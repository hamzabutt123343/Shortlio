/** GitHub Releases page (fallback when the direct installer API is unavailable). */
export const DESKTOP_RELEASES_URL =
  "https://github.com/hamzabutt123343/Shortlio/releases/latest";

/** Marketing / setup page. */
export const DESKTOP_DOWNLOAD_PATH = "/download";

/**
 * Same-origin endpoint that 302s to the latest Windows .exe asset.
 * Prefer this for all “Download Windows” CTAs so users never land on GitHub.
 */
export const DESKTOP_DOWNLOAD_API_PATH = "/api/desktop/download";

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}