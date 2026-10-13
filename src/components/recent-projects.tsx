"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { STAGE_LABELS, type Project } from "@/lib/types";

export function RecentProjects({ projects: initial }: { projects: Project[] }) {
  const router = useRouter();
  const [projects, setProjects] = useState(initial);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function deleteProject(id: string) {
    if (deletingId) return;
    const confirmed = window.confirm("Delete this project and its clips? This cannot be undone.");
    if (!confirmed) return;

    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete project");
      setProjects((prev) => prev.filter((p) => p.id !== id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete project");
    } finally {
      setDeletingId(null);
    }
  }

  if (!projects.length) {
    return (
      <EmptyState
        title="No projects yet"
        description="Paste a supported public video URL above to start your first Shortlio project."
      />
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      {projects.map((project) => (
        <Card
          key={project.id}
          className="transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <Link href={`/projects/${project.id}`} className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {project.source_title || project.source_url}
              </p>
              <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                {project.source_platform} · {project.requested_clip_count}{" "}
                {project.requested_clip_count === 1 ? "clip" : "clips"}
              </p>
            </Link>
            <div className="flex shrink-0 items-center gap-2">
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
              <Button
                type="button"
                variant="danger"
                className="px-3 py-1.5 text-xs"
                disabled={deletingId === project.id}
                onClick={() => void deleteProject(project.id)}
              >
                {deletingId === project.id ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
