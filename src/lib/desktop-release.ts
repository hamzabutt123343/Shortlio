/**
 * Resolve the latest Shortlio Windows installer from GitHub Releases.
 * Asset names come from desktop/electron-builder.yml:
 *   Shortlio-${version}-win-x64.exe  (NSIS installer — preferred)
 *   Shortlio-${version}-portable.exe
 */

export const DESKTOP_GITHUB_OWNER = "hamzabutt123343";
export const DESKTOP_GITHUB_REPO = "Shortlio";
export const DESKTOP_RELEASE_TAG_PREFIX = "desktop-v";

export type DesktopInstallerInfo = {
  version: string;
  tagName: string;
  fileName: string;
  /** Direct GitHub asset URL — browser download starts without opening the Releases page. */
  downloadUrl: string;
  sizeBytes: number;
  publishedAt: string | null;
  htmlUrl: string;
};

type GitHubAsset = {
  name?: string;
  browser_download_url?: string;
  size?: number;
};

type GitHubRelease = {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  html_url?: string;
  assets?: GitHubAsset[];
};

/** Prefer NSIS installer over portable when both exist. */
export function pickWindowsInstallerAsset(
  assets: GitHubAsset[],
): { name: string; downloadUrl: string; sizeBytes: number } | null {
  const exe = assets.filter(
    (a) =>
      typeof a.name === "string" &&
      a.name.toLowerCase().endsWith(".exe") &&
      typeof a.browser_download_url === "string" &&
      a.browser_download_url.length > 0,
  );
  if (!exe.length) return null;

  const rank = (name: string): number => {
    const n = name.toLowerCase();
    if (n.includes("portable")) return 50;
    if (/shortlio-\d+\.\d+\.\d+-win-x64\.exe$/.test(n)) return 0;
    if (n.includes("win") && n.includes("x64")) return 1;
    if (n.startsWith("shortlio-") && n.endsWith(".exe")) return 10;
    return 40;
  };

  const best = [...exe].sort((a, b) => rank(a.name!) - rank(b.name!))[0];
  if (!best?.name || !best.browser_download_url) return null;
  return {
    name: best.name,
    downloadUrl: best.browser_download_url,
    sizeBytes: typeof best.size === "number" ? best.size : 0,
  };
}

export function versionFromDesktopTag(tagName: string): string {
  const t = tagName.trim();
  if (t.toLowerCase().startsWith(DESKTOP_RELEASE_TAG_PREFIX)) {
    return t.slice(DESKTOP_RELEASE_TAG_PREFIX.length);
  }
  if (/^v\d/i.test(t)) return t.slice(1);
  return t;
}

export function selectLatestDesktopRelease(
  releases: GitHubRelease[],
): DesktopInstallerInfo | null {
  const desktop = releases.find(
    (r) =>
      !r.draft &&
      !r.prerelease &&
      typeof r.tag_name === "string" &&
      r.tag_name.startsWith(DESKTOP_RELEASE_TAG_PREFIX),
  );
  if (!desktop?.tag_name) return null;
  const asset = pickWindowsInstallerAsset(desktop.assets ?? []);
  if (!asset) return null;
  return {
    version: versionFromDesktopTag(desktop.tag_name),
    tagName: desktop.tag_name,
    fileName: asset.name,
    downloadUrl: asset.downloadUrl,
    sizeBytes: asset.sizeBytes,
    publishedAt: desktop.published_at ?? null,
    htmlUrl: desktop.html_url ?? `https://github.com/${DESKTOP_GITHUB_OWNER}/${DESKTOP_GITHUB_REPO}/releases`,
  };
}

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "shortlio-web-download",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Fetch the newest published desktop-v* release and its Windows installer asset.
 * Optional GITHUB_TOKEN raises rate limits / allows private-repo metadata reads.
 * Public browser downloads still require a public Releases asset.
 */
export async function resolveLatestWindowsInstaller(): Promise<DesktopInstallerInfo> {
  const override = process.env.DESKTOP_INSTALLER_URL?.trim();
  const overrideName = process.env.DESKTOP_INSTALLER_FILENAME?.trim();
  if (override) {
    return {
      version: process.env.DESKTOP_INSTALLER_VERSION?.trim() || "latest",
      tagName: "override",
      fileName: overrideName || "Shortlio-windows.exe",
      downloadUrl: override,
      sizeBytes: Number(process.env.DESKTOP_INSTALLER_SIZE_BYTES || 0) || 0,
      publishedAt: null,
      htmlUrl: `https://github.com/${DESKTOP_GITHUB_OWNER}/${DESKTOP_GITHUB_REPO}/releases`,
    };
  }

  const url = `https://api.github.com/repos/${DESKTOP_GITHUB_OWNER}/${DESKTOP_GITHUB_REPO}/releases?per_page=30`;
  const res = await fetch(url, {
    headers: githubHeaders(),
    // Keep fresh so a new desktop-v* tag is offered within seconds of publish.
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 404) {
      throw new Error(
        "Desktop releases are not publicly reachable yet. Make the GitHub repo public " +
          "(or publish a public release), or set DESKTOP_INSTALLER_URL to a direct .exe URL.",
      );
    }
    throw new Error(
      `GitHub Releases unavailable (${res.status})${body ? `: ${body.slice(0, 180)}` : ""}`,
    );
  }
  const releases = (await res.json()) as GitHubRelease[];
  const latest = selectLatestDesktopRelease(Array.isArray(releases) ? releases : []);
  if (!latest) {
    throw new Error(
      "No published desktop-v* Windows installer found on GitHub Releases. " +
        "Publish a desktop-v* tag release, or set DESKTOP_INSTALLER_URL.",
    );
  }
  return latest;
}
