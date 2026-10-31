const { app, BrowserWindow, shell, session } = require("electron");
const path = require("path");
const fs = require("fs");

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
    const app = new URL(appOrigin);
    if (u.origin === app.origin) return true;
    // Supabase auth / OAuth hosts — allow in-window; user stays in the shell.
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // Never spawn child BrowserWindows — that looked like constant flicker with Next popups/HMR.
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

    // Turbopack/Next full-reload loops fire will-navigate to the same URL repeatedly.
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

  // Soft-guard location.reload from injected page scripts (HMR fallback).
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
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
