import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseReservation } from "@/lib/quota";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const admin = createAdminClient();

    const { data: job } = await admin
      .from("jobs")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!job) return jsonError("Job not found", 404);

    if (job.status === "ready") {
      return jsonError("Cannot cancel a completed job", 400);
    }

    await admin
      .from("jobs")
      .update({
        status: "cancelled",
        progress_stage: "cancelled",
        completed_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (job.project_id) {
      await admin
        .from("projects")
        .update({ status: "cancelled" })
        .eq("id", job.project_id)
        .eq("user_id", user.id);
    }

    if (job.status === "queued" || job.status === "processing") {
      await releaseReservation(user.id, id, job.requested_clip_count ?? 1);
    }

    return jsonOk({ cancelled: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
