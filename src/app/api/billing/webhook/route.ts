import { jsonError, jsonOk } from "@/lib/api";
import { applyBillingEvent, getBillingProvider } from "@/lib/billing";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const provider = getBillingProvider();
    const signature =
      request.headers.get("x-signature") ||
      request.headers.get("stripe-signature") ||
      request.headers.get("x-lemon-signature");

    const payload = await provider.verifyWebhook(rawBody, signature);
    const event = provider.normalizeEvent(payload);
    if (!event) {
      return jsonOk({ ignored: true });
    }

    const result = await applyBillingEvent(event);
    return jsonOk({ received: true, applied: result.applied });
  } catch (err) {
    console.error("Webhook error", err);
    return jsonError(err instanceof Error ? err.message : "Webhook failed", 400);
  }
}
