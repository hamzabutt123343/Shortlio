import { describe, expect, it } from "vitest";
import { captionSettingsDiff, resolveCaptionStyle } from "@/lib/captions/style";

describe("caption style helpers", () => {
  it("resolves preset with overrides", () => {
    const style = resolveCaptionStyle("karaoke_highlight", {
      highlightColor: "#FF0000",
      position: "center",
    });
    expect(style.id).toBe("karaoke_highlight");
    expect(style.highlightColor).toBe("#FF0000");
    expect(style.position).toBe("center");
    expect(style.animation).toBe("karaoke");
  });

  it("only diffs changed fields", () => {
    const base = resolveCaptionStyle("classic_white");
    const diff = captionSettingsDiff("classic_white", {
      ...base,
      highlightColor: "#00FF00",
      fontSize: 70,
    });
    expect(diff).toEqual({ highlightColor: "#00FF00", fontSize: 70 });
  });
});
