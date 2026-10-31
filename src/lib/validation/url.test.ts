import { describe, expect, it } from "vitest";
import {
  detectPlatform,
  detectSourceKind,
  isPrivateOrLocalHost,
  validateVideoUrl,
} from "@/lib/validation/url";

describe("validateVideoUrl", () => {
  it("accepts public YouTube URLs", () => {
    const result = validateVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.platform).toBe("youtube");
  });

  it("accepts Twitch VOD and clip URLs", () => {
    const vod = validateVideoUrl("https://www.twitch.tv/videos/123456789");
    expect(vod.ok).toBe(true);
    if (vod.ok) {
      expect(vod.platform).toBe("twitch");
      expect(vod.kind).toBe("vod");
    }
    const clip = validateVideoUrl("https://clips.twitch.tv/SomeClipSlug-abc");
    expect(clip.ok).toBe(true);
    if (clip.ok) {
      expect(clip.platform).toBe("twitch");
      expect(clip.kind).toBe("clip");
    }
  });

  it("accepts Kick VOD URLs", () => {
    const vod = validateVideoUrl("https://kick.com/xqc/videos/abc-def-123");
    expect(vod.ok).toBe(true);
    if (vod.ok) {
      expect(vod.platform).toBe("kick");
      expect(vod.kind).toBe("vod");
    }
  });

  it("flags Twitch/Kick channel URLs as live hints", () => {
    expect(detectSourceKind("https://www.twitch.tv/shroud")).toBe("live");
    expect(detectSourceKind("https://kick.com/trainwreckstv")).toBe("live");
  });

  it("rejects private network hosts", () => {
    const result = validateVideoUrl("http://127.0.0.1/video.mp4");
    expect(result.ok).toBe(false);
  });

  it("rejects unsupported hosts", () => {
    const result = validateVideoUrl("https://example.com/video");
    expect(result.ok).toBe(false);
  });
});

describe("isPrivateOrLocalHost", () => {
  it("flags localhost and RFC1918", () => {
    expect(isPrivateOrLocalHost("localhost")).toBe(true);
    expect(isPrivateOrLocalHost("10.0.0.2")).toBe(true);
    expect(isPrivateOrLocalHost("192.168.1.1")).toBe(true);
    expect(isPrivateOrLocalHost("youtube.com")).toBe(false);
  });
});

describe("detectPlatform", () => {
  it("detects tiktok, youtu.be, twitch, kick", () => {
    expect(detectPlatform("https://youtu.be/abc")).toBe("youtube");
    expect(detectPlatform("https://www.tiktok.com/@x/video/1")).toBe("tiktok");
    expect(detectPlatform("https://www.twitch.tv/videos/1")).toBe("twitch");
    expect(detectPlatform("https://kick.com/someone")).toBe("kick");
  });
});
