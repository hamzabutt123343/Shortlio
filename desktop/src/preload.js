const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("shortlioDesktop", {
  isDesktop: true,
  version: process.env.npm_package_version || "0.2.1",
  engineReady: true,
  runJob: (jobId, accessToken) =>
    ipcRenderer.invoke("engine:runJob", { jobId, accessToken }),
  cancelJob: (jobId) => ipcRenderer.invoke("engine:cancel", { jobId }),
  openClipsFolder: () => ipcRenderer.invoke("shell:openClipsFolder"),
  getEngineStatus: () => ipcRenderer.invoke("engine:status"),
  /** Resolve a local filesystem path to an http://127.0.0.1 media URL (Range-capable). */
  resolveMediaUrl: (fsPath) => ipcRenderer.invoke("media:resolveUrl", { path: fsPath }),
});
