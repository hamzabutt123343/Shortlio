import { z } from "zod";
import { handleRouteError, jsonError, jsonOk, rateLimit } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CLIP_COUNT_OPTIONS } from "@/lib/types";
import { validateVideoUrl } from "@/lib/validation/url";
import { getUsageInfo, reserveClipQuota } from "@/lib/quota";
import { getWorkerStatus } from "@/lib/worker-status";

const createSchema = z.object({
  sourceUrl: z.string().min(1),
  clipCount: z.number().int().refine((n) => (CLIP_COUNT_OPTIONS as readonly number[]).includes(n)),
  aspectRatio: z.enum(["9:16", "1:1", "16:9"]).default("9:16"),
  captionPreset: z.string().default("classic_white"),
  captionLanguage: z.string().default("en"),
  platformPreset: z
    .enum(["youtube_shorts", "tiktok", "instagram_reels", "custom"])
    .default("youtube_shorts"),
  quality: z.enum(["draft", "balanced", "high"]).default("balanced"),
});

export async function GET() {
  try {
    const user = await requireUser();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return jsonOk({ projects: data ?? [] });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`create-project:${user.id}`, 10, 60_000);
    if (!rl.ok) {
      return jsonError("Too many projects created. Try again shortly.", 429, {
        retryAfter: rl.retryAfter,
      });
    }

    const body = createSchema.parse(await request.json());
    const validated = validateVideoUrl(body.sourceUrl);
    if (!validated.ok) {
      return jsonError(validated.error, 400);
    }

    const usage = await getUsageInfo(user.id);
    if (usage.plan === "free" && (usage.remaining ?? 0) < body.clipCount) {
      return jsonError(
        `Free plan allows ${usage.limit} successful clips per UTC day. You have ${usage.remaining} remaining. Reduce clip count or upgrade to Pro.`,
        402,
        { usage },
      );
    }

    const admin = createAdminClient();
    const { data: project, error: projectError } = await admin
      .from("projects")
      .insert({
        user_id: user.id,
        source_url: validated.url,
        source_platform: validated.platform,
        status: "queued",
        requested_clip_count: body.clipCount,
      })
      .select("*")
      .single();
    if (projectError) throw projectError;

    const payload = {
      source_url: validated.url,
      project_id: project.id,
      user_id: user.id,
      clip_count: body.clipCount,
      aspect_ratio: body.aspectRatio,
      caption_preset: body.captionPreset,
      language: body.captionLanguage,
      platform_preset: body.platformPreset,
      quality: body.quality,
    };

    const { data: job, error: jobError } = await admin
      .from("jobs")
      .insert({
        project_id: project.id,
        user_id: user.id,
        status: "queued",
        job_type: "full_pipeline",
        requested_clip_count: body.clipCount,
        progress_stage: "queued",
        payload,
      })
      .select("*")
      .single();
    if (jobError) throw jobError;

    const reservation = await reserveClipQuota(user.id, body.clipCount, job.id);
    if (!reservation.ok) {
      await admin.from("jobs").update({ status: "cancelled", progress_stage: "cancelled" }).eq("id", job.id);
      await admin.from("projects").update({ status: "cancelled" }).eq("id", project.id);
      return jsonError(
        "Daily free clip quota would be exceeded. Reduce clip count or upgrade to Pro.",
        402,
        { remaining: reservation.remaining },
      );
    }

    const worker = await getWorkerStatus();
    return jsonOk({
      project,
      job,
      worker,
      usage: await getUsageInfo(user.id),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return jsonError(err.issues[0]?.message ?? "Invalid request", 400);
    }
    return handleRouteError(err);
  }
}
