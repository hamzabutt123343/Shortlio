/** Client-side bridge to the Shortlio Windows desktop shell (Electron preload). */

export type ShortlioDesktopBridge = {
  version: string;
  engineReady: boolean;
  isDesktop: true;
  runJob: (jobId: string, accessToken: string) => Promise<{ ok: boolean; error?: string }>;
  cancelJob: (jobId: string) => Promise<{ ok: boolean }>;
  openClipsFolder: () => Promise<{ ok: boolean; path?: string }>;
  getEngineStatus: () => Promise<{
    ready: boolean;
    runningJobId: string | null;
    clipsDir: string;
  }>;
};

declare global {
  interface Window {
    shortlioDesktop?: ShortlioDesktopBridge;
  }
}

/** True only when Electron preload injected the processing bridge. */
export function isShortlioDesktop(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.shortlioDesktop?.isDesktop);
}

/** Electron shell without a modern preload (old GitHub EXE). */
export function isOutdatedElectronShell(): boolean {
  if (typeof window === "undefined") return false;
  if (isShortlioDesktop()) return false;
  return /Electron/i.test(navigator.userAgent);
}

export function getShortlioDesktop(): ShortlioDesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.shortlioDesktop ?? null;
}
