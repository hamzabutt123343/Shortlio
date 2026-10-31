import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const supabase = await createClient();

    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!project) return jsonError("Project not found", 404);

    const [{ data: jobs }, { data: candidates }, { data: clips }, { data: segments }] =
      await Promise.all([
        supabase
          .from("jobs")
          .select("*")
          .eq("project_id", id)
          .order("created_at", { ascending: false }),
        supabase
          .from("clip_candidates")
          .select("*")
          .eq("project_id", id)
          .order("score", { ascending: false }),
        supabase
          .from("clips")
          .select("*")
          .eq("project_id", id)
          .order("created_at", { ascending: true }),
        supabase
          .from("transcript_segments")
          .select("*")
          .eq("project_id", id)
          .order("start_time", { ascending: true })
          .limit(500),
      ]);

    return jsonOk({
      project,
      jobs: jobs ?? [],
      candidates: candidates ?? [],
      clips: clips ?? [],
      transcript: segments ?? [],
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const admin = createAdminClient();

    const { data: project } = await admin
      .from("projects")
      .select("id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!project) return jsonError("Project not found", 404);

    const { data: clips } = await admin
      .from("clips")
      .select("storage_path")
      .eq("project_id", id);

    for (const clip of clips ?? []) {
      if (clip.storage_path && !String(clip.storage_path).startsWith("local:")) {
        await admin.storage.from("clips").remove([clip.storage_path]);
      }
    }

    const { error } = await admin.from("projects").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    return jsonOk({ deleted: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
