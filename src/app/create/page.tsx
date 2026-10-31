import { AppShell } from "@/components/app-shell";
import { DesktopRequired } from "@/components/desktop-required";
import { NewProjectForm } from "@/components/new-project-form";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getUsageInfo } from "@/lib/quota";

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; framing?: string; language?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const usage = await getUsageInfo(user.id);
  const params = await searchParams;

  const usageLabel =
    usage.plan === "pro"
      ? "Pro · unlimited (fair use)"
      : `Basic · ${usage.remaining}/${usage.limit} clips left today`;

  return (
    <AppShell
      planLabel={usage.plan === "pro" ? "Pro" : "Basic"}
      usageLabel={usageLabel}
      title="Create Clips"
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">
            Create New Clips
          </h1>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            Import a public YouTube, Twitch, or Kick VOD/clip URL (or Live snapshot) and configure
            captions, framing, and export. Processing runs on your PC in the Windows app.
          </p>
        </div>

        <DesktopRequired>
          <NewProjectForm
            usage={usage}
            initialPreset={params.preset}
            initialFraming={params.framing}
            initialLanguage={params.language}
          />
        </DesktopRequired>
      </div>
    </AppShell>
  );
}
