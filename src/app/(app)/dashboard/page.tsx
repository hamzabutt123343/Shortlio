import Link from "next/link";
import { DesktopRequired } from "@/components/desktop-required";
import { NewProjectForm } from "@/components/new-project-form";
import { RecentProjects } from "@/components/recent-projects";
import { Button } from "@/components/ui";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getUsageInfo } from "@/lib/quota";
import { createClient } from "@/lib/supabase/server";
import type { Project } from "@/lib/types";
import { Captions, Ratio, ScanFace, Languages } from "lucide-react";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [usage, supabase] = await Promise.all([getUsageInfo(user.id), createClient()]);
  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(12);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">
            Create clips
          </h1>
          <p className="mt-1.5 max-w-xl text-sm text-[var(--text-muted)]">
            Paste a public video URL in the Windows app to analyze moments, reframe speakers, and
            export shorts to your PC.
          </p>
        </div>
        <Link href="/create">
          <Button>Create New Clips</Button>
        </Link>
      </div>

      {usage.plan === "free" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/70 px-4 py-3">
          <p className="text-sm text-[var(--text-muted)]">
            <span className="font-medium text-[var(--text)]">
              {usage.remaining}/{usage.limit}
            </span>{" "}
            free clips remaining today (UTC reset).
          </p>
          <Link href="/billing">
            <Button variant="secondary" className="text-xs">
              Upgrade — Rs 500 lifetime
            </Button>
          </Link>
        </div>
      )}

      <div id="create">
        <DesktopRequired>
          <NewProjectForm usage={usage} />
        </DesktopRequired>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: "/templates", icon: Captions, label: "Caption styles" },
          { href: "/create", icon: ScanFace, label: "Smart reframing" },
          { href: "/create", icon: Languages, label: "Languages & Hinglish" },
          { href: "/create", icon: Ratio, label: "Aspect ratios" },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              className="flex items-center gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/50 px-4 py-3 text-sm transition-colors duration-100 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
            >
              <Icon className="h-4 w-4 text-[var(--accent)]" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Recent projects
          </h2>
          <Link href="/projects" className="text-sm text-[var(--accent)] hover:underline">
            View all
          </Link>
        </div>
        <RecentProjects projects={(projects ?? []) as Project[]} />
      </section>
    </div>
  );
}
