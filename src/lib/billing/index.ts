import { createLemonSqueezyProvider } from "@/lib/billing/lemon-squeezy";
import { getBillingProviderName, type BillingProvider } from "@/lib/billing/provider";
import { createStripeProvider } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NormalizedBillingEvent } from "@/lib/billing/provider";

export function getBillingProvider(): BillingProvider {
  const name = getBillingProviderName();
  if (name === "stripe") return createStripeProvider();
  return createLemonSqueezyProvider();
}

export async function applyBillingEvent(event: NormalizedBillingEvent): Promise<{ applied: boolean }> {
  const admin = createAdminClient();

  const { error: insertError } = await admin.from("billing_events").insert({
    provider: getBillingProviderName(),
    event_id: event.eventId,
    event_type: event.type,
    payload: event.raw as object,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return { applied: false }; // duplicate webhook
    }
    throw insertError;
  }

  if (!event.userId && !event.subscriptionId && !event.customerId) {
    return { applied: true };
  }

  let userId = event.userId;
  if (!userId && event.customerId) {
    const { data } = await admin
      .from("subscriptions")
      .select("user_id")
      .eq("provider_customer_id", event.customerId)
      .maybeSingle();
    userId = data?.user_id ?? null;
  }

  if (!userId) {
    return { applied: true };
  }

  const plan =
    event.type === "subscription_expired" || event.type === "subscription_cancelled"
      ? event.cancelAtPeriodEnd
        ? "pro"
        : event.type === "subscription_expired"
          ? "free"
          : event.plan
      : event.plan;

  const status =
    event.type === "payment_failed"
      ? "past_due"
      : event.type === "subscription_cancelled"
        ? "cancelled"
        : event.type === "subscription_expired"
          ? "expired"
          : event.status === "on_trial" || event.status === "trialing"
            ? "trialing"
            : event.plan === "pro"
              ? "active"
              : "inactive";

  await admin.from("subscriptions").upsert(
    {
      user_id: userId,
      provider: getBillingProviderName(),
      provider_customer_id: event.customerId,
      provider_subscription_id: event.subscriptionId,
      status,
      plan: plan === "pro" ? "pro" : "free",
      current_period_end: event.currentPeriodEnd,
      cancel_at_period_end: event.cancelAtPeriodEnd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  return { applied: true };
}
