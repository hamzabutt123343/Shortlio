import { z } from "zod";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CAPTION_PRESETS } from "@/lib/captions/presets";
import { resolutionFor } from "@/lib/formats";
import type { AspectRatio } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  startTime: z.number().min(0).optional(),
  endTime: z.number().min(0.5).optional(),
  captionPreset: z.string().optional(),
  captionLanguage: z.string().optional(),
  captionText: z.array(z.unknown()).optional(),
  captionSettings: z.record(z.string(), z.unknown()).optional(),
  burnCaptions: z.boolean().optional(),
  outputFormat: z.enum(["9:16", "1:1", "16:9"]).optional(),
  quality: z.enum(["draft", "balanced", "high"]).optional(),
  cropSettings: z.record(z.string(), z.unknown()).optional(),
  reRender: z.boolean().optional(),
});

export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const supabase = await createClient();
    const { data: clip, error } = await supabase
      .from("clips")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!clip) return jsonError("Clip not found", 404);

    let signedUrl: string | null = null;
    if (clip.storage_path) {
      const admin = createAdminClient();
      const { data } = await admin.storage
        .from("clips")
        .createSignedUrl(clip.storage_path, 60 * 30);
      signedUrl = data?.signedUrl ?? null;
    }

    return jsonOk({ clip, signedUrl, presets: CAPTION_PRESETS });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = updateSchema.parse(await request.json());
    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("clips")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!existing) return jsonError("Clip not found", 404);

    const cheapOnly =
      !body.reRender &&
      body.startTime === undefined &&
      body.endTime === undefined &&
      body.outputFormat === undefined &&
      body.quality === undefined &&
      body.cropSettings === undefined &&
      body.burnCaptions === undefined &&
      body.captionPreset === undefined &&
      body.captionLanguage === undefined &&
      body.captionText === undefined;

    const updates: Record<string, unknown> = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.startTime !== undefined) updates.start_time = body.startTime;
    if (body.endTime !== undefined) updates.end_time = body.endTime;
    if (body.captionPreset !== undefined) updates.caption_preset = body.captionPreset;
    if (body.captionLanguage !== undefined) updates.caption_language = body.captionLanguage;
    if (body.captionText !== undefined) updates.caption_text = body.captionText;
    if (body.captionSettings !== undefined) updates.caption_settings = body.captionSettings;
    if (body.burnCaptions !== undefined) updates.burn_captions = body.burnCaptions;
    if (body.quality !== undefined) updates.quality = body.quality;
    if (body.cropSettings !== undefined) updates.crop_settings = body.cropSettings;
    if (body.outputFormat !== undefined) {
      updates.output_format = body.outputFormat;
      updates.resolution = resolutionFor(body.outputFormat as AspectRatio);
    }

    const needsRender =
      Boolean(body.reRender) ||
      body.startTime !== undefined ||
      body.endTime !== undefined ||
      body.outputFormat !== undefined ||
      body.quality !== undefined ||
      body.cropSettings !== undefined ||
      body.burnCaptions !== undefined ||
      body.captionPreset !== undefined ||
      body.captionLanguage !== undefined ||
      body.captionText !== undefined;

    if (needsRender && !cheapOnly) {
      updates.render_status = "pending";
    }

    const { data: clip, error } = await admin
      .from("clips")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("*")
      .single();
    if (error) throw error;

    let job = null;
    if (needsRender) {
      const { data: project } = await admin
        .from("projects")
        .select("source_url")
        .eq("id", clip.project_id)
        .single();

      const { data: newJob, error: jobError } = await admin
        .from("jobs")
        .insert({
          project_id: clip.project_id,
          user_id: user.id,
          status: "queued",
          job_type: "re_render",
          requested_clip_count: 1,
          progress_stage: "queued",
          payload: {
            mode: "re_render",
            clip_id: clip.id,
            source_url: project?.source_url,
            project_id: clip.project_id,
            user_id: user.id,
            start_time: clip.start_time,
            end_time: clip.end_time,
            aspect_ratio: clip.output_format,
            caption_preset: clip.caption_preset,
            language: clip.caption_language,
            caption_text: clip.caption_text,
            burn_captions: clip.burn_captions,
            quality: clip.quality,
            crop_settings: clip.crop_settings,
          },
        })
        .select("*")
        .single();
      if (jobError) throw jobError;
      job = newJob;
      await admin.from("clips").update({ render_status: "rendering", job_id: job.id }).eq("id", id);
    }

    return jsonOk({ clip, job });
  } catch (err) {
    if (err instanceof z.ZodError) return jsonError("Invalid update", 400);
    return handleRouteError(err);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const admin = createAdminClient();
    const { data: clip } = await admin
      .from("clips")
      .select("storage_path")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!clip) return jsonError("Clip not found", 404);
    if (clip.storage_path) {
      await admin.storage.from("clips").remove([clip.storage_path]);
    }
    await admin.from("clips").delete().eq("id", id).eq("user_id", user.id);
    return jsonOk({ deleted: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
