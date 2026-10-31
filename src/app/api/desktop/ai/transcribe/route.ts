import { AuthError } from "@/lib/auth/session";
import { requireRequestUser } from "@/lib/auth/request-user";
import { getUsageInfo } from "@/lib/quota";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // Groq practical limit

/**
 * Secure Groq Whisper proxy for the desktop engine.
 * GROQ_API_KEY never leaves the server.
 */
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const usage = await getUsageInfo(user.id);
    if (usage.plan === "free" && usage.remaining !== null && usage.remaining <= 0) {
      return jsonError("Daily free clip quota exhausted. Upgrade to Pro or try again tomorrow.", 402);
    }

    const groqKey = process.env.GROQ_API_KEY?.trim();
    if (!groqKey) {
      return jsonError("GROQ_API_KEY is not configured on the server", 503);
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError("file is required", 400);
    }
    if (file.size <= 0 || file.size > MAX_AUDIO_BYTES) {
      return jsonError(`Audio must be between 1 byte and ${MAX_AUDIO_BYTES} bytes`, 400);
    }

    const upstream = new FormData();
    upstream.append("file", file, file.name || "audio.m4a");
    upstream.append("model", "whisper-large-v3");
    upstream.append("response_format", "verbose_json");
    upstream.append("timestamp_granularities[]", "word");
    upstream.append("timestamp_granularities[]", "segment");

    const resp = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}` },
      body: upstream,
    });
    const text = await resp.text();
    if (!resp.ok) {
      return jsonError(`Groq transcription failed: ${text.slice(0, 500)}`, 502);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return jsonError("Invalid Groq response", 502);
    }
    return jsonOk({ transcription: payload });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, 401);
    return handleRouteError(err);
  }
}
