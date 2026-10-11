import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { NewProjectForm } from "@/components/new-project-form";
import { Badge, Card, EmptyState } from "@/components/ui";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getUsageInfo } from "@/lib/quota";
import { createClient } from "@/lib/supabase/server";
import { getWorkerStatus } from "@/lib/worker-status";
import { STAGE_LABELS } from "@/lib/types";

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
          {!projects?.length ? (
            <EmptyState
              title="No projects yet"
              description="Paste a supported public video URL above to start your first Shortlio project."
            />
          ) : (
            <div className="space-y-3">
              {projects.map((project) => (
                <Link key={project.id} href={`/projects/${project.id}`}>
                  <Card className="mb-3 transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {project.source_title || project.source_url}
                        </p>
                        <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                          {project.source_platform} · {project.requested_clip_count} clips
                        </p>
                      </div>
                      <Badge
                        tone={
                          project.status === "ready"
                            ? "success"
                            : project.status === "failed"
                              ? "danger"
                              : "accent"
                        }
                      >
                        {STAGE_LABELS[project.status] || project.status}
                      </Badge>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
