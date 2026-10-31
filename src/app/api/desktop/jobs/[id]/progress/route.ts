import { z } from "zod";
import { AuthError } from "@/lib/auth/session";
import { requireRequestUser } from "@/lib/auth/request-user";
import { runDesktopRepoAction } from "@/lib/desktop/repo-actions";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

const bodySchema = z.object({
  progressStage: z.string().optional(),
  progressPct: z.number().optional(),
  partialResult: z.record(z.string(), z.unknown()).optional(),
  workerId: z.string().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await params;
    const body = bodySchema.parse(await request.json());
    if (body.workerId) {
      await runDesktopRepoAction(user, "heartbeat", { jobId: id, workerId: body.workerId });
    }
    await runDesktopRepoAction(user, "update_progress", {
      jobId: id,
      progressStage: body.progressStage,
      progressPct: body.progressPct,
      partialResult: body.partialResult,
    });
    return jsonOk({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, 401);
    if (err instanceof z.ZodError) return jsonError(err.issues[0]?.message ?? "Invalid", 400);
    if (err instanceof Error && err.message === "Forbidden") return jsonError("Forbidden", 403);
    return handleRouteError(err);
  }
}
