import { describe, expect, it } from "vitest";
import { heuristicViralMetadata, mergePlatformMetadata } from "@/lib/viral-metadata/generate";
import { normalizeViralMetadata } from "@/lib/viral-metadata/types";

describe("viral metadata", () => {
  it("builds high-CTR Speed Norway titles from event context, not dialogue dumps", () => {
    const meta = heuristicViralMetadata({
      transcript:
        "oh my God bro Chad I'm so sorry Chad I'm genely sorry I'm genely sorry Chad I don't even know how it got like this Norway has been the worst country like I'm being super serious yo yeah I'm calling the police I'm actually on hello excuse me I am a YouTuber",
      clipTitle:
        "way we just came for stay oh my God bro Chad I'm so sorry Chad I'm genely sorry…",
      sourceTitle: "irl stream in Norway 🇳🇴",
      sourceChannel: "IShowSpeed",
      language: "en",
    });
    const titles = (meta.title_options ?? []).map((o) => o.title);
    expect(titles).toHaveLength(3);
    expect(new Set((meta.title_options ?? []).map((o) => o.angle)).size).toBe(3);
    expect(meta.youtube?.title.toLowerCase()).toContain("ishowspeed");
    expect(meta.youtube?.title.toLowerCase()).not.toContain("i'm so sorry chad");
    expect(titles.some((t) => /police/i.test(t))).toBe(true);
    expect(meta.moment_summary?.toLowerCase()).toContain("police");
    expect(meta.youtube?.title.toLowerCase()).not.toContain("you won't believe");
  });

  it("does not invent swatting when transcript only mentions police", () => {
    const meta = heuristicViralMetadata({
      transcript: "I'm calling the police right now chat",
      clipTitle: "calling police",
      sourceTitle: "irl stream in Norway",
      sourceChannel: "IShowSpeed",
      language: "en",
    });
    const blob = JSON.stringify(meta).toLowerCase();
    expect(blob).toContain("police");
    expect(blob).not.toContain("swatted");
  });

  it("uses first-time collab signal for Japan rented girlfriend clip", () => {
    const meta = heuristicViralMetadata({
      transcript:
        "have a guy like ever make content with you cont or like am I the first guy to make content with you oh for sure the first I've never done this this feels crazy to me",
      clipTitle: "guy like ever make content with you cont or like am I the first guy",
      sourceTitle: "I Rented a Girlfriend in Japan irl livestream🇯🇵",
      sourceChannel: "IShowSpeed",
      language: "en",
    });
    const titles = (meta.title_options ?? []).map((t) => t.title.toLowerCase()).join(" ");
    expect(titles).toContain("ishowspeed");
    expect(titles.includes("first") || meta.moment_summary?.toLowerCase().includes("first")).toBe(
      true,
    );
    expect(meta.youtube?.title.toLowerCase()).not.toMatch(/^guy like ever make content/);
  });

  it("adds Hinglish hashtag for hinglish language", () => {
    const meta = heuristicViralMetadata({
      transcript: "Yeh tip business ke liye bohot important hai",
      clipTitle: "Business tip",
      language: "hinglish",
    });
    expect(meta.youtube?.hashtags.some((h) => h.toLowerCase() === "#hinglish")).toBe(true);
  });

  it("merges a single platform regenerate", () => {
    const existing = normalizeViralMetadata({
      youtube: { title: "Old YT", description: "d", hashtags: ["#a"], tags: ["t"] },
      tiktok: { caption: "Old TT", hashtags: ["#b"] },
      instagram: { caption: "Old IG", keywords: ["k"], hashtags: ["#c"] },
    });
    const next = heuristicViralMetadata({
      transcript: "Focus compounds when you ship daily shorts for your audience.",
      clipTitle: "Fresh insight",
      sourceChannel: "CreatorX",
      language: "en",
    });
    const merged = mergePlatformMetadata(existing, next, ["tiktok"]);
    expect(merged.youtube?.title).toBe("Old YT");
    expect(merged.tiktok?.caption).not.toBe("Old TT");
    expect(merged.instagram?.caption).toBe("Old IG");
  });
});
