import { z } from "zod";
import { AuthError } from "@/lib/auth/session";
import { requireRequestUser } from "@/lib/auth/request-user";
import { claimDesktopJob } from "@/lib/desktop/repo-actions";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

const bodySchema = z.object({
  workerId: z.string().min(1).max(200).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await params;
    const raw = await request.json().catch(() => ({}));
    const body = bodySchema.parse(raw);
    const workerId = body.workerId || `desktop:${user.id.slice(0, 8)}`;
    const job = await claimDesktopJob(user, id, workerId);
    return jsonOk({ job });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, 401);
    if (err instanceof z.ZodError) return jsonError(err.issues[0]?.message ?? "Invalid", 400);
    if (err instanceof Error && err.message === "Forbidden") return jsonError("Forbidden", 403);
    if (err instanceof Error) return jsonError(err.message, 409);
    return handleRouteError(err);
  }
}
