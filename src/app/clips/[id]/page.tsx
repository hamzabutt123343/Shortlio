import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ClipEditor } from "@/components/clip-editor";
import { getSessionUser } from "@/lib/auth/session";
import { getUsageInfo } from "@/lib/quota";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_SEGMENT_PAD_SECONDS } from "@/lib/captions/style";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ id: string }> };

export default async function ClipPage({ params }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const usage = await getUsageInfo(user.id);
  const supabase = await createClient();

  const { data: clip } = await supabase
    .from("clips")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!clip) notFound();

  let signedUrl: string | null = null;
  if (clip.storage_path) {
    const admin = createAdminClient();
    const { data } = await admin.storage.from("clips").createSignedUrl(clip.storage_path, 1800);
    signedUrl = data?.signedUrl ?? null;
  }

  const pad = DEFAULT_SEGMENT_PAD_SECONDS;
  const { data: transcript } = await supabase
    .from("transcript_segments")
    .select("start_time,end_time,text,language")
    .eq("project_id", clip.project_id)
    .gte("end_time", Number(clip.start_time) - pad)
    .lte("start_time", Number(clip.end_time) + pad)
    .order("start_time", { ascending: true });

  return (
    <AppShell
      planLabel={usage.plan === "pro" ? "Pro" : "Basic"}
      usageLabel={
        usage.plan === "pro"
          ? "Pro · unlimited (fair use)"
          : `Basic · ${usage.remaining}/${usage.limit} clips left today`
      }
      title={clip.title || "Clip editor"}
    >
      <div className="mx-auto max-w-6xl">
        <ClipEditor
          initialClip={clip}
          initialSignedUrl={signedUrl}
          initialTranscript={transcript ?? []}
        />
      </div>
    </AppShell>
  );
}
