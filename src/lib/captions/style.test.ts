import { describe, expect, it } from "vitest";
import {
  STYLE_MODE_KEY,
  activeCaptionAt,
  captionSettingsDiff,
  captionStyleKey,
  collapseRollingCues,
  getCaptionStyleMode,
  languageDir,
  resolveCaptionStyle,
  sampleCaptionText,
  settingsForPresetMode,
} from "@/lib/captions/style";

describe("caption style helpers", () => {
  it("resolves preset with overrides", () => {
    const style = resolveCaptionStyle("karaoke_highlight", {
      highlightColor: "#FF0000",
      position: "center",
      fontFamily: "Poppins",
    });
    expect(style.id).toBe("karaoke_highlight");
    expect(style.highlightColor).toBe("#FF0000");
    expect(style.position).toBe("center");
    expect(style.animation).toBe("karaoke");
    expect(style.fontFamily).toBe("Poppins");
  });

  it("clones preset objects so style keys change per resolve", () => {
    const a = resolveCaptionStyle("classic_white");
    const b = resolveCaptionStyle("bold_yellow");
    expect(a).not.toBe(b);
    expect(captionStyleKey(a)).not.toBe(captionStyleKey(b));
    const overridden = resolveCaptionStyle("classic_white", { fontSize: 70 });
    expect(captionStyleKey(overridden)).not.toBe(captionStyleKey(a));
  });

  it("only diffs changed fields and marks finetune mode", () => {
    const base = resolveCaptionStyle("classic_white");
    const diff = captionSettingsDiff("classic_white", {
      ...base,
      highlightColor: "#00FF00",
      fontSize: 70,
    });
    expect(diff).toEqual({
      highlightColor: "#00FF00",
      fontSize: 70,
      [STYLE_MODE_KEY]: "finetune",
    });
  });

  it("gives preset mode highest priority over leftover fine-tune fields", () => {
    const style = resolveCaptionStyle("gaming_hype", {
      [STYLE_MODE_KEY]: "preset",
      textColor: "#FF0000",
      position: "top",
    });
    expect(getCaptionStyleMode({ [STYLE_MODE_KEY]: "preset" })).toBe("preset");
    expect(style.textColor).toBe("#FFFFFF");
    expect(style.highlightColor).toBe("#00FF00");
    expect(style.position).toBe("center");
    expect(style.animation).toBe("word_pop");
  });

  it("applies fine-tune overrides only in finetune mode", () => {
    const style = resolveCaptionStyle("classic_white", {
      [STYLE_MODE_KEY]: "finetune",
      textColor: "#FF0000",
      position: "top",
    });
    expect(style.textColor).toBe("#FF0000");
    expect(style.position).toBe("top");
    expect(settingsForPresetMode()).toEqual({ [STYLE_MODE_KEY]: "preset" });
  });

  it("samples language-specific preview text", () => {
    expect(sampleCaptionText("hinglish")).toMatch(/viral/i);
    expect(sampleCaptionText("hi")).toMatch(/[\u0900-\u097F]/);
    expect(languageDir("ar")).toBe("rtl");
    expect(languageDir("en")).toBe("ltr");
  });

  it("picks active caption by playback time", () => {
    const cues = [
      { start: 0, end: 2, text: "one two three four" },
      { start: 2, end: 4, text: "five six" },
    ];
    const hit = activeCaptionAt(cues, 1.0, 4);
    expect(hit?.text).toContain("one");
    expect(hit?.wordIndex).toBeGreaterThanOrEqual(0);
    expect(activeCaptionAt(cues, 9, 4)).toBeNull();
  });

  it("pulls captions forward so they feel realtime with speech", () => {
    const cues = [{ start: 1.0, end: 2.5, text: "hello world" }];
    // 150ms lead → visible slightly before the raw cue start.
    expect(activeCaptionAt(cues, 0.8, 4)).toBeNull();
    expect(activeCaptionAt(cues, 0.9, 4)?.text).toContain("hello");
    expect(activeCaptionAt(cues, 1.05, 4)?.text).toContain("hello");
  });

  it("uses synthesized roll word onsets so later words are not early", () => {
    const collapsed = collapseRollingCues([
      { start: 0.0, end: 2.0, text: "one" },
      { start: 0.5, end: 2.2, text: "one two" },
      { start: 1.0, end: 2.5, text: "one two three" },
    ]);
    expect(collapsed[0]?.words?.length).toBeGreaterThanOrEqual(3);
    const last = collapsed[0]!.words!.at(-1)!;
    expect(last.start).toBeGreaterThanOrEqual(0.9);
    // Before the third word onset, karaoke should not be on "three".
    const early = activeCaptionAt(collapsed, 0.6, 8);
    expect(early?.wordIndex).toBeLessThan(2);
  });

  it("chunks long cues like the ASS exporter", () => {
    const cues = [{ start: 0, end: 4, text: "one two three four five six" }];
    // maxWords=3 → two chunks of 2s each
    const first = activeCaptionAt(cues, 0.5, 3);
    const second = activeCaptionAt(cues, 2.5, 3);
    expect(first?.text).toBe("one two three");
    expect(second?.text).toBe("four five six");
  });

  it("collapses overlapping rolling cues", () => {
    const collapsed = collapseRollingCues([
      { start: 0, end: 2, text: "aap" },
      { start: 0.3, end: 2.2, text: "aap ke" },
      { start: 0.6, end: 2.5, text: "aap ke paas" },
    ]);
    expect(collapsed.length).toBeGreaterThanOrEqual(1);
    expect(collapsed.length).toBeLessThanOrEqual(3);
    expect(collapsed.some((c) => c.text.includes("paas") || c.text.includes("ke"))).toBe(
      true,
    );
    for (let i = 1; i < collapsed.length; i++) {
      expect(collapsed[i].start).toBeGreaterThanOrEqual(collapsed[i - 1].end - 1e-6);
    }
  });

  it("does not merge an entire monologue into one cue", () => {
    const words =
      "small clips of this long episode so that viewers stay hooked always".split(
        " ",
      );
    const cues = words.map((_, i) => ({
      start: i * 0.4,
      end: i * 0.4 + 2.5,
      text: words.slice(0, i + 1).join(" "),
    }));
    const collapsed = collapseRollingCues(cues);
    expect(collapsed.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...collapsed.map((c) => c.end - c.start))).toBeLessThanOrEqual(5.5);
  });
});
