/** Clips saved by the desktop engine use storage_path `local:C:\...\file.mp4`. */

export function parseLocalClipPath(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null;
  if (!storagePath.startsWith("local:")) return null;
  const raw = storagePath.slice("local:".length).trim();
  return raw || null;
}

/** Electron custom protocol URL for local playback inside the desktop shell. */
export function localClipProtocolUrl(fsPath: string): string {
  const normalized = fsPath.replace(/\\/g, "/");
  // shortlio-local:///C:/Users/...
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `shortlio-local:///${normalized}`;
  }
  return `shortlio-local://${normalized.startsWith("/") ? "" : "/"}${normalized}`;
}
