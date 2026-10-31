import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui";
import { CAPTION_PRESETS } from "@/lib/captions/presets";
import { FRAMING_OPTIONS } from "@/lib/framing";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getUsageInfo } from "@/lib/quota";

export default async function TemplatesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const usage = await getUsageInfo(user.id);

  const usageLabel =
    usage.plan === "pro"
      ? "Pro · unlimited (fair use)"
      : `Basic · ${usage.remaining}/${usage.limit} clips left today`;

  return (
    <AppShell
      planLabel={usage.plan === "pro" ? "Pro" : "Basic"}
      usageLabel={usageLabel}
      title="Templates"
    >
      <div className="mx-auto max-w-5xl space-y-10">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">
            Templates
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-[var(--text-muted)]">
            Start from a caption preset or framing mode. These map to controls already available when
            you create a project.
          </p>
        </div>

        <section>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Caption presets
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CAPTION_PRESETS.map((preset) => (
              <div
                key={preset.id}
                className="flex flex-col rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/60 p-4"
              >
                <p className="font-medium">{preset.name}</p>
                <p className="mt-1 flex-1 text-xs leading-relaxed text-[var(--text-muted)]">
                  {preset.description}
                </p>
                <Link href={`/create?preset=${encodeURIComponent(preset.id)}`} className="mt-4">
                  <Button variant="secondary" className="w-full text-xs">
                    Use in new project
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Smart framing
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {FRAMING_OPTIONS.map((opt) => (
              <div
                key={opt.id}
                className="flex flex-col rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/60 p-4"
              >
                <p className="font-medium">{opt.label}</p>
                <p className="mt-1 flex-1 text-xs leading-relaxed text-[var(--text-muted)]">
                  {opt.description}
                </p>
                <Link href={`/create?framing=${encodeURIComponent(opt.id)}`} className="mt-4">
                  <Button variant="secondary" className="w-full text-xs">
                    Use in new project
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
