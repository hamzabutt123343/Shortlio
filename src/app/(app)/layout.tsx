import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSessionUser } from "@/lib/auth/session";
import { getUsageInfo } from "@/lib/quota";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const usage = await getUsageInfo(user.id);
  const planLabel = usage.plan === "pro" ? "Pro" : "Basic";
  const usageLabel =
    usage.plan === "pro"
      ? "Pro · unlimited (fair use)"
      : `Basic · ${usage.remaining}/${usage.limit} clips left today`;

  return (
    <AppShell planLabel={planLabel} usageLabel={usageLabel}>
      {children}
    </AppShell>
  );
}
