import { z } from "zod";
import { handleRouteError, jsonError, jsonOk, rateLimit } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cropSettingsForFramingMode } from "@/lib/framing";
import {
  clampClipDuration,
  MAX_CLIP_DURATION_SECONDS,
} from "@/lib/clip-duration";
import { CLIP_COUNT_OPTIONS } from "@/lib/types";
import { validateVideoUrl } from "@/lib/validation/url";
import { getUsageInfo, reserveClipQuota } from "@/lib/quota";
import { getWorkerStatus } from "@/lib/worker-status";

const createSchema = z
  .object({
    sourceUrl: z.string().min(1),
    clipCount: z
      .number()
      .int()
      .refine((n) => (CLIP_COUNT_OPTIONS as readonly number[]).includes(n)),
    aspectRatio: z.enum(["9:16", "1:1", "16:9"]).default("9:16"),
    captionPreset: z.string().default("classic_white"),
    captionLanguage: z.string().default("en"),
    captionSettings: z.record(z.string(), z.unknown()).optional().default({}),
    cropSettings: z.record(z.string(), z.unknown()).optional(),
    platformPreset: z
      .enum(["youtube_shorts", "tiktok", "instagram_reels", "custom"])
      .default("youtube_shorts"),
    quality: z.enum(["draft", "balanced", "high"]).default("draft"),
    /** ai = viral moments · custom = start/end on a VOD · live_record = short live snapshot */
    clipMode: z.enum(["ai", "custom", "live_record"]).default("ai"),
    /** Target / max clip length in seconds (5–180). */
    maxClipDuration: z
      .number()
      .finite()
      .min(5)
      .max(MAX_CLIP_DURATION_SECONDS)
      .optional()
      .default(45),
    customStart: z.number().finite().nonnegative().optional(),
    customEnd: z.number().finite().positive().optional(),
    liveRecordSeconds: z.number().finite().min(20).max(180).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.clipMode === "custom") {
      if (val.customStart === undefined || val.customEnd === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "Custom clip requires start and end timestamps (seconds).",
          path: ["customStart"],
        });
        return;
      }
      if (val.customEnd <= val.customStart + 0.5) {
        ctx.addIssue({
          code: "custom",
          message: "Custom end must be greater than start.",
          path: ["customEnd"],
        });
        return;
      }
      const span = val.customEnd - val.customStart;
      if (span > MAX_CLIP_DURATION_SECONDS + 0.05) {
        ctx.addIssue({
          code: "custom",
          message: `Custom clip is ${Math.round(span)}s; max allowed is ${MAX_CLIP_DURATION_SECONDS}s (3 min).`,
          path: ["customEnd"],
        });
      }
    }
  });

const DEFAULT_CROP = cropSettingsForFramingMode("smart_auto");

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

    if (
      body.clipMode === "ai" &&
      validated.kind === "live" &&
      (validated.platform === "twitch" || validated.platform === "kick")
    ) {
      return jsonError(
        "That looks like a live channel URL. Use a VOD / past broadcast / clip link for AI clips, or choose Live snapshot to record a short window from the live edge.",
        400,
        { platform: validated.platform, kind: validated.kind },
      );
    }

    const effectiveClipCount =
      body.clipMode === "custom" || body.clipMode === "live_record" ? 1 : body.clipCount;

    const usage = await getUsageInfo(user.id);
    if (usage.plan === "free" && (usage.remaining ?? 0) < effectiveClipCount) {
      return jsonError(
        `Basic plan allows ${usage.limit} successful clips per UTC day. You have ${usage.remaining} remaining. Reduce clip count or upgrade to Pro (Rs 500 lifetime via Discord).`,
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
        requested_clip_count: effectiveClipCount,
      })
      .select("*")
      .single();
    if (projectError) throw projectError;

    const maxClipDuration = clampClipDuration(body.maxClipDuration ?? 45);

    const payload = {
      source_url: validated.url,
      project_id: project.id,
      user_id: user.id,
      clip_count: effectiveClipCount,
      aspect_ratio: body.aspectRatio,
      caption_preset: body.captionPreset,
      caption_settings: body.captionSettings,
      language: body.captionLanguage,
      platform_preset: body.platformPreset,
      quality: body.quality,
      crop_settings: body.cropSettings ?? DEFAULT_CROP,
      clip_mode: body.clipMode,
      max_clip_duration: maxClipDuration,
      custom_start: body.customStart,
      custom_end: body.customEnd,
      live_record_seconds: body.liveRecordSeconds ?? Math.max(20, Math.min(180, maxClipDuration)),
      source_kind_hint: validated.kind,
    };

    const { data: job, error: jobError } = await admin
      .from("jobs")
      .insert({
        project_id: project.id,
        user_id: user.id,
        status: "queued",
        job_type: "full_pipeline",
        requested_clip_count: effectiveClipCount,
        progress_stage: "queued",
        payload,
      })
      .select("*")
      .single();
    if (jobError) throw jobError;

    const reservation = await reserveClipQuota(user.id, effectiveClipCount, job.id);
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
