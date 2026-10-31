import { getShortlioDesktop } from "@/lib/desktop-bridge";
import { createClient } from "@/lib/supabase/client";

/** Start the bundled local engine for a queued job (no-op in browser). */
export async function startDesktopJob(jobId: string): Promise<string | null> {
  const desktop = getShortlioDesktop();
  if (!desktop || !jobId) return null;
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    return "Not signed in — open the desktop app and log in again.";
  }
  const started = await desktop.runJob(String(jobId), token);
  if (!started.ok) {
    return (
      started.error ||
      "Local engine could not start. Clips stay queued until the engine runs."
    );
  }
  return null;
}
