import { describe, expect, it } from "vitest";
import { transformCaptionText, transformCaptionTextDetailed } from "@/lib/captions/transform";

describe("caption language transform", () => {
  it("romanizes Hindi to Hinglish", () => {
    const out = transformCaptionText("यह अच्छा है", "hi", "hinglish");
    expect(out.toLowerCase()).toMatch(/hai/);
    expect(out).not.toMatch(/[\u0900-\u097F]/);
  });

  it("preserves English words for Hinglish", () => {
    expect(transformCaptionText("to open up more packs", "en", "hinglish")).toBe(
      "to open up more packs",
    );
  });

  it("flags unsupported formal translation pairs", () => {
    const result = transformCaptionTextDetailed("Hello world", "en", "hi");
    expect(result.unsupported).toBe(true);
    expect(result.message).toBeTruthy();
  });
});
