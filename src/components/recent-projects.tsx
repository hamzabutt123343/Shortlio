"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, EmptyState } from "@/components/ui";
import { STAGE_LABELS, type Project } from "@/lib/types";

function statusTone(status: string): "success" | "danger" | "accent" | "warning" | "neutral" {
  if (status === "ready") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "queued" || status === "draft") return "neutral";
  return "accent";
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

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
        description="Paste a supported public video URL to start your first Shortlio project."
        action={
          <Link href="/create">
            <Button>Create New Clips</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/50">
        {projects.map((project) => {
          const meta = project.source_metadata as Record<string, unknown> | undefined;
          const thumb =
            typeof meta?.thumbnail === "string"
              ? meta.thumbnail
              : typeof meta?.thumbnail_url === "string"
                ? meta.thumbnail_url
                : null;
          return (
            <li
              key={project.id}
              className="flex flex-wrap items-center gap-3 px-3 py-3 transition hover:bg-[var(--surface-hover)]/60 sm:px-4"
            >
              <Link
                href={`/projects/${project.id}`}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-elevated)]">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(160deg,#1a2233,#0c0e14)] text-[10px] text-[var(--text-muted)]">
                      9:16
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-[var(--text)]">
                    {project.source_title || project.source_url}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                    {project.source_platform || "video"} · {project.requested_clip_count}{" "}
                    {project.requested_clip_count === 1 ? "clip" : "clips"} ·{" "}
                    {formatDate(project.created_at)}
                  </p>
                </div>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={statusTone(project.status)}>
                  {STAGE_LABELS[project.status] || project.status}
                </Badge>
                <Link href={`/projects/${project.id}`}>
                  <Button variant="secondary" className="px-3 py-1.5 text-xs">
                    Open
                  </Button>
                </Link>
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}
