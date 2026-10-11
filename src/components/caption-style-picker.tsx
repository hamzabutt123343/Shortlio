"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { cn, Label } from "@/components/ui";
import { CAPTION_PRESETS, type CaptionStyle } from "@/lib/captions/presets";
import {
  ANIMATION_OPTIONS,
  HIGHLIGHT_SWATCHES,
  POSITION_OPTIONS,
  captionSettingsDiff,
  fontStackFor,
  resolveCaptionStyle,
  sampleCaptionText,
  type CaptionSettings,
} from "@/lib/captions/style";

type Props = {
  presetId: string;
  language: string;
  settings?: CaptionSettings | Record<string, unknown> | null;
  onPresetChange: (id: string) => void;
  onLanguageChange?: (lang: string) => void;
  onSettingsChange?: (settings: CaptionSettings) => void;
  /** compact = project create; full = editor with more controls */
  density?: "compact" | "full";
  className?: string;
};

export function CaptionStylePicker({
  presetId,
  language,
  settings,
  onPresetChange,
  onLanguageChange,
  onSettingsChange,
  density = "full",
  className,
}: Props) {
  const [showTune, setShowTune] = useState(density === "full");
  const style = useMemo(
    () => resolveCaptionStyle(presetId, settings),
    [presetId, settings],
  );

  function patch(partial: Partial<CaptionStyle>) {
    if (!onSettingsChange) return;
    const next = { ...style, ...partial };
    onSettingsChange(captionSettingsDiff(presetId, next));
  }

  function selectPreset(id: string) {
    onPresetChange(id);
    onSettingsChange?.({});
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Caption style
          </p>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
            Preview updates live — pick a look, then fine-tune.
          </p>
        </div>
        {onLanguageChange && (
          <div className="w-36 shrink-0">
            <Label htmlFor="caption-lang">Language</Label>
            <select
              id="caption-lang"
              className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm"
              value={language}
              onChange={(e) => onLanguageChange(e.target.value)}
            >
              <option value="en">English</option>
              <option value="hinglish">Hinglish</option>
            </select>
          </div>
        )}
      </div>

      <div
        className={cn(
          "grid gap-4",
          density === "full" ? "lg:grid-cols-[180px_1fr]" : "sm:grid-cols-[140px_1fr]",
        )}
      >
        <CaptionPhonePreview style={style} language={language} />

        <div className="min-w-0 space-y-3">
          <div
            className={cn(
              "grid gap-2",
              density === "full" ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-4",
            )}
          >
            {CAPTION_PRESETS.map((preset) => {
              const active = preset.id === presetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => selectPreset(preset.id)}
                  className={cn(
                    "group relative overflow-hidden rounded-[10px] border p-2 text-left transition",
                    active
                      ? "border-[var(--accent)] bg-[var(--accent-dim)] ring-1 ring-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]",
                  )}
                >
                  <PresetThumb preset={preset} language={language} />
                  <p className="mt-1.5 truncate text-xs font-semibold">{preset.name}</p>
                  <p className="truncate text-[10px] text-[var(--text-muted)]">
                    {preset.animation.replace("_", " ")}
                  </p>
                </button>
              );
            })}
          </div>

          {onSettingsChange && (
            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)]/60">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium"
                onClick={() => setShowTune((v) => !v)}
              >
                Fine-tune style
                <span className="text-[var(--text-muted)]">{showTune ? "−" : "+"}</span>
              </button>
              {showTune && (
                <div className="space-y-4 border-t border-[var(--border)] px-3 py-3">
                  <div>
                    <Label>Highlight color</Label>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {HIGHLIGHT_SWATCHES.map((color) => (
                        <button
                          key={color}
                          type="button"
                          aria-label={`Highlight ${color}`}
                          onClick={() => patch({ highlightColor: color })}
                          className={cn(
                            "h-7 w-7 rounded-full border-2 transition",
                            style.highlightColor.toLowerCase() === color.toLowerCase()
                              ? "border-[var(--accent)] scale-110"
                              : "border-transparent hover:scale-105",
                          )}
                          style={{ background: color }}
                        />
                      ))}
                      <label className="relative h-7 w-7 overflow-hidden rounded-full border border-[var(--border)]">
                        <input
                          type="color"
                          value={style.highlightColor}
                          onChange={(e) => patch({ highlightColor: e.target.value })}
                          className="absolute inset-0 cursor-pointer opacity-0"
                        />
                        <span
                          className="block h-full w-full"
                          style={{ background: style.highlightColor }}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="cap-text-color">Text color</Label>
                      <div className="flex items-center gap-2">
                        <input
                          id="cap-text-color"
                          type="color"
                          value={style.textColor}
                          onChange={(e) => patch({ textColor: e.target.value })}
                          className="h-9 w-12 cursor-pointer rounded border border-[var(--border)] bg-transparent"
                        />
                        <span className="text-xs text-[var(--text-muted)]">{style.textColor}</span>
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="cap-outline-color">Outline</Label>
                      <div className="flex items-center gap-2">
                        <input
                          id="cap-outline-color"
                          type="color"
                          value={style.outlineColor}
                          onChange={(e) => patch({ outlineColor: e.target.value })}
                          className="h-9 w-12 cursor-pointer rounded border border-[var(--border)] bg-transparent"
                        />
                        <input
                          type="range"
                          min={0}
                          max={8}
                          step={1}
                          value={style.outlineWidth}
                          onChange={(e) => patch({ outlineWidth: Number(e.target.value) })}
                          className="flex-1 accent-[var(--accent)]"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label>Position</Label>
                    <div className="mt-1.5 grid grid-cols-3 gap-2">
                      {POSITION_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => patch({ position: opt.id })}
                          className={cn(
                            "rounded-[8px] border px-2 py-2 text-xs font-medium transition",
                            style.position === opt.id
                              ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                              : "border-[var(--border)] hover:bg-[var(--surface-hover)]",
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label>Animation</Label>
                    <div className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {ANIMATION_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => patch({ animation: opt.id })}
                          className={cn(
                            "rounded-[8px] border px-2 py-2 text-xs font-medium transition",
                            style.animation === opt.id
                              ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                              : "border-[var(--border)] hover:bg-[var(--surface-hover)]",
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="cap-size">
                        Size · {Math.round(style.fontSize)}
                      </Label>
                      <input
                        id="cap-size"
                        type="range"
                        min={32}
                        max={84}
                        step={2}
                        value={style.fontSize}
                        onChange={(e) => patch({ fontSize: Number(e.target.value) })}
                        className="mt-1 w-full accent-[var(--accent)]"
                      />
                    </div>
                    <div>
                      <Label htmlFor="cap-words">
                        Words / line · {style.maxWordsPerCaption}
                      </Label>
                      <input
                        id="cap-words"
                        type="range"
                        min={1}
                        max={12}
                        step={1}
                        value={style.maxWordsPerCaption}
                        onChange={(e) =>
                          patch({ maxWordsPerCaption: Number(e.target.value) })
                        }
                        className="mt-1 w-full accent-[var(--accent)]"
                      />
                    </div>
                    <div>
                      <Label htmlFor="cap-bg">
                        Background · {Math.round(style.backgroundOpacity * 100)}%
                      </Label>
                      <input
                        id="cap-bg"
                        type="range"
                        min={0}
                        max={0.8}
                        step={0.05}
                        value={style.backgroundOpacity}
                        onChange={(e) =>
                          patch({ backgroundOpacity: Number(e.target.value) })
                        }
                        className="mt-1 w-full accent-[var(--accent)]"
                      />
                    </div>
                    <label className="mt-6 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={style.shadow}
                        onChange={(e) => patch({ shadow: e.target.checked })}
                      />
                      Drop shadow
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Overlay captions onto an existing video frame (clip editor). */
export function CaptionOverlayPreview({
  style,
  language,
  className,
}: {
  style: CaptionStyle;
  language: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 flex px-4",
        style.position === "top" && "items-start pt-[12%]",
        style.position === "center" && "items-center",
        style.position === "bottom" && "items-end pb-[14%]",
        className,
      )}
    >
      <AnimatedCaptionText style={style} language={language} scale={0.42} />
    </div>
  );
}

function CaptionPhonePreview({
  style,
  language,
}: {
  style: CaptionStyle;
  language: string;
}) {
  return (
    <div className="mx-auto w-full max-w-[180px]">
      <div className="relative aspect-[9/16] overflow-hidden rounded-[18px] border border-[var(--border-strong)] bg-[#1a1c22] shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
        <div
          className="absolute inset-0 opacity-80"
          style={{
            background:
              "linear-gradient(160deg, #2a3140 0%, #151820 45%, #0e1016 100%)",
          }}
        />
        <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/5 to-transparent" />
        <div className="absolute left-1/2 top-3 h-1.5 w-10 -translate-x-1/2 rounded-full bg-black/50" />
        <div
          className={cn(
            "absolute inset-x-0 flex px-2.5",
            style.position === "top" && "top-[14%]",
            style.position === "center" && "top-1/2 -translate-y-1/2",
            style.position === "bottom" && "bottom-[16%]",
          )}
        >
          <AnimatedCaptionText style={style} language={language} scale={0.28} />
        </div>
        <p className="absolute bottom-2 left-0 right-0 text-center text-[9px] text-white/40">
          Live preview
        </p>
      </div>
    </div>
  );
}

function PresetThumb({ preset, language }: { preset: CaptionStyle; language: string }) {
  const words = sampleCaptionText(language).split(" ").slice(0, 3);
  return (
    <div className="relative flex h-14 items-end justify-center overflow-hidden rounded-md bg-[#111318] px-1 pb-2">
      <div
        className="absolute inset-0 opacity-60"
        style={{
          background: "linear-gradient(145deg, #2c3344, #12151c 70%)",
        }}
      />
      <p
        className="relative z-[1] text-center leading-none"
        style={captionTextStyle(preset, 0.22)}
      >
        <span style={{ color: preset.highlightColor }}>{words[0]}</span>{" "}
        <span>{words.slice(1).join(" ")}</span>
      </p>
    </div>
  );
}

function AnimatedCaptionText({
  style,
  language,
  scale,
}: {
  style: CaptionStyle;
  language: string;
  scale: number;
}) {
  const full = sampleCaptionText(language);
  const words = useMemo(() => {
    const all = full.split(/\s+/).filter(Boolean);
    return all.slice(0, Math.max(1, style.maxWordsPerCaption));
  }, [full, style.maxWordsPerCaption]);

  const [active, setActive] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (style.animation === "none") return;
    const ms =
      style.animation === "word_pop" ? 700 : style.animation === "karaoke" ? 450 : 1200;
    const id = setInterval(() => {
      setActive((i) => (i + 1) % Math.max(words.length, 1));
      setTick((t) => t + 1);
    }, ms);
    return () => clearInterval(id);
  }, [style.animation, words.length]);

  if (style.animation === "word_pop") {
    const word = words[active % words.length] ?? words[0] ?? "";
    return (
      <p
        key={`${tick}-${word}`}
        className="caption-anim-word-pop w-full text-center leading-none"
        style={captionTextStyle(style, scale)}
      >
        <span style={{ color: style.highlightColor }}>{word}</span>
      </p>
    );
  }

  return (
    <p
      key={style.animation === "pop" || style.animation === "fade" ? tick : "static"}
      className={cn(
        "w-full text-center leading-[1.15]",
        style.animation === "fade" && "caption-anim-fade",
        style.animation === "pop" && "caption-anim-pop",
      )}
      style={captionTextStyle(style, scale)}
    >
      {words.map((word, i) => {
        const highlighted =
          style.animation === "karaoke" ? i === active % words.length : i === 0;
        return (
          <span key={`${word}-${i}`}>
            {i > 0 ? " " : null}
            <span
              style={{
                color: highlighted ? style.highlightColor : style.textColor,
                transition: "color 120ms ease",
              }}
            >
              {word}
            </span>
          </span>
        );
      })}
    </p>
  );
}

function captionTextStyle(style: CaptionStyle, scale: number): CSSProperties {
  const size = Math.max(10, style.fontSize * scale);
  const outline = Math.max(0, style.outlineWidth * scale * 0.85);
  const bg =
    style.backgroundOpacity > 0
      ? hexToRgba(style.backgroundColor, style.backgroundOpacity)
      : "transparent";

  const shadows: string[] = [];
  if (outline > 0) {
    const o = style.outlineColor;
    shadows.push(
      `${outline}px 0 0 ${o}`,
      `-${outline}px 0 0 ${o}`,
      `0 ${outline}px 0 ${o}`,
      `0 -${outline}px 0 ${o}`,
      `${outline}px ${outline}px 0 ${o}`,
      `-${outline}px ${outline}px 0 ${o}`,
      `${outline}px -${outline}px 0 ${o}`,
      `-${outline}px -${outline}px 0 ${o}`,
    );
  }
  if (style.shadow) {
    shadows.push(`0 ${Math.max(1, outline + 1)}px ${Math.max(2, outline * 2)}px rgba(0,0,0,0.75)`);
  }

  return {
    color: style.textColor,
    fontFamily: fontStackFor(style.fontFamily),
    fontSize: size,
    fontWeight: style.fontWeight,
    textShadow: shadows.length ? shadows.join(", ") : undefined,
    background: bg,
    padding: style.backgroundOpacity > 0 ? `${size * 0.25}px ${size * 0.4}px` : 0,
    borderRadius: 6,
    WebkitTextStroke:
      outline > 0 && shadows.length === 0 ? `${outline * 0.4}px ${style.outlineColor}` : undefined,
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
