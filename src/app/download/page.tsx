import Link from "next/link";
import type { Metadata } from "next";
import { MonitorSmartphone, HardDrive, Shield } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { DESKTOP_RELEASES_URL } from "@/lib/desktop";

export const metadata: Metadata = {
  title: "Download Shortlio for Windows",
  description:
    "Install Shortlio for Windows — process YouTube, Kick, and Twitch clips on your PC with bundled FFmpeg and AI.",
};

export default async function DownloadPage() {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader authed={Boolean(user)} />

      <main className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_0%,rgba(255,92,57,0.12),transparent_55%)]" />
        <div className="relative mx-auto max-w-3xl px-4 py-20 md:py-28">
          <div className="flex items-center gap-4">
            <BrandLogo size={72} className="rounded-[18px]" priority />
            <p className="font-[family-name:var(--font-display)] text-4xl font-extrabold tracking-tight md:text-5xl">
              Shortlio
            </p>
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">
            Download for Windows
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-[var(--text-muted)] md:text-lg">
            The Windows app is the full Shortlio product. After install, open Shortlio from the Start
            menu — do not create clips in Chrome. You must use a build that shows{" "}
            <strong className="text-[var(--text)]">Desktop engine connected</strong> under the logo;
            older GitHub EXEs only wrap the website and cannot process video yet.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <a href={DESKTOP_RELEASES_URL} target="_blank" rel="noopener noreferrer">
              <Button className="min-w-[200px] px-6 py-3">
                <MonitorSmartphone className="mr-2 h-4 w-4" aria-hidden />
                Get Windows installer
              </Button>
            </a>
            <Link href={user ? "/billing" : "/signup"}>
              <Button variant="secondary" className="px-6 py-3">
                {user ? "Manage billing" : "Create account"}
              </Button>
            </Link>
          </div>

          <ul className="mt-12 space-y-4 text-sm leading-relaxed text-[var(--text-muted)]">
            <li className="flex gap-3">
              <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden />
              <span>
                No separate Python, Node, or FFmpeg install — the installer bundles the processing
                engine. No always-on cloud worker on our side for your clips.
              </span>
            </li>
            <li className="flex gap-3">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden />
              <span>
                API secrets stay on the server. Daily free/Pro limits are enforced by the backend
                when you create projects.
              </span>
            </li>
            <li>
              Installer and portable builds are on{" "}
              <a
                href={DESKTOP_RELEASES_URL}
                className="text-[var(--accent)] underline-offset-2 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub Releases
              </a>
              . Pick the latest <code className="text-[var(--text)]">.exe</code>.
            </li>
          </ul>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
