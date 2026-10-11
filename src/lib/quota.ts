import { createAdminClient } from "@/lib/supabase/admin";
import { FREE_DAILY_CLIP_LIMIT, type Plan, type UsageInfo } from "@/lib/types";

function utcDayBounds(now = new Date()): { start: Date; end: Date; resetAt: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end, resetAt: end.toISOString() };
}

export async function getUserPlan(userId: string): Promise<Plan> {
  const admin = createAdminClient();
  const { data } = await admin.rpc("user_plan", { p_user_id: userId });
  return data === "pro" ? "pro" : "free";
}

export async function getUsageInfo(userId: string): Promise<UsageInfo> {
  const plan = await getUserPlan(userId);
  const { resetAt } = utcDayBounds();

  if (plan === "pro") {
    return {
      plan: "pro",
      used: 0,
      limit: null,
      remaining: null,
      resetAt,
      timezone: "UTC",
    };
  }

  const admin = createAdminClient();
  const { start } = utcDayBounds();
  const { data: events } = await admin
    .from("usage_events")
    .select("event_type, quantity")
    .eq("user_id", userId)
    .gte("created_at", start.toISOString());

  let used = 0;
  for (const ev of events ?? []) {
    if (ev.event_type === "clip_success" || ev.event_type === "clip_reserved") {
      used += ev.quantity ?? 0;
    } else if (ev.event_type === "clip_release") {
      used -= ev.quantity ?? 0;
    }
  }
  // success + in-flight (reserved - release). Releases on job end clear reservations.
  used = Math.max(0, used);
  const remaining = Math.max(0, FREE_DAILY_CLIP_LIMIT - used);

  return {
    plan: "free",
    used,
    limit: FREE_DAILY_CLIP_LIMIT,
    remaining,
    resetAt,
    timezone: "UTC",
  };
}

export async function reserveClipQuota(
  userId: string,
  quantity: number,
  jobId?: string | null,
): Promise<{ ok: true; remaining: number | null; plan: Plan } | { ok: false; error: string; remaining: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reserve_clip_quota", {
    p_user_id: userId,
    p_quantity: quantity,
    p_job_id: jobId ?? null,
  });

  if (error) {
    return { ok: false, error: error.message, remaining: 0 };
  }

  const result = data as {
    ok: boolean;
    error?: string;
    remaining?: number | null;
    plan?: Plan;
  };

  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error ?? "quota_exceeded",
      remaining: result?.remaining ?? 0,
    };
  }

  return {
    ok: true,
    remaining: result.remaining ?? null,
    plan: result.plan === "pro" ? "pro" : "free",
  };
}

export async function confirmClipSuccess(
  userId: string,
  clipId: string,
  jobId?: string | null,
): Promise<void> {
  const admin = createAdminClient();
  await admin.rpc("confirm_clip_success", {
    p_user_id: userId,
    p_clip_id: clipId,
    p_job_id: jobId ?? null,
  });
}

export async function releaseReservation(
  userId: string,
  jobId: string,
  quantity: number,
): Promise<void> {
  const admin = createAdminClient();
  await admin.rpc("release_clip_reservation", {
    p_user_id: userId,
    p_job_id: jobId,
    p_quantity: quantity,
  });
}
