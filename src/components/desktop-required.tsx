"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { MonitorSmartphone, RefreshCw } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui";
import { DESKTOP_DOWNLOAD_PATH, DESKTOP_RELEASES_URL } from "@/lib/desktop";
import { isOutdatedElectronShell, isShortlioDesktop } from "@/lib/desktop-bridge";

type Mode = "loading" | "desktop" | "outdated" | "browser";

/**
 * Processing UI is desktop-only. Requires Electron + modern preload (`window.shortlioDesktop`).
 * Old GitHub EXEs load the site without the bridge — show an update message, not the create form.
 */
export function DesktopRequired({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("loading");

  useEffect(() => {
    if (isShortlioDesktop()) {
      setMode("desktop");
      return;
    }
    if (isOutdatedElectronShell()) {
      setMode("outdated");
      return;
    }
    setMode("browser");
  }, []);

  if (mode === "loading") {
    return (
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/50 px-4 py-8 text-center text-sm text-[var(--text-muted)]">
        Checking desktop app…
      </div>
    );
  }

  if (mode === "desktop") {
    return <>{children}</>;
  }

  if (mode === "outdated") {
    return (
      <div className="rounded-[12px] border border-[var(--warning)]/35 bg-[var(--warning)]/10 px-5 py-8 text-center">
        <BrandLogo size={56} className="mx-auto rounded-[14px]" />
        <h2 className="mt-4 font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
          Update Shortlio desktop
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--text-muted)]">
          This window is the Windows app, but it&apos;s an <strong className="text-[var(--text)]">old build</strong>{" "}
          without the local processing engine. The EXE from GitHub Releases hasn&apos;t been rebuilt since
          desktop processing was added — uninstall it and install a fresh build, or run the new app from the
          project.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <a href={DESKTOP_RELEASES_URL} target="_blank" rel="noopener noreferrer">
            <Button className="px-5">
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
              Get latest EXE
            </Button>
          </a>
          <Link href={DESKTOP_DOWNLOAD_PATH}>
            <Button variant="secondary" className="px-5">
              Setup help
            </Button>
          </Link>
        </div>
        <p className="mx-auto mt-4 max-w-lg text-xs leading-relaxed text-[var(--text-muted)]">
          Dev shortcut on this PC: close this window, then in a terminal run{" "}
          <code className="text-[var(--text)]">cd D:\shortlio\desktop</code> →{" "}
          <code className="text-[var(--text)]">npm run dev</code> (with <code className="text-[var(--text)]">npm run
          dev</code> already running in the repo root).
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/70 px-5 py-8 text-center">
      <BrandLogo size={56} className="mx-auto rounded-[14px]" />
      <h2 className="mt-4 font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
        Open the Shortlio Windows app
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--text-muted)]">
        This is Chrome/Edge — not the desktop app. Closing this tab and installing an EXE that still
        shows this card usually means the EXE is outdated. Use a freshly built Shortlio window (title
        bar should be a normal app window, not a browser with tabs).
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <a href={DESKTOP_RELEASES_URL} target="_blank" rel="noopener noreferrer">
          <Button className="px-5">
            <MonitorSmartphone className="mr-2 h-4 w-4" aria-hidden />
            Download / reinstall EXE
          </Button>
        </a>
        <Link href={DESKTOP_DOWNLOAD_PATH}>
          <Button variant="secondary" className="px-5">
            Setup help
          </Button>
        </Link>
      </div>
    </div>
  );
}
