import { z } from "zod";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SEGMENT_PAD_SECONDS } from "@/lib/captions/style";
import {
  generateViralMetadata,
  mergePlatformMetadata,
} from "@/lib/viral-metadata/generate";
import { normalizeViralMetadata } from "@/lib/viral-metadata/types";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  language: z.string().min(1).max(32).optional(),
  platforms: z.array(z.enum(["youtube", "tiktok", "instagram"])).optional(),
});

function transcriptFromRows(
  rows: Array<{ start_time: number; end_time: number; text: string }>,
): string {
  return rows
    .map((r) => String(r.text || "").trim())
    .filter(Boolean)
    .join(" ");
}

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const supabase = await createClient();
    const admin = createAdminClient();

    const { data: clip, error } = await supabase
      .from("clips")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!clip) return jsonError("Clip not found", 404);

    const { data: project } = await supabase
      .from("projects")
      .select("source_title,source_metadata,source_url")
      .eq("id", clip.project_id)
      .maybeSingle();

    const start = Number(clip.start_time);
    const end = Number(clip.end_time);
    const clipPad = DEFAULT_SEGMENT_PAD_SECONDS;
    const surroundBefore = 12;
    const surroundAfter = 4;

    const { data: transcriptRows } = await supabase
      .from("transcript_segments")
      .select("start_time,end_time,text,language")
      .eq("project_id", clip.project_id)
      .gte("end_time", start - clipPad)
      .lte("start_time", end + clipPad)
      .order("start_time", { ascending: true });

    const { data: surroundRows } = await supabase
      .from("transcript_segments")
      .select("start_time,end_time,text")
      .eq("project_id", clip.project_id)
      .gte("end_time", start - surroundBefore)
      .lte("start_time", end + surroundAfter)
      .order("start_time", { ascending: true });

    const clipText = transcriptFromRows(transcriptRows ?? []);
    const surroundText = transcriptFromRows(
      (surroundRows ?? []).filter(
        (r) =>
          Number(r.end_time) < start - clipPad || Number(r.start_time) > end + clipPad,
      ),
    );

    const sourceMeta =
      project?.source_metadata && typeof project.source_metadata === "object"
        ? (project.source_metadata as Record<string, unknown>)
        : {};

    const language = body.language || clip.caption_language || "en";
    const generated = await generateViralMetadata({
      transcript: clipText,
      clipTitle: clip.title || "Clip",
      language,
      sourceTitle: project?.source_title || "",
      sourceChannel: String(sourceMeta.channel || ""),
      sourceUploader: String(sourceMeta.uploader || ""),
      surroundingContext: surroundText,
    });

    const existing = normalizeViralMetadata(clip.viral_metadata, language);
    const viralMetadata = mergePlatformMetadata(existing, generated, body.platforms);

    const { data: updated, error: updateError } = await admin
      .from("clips")
      .update({ viral_metadata: viralMetadata })
      .eq("id", id)
      .eq("user_id", user.id)
      .select("*")
      .single();
    if (updateError) throw updateError;

    return jsonOk({ clip: updated, viralMetadata });
  } catch (err) {
    return handleRouteError(err);
  }
}
