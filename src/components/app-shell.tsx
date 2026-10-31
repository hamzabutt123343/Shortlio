"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Clapperboard,
  CreditCard,
  LayoutDashboard,
  LogOut,
  PlusCircle,
  Settings,
  FolderOpen,
  LayoutTemplate,
  ChevronDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button, cn } from "@/components/ui";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/create", label: "Create Clips", icon: PlusCircle },
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/billing", label: "Billing", icon: CreditCard },
];

export function AppShell({
  children,
  planLabel,
  usageLabel,
  title,
}: {
  children: React.ReactNode;
  planLabel?: string;
  usageLabel?: string;
  title?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-b border-[var(--border)] bg-[var(--bg-elevated)]/50 md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 font-[family-name:var(--font-display)] text-lg font-bold tracking-tight"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] bg-[var(--accent-dim)] text-[var(--accent)]">
              <Clapperboard className="h-4 w-4" />
            </span>
            Shortlio
          </Link>

          <nav className="mt-0 flex gap-0.5 overflow-x-auto md:mt-8 md:flex-col md:gap-1">
            {links.map((link) => {
              const Icon = link.icon;
              const active =
                pathname === link.href ||
                (link.href !== "/dashboard" && pathname.startsWith(`${link.href}/`)) ||
                (link.href === "/projects" && pathname.startsWith("/projects"));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "flex shrink-0 items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm transition",
                    active
                      ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                      : "text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text)]",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline md:inline">{link.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto hidden space-y-3 border-t border-[var(--border)] px-4 py-4 md:block">
          {planLabel && (
            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]/80 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Plan
              </p>
              <p className="mt-0.5 text-sm font-medium text-[var(--text)]">{planLabel}</p>
              {usageLabel && (
                <p className="mt-1 text-xs leading-snug text-[var(--text-muted)]">{usageLabel}</p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-sm text-[var(--text-muted)] transition hover:bg-white/5 hover:text-[var(--text)]"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg)]/90 px-4 backdrop-blur-md md:px-8">
          <div className="min-w-0">
            {title ? (
              <p className="truncate text-sm font-medium text-[var(--text)]">{title}</p>
            ) : (
              <p className="truncate text-sm text-[var(--text-muted)]">Video workspace</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {usageLabel && (
              <p className="hidden text-xs text-[var(--text-muted)] lg:block">{usageLabel}</p>
            )}
            {planLabel === "Basic" && (
              <Link href="/billing" className="hidden sm:block">
                <Button variant="secondary" className="px-3 py-1.5 text-xs">
                  Upgrade
                </Button>
              </Link>
            )}
            <Link href="/create">
              <Button className="px-3 py-1.5 text-xs sm:text-sm">
                <PlusCircle className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Create</span>
              </Button>
            </Link>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <span className="max-w-[120px] truncate">{email ?? "Account"}</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-1.5 w-44 overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] py-1 shadow-xl"
                >
                  <Link
                    href="/settings"
                    role="menuitem"
                    className="block px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text)]"
                    onClick={() => setMenuOpen(false)}
                  >
                    Settings
                  </Link>
                  <Link
                    href="/billing"
                    role="menuitem"
                    className="block px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text)]"
                    onClick={() => setMenuOpen(false)}
                  >
                    Billing
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text)]"
                    onClick={() => {
                      setMenuOpen(false);
                      void signOut();
                    }}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
