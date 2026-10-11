import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { getBillingProvider } from "@/lib/billing";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!user.email) return jsonError("Account email required for checkout", 400);

    const origin = new URL(request.url).origin;
    const provider = getBillingProvider();
    const { url } = await provider.createCheckout({
      userId: user.id,
      email: user.email,
      successUrl: `${origin}/billing?success=1`,
      cancelUrl: `${origin}/billing?cancelled=1`,
    });

    return jsonOk({ url });
  } catch (err) {
    return handleRouteError(err);
  }
}
