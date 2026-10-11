import type { AspectRatio, PlatformPreset } from "@/lib/types";

export interface OutputFormat {
  aspect: AspectRatio;
  width: number;
  height: number;
  label: string;
}

export const OUTPUT_FORMATS: Record<AspectRatio, OutputFormat> = {
  "9:16": { aspect: "9:16", width: 1080, height: 1920, label: "Vertical 9:16" },
  "1:1": { aspect: "1:1", width: 1080, height: 1080, label: "Square 1:1" },
  "16:9": { aspect: "16:9", width: 1920, height: 1080, label: "Landscape 16:9" },
};

export const PLATFORM_PRESETS: Record<
  PlatformPreset,
  { label: string; aspect: AspectRatio; safeBottomPct: number }
> = {
  youtube_shorts: { label: "YouTube Shorts", aspect: "9:16", safeBottomPct: 18 },
  tiktok: { label: "TikTok", aspect: "9:16", safeBottomPct: 22 },
  instagram_reels: { label: "Instagram Reels", aspect: "9:16", safeBottomPct: 20 },
  custom: { label: "Custom", aspect: "9:16", safeBottomPct: 12 },
};

export function resolutionFor(aspect: AspectRatio): string {
  const f = OUTPUT_FORMATS[aspect];
  return `${f.width}x${f.height}`;
}
