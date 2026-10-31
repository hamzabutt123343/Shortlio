const { app, BrowserWindow, shell, ipcMain, protocol } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const engine = require("./engine");

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
    return false;
  } catch {
    return false;
  }
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

function registerIpc() {
  ipcMain.handle("engine:status", () => engine.engineStatus());
  ipcMain.handle("engine:runJob", (_event, payload) => engine.runJob(payload || {}));
  ipcMain.handle("engine:cancel", (_event, payload) =>
    engine.cancelJob(payload?.jobId || ""),
  );
  ipcMain.handle("shell:openClipsFolder", () => engine.openClipsFolder());
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

  app.whenReady().then(() => {
    protocol.handle("shortlio-local", (request) => {
      try {
        let raw = request.url.replace(/^shortlio-local:\/\//, "");
        // shortlio-local:///C:/path → /C:/path
        if (raw.startsWith("/") && /^\/[a-zA-Z]:/.test(raw)) {
          raw = raw.slice(1);
        }
        const filePath = decodeURIComponent(raw).replace(/\//g, path.sep);
        if (!fs.existsSync(filePath)) {
          return new Response("Not found", { status: 404 });
        }
        return netFetchFile(filePath);
      } catch (err) {
        console.error("shortlio-local protocol error", err);
        return new Response("Bad request", { status: 400 });
      }
    });

    registerIpc();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  function netFetchFile(filePath) {
    // Electron 35+: protocol.handle expects a Response / fetch-like result.
    const { net } = require("electron");
    return net.fetch(pathToFileURL(filePath).href);
  }

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
