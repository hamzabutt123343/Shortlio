"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { CaptionStylePicker } from "@/components/caption-style-picker";
import { Button, Card, Input, Label } from "@/components/ui";
import { settingsForPresetMode, type CaptionSettings } from "@/lib/captions/style";
import { CLIP_COUNT_OPTIONS, type UsageInfo } from "@/lib/types";

export function NewProjectForm({ usage }: { usage: UsageInfo }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [clipCount, setClipCount] = useState(1);
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "1:1" | "16:9">("9:16");
  const [captionPreset, setCaptionPreset] = useState("classic_white");
  const [captionLanguage, setCaptionLanguage] = useState("en");
  const [captionSettings, setCaptionSettings] = useState<CaptionSettings>(settingsForPresetMode);
  const [platformPreset, setPlatformPreset] = useState("youtube_shorts");
  const [error, setError] = useState<string | null>(null);
  const [workerNote, setWorkerNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const freeBlocked =
    usage.plan === "free" && usage.remaining !== null && clipCount > usage.remaining;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setLoading(true);
    setError(null);
    setWorkerNote(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: url,
          clipCount,
          aspectRatio,
          captionPreset,
          captionLanguage,
          captionSettings,
          platformPreset,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create project");
      if (data.worker && !data.worker.available) {
        setWorkerNote(data.worker.message);
      }
      router.push(`/projects/${data.project.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
      setSubmitting(false);
      setLoading(false);
    }
  }

  return (
    <Card>
      <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">New project</h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Paste a public video URL. Analysis starts after you create the project.
      </p>
      <form onSubmit={onSubmit} className="mt-5 space-y-5">
        <div>
          <Label htmlFor="url">Video URL</Label>
          <Input
            id="url"
            placeholder="https://www.youtube.com/watch?v=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="clips">Clip count</Label>
            <select
              id="clips"
              className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm"
              value={clipCount}
              onChange={(e) => setClipCount(Number(e.target.value))}
            >
              {CLIP_COUNT_OPTIONS.map((n) => (
                <option key={n} value={n} disabled={usage.plan === "free" && (usage.remaining ?? 0) < n}>
                  {n} {n === 1 ? "clip" : "clips"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="platform">Platform preset</Label>
            <select
              id="platform"
              className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm"
              value={platformPreset}
              onChange={(e) => setPlatformPreset(e.target.value)}
            >
              <option value="youtube_shorts">YouTube Shorts</option>
              <option value="tiktok">TikTok</option>
              <option value="instagram_reels">Instagram Reels</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <Label htmlFor="aspect">Aspect ratio</Label>
            <select
              id="aspect"
              className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm"
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as typeof aspectRatio)}
            >
              <option value="9:16">9:16 · 1080×1920</option>
              <option value="1:1">1:1 · 1080×1080</option>
              <option value="16:9">16:9 · 1920×1080</option>
            </select>
          </div>
        </div>

        <CaptionStylePicker
          presetId={captionPreset}
          language={captionLanguage}
          settings={captionSettings}
          onPresetChange={setCaptionPreset}
          onLanguageChange={setCaptionLanguage}
          onSettingsChange={setCaptionSettings}
          density="compact"
        />

        {usage.plan === "free" && (
          <p className="text-xs text-[var(--text-muted)]">
            Free plan: {usage.remaining}/{usage.limit} clips remaining today (resets {new Date(usage.resetAt).toUTCString()} UTC).
          </p>
        )}
        {freeBlocked && (
          <p className="text-sm text-[var(--warning)]">
            Selected clip count exceeds your remaining daily allowance. Choose fewer clips or upgrade to Pro.
          </p>
        )}
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        {workerNote && <p className="text-sm text-[var(--warning)]">{workerNote}</p>}

        <Button type="submit" disabled={loading || freeBlocked || submitting}>
          {loading ? "Creating…" : "Analyze & generate"}
        </Button>
      </form>
    </Card>
  );
}
