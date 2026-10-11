import { createAdminClient } from "@/lib/supabase/admin";

const STALE_MS = 90_000;

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
          "Video worker is offline. Jobs will stay queued until you start the worker process.",
      };
    }

    const age = Date.now() - new Date(data.last_seen_at).getTime();
    if (age > STALE_MS) {
      return {
        available: false,
        lastSeenAt: data.last_seen_at,
        message:
          "Video worker has not reported recently. Queued jobs will not process until it is running.",
      };
    }

    return {
      available: true,
      lastSeenAt: data.last_seen_at,
      message: "Worker online",
    };
  } catch {
    return {
      available: false,
      lastSeenAt: null,
      message: "Unable to check worker status. Configure Supabase service role key.",
    };
  }
}
