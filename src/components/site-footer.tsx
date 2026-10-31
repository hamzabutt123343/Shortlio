import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { DISCORD_INVITE_URL } from "@/lib/pricing";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--bg-elevated)]/40">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="flex items-center gap-2.5 font-[family-name:var(--font-display)] text-lg font-bold">
            <BrandLogo size={28} />
            Shortlio
          </p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">
            The fastest clipping software — AI moments, face-aware reframing, and animated captions
            for Shorts, TikTok, and Reels.
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Product
          </p>
          <ul className="mt-3 space-y-2 text-sm text-[var(--text-muted)]">
            <li>
              <Link href="/#features" className="hover:text-[var(--text)]">
                Features
              </Link>
            </li>
            <li>
              <Link href="/#how" className="hover:text-[var(--text)]">
                How It Works
              </Link>
            </li>
            <li>
              <Link href="/pricing" className="hover:text-[var(--text)]">
                Pricing
              </Link>
            </li>
            <li>
              <Link href="/download" className="hover:text-[var(--text)]">
                Download for Windows
              </Link>
            </li>
            <li>
              <a
                href={DISCORD_INVITE_URL}
                className="hover:text-[var(--text)]"
                target="_blank"
                rel="noopener noreferrer"
              >
                Discord (buy Pro)
              </a>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Account
          </p>
          <ul className="mt-3 space-y-2 text-sm text-[var(--text-muted)]">
            <li>
              <Link href="/login" className="hover:text-[var(--text)]">
                Sign In
              </Link>
            </li>
            <li>
              <Link href="/signup" className="hover:text-[var(--text)]">
                Get Started
              </Link>
            </li>
            <li>
              <Link href="/dashboard" className="hover:text-[var(--text)]">
                Dashboard
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} Shortlio. Process only content you have rights to use.</p>
          <p>Built for Shorts, TikTok, and Reels.</p>
        </div>
      </div>
    </footer>
  );
}
