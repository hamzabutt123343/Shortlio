"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { CaptionStylePicker } from "@/components/caption-style-picker";
import { Button, Card, Input, Label } from "@/components/ui";
import { settingsForPresetMode, type CaptionSettings } from "@/lib/captions/style";
import {
  CLIP_DURATION_OPTIONS,
  DEFAULT_CLIP_DURATION_ID,
  MAX_CLIP_DURATION_SECONDS,
  clipDurationSeconds,
  type ClipDurationId,
} from "@/lib/clip-duration";
import {
  DEFAULT_FRAMING_MODE,
  FRAMING_OPTIONS,
  cropSettingsForFramingMode,
  type FramingMode,
} from "@/lib/framing";
import { startDesktopJob } from "@/lib/start-desktop-job";
import { CLIP_COUNT_OPTIONS, type UsageInfo } from "@/lib/types";
import { detectPlatform, detectSourceKind } from "@/lib/validation/url";

const FRAMING_IDS = new Set(FRAMING_OPTIONS.map((o) => o.id));

type ClipMode = "ai" | "custom" | "live_record";

export function NewProjectForm({
  usage,
  initialPreset,
  initialFraming,
  initialLanguage,
}: {
  usage: UsageInfo;
  initialPreset?: string;
  initialFraming?: string;
  initialLanguage?: string;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [clipMode, setClipMode] = useState<ClipMode>("ai");
  const [clipCount, setClipCount] = useState(1);
  const [clipDurationId, setClipDurationId] = useState<ClipDurationId>(DEFAULT_CLIP_DURATION_ID);
  const [customStart, setCustomStart] = useState("0");
  const [customEnd, setCustomEnd] = useState("45");
  const [liveRecordSeconds, setLiveRecordSeconds] = useState("90");
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "1:1" | "16:9">("9:16");
  const [captionPreset, setCaptionPreset] = useState(initialPreset || "classic_white");
  const [captionLanguage, setCaptionLanguage] = useState(initialLanguage || "en");
  const [captionSettings, setCaptionSettings] = useState<CaptionSettings>(settingsForPresetMode);
  const [platformPreset, setPlatformPreset] = useState("youtube_shorts");
  const [framingMode, setFramingMode] = useState<FramingMode>(
    initialFraming && FRAMING_IDS.has(initialFraming as FramingMode)
      ? (initialFraming as FramingMode)
      : DEFAULT_FRAMING_MODE,
  );
  const [error, setError] = useState<string | null>(null);
  const [workerNote, setWorkerNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const maxClipDuration = clipDurationSeconds(clipDurationId);

  function applyClipDuration(id: ClipDurationId) {
    setClipDurationId(id);
    const secs = clipDurationSeconds(id);
    const start = Number(customStart);
    if (Number.isFinite(start) && start >= 0) {
      setCustomEnd(String(start + secs));
    }
    // Live snapshot shares the same length options (min 20s).
    setLiveRecordSeconds(String(Math.max(20, Math.min(MAX_CLIP_DURATION_SECONDS, secs === 45 && id === "auto" ? 90 : secs))));
  }

  const framingHint = useMemo(
    () => FRAMING_OPTIONS.find((o) => o.id === framingMode)?.description ?? "",
    [framingMode],
  );

  const urlHint = useMemo(() => {
    if (!url.trim()) return null;
    try {
      const platform = detectPlatform(url);
      const kind = detectSourceKind(url);
      if (platform === "unknown") return null;
      if (kind === "live" && (platform === "twitch" || platform === "kick")) {
        return `Detected ${platform} live channel URL — use a VOD/clip for AI/Custom, or Live snapshot.`;
      }
      if (kind === "vod" || kind === "clip") {
        return `Detected ${platform} ${kind}.`;
      }
      return `Detected ${platform}.`;
    } catch {
      return null;
    }
  }, [url]);

  const effectiveClipCount = clipMode === "ai" ? clipCount : 1;
  const freeBlocked =
    usage.plan === "free" &&
    usage.remaining !== null &&
    effectiveClipCount > usage.remaining;

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
          clipCount: effectiveClipCount,
          aspectRatio,
          captionPreset,
          captionLanguage,
          captionSettings,
          platformPreset,
          cropSettings: cropSettingsForFramingMode(framingMode),
          clipMode,
          maxClipDuration,
          customStart: clipMode === "custom" ? Number(customStart) : undefined,
          customEnd: clipMode === "custom" ? Number(customEnd) : undefined,
          liveRecordSeconds:
            clipMode === "live_record" ? Number(liveRecordSeconds) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create project");

      if (data.job?.id) {
        const engineNote = await startDesktopJob(String(data.job.id));
        if (engineNote) setWorkerNote(engineNote);
      } else {
        setWorkerNote(
          "Open this page in the Shortlio Windows app to process clips on your PC.",
        );
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
    <Card className="border-[var(--border)] bg-[var(--surface)]/70">
      <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
        Import stream or video URL
      </h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        YouTube, Twitch, and Kick VODs/clips (public). Live channels need Live snapshot — they
        cannot be downloaded like finished broadcasts.
      </p>
      <form onSubmit={onSubmit} className="mt-5 space-y-5">
        <div>
          <Label htmlFor="url">Source URL</Label>
          <Input
            id="url"
            placeholder="https://www.twitch.tv/videos/… or kick.com/…/videos/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            className="text-base"
          />
          {urlHint && <p className="mt-1.5 text-xs text-[var(--text-muted)]">{urlHint}</p>}
        </div>

        <div>
          <Label htmlFor="clipMode">Clip mode</Label>
          <select
            id="clipMode"
            className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm"
            value={clipMode}
            onChange={(e) => setClipMode(e.target.value as ClipMode)}
          >
            <option value="ai">AI viral clips (VODs)</option>
            <option value="custom">Custom clip (start / end on VOD)</option>
            <option value="live_record">Live snapshot (record 20–180s from live edge)</option>
          </select>
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            {clipMode === "ai" &&
              "Finds reactions, arguments, surprises, and funny moments from the transcript."}
            {clipMode === "custom" &&
              "Pick exact timestamps on a finished VOD or past broadcast."}
            {clipMode === "live_record" &&
              "Records a short window from an active live stream, then captions/exports it. Not a full VOD download."}
          </p>
        </div>

        <div>
          <Label htmlFor="clipDuration">Clip length</Label>
          <select
            id="clipDuration"
            className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm"
            value={clipDurationId}
            onChange={(e) => applyClipDuration(e.target.value as ClipDurationId)}
          >
            {CLIP_DURATION_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            {clipMode === "ai" && "AI aims for moments up to this length (max 3 min)."}
            {clipMode === "custom" &&
              `Sets end from your start time. Custom window cannot exceed ${MAX_CLIP_DURATION_SECONDS}s (3 min).`}
            {clipMode === "live_record" && "How long to record from the live edge (20–180s)."}
          </p>
        </div>

        {clipMode === "custom" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="customStart">Start (seconds)</Label>
              <Input
                id="customStart"
                type="number"
                min={0}
                step={0.1}
                value={customStart}
                onChange={(e) => {
                  const next = e.target.value;
                  setCustomStart(next);
                  const start = Number(next);
                  if (Number.isFinite(start) && start >= 0) {
                    setCustomEnd(String(start + maxClipDuration));
                  }
                }}
                required
              />
            </div>
            <div>
              <Label htmlFor="customEnd">End (seconds)</Label>
              <Input
                id="customEnd"
                type="number"
                min={0.5}
                step={0.1}
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                required
              />
              {(() => {
                const span = Number(customEnd) - Number(customStart);
                if (!Number.isFinite(span)) return null;
                if (span > MAX_CLIP_DURATION_SECONDS) {
                  return (
                    <p className="mt-1.5 text-xs text-[var(--danger)]">
                      Window is {Math.round(span)}s — max is {MAX_CLIP_DURATION_SECONDS}s (3 min).
                    </p>
                  );
                }
                return (
                  <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                    Length: {Math.max(0, Math.round(span))}s
                  </p>
                );
              })()}
            </div>
          </div>
        )}

        {clipMode === "live_record" && (
          <div>
            <Label htmlFor="liveSecs">Record length (seconds)</Label>
            <Input
              id="liveSecs"
              type="number"
              min={20}
              max={180}
              step={1}
              value={liveRecordSeconds}
              onChange={(e) => setLiveRecordSeconds(e.target.value)}
              required
            />
            <p className="mt-1.5 text-xs text-[var(--text-muted)]">
              20–{MAX_CLIP_DURATION_SECONDS} seconds from the live edge (synced with Clip length above).
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {clipMode === "ai" && (
            <div>
              <Label htmlFor="clips">Clip count</Label>
              <select
                id="clips"
                className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm"
                value={clipCount}
                onChange={(e) => setClipCount(Number(e.target.value))}
              >
                {CLIP_COUNT_OPTIONS.map((n) => (
                  <option
                    key={n}
                    value={n}
                    disabled={usage.plan === "free" && (usage.remaining ?? 0) < n}
                  >
                    {n} {n === 1 ? "clip" : "clips"}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <Label htmlFor="platform">Export preset</Label>
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
          <div className="sm:col-span-2">
            <Label htmlFor="framing">Smart framing</Label>
            <select
              id="framing"
              className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm"
              value={framingMode}
              onChange={(e) => setFramingMode(e.target.value as FramingMode)}
            >
              {FRAMING_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            {framingHint && (
              <p className="mt-1.5 text-xs text-[var(--text-muted)]">{framingHint}</p>
            )}
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
            Basic (free): {usage.remaining}/{usage.limit} clips remaining today (resets{" "}
            {new Date(usage.resetAt).toUTCString()} UTC).
          </p>
        )}
        {freeBlocked && (
          <p className="text-sm text-[var(--warning)]">
            Selected clip count exceeds your remaining daily allowance. Choose fewer clips or
            upgrade to Pro (Rs 500 lifetime on Discord).
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
