import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { getBillingProvider } from "@/lib/billing";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const provider = getBillingProvider();
    if (!provider.createPortal) {
      return jsonError(
        "Billing portal is not available for the configured provider. Use the checkout/cancel links from your email receipt or provider dashboard.",
        501,
      );
    }
    const origin = new URL(request.url).origin;
    const { url } = await provider.createPortal({
      userId: user.id,
      returnUrl: `${origin}/billing`,
    });
    return jsonOk({ url });
  } catch (err) {
    return handleRouteError(err);
  }
}
