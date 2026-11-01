const { app, BrowserWindow, shell, ipcMain, protocol } = require("electron");
const path = require("path");
const fs = require("fs");
const { Readable } = require("stream");
const engine = require("./engine");
const mediaServer = require("./media-server");

// Must register before app ready for custom schemes used by <video src>.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "shortlio-local",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

const DEFAULT_URL = "http://localhost:3000";
/** Ignore same-URL full reloads that arrive faster than this (Next/Turbopack HMR thrash). */
const RELOAD_GUARD_MS = 4000;

const MIME_BY_EXT = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function readBundledAppUrl() {
  try {
    const configPath = path.join(__dirname, "..", "app-config.json");
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.appUrl === "string" && parsed.appUrl.trim()) {
      return parsed.appUrl.trim().replace(/\/$/, "");
    }
  } catch {
    // fall through
  }
  return DEFAULT_URL;
}

/** Env wins over bundled config (dev + CI overrides). */
function resolveAppUrl() {
  const fromEnv = process.env.SHORTLIO_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return readBundledAppUrl();
}

function isAllowedNavigation(targetUrl, appOrigin) {
  try {
    const u = new URL(targetUrl);
    const appOriginUrl = new URL(appOrigin);
    if (u.origin === appOriginUrl.origin) return true;
    if (u.hostname.endsWith(".supabase.co")) return true;
    // Local media server for <video> / range requests
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") {
      const p = mediaServer.getMediaPort();
      if (p && Number(u.port) === Number(p)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function allowedMediaRoots() {
  const roots = [engine.clipsDir()];
  try {
    // Whole Videos tree — OUTPUT_DIR may be a Shortlio subfolder or sibling job folders.
    roots.push(path.join(require("os").homedir(), "Videos"));
  } catch {
    // ignore
  }
  try {
    roots.push(app.getPath("userData"));
  } catch {
    // ignore
  }
  return roots;
}

/** Windows paths often differ by drive-letter case; use case-fold compare there. */
function isPathInsideRoot(candidate, root) {
  const resolved = path.resolve(candidate);
  const base = path.resolve(root);
  if (process.platform === "win32") {
    const c = resolved.toLowerCase();
    const r = base.toLowerCase();
    return c === r || c.startsWith(r + "\\") || c.startsWith(r + "/");
  }
  return resolved === base || resolved.startsWith(base + path.sep);
}

function sameDocumentUrl(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname && ua.search === ub.search;
  } catch {
    return a === b;
  }
}

function mimeForPath(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function parseFilePathFromShortlioUrl(requestUrl) {
  let raw = requestUrl.replace(/^shortlio-local:\/\//i, "");
  // shortlio-local:///C:/path → /C:/path
  if (raw.startsWith("/") && /^\/[a-zA-Z]:/.test(raw)) {
    raw = raw.slice(1);
  }
  // Drop query/hash if a player appends them.
  const q = raw.search(/[?#]/);
  if (q >= 0) raw = raw.slice(0, q);
  return decodeURIComponent(raw).replace(/\//g, path.sep);
}

/**
 * Serve local media with Accept-Ranges + optional 206 Partial Content.
 * Chromium <video> seeking/startup often fails without Range support on custom schemes.
 */
function serveLocalMedia(request, filePath) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const mime = mimeForPath(filePath);
  const method = (request.method || "GET").toUpperCase();
  const rangeHeader = request.headers.get("Range") || request.headers.get("range");

  const baseHeaders = {
    "Accept-Ranges": "bytes",
    "Content-Type": mime,
    "Cache-Control": "no-cache",
  };

  if (method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: {
        ...baseHeaders,
        "Content-Length": String(size),
      },
    });
  }

  let start = 0;
  let end = size - 1;
  let status = 200;

  if (rangeHeader && size > 0) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (match) {
      const hasStart = match[1] !== "";
      const hasEnd = match[2] !== "";
      if (hasStart) start = Number.parseInt(match[1], 10);
      if (hasEnd) end = Number.parseInt(match[2], 10);
      if (!hasStart && hasEnd) {
        // bytes=-N → last N bytes
        const suffix = end;
        start = Math.max(0, size - suffix);
        end = size - 1;
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
        return new Response(null, {
          status: 416,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes */${size}`,
          },
        });
      }
      end = Math.min(end, size - 1);
      status = 206;
    }
  }

  const chunkSize = end - start + 1;
  const nodeStream = fs.createReadStream(filePath, { start, end });
  const webStream = Readable.toWeb(nodeStream);
  const headers = {
    ...baseHeaders,
    "Content-Length": String(chunkSize),
  };
  if (status === 206) {
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }

  return new Response(webStream, { status, headers });
}

function registerIpc() {
  ipcMain.handle("engine:status", () => engine.engineStatus());
  ipcMain.handle("engine:runJob", (_event, payload) => engine.runJob(payload || {}));
  ipcMain.handle("engine:cancel", (_event, payload) =>
    engine.cancelJob(payload?.jobId || ""),
  );
  ipcMain.handle("shell:openClipsFolder", () => engine.openClipsFolder());
  ipcMain.handle("media:resolveUrl", async (_event, payload) => {
    const fsPath = typeof payload === "string" ? payload : payload?.path;
    if (!fsPath || typeof fsPath !== "string") {
      return { ok: false, error: "path required" };
    }
    const resolved = path.resolve(fsPath);
    const roots = allowedMediaRoots();
    const allowed = roots.some((root) => isPathInsideRoot(resolved, root));
    if (!allowed) {
      return { ok: false, error: `path not allowed: ${resolved}` };
    }
    if (!fs.existsSync(resolved)) {
      return { ok: false, error: "file not found" };
    }
    // Ensure server is up even if ready-hook raced.
    try {
      if (!mediaServer.getMediaPort()) {
        await mediaServer.startMediaServer(allowedMediaRoots);
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "media server failed",
      };
    }
    const url = mediaServer.mediaUrlFor(resolved);
    if (!url) {
      return { ok: false, error: "media server not ready" };
    }
    return { ok: true, url };
  });
}

function createWindow() {
  const appUrl = resolveAppUrl();
  let lastMainNav = { url: "", at: 0 };

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "Shortlio",
    backgroundColor: "#0a0a0b",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url, appUrl)) {
      if (!sameDocumentUrl(win.webContents.getURL(), url)) {
        void win.loadURL(url);
      }
      return { action: "deny" };
    }
    void shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url, appUrl)) {
      event.preventDefault();
      void shell.openExternal(url);
      return;
    }

    const now = Date.now();
    const current = win.webContents.getURL();
    if (
      sameDocumentUrl(current, url) &&
      sameDocumentUrl(lastMainNav.url, url) &&
      now - lastMainNav.at < RELOAD_GUARD_MS
    ) {
      event.preventDefault();
      return;
    }
    lastMainNav = { url, at: now };
  });

  win.webContents.on("dom-ready", () => {
    void win.webContents
      .executeJavaScript(
        `(() => {
          if (window.__shortlioReloadGuard) return;
          window.__shortlioReloadGuard = true;
          const native = window.location.reload.bind(window.location);
          let last = 0;
          window.location.reload = function () {
            const now = Date.now();
            if (now - last < ${RELOAD_GUARD_MS}) return;
            last = now;
            return native();
          };
        })();`,
        true,
      )
      .catch(() => {});
  });

  win.loadURL(appUrl).catch((err) => {
    console.error("Failed to load Shortlio URL:", appUrl, err);
  });

  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    try {
      await mediaServer.startMediaServer(allowedMediaRoots);
    } catch (err) {
      console.error("Failed to start media server", err);
    }

    protocol.handle("shortlio-local", (request) => {
      try {
        const filePath = parseFilePathFromShortlioUrl(request.url);
        if (!filePath || !fs.existsSync(filePath)) {
          return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
        }
        const st = fs.statSync(filePath);
        if (!st.isFile()) {
          return new Response("Not a file", { status: 404, headers: { "Content-Type": "text/plain" } });
        }
        // Prefer buffering small range responses — more reliable than streaming
        // through custom schemes on some Electron builds.
        return serveLocalMedia(request, filePath);
      } catch (err) {
        console.error("shortlio-local protocol error", err);
        return new Response("Bad request", { status: 400, headers: { "Content-Type": "text/plain" } });
      }
    });

    registerIpc();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    mediaServer.stopMediaServer();
    if (process.platform !== "darwin") app.quit();
  });
}
