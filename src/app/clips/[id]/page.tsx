import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ClipEditor } from "@/components/clip-editor";
import { getSessionUser } from "@/lib/auth/session";
import { getUsageInfo } from "@/lib/quota";
import { createAdminClient } from "@/lib/supabase/admin";
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

  return (
    <AppShell
      planLabel={usage.plan === "pro" ? "Pro" : "Free"}
      usageLabel={
        usage.plan === "pro"
          ? "Pro · unlimited (fair use)"
          : `Free · ${usage.remaining}/${usage.limit} clips left today`
      }
    >
      <div className="mx-auto max-w-6xl">
        <ClipEditor initialClip={clip} initialSignedUrl={signedUrl} />
      </div>
    </AppShell>
  );
}
