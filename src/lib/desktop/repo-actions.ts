import { createAdminClient } from "@/lib/supabase/admin";
import type { User } from "@supabase/supabase-js";

type JobRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  status: string;
  job_type: string;
  requested_clip_count: number | null;
  payload: Record<string, unknown> | string | null;
  result: Record<string, unknown> | null;
  progress_stage: string | null;
  progress_pct: number | null;
  worker_id: string | null;
  error_message: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function asPayload(raw: JobRow["payload"]): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw;
}

async function getOwnedJob(userId: string, jobId: string): Promise<JobRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Job not found");
  if (data.user_id !== userId) throw new Error("Forbidden");
  return data as JobRow;
}

export async function claimDesktopJob(
  user: User,
  jobId: string,
  workerId: string,
): Promise<JobRow> {
  const admin = createAdminClient();
  const job = await getOwnedJob(user.id, jobId);
  if (job.status === "processing" && job.worker_id?.startsWith("desktop:")) {
    return job;
  }
  if (job.status !== "queued") {
    throw new Error(`Job is ${job.status}, cannot claim`);
  }
  const stage =
    !job.progress_stage || job.progress_stage === "queued"
      ? "fetching_transcript"
      : job.progress_stage;
  const { data, error } = await admin
    .from("jobs")
    .update({
      status: "processing",
      worker_id: workerId,
      heartbeat_at: nowIso(),
      started_at: nowIso(),
      progress_stage: stage,
      updated_at: nowIso(),
    })
    .eq("id", jobId)
    .eq("user_id", user.id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    // Race: another claim won — re-read
    return getOwnedJob(user.id, jobId);
  }
  return data as JobRow;
}

export async function runDesktopRepoAction(
  user: User,
  action: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const admin = createAdminClient();
  const jobId = typeof body.jobId === "string" ? body.jobId : "";

  switch (action) {
    case "get_job": {
      if (!jobId) throw new Error("jobId required");
      return getOwnedJob(user.id, jobId);
    }
    case "heartbeat": {
      if (!jobId) throw new Error("jobId required");
      await getOwnedJob(user.id, jobId);
      const workerId = String(body.workerId || `desktop:${user.id.slice(0, 8)}`);
      await admin
        .from("jobs")
        .update({ heartbeat_at: nowIso(), worker_id: workerId, updated_at: nowIso() })
        .eq("id", jobId)
        .eq("user_id", user.id);
      return { ok: true };
    }
    case "update_progress": {
      if (!jobId) throw new Error("jobId required");
      const job = await getOwnedJob(user.id, jobId);
      const payload: Record<string, unknown> = { updated_at: nowIso() };
      if (typeof body.progressStage === "string") payload.progress_stage = body.progressStage;
      if (typeof body.progressPct === "number") {
        payload.progress_pct = Math.max(0, Math.min(100, body.progressPct));
      }
      if (body.partialResult && typeof body.partialResult === "object") {
        payload.result = {
          ...(typeof job.result === "object" && job.result ? job.result : {}),
          ...(body.partialResult as object),
        };
      }
      await admin.from("jobs").update(payload).eq("id", jobId).eq("user_id", user.id);
      return { ok: true };
    }
    case "is_cancelled": {
      if (!jobId) throw new Error("jobId required");
      const job = await getOwnedJob(user.id, jobId);
      return {
        cancelled:
          job.status === "cancelled" || job.progress_stage === "cancelled",
      };
    }
    case "get_project": {
      const projectId = String(body.projectId || "");
      if (!projectId) throw new Error("projectId required");
      const { data, error } = await admin
        .from("projects")
        .select("id,source_title,source_metadata,source_url,source_platform,user_id")
        .eq("id", projectId)
        .maybeSingle();
      if (error) throw error;
      if (!data || data.user_id !== user.id) throw new Error("Forbidden");
      return data;
    }
    case "update_project": {
      const projectId = String(body.projectId || "");
      const fields = (body.fields || {}) as Record<string, unknown>;
      if (!projectId) throw new Error("projectId required");
      const { data: project } = await admin
        .from("projects")
        .select("user_id")
        .eq("id", projectId)
        .maybeSingle();
      if (!project || project.user_id !== user.id) throw new Error("Forbidden");
      await admin
        .from("projects")
        .update({ ...fields, updated_at: nowIso() })
        .eq("id", projectId)
        .eq("user_id", user.id);
      return { ok: true };
    }
    case "replace_transcript_segments": {
      const projectId = String(body.projectId || "");
      const segments = Array.isArray(body.segments) ? body.segments : [];
      if (!projectId) throw new Error("projectId required");
      const { data: project } = await admin
        .from("projects")
        .select("user_id")
        .eq("id", projectId)
        .maybeSingle();
      if (!project || project.user_id !== user.id) throw new Error("Forbidden");
      await admin.from("transcript_segments").delete().eq("project_id", projectId);
      if (segments.length) {
        const rows = segments.map((seg) => {
          const s = seg as Record<string, unknown>;
          return {
            project_id: projectId,
            start_time: Number(s.start ?? s.start_time ?? 0),
            end_time: Number(s.end ?? s.end_time ?? 0),
            text: String(s.text || ""),
            speaker_id: s.speaker ?? s.speaker_id ?? null,
            language: s.language ?? null,
          };
        });
        for (let i = 0; i < rows.length; i += 200) {
          const { error } = await admin
            .from("transcript_segments")
            .insert(rows.slice(i, i + 200));
          if (error) throw error;
        }
      }
      return { ok: true };
    }
    case "fetch_transcript_segments": {
      const projectId = String(body.projectId || "");
      if (!projectId) throw new Error("projectId required");
      const { data: project } = await admin
        .from("projects")
        .select("user_id")
        .eq("id", projectId)
        .maybeSingle();
      if (!project || project.user_id !== user.id) throw new Error("Forbidden");
      const { data, error } = await admin
        .from("transcript_segments")
        .select("start_time,end_time,text,speaker_id,language")
        .eq("project_id", projectId)
        .order("start_time");
      if (error) throw error;
      return data || [];
    }
    case "replace_clip_candidates": {
      const projectId = String(body.projectId || "");
      const candidates = Array.isArray(body.candidates) ? body.candidates : [];
      const selectedCount = Number(body.selectedCount ?? 0);
      if (!projectId) throw new Error("projectId required");
      const { data: project } = await admin
        .from("projects")
        .select("user_id")
        .eq("id", projectId)
        .maybeSingle();
      if (!project || project.user_id !== user.id) throw new Error("Forbidden");
      await admin.from("clip_candidates").delete().eq("project_id", projectId);
      if (!candidates.length) return [];
      // Preserve analyzer order (first N = variety-aware selection). Explicit
      // `selected` on a candidate wins when present.
      const rows = candidates.map((c, i) => {
        const cand = c as Record<string, unknown>;
        const start = Number(cand.start);
        const end = Number(cand.end);
        const selected =
          typeof cand.selected === "boolean" ? cand.selected : i < selectedCount;
        return {
          project_id: projectId,
          start_time: start,
          end_time: end,
          title: String(cand.title || "Clip").slice(0, 500),
          hook: cand.hook ?? null,
          score: Number(cand.score || 0),
          explanation: cand.explanation ?? null,
          confidence: cand.confidence ?? null,
          recommended_duration: cand.recommended_duration ?? Math.max(0, end - start),
          selected,
        };
      });
      const inserted: unknown[] = [];
      for (let i = 0; i < rows.length; i += 200) {
        const { data, error } = await admin
          .from("clip_candidates")
          .insert(rows.slice(i, i + 200))
          .select("*");
        if (error) throw error;
        inserted.push(...(data || []));
      }
      return inserted;
    }
    case "fetch_selected_clip_candidates": {
      const projectId = String(body.projectId || "");
      const limit = Number(body.limit ?? 10);
      if (!projectId) throw new Error("projectId required");
      const { data: project } = await admin
        .from("projects")
        .select("user_id")
        .eq("id", projectId)
        .maybeSingle();
      if (!project || project.user_id !== user.id) throw new Error("Forbidden");
      const { data, error } = await admin
        .from("clip_candidates")
        .select("*")
        .eq("project_id", projectId)
        .eq("selected", true)
        .order("score", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    }
    case "fetch_clip_candidates_by_ids": {
      const projectId = String(body.projectId || "");
      const ids = Array.isArray(body.candidateIds)
        ? body.candidateIds.map(String)
        : [];
      if (!projectId) throw new Error("projectId required");
      const { data: project } = await admin
        .from("projects")
        .select("user_id")
        .eq("id", projectId)
        .maybeSingle();
      if (!project || project.user_id !== user.id) throw new Error("Forbidden");
      if (!ids.length) return [];
      const { data, error } = await admin
        .from("clip_candidates")
        .select("*")
        .eq("project_id", projectId)
        .in("id", ids);
      if (error) throw error;
      const byId = new Map((data || []).map((r) => [String(r.id), r]));
      return ids.map((id) => byId.get(id)).filter(Boolean);
    }
    case "fetch_prior_clip_ranges": {
      const sourceUrl = String(body.sourceUrl || "").trim();
      const excludeProjectId = body.excludeProjectId
        ? String(body.excludeProjectId)
        : null;
      const limit = Math.max(1, Math.min(200, Number(body.limit ?? 80)));
      if (!sourceUrl) return [];
      // Always scope to the authenticated user (ignore body.userId spoofing).
      const ranges: { start: number; end: number }[] = [];
      const seen = new Set<string>();
      const push = (start: number, end: number) => {
        if (!(end > start)) return;
        const key = `${Math.round(start * 10)}:${Math.round(end * 10)}`;
        if (seen.has(key)) return;
        seen.add(key);
        ranges.push({ start, end });
      };

      const { data: clipRows, error: clipErr } = await admin
        .from("clips")
        .select("start_time,end_time,project_id,projects!inner(source_url,user_id)")
        .eq("user_id", user.id)
        .eq("projects.source_url", sourceUrl)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (clipErr) throw clipErr;
      for (const row of clipRows || []) {
        if (excludeProjectId && String(row.project_id) === excludeProjectId) continue;
        push(Number(row.start_time), Number(row.end_time));
      }

      const { data: candRows, error: candErr } = await admin
        .from("clip_candidates")
        .select(
          "start_time,end_time,project_id,projects!inner(source_url,user_id)",
        )
        .eq("selected", true)
        .eq("projects.source_url", sourceUrl)
        .eq("projects.user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (candErr) throw candErr;
      for (const row of candRows || []) {
        if (excludeProjectId && String(row.project_id) === excludeProjectId) continue;
        push(Number(row.start_time), Number(row.end_time));
      }

      return ranges.slice(0, limit);
    }
    case "get_clip": {
      const clipId = String(body.clipId || "");
      if (!clipId) throw new Error("clipId required");
      const { data, error } = await admin.from("clips").select("*").eq("id", clipId).maybeSingle();
      if (error) throw error;
      if (!data || data.user_id !== user.id) throw new Error("Forbidden");
      return data;
    }
    case "upsert_rendered_clip": {
      const row = (body.row || {}) as Record<string, unknown>;
      const clipId = body.clipId ? String(body.clipId) : null;
      if (row.user_id && row.user_id !== user.id) throw new Error("Forbidden");
      row.user_id = user.id;
      row.updated_at = nowIso();
      row.render_status = "ready";
      if (clipId) {
        const existing = await admin
          .from("clips")
          .select("user_id")
          .eq("id", clipId)
          .maybeSingle();
        if (!existing.data || existing.data.user_id !== user.id) throw new Error("Forbidden");
        const { error } = await admin.from("clips").update(row).eq("id", clipId);
        if (error) throw error;
        const { data } = await admin.from("clips").select("*").eq("id", clipId).maybeSingle();
        return data;
      }
      const { data, error } = await admin.from("clips").insert(row).select("*").maybeSingle();
      if (error) throw error;
      return data;
    }
    case "confirm_clip_success": {
      const clipId = String(body.clipId || "");
      const jid = body.jobId ? String(body.jobId) : null;
      if (!clipId) throw new Error("clipId required");
      const { error } = await admin.rpc("confirm_clip_success", {
        p_user_id: user.id,
        p_clip_id: clipId,
        p_job_id: jid,
      });
      if (error) throw error;
      return { ok: true };
    }
    case "release_clip_reservation": {
      if (!jobId) throw new Error("jobId required");
      await getOwnedJob(user.id, jobId);
      const quantity = Number(body.quantity ?? 0);
      if (quantity <= 0) return { ok: true };
      const { error } = await admin.rpc("release_clip_reservation", {
        p_user_id: user.id,
        p_job_id: jobId,
        p_quantity: quantity,
      });
      if (error) throw error;
      return { ok: true };
    }
    case "mark_failed": {
      if (!jobId) throw new Error("jobId required");
      const job = await getOwnedJob(user.id, jobId);
      const message = String(body.message || "Failed").slice(0, 4000);
      await admin
        .from("jobs")
        .update({
          status: "failed",
          progress_stage: "failed",
          error_message: message,
          completed_at: nowIso(),
          updated_at: nowIso(),
        })
        .eq("id", jobId)
        .eq("user_id", user.id);
      const payload = asPayload(job.payload);
      const isReRender = payload.mode === "re_render" || job.job_type === "re_render";
      if (job.project_id && !isReRender) {
        await admin
          .from("projects")
          .update({ status: "failed", error_message: message, updated_at: nowIso() })
          .eq("id", job.project_id)
          .eq("user_id", user.id);
      }
      const quantity = isReRender ? 0 : Number(job.requested_clip_count || 0);
      if (quantity > 0) {
        await admin.rpc("release_clip_reservation", {
          p_user_id: user.id,
          p_job_id: jobId,
          p_quantity: quantity,
        });
      }
      return { ok: true };
    }
    case "mark_ready": {
      if (!jobId) throw new Error("jobId required");
      const job = await getOwnedJob(user.id, jobId);
      const result = (body.result && typeof body.result === "object" ? body.result : {}) as object;
      await admin
        .from("jobs")
        .update({
          status: "ready",
          progress_stage: "ready",
          progress_pct: 100,
          result,
          error_message: null,
          completed_at: nowIso(),
          updated_at: nowIso(),
        })
        .eq("id", jobId)
        .eq("user_id", user.id);
      const payload = asPayload(job.payload);
      const isReRender = payload.mode === "re_render" || job.job_type === "re_render";
      if (job.project_id) {
        await admin
          .from("projects")
          .update({ status: "ready", error_message: null, updated_at: nowIso() })
          .eq("id", job.project_id)
          .eq("user_id", user.id);
      }
      const quantity = isReRender ? 0 : Number(job.requested_clip_count || 0);
      if (quantity > 0) {
        await admin.rpc("release_clip_reservation", {
          p_user_id: user.id,
          p_job_id: jobId,
          p_quantity: quantity,
        });
      }
      return { ok: true };
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
