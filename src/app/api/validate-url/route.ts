import { z } from "zod";
import { handleRouteError, jsonError, jsonOk, rateLimit } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { validateVideoUrl } from "@/lib/validation/url";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`validate:${user.id}`, 30, 60_000);
    if (!rl.ok) return jsonError("Rate limit exceeded", 429);

    const body = z.object({ url: z.string() }).parse(await request.json());
    const result = validateVideoUrl(body.url);
    if (!result.ok) return jsonError(result.error, 400);
    return jsonOk({
      valid: true,
      url: result.url,
      platform: result.platform,
      note: "Duration and accessibility are verified by the worker when processing starts.",
    });
  } catch (err) {
    if (err instanceof z.ZodError) return jsonError("Invalid request", 400);
    return handleRouteError(err);
  }
}
