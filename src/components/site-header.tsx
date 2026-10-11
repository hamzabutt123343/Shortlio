import Link from "next/link";
import { Button } from "@/components/ui";

export function SiteHeader({
  authed = false,
}: {
  authed?: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)]/80 bg-[var(--bg)]/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="font-[family-name:var(--font-display)] text-xl font-bold tracking-tight">
          Shortlio
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-[var(--text-muted)] md:flex">
          <Link href="/pricing" className="hover:text-[var(--text)]">
            Pricing
          </Link>
          <Link href="#how" className="hover:text-[var(--text)]">
            How it works
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          {authed ? (
            <Link href="/dashboard">
              <Button>Dashboard</Button>
            </Link>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost">Sign in</Button>
              </Link>
              <Link href="/signup">
                <Button>Get started</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
