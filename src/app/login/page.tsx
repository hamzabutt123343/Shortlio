"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { Button, Card, Input, Label } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      router.push(search.get("next") || "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold">Sign in</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">Welcome back to Shortlio.</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="mt-4 text-sm text-[var(--text-muted)]">
        No account?{" "}
        <Link href="/signup" className="text-[var(--accent)]">
          Sign up
        </Link>
        {" · "}
        <Link href="/reset-password" className="text-[var(--accent)]">
          Reset password
        </Link>
      </p>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-xl font-extrabold tracking-tight"
        >
          Shortlio
        </Link>
        <Link href="/signup" className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
          Create account
        </Link>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <Suspense fallback={<Card className="w-full max-w-md">Loading…</Card>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
