import { describe, expect, it } from "vitest";
import {
  pickWindowsInstallerAsset,
  selectLatestDesktopRelease,
  versionFromDesktopTag,
} from "@/lib/desktop-release";

describe("desktop-release", () => {
  it("parses desktop-v tags", () => {
    expect(versionFromDesktopTag("desktop-v0.2.1")).toBe("0.2.1");
    expect(versionFromDesktopTag("v1.0.0")).toBe("1.0.0");
  });

  it("prefers NSIS win-x64 over portable", () => {
    const picked = pickWindowsInstallerAsset([
      {
        name: "Shortlio-0.2.1-portable.exe",
        browser_download_url: "https://example.com/portable.exe",
        size: 10,
      },
      {
        name: "Shortlio-0.2.1-win-x64.exe",
        browser_download_url: "https://example.com/nsis.exe",
        size: 20,
      },
    ]);
    expect(picked?.name).toBe("Shortlio-0.2.1-win-x64.exe");
    expect(picked?.downloadUrl).toBe("https://example.com/nsis.exe");
  });

  it("selects newest non-draft desktop-v release", () => {
    const info = selectLatestDesktopRelease([
      {
        tag_name: "web-v9",
        draft: false,
        prerelease: false,
        assets: [],
      },
      {
        tag_name: "desktop-v0.2.1",
        draft: false,
        prerelease: false,
        published_at: "2026-03-01T00:00:00Z",
        html_url: "https://github.com/hamzabutt123343/Shortlio/releases/tag/desktop-v0.2.1",
        assets: [
          {
            name: "Shortlio-0.2.1-win-x64.exe",
            browser_download_url:
              "https://github.com/hamzabutt123343/Shortlio/releases/download/desktop-v0.2.1/Shortlio-0.2.1-win-x64.exe",
            size: 120_000_000,
          },
        ],
      },
    ]);
    expect(info?.version).toBe("0.2.1");
    expect(info?.fileName).toBe("Shortlio-0.2.1-win-x64.exe");
    expect(info?.downloadUrl).toContain("Shortlio-0.2.1-win-x64.exe");
  });

  it("skips draft / prerelease desktop tags", () => {
    const info = selectLatestDesktopRelease([
      {
        tag_name: "desktop-v0.3.0",
        draft: true,
        assets: [
          {
            name: "Shortlio-0.3.0-win-x64.exe",
            browser_download_url: "https://example.com/draft.exe",
          },
        ],
      },
      {
        tag_name: "desktop-v0.2.0",
        prerelease: true,
        assets: [
          {
            name: "Shortlio-0.2.0-win-x64.exe",
            browser_download_url: "https://example.com/pre.exe",
          },
        ],
      },
    ]);
    expect(info).toBeNull();
  });

  it("honors DESKTOP_INSTALLER_URL override", async () => {
    const prev = {
      url: process.env.DESKTOP_INSTALLER_URL,
      name: process.env.DESKTOP_INSTALLER_FILENAME,
      ver: process.env.DESKTOP_INSTALLER_VERSION,
      size: process.env.DESKTOP_INSTALLER_SIZE_BYTES,
    };
    process.env.DESKTOP_INSTALLER_URL = "https://cdn.example/Shortlio-0.2.2-win-x64.exe";
    process.env.DESKTOP_INSTALLER_FILENAME = "Shortlio-0.2.2-win-x64.exe";
    process.env.DESKTOP_INSTALLER_VERSION = "0.2.2";
    process.env.DESKTOP_INSTALLER_SIZE_BYTES = "999";
    try {
      const { resolveLatestWindowsInstaller } = await import("@/lib/desktop-release");
      const info = await resolveLatestWindowsInstaller();
      expect(info.downloadUrl).toContain("cdn.example");
      expect(info.fileName).toBe("Shortlio-0.2.2-win-x64.exe");
      expect(info.version).toBe("0.2.2");
    } finally {
      for (const [k, v] of Object.entries({
        DESKTOP_INSTALLER_URL: prev.url,
        DESKTOP_INSTALLER_FILENAME: prev.name,
        DESKTOP_INSTALLER_VERSION: prev.ver,
        DESKTOP_INSTALLER_SIZE_BYTES: prev.size,
      })) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
