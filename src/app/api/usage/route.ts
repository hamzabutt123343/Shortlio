import { handleRouteError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { getUsageInfo } from "@/lib/quota";

export async function GET() {
  try {
    const user = await requireUser();
    const usage = await getUsageInfo(user.id);
    return jsonOk({ usage });
  } catch (err) {
    return handleRouteError(err);
  }
}
