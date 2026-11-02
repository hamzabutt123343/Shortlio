"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Label } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      setEmail(data.user.email ?? "");
      setDisplayName((data.user.user_metadata?.display_name as string) || "");
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void load();
    });
    return () => cancelAnimationFrame(id);
  }, [load]);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setError("Not signed in");
      return;
    }
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", auth.user.id);
    if (profileError) {
      setError(profileError.message);
      return;
    }
    await supabase.auth.updateUser({ data: { display_name: displayName } });
    setMessage("Profile updated.");
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">
        Settings
      </h1>
      <Card>
        <form onSubmit={saveProfile} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={email} disabled />
          </div>
          <div>
            <Label htmlFor="name">Display name</Label>
            <Input
              id="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          {message && <p className="mt-0 text-sm text-[var(--success)]">{message}</p>}
          <Button type="submit">Save</Button>
        </form>
      </Card>
    </div>
  );
}
