"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Clapperboard, CreditCard, LayoutDashboard, LogOut, Settings } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/components/ui";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({
  children,
  planLabel,
  usageLabel,
}: {
  children: React.ReactNode;
  planLabel?: string;
  usageLabel?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="border-b border-[var(--border)] md:border-b-0 md:border-r md:min-h-screen">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <Link href="/dashboard" className="flex items-center gap-2 font-[family-name:var(--font-display)] text-lg font-bold">
            <Clapperboard className="h-5 w-5 text-[var(--accent)]" />
            Shortlio
          </Link>
          <div className="mt-0 flex gap-1 md:mt-8 md:flex-col">
            {links.map((link) => {
              const Icon = link.icon;
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm transition",
                    active
                      ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                      : "text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text)]",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden md:inline">{link.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
        <div className="hidden space-y-2 border-t border-[var(--border)] px-4 py-4 md:block">
          {planLabel && (
            <p className="text-xs text-[var(--text-muted)]">
              Plan: <span className="text-[var(--text)]">{planLabel}</span>
            </p>
          )}
          {usageLabel && (
            <p className="text-xs text-[var(--text-muted)]">{usageLabel}</p>
          )}
          <button
            type="button"
            onClick={signOut}
            className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>
      <main className="px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
