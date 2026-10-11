import { handleRouteError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getUsageInfo } from "@/lib/quota";

export async function GET() {
  try {
    const user = await requireUser();
    const supabase = await createClient();
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    const usage = await getUsageInfo(user.id);
    return jsonOk({ subscription, usage });
  } catch (err) {
    return handleRouteError(err);
  }
}
