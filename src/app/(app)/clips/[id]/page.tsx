import { notFound, redirect } from "next/navigation";
import { ClipEditor } from "@/components/clip-editor";
import { getSessionUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_SEGMENT_PAD_SECONDS } from "@/lib/captions/style";
import { localClipProtocolUrl, parseLocalClipPath } from "@/lib/local-clip-path";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ id: string }> };

export default async function ClipPage({ params }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [{ id }, supabase] = await Promise.all([params, createClient()]);

  const { data: clip } = await supabase
    .from("clips")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!clip) notFound();

  const pad = DEFAULT_SEGMENT_PAD_SECONDS;
  const localPath = parseLocalClipPath(clip.storage_path);

  const [signedUrl, transcriptResult] = await Promise.all([
    (async (): Promise<string | null> => {
      if (localPath) return localClipProtocolUrl(localPath);
      if (!clip.storage_path) return null;
      const admin = createAdminClient();
      const { data } = await admin.storage.from("clips").createSignedUrl(clip.storage_path, 1800);
      return data?.signedUrl ?? null;
    })(),
    supabase
      .from("transcript_segments")
      .select("start_time,end_time,text,language")
      .eq("project_id", clip.project_id)
      .gte("end_time", Number(clip.start_time) - pad)
      .lte("start_time", Number(clip.end_time) + pad)
      .order("start_time", { ascending: true }),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <ClipEditor
        initialClip={clip}
        initialSignedUrl={signedUrl}
        initialTranscript={transcriptResult.data ?? []}
      />
    </div>
  );
}
