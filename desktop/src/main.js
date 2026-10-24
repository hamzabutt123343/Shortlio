const { app, BrowserWindow, shell, session } = require("electron");
const path = require("path");
const fs = require("fs");

const DEFAULT_URL = "http://localhost:3000";

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

function createWindow() {
  const appUrl = resolveAppUrl();

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
    },
  });

  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url, appUrl)) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url, appUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.loadURL(appUrl).catch((err) => {
    console.error("Failed to load Shortlio URL:", appUrl, err);
  });

  return win;
}

app.whenReady().then(() => {
  // Prefer Chromium network stack defaults; no custom cert bypass.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
