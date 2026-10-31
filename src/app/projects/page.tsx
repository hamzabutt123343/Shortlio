import { AppShell } from "@/components/app-shell";
import { RecentProjects } from "@/components/recent-projects";
import { Button } from "@/components/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getUsageInfo } from "@/lib/quota";
import { createClient } from "@/lib/supabase/server";
import type { Project } from "@/lib/types";

export default async function ProjectsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const usage = await getUsageInfo(user.id);
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const usageLabel =
    usage.plan === "pro"
      ? "Pro · unlimited (fair use)"
      : `Basic · ${usage.remaining}/${usage.limit} clips left today`;

  return (
    <AppShell
      planLabel={usage.plan === "pro" ? "Pro" : "Basic"}
      usageLabel={usageLabel}
      title="Projects"
    >
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">
              Projects
            </h1>
            <p className="mt-1.5 text-sm text-[var(--text-muted)]">
              History of your imports, analysis jobs, and exported clips.
            </p>
          </div>
          <Link href="/create">
            <Button>Create New Clips</Button>
          </Link>
        </div>
        <RecentProjects projects={(projects ?? []) as Project[]} />
      </div>
    </AppShell>
  );
}
