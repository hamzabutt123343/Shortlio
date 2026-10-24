import { describe, expect, it } from "vitest";
import { CAPTION_PRESETS, getCaptionPreset } from "@/lib/captions/presets";

describe("caption presets", () => {
  it("defines seventeen distinct rendering presets", () => {
    expect(CAPTION_PRESETS).toHaveLength(17);
    const ids = new Set(CAPTION_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(17);
  });

  it("falls back to classic white", () => {
    expect(getCaptionPreset("missing").id).toBe("classic_white");
  });

  it("includes real animation modes", () => {
    const animations = new Set(CAPTION_PRESETS.map((p) => p.animation));
    expect(animations.has("karaoke")).toBe(true);
    expect(animations.has("word_pop")).toBe(true);
    expect(animations.has("bounce")).toBe(true);
    expect(animations.has("box")).toBe(true);
    expect(animations.has("glow")).toBe(true);
  });

  it("includes Capite-adapted presets", () => {
    expect(getCaptionPreset("hormozi").highlightColor).toBe("#00FFFF");
    expect(getCaptionPreset("crimson_pop").animation).toBe("box");
  });
});
