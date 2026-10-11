import { z } from "zod";

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^\[?fc00:/i,
  /^\[?fe80:/i,
  /^169\.254\./,
  /^metadata\.google/i,
  /^metadata$/i,
];

export const SUPPORTED_PLATFORMS = [
  "youtube",
  "youtu.be",
  "tiktok",
  "instagram",
  "vimeo",
  "twitter",
  "x.com",
] as const;

export type SupportedPlatform =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "vimeo"
  | "twitter"
  | "unknown";

export function detectPlatform(url: string): SupportedPlatform {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (host.includes("youtube") || host === "youtu.be") return "youtube";
    if (host.includes("tiktok")) return "tiktok";
    if (host.includes("instagram")) return "instagram";
    if (host.includes("vimeo")) return "vimeo";
    if (host.includes("twitter") || host === "x.com") return "twitter";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(host));
}

export const videoUrlSchema = z
  .string()
  .trim()
  .url("Enter a valid URL")
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  }, "Only http(s) URLs are allowed")
  .refine((value) => {
    try {
      return !isPrivateOrLocalHost(new URL(value).hostname);
    } catch {
      return false;
    }
  }, "Private or local network URLs are not allowed")
  .refine((value) => detectPlatform(value) !== "unknown", {
    message:
      "Unsupported source. Use a public YouTube, TikTok, Instagram, Vimeo, or X video URL.",
  });

export function validateVideoUrl(url: string): {
  ok: true;
  url: string;
  platform: SupportedPlatform;
} | {
  ok: false;
  error: string;
} {
  const parsed = videoUrlSchema.safeParse(url);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid URL" };
  }
  return {
    ok: true,
    url: parsed.data,
    platform: detectPlatform(parsed.data),
  };
}
