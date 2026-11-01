/** Clips saved by the desktop engine use storage_path `local:C:\...\file.mp4`. */

export function parseLocalClipPath(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null;
  if (!storagePath.startsWith("local:")) return null;
  const raw = storagePath.slice("local:".length).trim();
  return raw || null;
}

/**
 * Electron custom protocol URL for local playback inside the desktop shell.
 * Encodes each path segment so spaces / unicode in Windows paths don't break <video>.
 */
export function localClipProtocolUrl(fsPath: string): string {
  const normalized = fsPath.replace(/\\/g, "/");
  const encodeSegments = (p: string) =>
    p
      .split("/")
      .map((seg) => (seg ? encodeURIComponent(seg) : ""))
      .join("/");

  // shortlio-local:///C:/Users/...
  if (/^[a-zA-Z]:\//.test(normalized)) {
    const drive = normalized.slice(0, 2); // C:
    const rest = normalized.slice(2); // /Users/...
    return `shortlio-local:///${drive}${encodeSegments(rest)}`;
  }
  const withSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `shortlio-local://${encodeSegments(withSlash)}`;
}
