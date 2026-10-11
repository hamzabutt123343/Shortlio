import { describe, expect, it } from "vitest";
import {
  detectPlatform,
  isPrivateOrLocalHost,
  validateVideoUrl,
} from "@/lib/validation/url";

describe("validateVideoUrl", () => {
  it("accepts public YouTube URLs", () => {
    const result = validateVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.platform).toBe("youtube");
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
  it("detects tiktok and youtu.be", () => {
    expect(detectPlatform("https://youtu.be/abc")).toBe("youtube");
    expect(detectPlatform("https://www.tiktok.com/@x/video/1")).toBe("tiktok");
  });
});
