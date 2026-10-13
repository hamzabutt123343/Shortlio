import { AppShell } from "@/components/app-shell";
import { NewProjectForm } from "@/components/new-project-form";
import { RecentProjects } from "@/components/recent-projects";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getUsageInfo } from "@/lib/quota";
import { createClient } from "@/lib/supabase/server";
import { getWorkerStatus } from "@/lib/worker-status";
import type { Project } from "@/lib/types";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const usage = await getUsageInfo(user.id);
  const worker = await getWorkerStatus();
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const usageLabel =
    usage.plan === "pro"
      ? "Pro · unlimited (fair use)"
      : `Free · ${usage.remaining}/${usage.limit} clips left today`;

  return (
    <AppShell planLabel={usage.plan === "pro" ? "Pro" : "Free"} usageLabel={usageLabel}>
      <div className="mx-auto max-w-5xl space-y-8">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold">Dashboard</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Create a project to analyze a public video and generate clips.
          </p>
        </div>

        {!worker.available && (
          <div className="rounded-[10px] border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-3 text-sm text-[var(--warning)]">
            {worker.message}
          </div>
        )}

        <NewProjectForm usage={usage} />

        <section>
          <h2 className="mb-3 font-[family-name:var(--font-display)] text-lg font-semibold">
            Recent projects
          </h2>
          <RecentProjects projects={(projects ?? []) as Project[]} />
        </section>
      </div>
    </AppShell>
  );
}
