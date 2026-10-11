"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, ProgressBar } from "@/components/ui";
import { STAGE_LABELS, type Clip, type ClipCandidate, type Job, type Project } from "@/lib/types";

interface ProjectPayload {
  project: Project;
  jobs: Job[];
  candidates: ClipCandidate[];
  clips: Clip[];
}

export function ProjectLive({ projectId, initial }: { projectId: string; initial: ProjectPayload }) {
  const [data, setData] = useState(initial);
  const [cancelling, setCancelling] = useState(false);
  const job = data.jobs[0];

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    setData(json);
  }, [projectId]);

  useEffect(() => {
    const active =
      job &&
      (job.status === "queued" || job.status === "processing") &&
      job.progress_stage !== "ready" &&
      job.progress_stage !== "failed" &&
      job.progress_stage !== "cancelled";
    if (!active) return;
    const id = setInterval(() => {
      void refresh();
    }, 2500);
    return () => clearInterval(id);
  }, [job, refresh]);

  async function cancelJob() {
    if (!job) return;
    setCancelling(true);
    await fetch(`/api/jobs/${job.id}/cancel`, { method: "POST" });
    await refresh();
    setCancelling(false);
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold">
              {data.project.source_title || "Processing project"}
            </h1>
            <p className="mt-1 break-all text-sm text-[var(--text-muted)]">{data.project.source_url}</p>
          </div>
          <Badge
            tone={
              data.project.status === "ready"
                ? "success"
                : data.project.status === "failed"
                  ? "danger"
                  : "accent"
            }
          >
            {STAGE_LABELS[job?.progress_stage || data.project.status] || data.project.status}
          </Badge>
        </div>
        {job && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span>{STAGE_LABELS[job.progress_stage] || job.progress_stage}</span>
              <span>{Math.round(job.progress_pct || 0)}%</span>
            </div>
            <ProgressBar value={job.progress_pct || 0} />
            {job.error_message && (
              <p className="text-sm text-[var(--danger)]">{job.error_message}</p>
            )}
            {(job.status === "queued" || job.status === "processing") && (
              <Button variant="danger" onClick={cancelJob} disabled={cancelling}>
                {cancelling ? "Cancelling…" : "Cancel job"}
              </Button>
            )}
          </div>
        )}
      </Card>

      {data.candidates.length > 0 && (
        <section>
          <h2 className="mb-3 font-[family-name:var(--font-display)] text-lg font-semibold">
            Candidate moments
          </h2>
          <div className="space-y-3">
            {data.candidates.map((c) => (
              <Card key={c.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{c.title}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {formatTime(c.start_time)} – {formatTime(c.end_time)} · score{" "}
                      {(c.score * 100).toFixed(0)}
                    </p>
                  </div>
                  {c.selected && <Badge tone="accent">Selected</Badge>}
                </div>
                {c.hook && <p className="mt-2 text-sm italic text-[var(--accent)]">“{c.hook}”</p>}
                {c.explanation && (
                  <p className="mt-2 text-sm text-[var(--text-muted)]">{c.explanation}</p>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-lg font-semibold">
          Generated clips
        </h2>
        {!data.clips.length ? (
          <Card>
            <p className="text-sm text-[var(--text-muted)]">
              Clips appear here after rendering finishes.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.clips.map((clip) => (
              <Link key={clip.id} href={`/clips/${clip.id}`}>
                <Card className="h-full transition hover:border-[var(--border-strong)]">
                  <p className="font-medium">{clip.title}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {clip.output_format} · {clip.caption_preset} · {clip.render_status}
                  </p>
                  {clip.reframe_warning && (
                    <p className="mt-2 text-xs text-[var(--warning)]">
                      Auto-reframe used a fallback crop — review before publishing.
                    </p>
                  )}
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
