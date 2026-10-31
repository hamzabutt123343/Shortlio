import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { AuthError, getSessionUser } from "@/lib/auth/session";

/**
 * Resolve the caller from session cookies (browser/Electron UI) or
 * Authorization: Bearer <access_token> (desktop Python sidecar).
 */
export async function requireRequestUser(request: Request): Promise<User> {
  const auth = request.headers.get("authorization") || request.headers.get("Authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (!token) throw new AuthError("Authentication required");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) throw new AuthError("Supabase is not configured");
    const supabase = createSupabaseClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) throw new AuthError("Invalid or expired access token");
    return data.user;
  }

  const user = await getSessionUser();
  if (!user) throw new AuthError("Authentication required");
  return user;
}
