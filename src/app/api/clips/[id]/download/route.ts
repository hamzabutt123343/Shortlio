import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const admin = createAdminClient();

    const { data: clip } = await admin
      .from("clips")
      .select("id, storage_path, title, render_status, user_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!clip) return jsonError("Clip not found", 404);
    if (clip.render_status !== "ready" || !clip.storage_path) {
      return jsonError("Clip is not ready for download", 400);
    }

    const { data, error } = await admin.storage
      .from("clips")
      .createSignedUrl(clip.storage_path, 60 * 15, {
        download: `${(clip.title || "shortlio-clip").replace(/[^\w.-]+/g, "_")}.mp4`,
      });
    if (error || !data?.signedUrl) {
      return jsonError("Could not create download link", 500);
    }

    return jsonOk({ url: data.signedUrl, expiresIn: 900 });
  } catch (err) {
    return handleRouteError(err);
  }
}
