/** Hard cap for AI / custom / live clip length (seconds). */
export const MAX_CLIP_DURATION_SECONDS = 180;

export type ClipDurationId = "auto" | "45" | "60" | "120" | "180";

export type ClipDurationOption = {
  id: ClipDurationId;
  label: string;
  /** Target / max clip length in seconds. */
  seconds: number;
};

/** User-facing clip length choices (never longer than 3 minutes). */
export const CLIP_DURATION_OPTIONS: readonly ClipDurationOption[] = [
  { id: "auto", label: "Auto · ~45s (best for Shorts)", seconds: 45 },
  { id: "45", label: "45 seconds", seconds: 45 },
  { id: "60", label: "1 minute", seconds: 60 },
  { id: "120", label: "2 minutes", seconds: 120 },
  { id: "180", label: "3 minutes (max)", seconds: 180 },
] as const;

export const DEFAULT_CLIP_DURATION_ID: ClipDurationId = "auto";

export function clipDurationSeconds(id: ClipDurationId | string): number {
  const opt = CLIP_DURATION_OPTIONS.find((o) => o.id === id);
  return opt?.seconds ?? 45;
}

export function clampClipDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return 45;
  return Math.min(MAX_CLIP_DURATION_SECONDS, Math.max(5, Math.round(seconds)));
}
