import { z } from "zod";
import { AuthError } from "@/lib/auth/session";
import { requireRequestUser } from "@/lib/auth/request-user";
import { runDesktopRepoAction } from "@/lib/desktop/repo-actions";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

const bodySchema = z.object({
  action: z.string().min(1),
  jobId: z.string().uuid().optional(),
  workerId: z.string().optional(),
  progressStage: z.string().optional(),
  progressPct: z.number().optional(),
  partialResult: z.record(z.string(), z.unknown()).optional(),
  projectId: z.string().uuid().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  segments: z.array(z.record(z.string(), z.unknown())).optional(),
  candidates: z.array(z.record(z.string(), z.unknown())).optional(),
  selectedCount: z.number().optional(),
  candidateIds: z.array(z.string()).optional(),
  limit: z.number().optional(),
  clipId: z.string().uuid().nullable().optional(),
  row: z.record(z.string(), z.unknown()).optional(),
  quantity: z.number().optional(),
  message: z.string().optional(),
  result: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const raw = await request.json();
    const body = bodySchema.parse(raw);
    const data = await runDesktopRepoAction(user, body.action, body as Record<string, unknown>);
    return jsonOk({ data });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, 401);
    if (err instanceof z.ZodError) return jsonError(err.issues[0]?.message ?? "Invalid", 400);
    if (err instanceof Error && err.message === "Forbidden") return jsonError("Forbidden", 403);
    if (err instanceof Error && err.message.includes("not found")) {
      return jsonError(err.message, 404);
    }
    return handleRouteError(err);
  }
}
