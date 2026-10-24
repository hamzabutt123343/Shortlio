import Link from "next/link";
import type { Metadata } from "next";
import { MonitorSmartphone, Globe } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { DESKTOP_RELEASES_URL } from "@/lib/desktop";

export const metadata: Metadata = {
  title: "Download Shortlio for Windows",
  description:
    "Install the Shortlio Windows app — same account and cloud rendering as the web app, in a native desktop window.",
};

export default async function DownloadPage() {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader authed={Boolean(user)} />

      <main className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_0%,rgba(255,92,57,0.12),transparent_55%)]" />
        <div className="relative mx-auto max-w-3xl px-4 py-20 md:py-28">
          <p className="font-[family-name:var(--font-display)] text-4xl font-extrabold tracking-tight md:text-5xl">
            Shortlio
          </p>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">
            Download for Windows
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-[var(--text-muted)] md:text-lg">
            The Windows app is a thin desktop shell around the same Shortlio web product. Sign in
            with your existing account — clips still render in the cloud via the worker.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <a href={DESKTOP_RELEASES_URL} target="_blank" rel="noopener noreferrer">
              <Button className="min-w-[200px] px-6 py-3">
                <MonitorSmartphone className="mr-2 h-4 w-4" aria-hidden />
                Get Windows installer
              </Button>
            </a>
            <Link href={user ? "/dashboard" : "/signup"}>
              <Button variant="secondary" className="px-6 py-3">
                <Globe className="mr-2 h-4 w-4" aria-hidden />
                Use in browser
              </Button>
            </Link>
          </div>

          <ul className="mt-12 space-y-3 text-sm leading-relaxed text-[var(--text-muted)]">
            <li>
              Installer and portable builds are published on{" "}
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
            <li>
              Before first launch against production, the desktop build must point at your hosted
              site URL (<code className="text-[var(--text)]">SHORTLIO_APP_URL</code> /{" "}
              <code className="text-[var(--text)]">app-config.json</code>).
            </li>
            <li>Web and desktop share the same Supabase auth, projects, and clip library.</li>
          </ul>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
