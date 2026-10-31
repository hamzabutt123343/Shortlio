import { AuthError } from "@/lib/auth/session";
import { requireRequestUser } from "@/lib/auth/request-user";
import { MAX_CLIP_DURATION_SECONDS } from "@/lib/clip-duration";
import { FREE_DAILY_CLIP_LIMIT } from "@/lib/types";
import { getUsageInfo } from "@/lib/quota";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const usage = await getUsageInfo(user.id);
    return jsonOk({
      maxClipDurationSeconds: MAX_CLIP_DURATION_SECONDS,
      freeDailyClipLimit: FREE_DAILY_CLIP_LIMIT,
      usage,
      transcription: "groq_proxy",
      llm: "heuristic",
      outputMode: "local",
    });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, 401);
    return handleRouteError(err);
  }
}
