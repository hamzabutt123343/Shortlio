import { createAdminClient } from "@/lib/supabase/admin";

const STALE_MS = 90_000;

/**
 * Cloud/dev worker heartbeat check. Product processing runs in the Windows desktop
 * engine — this is informational for operators who still run `worker/main.py`.
 */
export async function getWorkerStatus(): Promise<{
  available: boolean;
  lastSeenAt: string | null;
  message: string;
}> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("worker_heartbeats")
      .select("worker_id, last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data?.last_seen_at) {
      return {
        available: false,
        lastSeenAt: null,
        message:
          "No cloud/dev worker heartbeat. Use the Shortlio Windows app to process clips on your PC.",
      };
    }

    const age = Date.now() - new Date(data.last_seen_at).getTime();
    if (age > STALE_MS) {
      return {
        available: false,
        lastSeenAt: data.last_seen_at,
        message:
          "Cloud/dev worker heartbeat is stale. Desktop users process jobs locally in the Windows app.",
      };
    }

    return {
      available: true,
      lastSeenAt: data.last_seen_at,
      message: "Dev/cloud worker online",
    };
  } catch {
    return {
      available: false,
      lastSeenAt: null,
      message: "Unable to check worker status. Configure Supabase service role key.",
    };
  }
}
