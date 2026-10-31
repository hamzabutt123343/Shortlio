import { z } from "zod";
import { AuthError } from "@/lib/auth/session";
import { requireRequestUser } from "@/lib/auth/request-user";
import { runDesktopRepoAction } from "@/lib/desktop/repo-actions";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

const bodySchema = z.object({
  status: z.enum(["ready", "failed"]),
  result: z.record(z.string(), z.unknown()).optional(),
  message: z.string().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await params;
    const body = bodySchema.parse(await request.json());
    if (body.status === "failed") {
      await runDesktopRepoAction(user, "mark_failed", {
        jobId: id,
        message: body.message || "Failed",
      });
    } else {
      await runDesktopRepoAction(user, "mark_ready", {
        jobId: id,
        result: body.result || {},
      });
    }
    return jsonOk({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, 401);
    if (err instanceof z.ZodError) return jsonError(err.issues[0]?.message ?? "Invalid", 400);
    if (err instanceof Error && err.message === "Forbidden") return jsonError("Forbidden", 403);
    return handleRouteError(err);
  }
}
