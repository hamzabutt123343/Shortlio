import { z } from "zod";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUsageInfo, reserveClipQuota } from "@/lib/quota";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  candidateIds: z.array(z.string().uuid()).min(1).max(10),
  aspectRatio: z.enum(["9:16", "1:1", "16:9"]).optional(),
  captionPreset: z.string().optional(),
  captionLanguage: z.string().optional(),
  captionSettings: z.record(z.string(), z.unknown()).optional(),
  cropSettings: z.record(z.string(), z.unknown()).optional(),
});

/** Re-select candidates and enqueue a render-only job when analysis already finished. */
export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = schema.parse(await request.json());
    const admin = createAdminClient();

    const { data: project } = await admin
      .from("projects")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!project) return jsonError("Project not found", 404);

    const usage = await getUsageInfo(user.id);
    if (usage.plan === "free" && (usage.remaining ?? 0) < body.candidateIds.length) {
      return jsonError("Not enough free daily clip quota for the selected clips.", 402, { usage });
    }

    await admin.from("clip_candidates").update({ selected: false }).eq("project_id", id);
    await admin
      .from("clip_candidates")
      .update({ selected: true })
      .eq("project_id", id)
      .in("id", body.candidateIds);

    const payload = {
      source_url: project.source_url,
      project_id: project.id,
      user_id: user.id,
      clip_count: body.candidateIds.length,
      candidate_ids: body.candidateIds,
      aspect_ratio: body.aspectRatio ?? "9:16",
      caption_preset: body.captionPreset ?? "classic_white",
      caption_settings: body.captionSettings ?? {},
      language: body.captionLanguage ?? "en",
      crop_settings: body.cropSettings ?? {
        focal_x: 0.5,
        mode: "auto",
        speaker_focus: true,
        tracking_mode: "hard_cut",
      },
      mode: "render_selected",
    };

    const { data: job, error } = await admin
      .from("jobs")
      .insert({
        project_id: project.id,
        user_id: user.id,
        status: "queued",
        job_type: "render",
        requested_clip_count: body.candidateIds.length,
        progress_stage: "queued",
        payload,
      })
      .select("*")
      .single();
    if (error) throw error;

    const reservation = await reserveClipQuota(user.id, body.candidateIds.length, job.id);
    if (!reservation.ok) {
      await admin.from("jobs").update({ status: "cancelled" }).eq("id", job.id);
      return jsonError("Quota exceeded", 402);
    }

    await admin.from("projects").update({ status: "rendering" }).eq("id", id);
    return jsonOk({ job });
  } catch (err) {
    if (err instanceof z.ZodError) return jsonError("Invalid selection", 400);
    return handleRouteError(err);
  }
}
