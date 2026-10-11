import { createHmac, timingSafeEqual } from "crypto";
import type {
  BillingProvider,
  CheckoutParams,
  CheckoutResult,
  NormalizedBillingEvent,
  PortalParams,
} from "@/lib/billing/provider";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

/** Minimal Stripe adapter using REST (no stripe SDK required). */
export function createStripeProvider(): BillingProvider {
  return {
    name: "stripe",

    async createCheckout(params: CheckoutParams): Promise<CheckoutResult> {
      const secret = requireEnv("STRIPE_SECRET_KEY");
      const priceId = requireEnv("STRIPE_PRICE_ID");

      const body = new URLSearchParams();
      body.set("mode", "subscription");
      body.set("success_url", params.successUrl);
      body.set("cancel_url", params.cancelUrl);
      body.set("client_reference_id", params.userId);
      body.set("customer_email", params.email);
      body.set("line_items[0][price]", priceId);
      body.set("line_items[0][quantity]", "1");
      body.set("metadata[user_id]", params.userId);

      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!res.ok) {
        throw new Error(`Stripe checkout failed: ${await res.text()}`);
      }
      const json = (await res.json()) as { url?: string };
      if (!json.url) throw new Error("Stripe checkout URL missing");
      return { url: json.url };
    },

    async createPortal(params: PortalParams): Promise<{ url: string }> {
      const secret = requireEnv("STRIPE_SECRET_KEY");
      // Expect caller to store stripe customer id on subscriptions row
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      const { data } = await admin
        .from("subscriptions")
        .select("provider_customer_id")
        .eq("user_id", params.userId)
        .maybeSingle();
      if (!data?.provider_customer_id) {
        throw new Error("No Stripe customer on file");
      }
      const body = new URLSearchParams();
      body.set("customer", data.provider_customer_id);
      body.set("return_url", params.returnUrl);
      const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!res.ok) throw new Error(`Stripe portal failed: ${await res.text()}`);
      const json = (await res.json()) as { url?: string };
      if (!json.url) throw new Error("Stripe portal URL missing");
      return { url: json.url };
    },

    async verifyWebhook(rawBody: string, signature: string | null): Promise<unknown> {
      const secret = requireEnv("STRIPE_WEBHOOK_SECRET");
      if (!signature) throw new Error("Missing Stripe signature");
      // Simplified verification for test mode; production should use Stripe SDK constructEvent
      const parts = Object.fromEntries(
        signature.split(",").map((p) => {
          const [k, v] = p.split("=");
          return [k, v];
        }),
      );
      const timestamp = parts.t;
      const sig = parts.v1;
      if (!timestamp || !sig) throw new Error("Malformed Stripe signature");
      const age = Math.abs(Date.now() / 1000 - Number(timestamp));
      if (age > 300) throw new Error("Stripe webhook timestamp too old");
      const signed = `${timestamp}.${rawBody}`;
      const expected = createHmac("sha256", secret).update(signed).digest("hex");
      const a = Buffer.from(expected);
      const b = Buffer.from(sig);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new Error("Invalid Stripe webhook signature");
      }
      return JSON.parse(rawBody) as unknown;
    },

    normalizeEvent(payload: unknown): NormalizedBillingEvent | null {
      const event = payload as {
        id?: string;
        type?: string;
        data?: {
          object?: {
            id?: string;
            customer?: string;
            status?: string;
            client_reference_id?: string;
            metadata?: { user_id?: string };
            current_period_end?: number;
            cancel_at_period_end?: boolean;
            subscription?: string;
          };
        };
      };

      const typeMap: Record<string, NormalizedBillingEvent["type"] | undefined> = {
        "customer.subscription.created": "subscription_created",
        "customer.subscription.updated": "subscription_updated",
        "customer.subscription.deleted": "subscription_cancelled",
        "invoice.payment_failed": "payment_failed",
        "checkout.session.completed": "subscription_created",
      };
      const mapped = event.type ? typeMap[event.type] : undefined;
      if (!mapped || !event.id) return null;

      const obj = event.data?.object ?? {};
      const status = obj.status ?? "inactive";
      const active = status === "active" || status === "trialing";

      return {
        type: mapped,
        eventId: event.id,
        userId: obj.metadata?.user_id ?? obj.client_reference_id ?? null,
        customerId: obj.customer ? String(obj.customer) : null,
        subscriptionId: obj.subscription
          ? String(obj.subscription)
          : obj.id
            ? String(obj.id)
            : null,
        status,
        plan: active ? "pro" : "free",
        currentPeriodEnd: obj.current_period_end
          ? new Date(obj.current_period_end * 1000).toISOString()
          : null,
        cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
        raw: payload,
      };
    },
  };
}
