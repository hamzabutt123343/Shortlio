"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useEffectEvent } from "react";
import {
  CreditCard,
  LayoutDashboard,
  LogOut,
  PlusCircle,
  Settings,
  FolderOpen,
  LayoutTemplate,
  ChevronDown,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { isShortlioDesktop } from "@/lib/desktop-bridge";
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

function titleFromPath(pathname: string): string {
  if (pathname.startsWith("/clips/")) return "Clip editor";
  if (pathname.startsWith("/projects/") && pathname !== "/projects") return "Project";
  if (pathname.startsWith("/create")) return "Create Clips";
  if (pathname.startsWith("/projects")) return "Projects";
  if (pathname.startsWith("/templates")) return "Templates";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/billing")) return "Billing";
  if (pathname.startsWith("/dashboard")) return "Dashboard";
  return "Video workspace";
}

export function AppShell({
  children,
  planLabel,
  usageLabel,
  title,
}: {
  children: React.ReactNode;
  planLabel?: string;
  usageLabel?: string;
  /** Optional override; defaults from pathname for snappy shared-layout nav. */
  title?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [desktopOnline, setDesktopOnline] = useState(false);
  const [navPending, setNavPending] = useState(false);

  const headerTitle = title ?? titleFromPath(pathname);

  const onPathChange = useEffectEvent((path: string) => {
    setNavPending(false);
    setMenuOpen(false);
    void path;
  });

  useEffect(() => {
    onPathChange(pathname);
  }, [pathname]);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
    setDesktopOnline(isShortlioDesktop());
  }, []);

  function markNavStart(href: string) {
    if (href === pathname) return;
    setNavPending(true);
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="relative min-h-screen bg-[var(--bg)] md:grid md:grid-cols-[240px_1fr]">
      {navPending && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-[var(--border)]"
          aria-hidden
        >
          <div className="h-full w-1/3 animate-[shortlio-nav-slide_0.7s_ease-in-out_infinite] bg-[var(--accent)]" />
        </div>
      )}
      <aside className="border-b border-[var(--border)] bg-[var(--bg-elevated)]/50 md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <Link
            href="/dashboard"
            onClick={() => markNavStart("/dashboard")}
            className="flex items-center gap-2.5 font-[family-name:var(--font-display)] text-lg font-bold tracking-tight"
          >
            <BrandLogo size={32} />
            Shortlio
          </Link>
          {desktopOnline && (
            <p className="mt-2 hidden text-[10px] font-medium uppercase tracking-wider text-[var(--success)] md:block">
              Desktop engine connected
            </p>
          )}

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
                  onClick={() => markNavStart(link.href)}
                  className={cn(
                    "flex shrink-0 items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm transition-colors duration-100",
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
            className="flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-sm text-[var(--text-muted)] transition-colors duration-100 hover:bg-white/5 hover:text-[var(--text)]"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg)]/90 px-4 backdrop-blur-md md:px-8">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--text)]">{headerTitle}</p>
          </div>
          <div className="flex items-center gap-2">
            {usageLabel && (
              <p className="hidden text-xs text-[var(--text-muted)] lg:block">{usageLabel}</p>
            )}
            {planLabel === "Basic" && (
              <Link
                href="/billing"
                onClick={() => markNavStart("/billing")}
                className="hidden sm:block"
              >
                <Button variant="secondary" className="px-3 py-1.5 text-xs">
                  Upgrade
                </Button>
              </Link>
            )}
            <Link href="/create" onClick={() => markNavStart("/create")}>
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
                    onClick={() => {
                      setMenuOpen(false);
                      markNavStart("/settings");
                    }}
                  >
                    Settings
                  </Link>
                  <Link
                    href="/billing"
                    role="menuitem"
                    className="block px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text)]"
                    onClick={() => {
                      setMenuOpen(false);
                      markNavStart("/billing");
                    }}
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
