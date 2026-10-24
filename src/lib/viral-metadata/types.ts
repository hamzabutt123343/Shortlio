export type ViralPlatform = "youtube" | "tiktok" | "instagram";

export type TitleAngle = "curiosity" | "emotion" | "event";

export type TitleOption = {
  angle: TitleAngle;
  title: string;
};

export type YouTubeViralMeta = {
  title: string;
  description: string;
  hashtags: string[];
  tags: string[];
};

export type TikTokViralMeta = {
  caption: string;
  hashtags: string[];
};

export type InstagramViralMeta = {
  caption: string;
  keywords: string[];
  hashtags: string[];
};

export type ViralMetadata = {
  language?: string;
  youtube?: YouTubeViralMeta;
  tiktok?: TikTokViralMeta;
  instagram?: InstagramViralMeta;
  /** Three distinct high-CTR title angles; youtube.title is the selected/primary one. */
  title_options?: TitleOption[];
  /** One-line grounded summary of what happens in the clip. */
  moment_summary?: string;
  generated_at?: string;
  provider?: string;
};

export function emptyViralMetadata(language = "en"): ViralMetadata {
  return {
    language,
    youtube: { title: "", description: "", hashtags: [], tags: [] },
    tiktok: { caption: "", hashtags: [] },
    instagram: { caption: "", keywords: [], hashtags: [] },
    title_options: [],
    moment_summary: "",
  };
}

export function normalizeViralMetadata(raw: unknown, language = "en"): ViralMetadata {
  const base = emptyViralMetadata(language);
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  const yt = (obj.youtube && typeof obj.youtube === "object" ? obj.youtube : {}) as Record<
    string,
    unknown
  >;
  const tt = (obj.tiktok && typeof obj.tiktok === "object" ? obj.tiktok : {}) as Record<
    string,
    unknown
  >;
  const ig = (obj.instagram && typeof obj.instagram === "object" ? obj.instagram : {}) as Record<
    string,
    unknown
  >;
  const asList = (v: unknown) =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

  const optionsRaw = Array.isArray(obj.title_options) ? obj.title_options : [];
  const title_options: TitleOption[] = optionsRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const angle = String(row.angle || "").toLowerCase();
      const title = String(row.title || "").trim();
      if (!title) return null;
      if (angle !== "curiosity" && angle !== "emotion" && angle !== "event") return null;
      return { angle: angle as TitleAngle, title };
    })
    .filter((x): x is TitleOption => Boolean(x))
    .slice(0, 3);

  return {
    language: String(obj.language || language),
    youtube: {
      title: String(yt.title ?? base.youtube!.title),
      description: String(yt.description ?? base.youtube!.description),
      hashtags: asList(yt.hashtags).length ? asList(yt.hashtags) : base.youtube!.hashtags,
      tags: asList(yt.tags).length ? asList(yt.tags) : base.youtube!.tags,
    },
    tiktok: {
      caption: String(tt.caption ?? base.tiktok!.caption),
      hashtags: asList(tt.hashtags).length ? asList(tt.hashtags) : base.tiktok!.hashtags,
    },
    instagram: {
      caption: String(ig.caption ?? base.instagram!.caption),
      keywords: asList(ig.keywords).length ? asList(ig.keywords) : base.instagram!.keywords,
      hashtags: asList(ig.hashtags).length ? asList(ig.hashtags) : base.instagram!.hashtags,
    },
    title_options,
    moment_summary: obj.moment_summary ? String(obj.moment_summary) : "",
    generated_at: obj.generated_at ? String(obj.generated_at) : undefined,
    provider: obj.provider ? String(obj.provider) : undefined,
  };
}
