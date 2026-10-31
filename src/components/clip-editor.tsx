"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CaptionOverlayPreview,
  CaptionStylePicker,
} from "@/components/caption-style-picker";
import { Badge, Button, Card, Input, Label } from "@/components/ui";
import {
  activeCaptionAt,
  captionStyleKey,
  DEFAULT_SEGMENT_PAD_SECONDS,
  collapseRollingCues,
  getCaptionStyleMode,
  resolveCaptionStyle,
  settingsForPresetMode,
  type CaptionSettings,
  type PreviewCue,
} from "@/lib/captions/style";
import { transformCaptionTextDetailed } from "@/lib/captions/transform";
import {
  FIT_MODE_OPTIONS,
  FRAMING_OPTIONS,
  STACK_DIRECTION_OPTIONS,
  cropSettingsForFramingMode,
  fitModeFromCropSettings,
  framingModeFromCropSettings,
  panelRatioFromCropSettings,
  stackDirectionFromCropSettings,
  type FitMode,
  type FramingMode,
  type StackDirection,
} from "@/lib/framing";
import { ViralMetadataPanel } from "@/components/viral-metadata-panel";
import { startDesktopJob } from "@/lib/start-desktop-job";
import type { Clip } from "@/lib/types";
import type { ViralMetadata } from "@/lib/viral-metadata/types";

type TranscriptRow = {
  start_time: number;
  end_time: number;
  text: string;
  language?: string | null;
};

function settingsEqual(a: CaptionSettings, b: CaptionSettings) {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

function readCropSettings(raw: unknown) {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const focal = typeof obj.focal_x === "number" ? obj.focal_x : Number(obj.focal_x ?? 0.5);
  const fx = Number.isFinite(focal) ? focal : 0.5;
  const mode = framingModeFromCropSettings(obj);
  return cropSettingsForFramingMode(mode, fx, {
    stackDirection: stackDirectionFromCropSettings(obj),
    panelRatio: panelRatioFromCropSettings(obj),
    fitMode: fitModeFromCropSettings(obj, mode),
  });
}

export function ClipEditor({
  initialClip,
  initialSignedUrl,
  initialTranscript = [],
}: {
  initialClip: Clip;
  initialSignedUrl: string | null;
  initialTranscript?: TranscriptRow[];
}) {
  const initialCrop = readCropSettings(initialClip.crop_settings);
  const [clip, setClip] = useState(initialClip);
  const [signedUrl, setSignedUrl] = useState(initialSignedUrl);
  const [transcript, setTranscript] = useState(initialTranscript);
  const [title, setTitle] = useState(initialClip.title);
  const [startTime, setStartTime] = useState(String(initialClip.start_time));
  const [endTime, setEndTime] = useState(String(initialClip.end_time));
  const [captionPreset, setCaptionPreset] = useState(initialClip.caption_preset);
  const [captionLanguage, setCaptionLanguage] = useState(initialClip.caption_language);
  const [captionSettings, setCaptionSettings] = useState<CaptionSettings>(() => {
    const raw = (initialClip.caption_settings as CaptionSettings) ?? {};
    // Normalize legacy rows so mode is always explicit.
    if (!raw.__mode) {
      return getCaptionStyleMode(raw) === "finetune"
        ? { ...raw, __mode: "finetune" }
        : settingsForPresetMode();
    }
    return raw;
  });
  const [burnCaptions, setBurnCaptions] = useState(initialClip.burn_captions);
  const [outputFormat, setOutputFormat] = useState(initialClip.output_format);
  const [quality, setQuality] = useState(initialClip.quality);
  const [focalX, setFocalX] = useState(String(initialCrop.focal_x));
  const [framingMode, setFramingMode] = useState<FramingMode>(() =>
    framingModeFromCropSettings(initialClip.crop_settings as Record<string, unknown>),
  );
  const cropRaw = initialClip.crop_settings as Record<string, unknown>;
  const [stackDirection, setStackDirection] = useState<StackDirection>(() =>
    stackDirectionFromCropSettings(cropRaw),
  );
  const [panelRatio, setPanelRatio] = useState(() =>
    String(panelRatioFromCropSettings(cropRaw)),
  );
  const [fitMode, setFitMode] = useState<FitMode>(() =>
    fitModeFromCropSettings(
      cropRaw,
      framingModeFromCropSettings(cropRaw),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerShellRef = useRef<HTMLDivElement | null>(null);
  const prevRenderStatus = useRef(initialClip.render_status);
  const storagePathRef = useRef(initialClip.storage_path);
  // Bump only when the burned MP4 actually changes (not on every poll signed-URL refresh).
  const [videoRevision, setVideoRevision] = useState(0);
  // What is actually painted in the current MP4 (survives Save without re-render).
  const [burnedSnapshot, setBurnedSnapshot] = useState(() => ({
    preset: initialClip.caption_preset,
    settings: (initialClip.caption_settings as CaptionSettings) ?? {},
    language: initialClip.caption_language,
  }));

  const style = useMemo(
    () => resolveCaptionStyle(captionPreset, captionSettings),
    [captionPreset, captionSettings],
  );
  const burnedStyleKey = useMemo(
    () => captionStyleKey(resolveCaptionStyle(burnedSnapshot.preset, burnedSnapshot.settings)),
    [burnedSnapshot],
  );

  const styleDirty = useMemo(() => {
    const saved = (clip.caption_settings as CaptionSettings) ?? {};
    return (
      captionPreset !== clip.caption_preset ||
      captionLanguage !== clip.caption_language ||
      burnCaptions !== clip.burn_captions ||
      !settingsEqual(captionSettings, saved)
    );
  }, [
    captionPreset,
    captionLanguage,
    captionSettings,
    burnCaptions,
    clip.caption_preset,
    clip.caption_language,
    clip.caption_settings,
    clip.burn_captions,
  ]);

  // Preview matches the file only when the burn snapshot equals the live style.
  // Save-without-re-render must NOT flip this to true (that caused duplicate/wrong position).
  const exportMatchesPreview =
    burnCaptions &&
    clip.render_status === "ready" &&
    Boolean(signedUrl) &&
    captionLanguage === burnedSnapshot.language &&
    captionStyleKey(style) === burnedStyleKey;

  const languagePreview = useMemo(() => {
    const sourceLang = transcript[0]?.language || "en";
    const sample = transcript.find((s) => s.text?.trim())?.text ?? "";
    if (!sample) return { unsupported: false as const, message: undefined as string | undefined };
    return transformCaptionTextDetailed(sample, sourceLang, captionLanguage);
  }, [transcript, captionLanguage]);

  const cues: PreviewCue[] = useMemo(() => {
    const start = Number(startTime) || clip.start_time;
    const pad = DEFAULT_SEGMENT_PAD_SECONDS;
    const sourceLang = transcript[0]?.language || "en";
    const raw = transcript
      .filter(
        (s) =>
          s.end_time >= start - pad &&
          s.start_time <= (Number(endTime) || clip.end_time) + pad,
      )
      .map((s) => {
        const transformed = transformCaptionTextDetailed(
          s.text,
          s.language || sourceLang,
          captionLanguage,
        );
        return {
          start: Math.max(0, s.start_time - (start - pad)),
          end: Math.max(0.05, s.end_time - (start - pad)),
          text: transformed.text,
        };
      });
    return collapseRollingCues(raw);
  }, [transcript, startTime, endTime, clip.start_time, clip.end_time, captionLanguage]);

  const liveCaption = useMemo(
    () => activeCaptionAt(cues, currentTime, style.maxWordsPerCaption),
    [cues, currentTime, style.maxWordsPerCaption],
  );

  // While paused between cues, keep the most recent line so style tweaks stay visible.
  const overlayCaption = useMemo(() => {
    if (liveCaption) return liveCaption;
    if (playing || !cues.length) return null;
    const t = currentTime; // No lead - exact sync
    let last: PreviewCue | null = null;
    for (const cue of cues) {
      if (cue.start <= t) last = cue;
      else break;
    }
    if (!last) return null;
    // Same chunking as export: show the last chunk of the cue while paused.
    const hit = activeCaptionAt(
      [{ start: last.start, end: last.end, text: last.text }],
      Math.max(last.start, last.end - 0.001),
      style.maxWordsPerCaption,
    );
    return hit;
  }, [liveCaption, playing, cues, currentTime, style.maxWordsPerCaption]);

  const overlayText = overlayCaption?.text ?? null;

  // Live CSS captions only — no black cover bars over the video.
  // (Burned MP4 text may still peek through until Save & re-render finishes.)
  const showLiveOverlay =
    !exportMatchesPreview &&
    (Boolean(overlayText?.trim()) || !transcript.length || styleDirty);

  useEffect(() => {
    if (clip.render_status !== "rendering" && clip.render_status !== "pending") return;
    const id = setInterval(async () => {
      const res = await fetch(`/api/clips/${clip.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const next = data.clip as Clip | undefined;
      if (!next) return;

      const prevStatus = prevRenderStatus.current;
      const pathChanged =
        Boolean(next.storage_path) && next.storage_path !== storagePathRef.current;
      const becameReady =
        (prevStatus === "rendering" || prevStatus === "pending") &&
        next.render_status === "ready";

      setClip(next);
      prevRenderStatus.current = next.render_status;
      if (Array.isArray(data.transcript)) setTranscript(data.transcript);

      // Fresh signed URLs every poll would remount <video key={signedUrl}> and look
      // like the preview is endlessly refreshing. Only swap when the file changes.
      if (data.signedUrl && (pathChanged || becameReady)) {
        storagePathRef.current = next.storage_path;
        setSignedUrl(data.signedUrl);
        setVideoRevision((n) => n + 1);
      }

      if (becameReady) {
        setBurnedSnapshot({
          preset: next.caption_preset,
          settings: (next.caption_settings as CaptionSettings) ?? {},
          language: next.caption_language,
        });
        setMessage("Re-render ready — preview matches the new burned captions.");
      }
    }, 3000);
    return () => clearInterval(id);
  }, [clip.id, clip.render_status]);

  useEffect(() => {
    if (transcript.length) return;
    void (async () => {
      const res = await fetch(`/api/clips/${clip.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.transcript)) setTranscript(data.transcript);
    })();
  }, [clip.id, transcript.length]);

  // Smooth playback clock (onTimeUpdate alone feels a little behind)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && !v.paused) setCurrentTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [signedUrl]);

  function buildCropSettings() {
    const fx = Number(focalX);
    const validFocal = Number.isFinite(fx) && fx >= 0 && fx <= 1;
    const pr = Number(panelRatio);
    return cropSettingsForFramingMode(framingMode, validFocal ? fx : 0.5, {
      stackDirection,
      panelRatio: Number.isFinite(pr) ? pr : 0.5,
      fitMode,
    });
  }

  async function save(
    reRender: boolean,
    overrides?: { captionPreset?: string; captionSettings?: CaptionSettings },
  ) {
    const nextPreset = overrides?.captionPreset ?? captionPreset;
    const nextSettings = overrides?.captionSettings ?? captionSettings;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          startTime: Number(startTime),
          endTime: Number(endTime),
          captionPreset: nextPreset,
          captionLanguage,
          captionSettings: nextSettings,
          burnCaptions,
          outputFormat,
          quality,
          cropSettings: buildCropSettings(),
          reRender,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setClip(data.clip);
      // So the poll can detect pending/rendering → ready (not ready → ready).
      if (reRender && data.clip?.render_status) {
        prevRenderStatus.current = data.clip.render_status;
      }
      if (data.clip?.caption_preset) setCaptionPreset(data.clip.caption_preset);
      if (data.clip?.caption_settings && typeof data.clip.caption_settings === "object") {
        setCaptionSettings(data.clip.caption_settings as CaptionSettings);
      }
      if (reRender && data.job?.id) {
        const engineNote = await startDesktopJob(String(data.job.id));
        if (engineNote) setError(engineNote);
      }
      const mode = getCaptionStyleMode(nextSettings);
      setMessage(
        reRender
          ? mode === "preset"
            ? `Preset applied & re-render started (${nextPreset}). Keep this window open — preview updates when ready.`
            : "Fine-tune saved & re-render started — preview updates when the new MP4 is ready."
          : "Settings saved. Re-render to update the burned MP4 captions.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function download() {
    setError(null);
    const res = await fetch(`/api/clips/${clip.id}/download`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Download failed");
      return;
    }
    if (data.localPath && window.shortlioDesktop?.openClipsFolder) {
      await window.shortlioDesktop.openClipsFolder();
      setMessage(`Clip saved on this PC — opened Videos\\Shortlio.`);
      return;
    }
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold">
            Clip editor
          </h1>
          <Badge
            tone={
              clip.render_status === "ready"
                ? "success"
                : clip.render_status === "failed"
                  ? "danger"
                  : "accent"
            }
          >
            {clip.render_status}
          </Badge>
        </div>
        <div
          ref={playerShellRef}
          className="relative aspect-[9/16] max-h-[640px] overflow-hidden rounded-[12px] border border-[var(--border)] bg-black"
        >
          {signedUrl ? (
            <video
              ref={videoRef}
              key={`${clip.storage_path ?? clip.id}:${videoRevision}`}
              src={signedUrl}
              controls
              // Keep live overlay in sync — native video fullscreen would drop the HTML layer.
              controlsList="nofullscreen"
              className="h-full w-full object-contain"
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onLoadedMetadata={(e) => {
                // Disable any soft subtitle tracks so the browser never paints a 2nd layer.
                const tracks = e.currentTarget.textTracks;
                for (let i = 0; i < tracks.length; i++) {
                  tracks[i].mode = "disabled";
                }
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
              Preview unavailable until render completes
            </div>
          )}
          {showLiveOverlay && (
            <CaptionOverlayPreview
              style={style}
              language={captionLanguage}
              text={overlayText}
              wordIndex={
                overlayCaption && "wordIndex" in overlayCaption
                  ? overlayCaption.wordIndex
                  : undefined
              }
              playing={playing}
              sampleFallback={!transcript.length && (styleDirty || !exportMatchesPreview)}
              className="z-[2]"
            />
          )}
          {signedUrl && (
            <button
              type="button"
              className="absolute right-3 top-2 z-[3] rounded-md border border-white/20 bg-black/55 px-2 py-1 text-[11px] font-medium text-white/90 hover:bg-black/75"
              onClick={() => {
                const el = playerShellRef.current;
                if (!el) return;
                if (document.fullscreenElement === el) {
                  void document.exitFullscreen();
                } else {
                  void el.requestFullscreen();
                }
              }}
            >
              Full screen
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {exportMatchesPreview
            ? "Showing exported captions (preview matches download)."
            : overlayText
              ? "Live preview — Save & re-render to burn this style into the MP4."
              : transcript.length
                ? "Waiting for speech in this part of the clip…"
                : "Loading transcript for captions…"}
          {styleDirty
            ? " Unsaved editor changes."
            : !exportMatchesPreview && burnCaptions
              ? " Saved style differs from the current MP4 burn."
              : ""}
        </p>
        {clip.reframe_warning && (
          <p className="mt-3 text-sm text-[var(--warning)]">
            Automatic subject tracking used a fallback. Adjust Focal X and re-render.
          </p>
        )}
      </Card>

      <div className="space-y-4">
        <Card className="space-y-3">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="start">Start (s)</Label>
              <Input id="start" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="end">End (s)</Label>
              <Input id="end" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <CaptionStylePicker
            presetId={captionPreset}
            language={captionLanguage}
            settings={captionSettings}
            onPresetChange={setCaptionPreset}
            onLanguageChange={setCaptionLanguage}
            onSettingsChange={setCaptionSettings}
            density="full"
          />

          <div>
            <Label htmlFor="aspect">Aspect ratio</Label>
            <select
              id="aspect"
              className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm"
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value)}
            >
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
              <option value="16:9">16:9</option>
            </select>
          </div>
          <div>
            <Label htmlFor="quality">Quality</Label>
            <select
              id="quality"
              className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm"
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
            >
              <option value="draft">Draft</option>
              <option value="balanced">Balanced</option>
              <option value="high">High</option>
            </select>
          </div>

          <div className="space-y-2 rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)]/60 px-3 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Smart Framing
            </p>
            
            <div>
              <Label htmlFor="framing-mode">Framing mode</Label>
              <select
                id="framing-mode"
                className="mt-1 w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                value={framingMode}
                onChange={(e) => setFramingMode(e.target.value as FramingMode)}
              >
                {FRAMING_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                {FRAMING_OPTIONS.find((o) => o.id === framingMode)?.description}
              </p>
            </div>

            {(framingMode === "static" || framingMode === "reaction_stack") && (
              <div>
                <Label htmlFor="focal">
                  {framingMode === "reaction_stack"
                    ? "Reactor side (0 = left, 1 = right)"
                    : "Focal X position (0 = left, 1 = right)"}
                </Label>
                <Input
                  id="focal"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={focalX}
                  onChange={(e) => setFocalX(e.target.value)}
                />
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {framingMode === "reaction_stack"
                    ? "Which side of the source the reactor is on."
                    : "0.5 = center. Adjust left/right to frame your subject."}
                </p>
              </div>
            )}

            {(framingMode === "reaction_stack" || framingMode === "split_stack") && (
              <>
                <div>
                  <Label htmlFor="stack-direction">Panel layout</Label>
                  <select
                    id="stack-direction"
                    className="mt-1 w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                    value={stackDirection}
                    onChange={(e) => setStackDirection(e.target.value as StackDirection)}
                  >
                    {STACK_DIRECTION_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="panel-ratio">
                    Primary panel size ({Math.round(Number(panelRatio) * 100) || 50}%)
                  </Label>
                  <input
                    id="panel-ratio"
                    type="range"
                    min={0.25}
                    max={0.75}
                    step={0.05}
                    value={panelRatio}
                    onChange={(e) => setPanelRatio(e.target.value)}
                    className="mt-2 w-full"
                  />
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Share of the canvas for the reactor / primary speaker panel.
                  </p>
                </div>
                <div>
                  <Label htmlFor="fit-mode">Panel fit</Label>
                  <select
                    id="fit-mode"
                    className="mt-1 w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                    value={fitMode}
                    onChange={(e) => setFitMode(e.target.value as FitMode)}
                  >
                    {FIT_MODE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                    {FIT_MODE_OPTIONS.find((o) => o.id === fitMode)?.description}
                  </p>
                </div>
              </>
            )}
          </div>

          <ViralMetadataPanel
            clipId={clip.id}
            initial={clip.viral_metadata}
            language={captionLanguage}
            onSaved={(meta: ViralMetadata) => {
              setClip((prev) => ({
                ...prev,
                viral_metadata: meta as unknown as Record<string, unknown>,
              }));
            }}
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={burnCaptions}
              onChange={(e) => setBurnCaptions(e.target.checked)}
            />
            Burn captions into export
          </label>
          {languagePreview.unsupported && languagePreview.message && (
            <p className="text-sm text-[var(--warning)]">{languagePreview.message}</p>
          )}
          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          {message && <p className="text-sm text-[var(--success)]">{message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void save(false)}
              disabled={saving || clip.render_status === "rendering" || clip.render_status === "pending"}
            >
              {saving ? "Saving…" : "Save settings"}
            </Button>
            <Button
              type="button"
              onClick={() => void save(true)}
              disabled={saving || clip.render_status === "rendering" || clip.render_status === "pending"}
            >
              {saving
                ? "Saving…"
                : clip.render_status === "rendering" || clip.render_status === "pending"
                  ? "Re-rendering…"
                  : "Save & re-render"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void download()}
              disabled={clip.render_status !== "ready"}
            >
              Download
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
