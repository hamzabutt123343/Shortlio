import {
  emptyViralMetadata,
  normalizeViralMetadata,
  type TitleOption,
  type ViralMetadata,
} from "@/lib/viral-metadata/types";

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "is",
  "are", "was", "were", "be", "this", "that", "it", "with", "as", "by", "from",
  "you", "i", "we", "they", "he", "she", "my", "your", "our", "so", "if", "not",
  "just", "like", "really", "very", "hai", "ho", "ka", "ki", "ke", "mein", "yeh",
  "woh", "aur", "toh", "bhi", "nahi", "kya", "bro", "yeah", "chat", "gonna",
  "gotta", "dont", "didn't", "im", "ive", "thats", "theres", "whats",
]);

const SIGNAL_GROUPS: Array<{ id: string; words: string[]; weight: number }> = [
  { id: "police", words: ["police", "cops", "swat", "arrest", "911", "ambulance"], weight: 6 },
  { id: "anger", words: ["mad", "furious", "angry", "rage", "yelling", "screaming", "pissed", "bull"], weight: 5 },
  { id: "apology", words: ["sorry", "apologize", "apology", "genuinely", "genely"], weight: 4 },
  { id: "shock", words: ["omg", "oh my god", "unbelievable", "insane", "crazy", "wild", "no way"], weight: 3 },
  {
    id: "first",
    words: [
      "first time",
      "first guy",
      "the first",
      "never done",
      "never been",
      "am i the first",
      "i'm the first",
      "im the first",
    ],
    weight: 5,
  },
  { id: "comedy", words: ["laugh", "funny", "hilarious", "meme", "try not to laugh"], weight: 3 },
  { id: "sports", words: ["goal", "keeper", "lag", "score", "football", "soccer", "match"], weight: 3 },
  { id: "fear", words: ["scared", "terrified", "afraid", "help"], weight: 4 },
  { id: "conflict", words: ["fight", "argue", "beef", "vs", "versus", "against"], weight: 3 },
  { id: "travel", words: ["norway", "japan", "country", "irl", "stream", "abroad"], weight: 2 },
];

export type ViralGenerateInput = {
  transcript: string;
  clipTitle: string;
  language?: string;
  sourceTitle?: string;
  sourceChannel?: string;
  sourceUploader?: string;
  surroundingContext?: string;
};

function keywords(text: string, limit = 8): string[] {
  const words = text.toLowerCase().match(/[a-z\u0900-\u097f']{3,}/g) ?? [];
  const freq = new Map<string, number>();
  for (const w of words) {
    if (STOP.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

function cleanTitle(raw: string, fallback: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  t = t.replace(/^["'`“”]+|["'`“”]+$/g, "");
  t = t.replace(/[!?]{2,}/g, "!");
  t = t.replace(/…+$/g, "").trim();
  const banned = ["you won't believe", "gone wrong", "shocking", "must watch!!!", "clickbait"];
  const low = t.toLowerCase();
  if (banned.some((b) => low.includes(b))) t = fallback;
  // Reject titles that are mostly raw dialogue copies
  if (looksLikeDialogueDump(t)) t = fallback;
  if (t.length > 85) t = `${t.slice(0, 82).trimEnd()}`;
  return t || fallback;
}

function looksLikeDialogueDump(title: string): boolean {
  const low = title.toLowerCase();
  const dialogueMarks = (low.match(/\b(bro|chat|yo|um+|uh+|like)\b/g) || []).length;
  const commas = (title.match(/,/g) || []).length;
  return dialogueMarks >= 2 || commas >= 3 || /\bi'?m so sorry\b/i.test(title);
}

function stripCreatorNoise(name: string): string {
  return name
    .replace(/\s*(live|official|yt|youtube|streams?|clips?)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCreator(input: ViralGenerateInput): string {
  const raw =
    input.sourceChannel ||
    input.sourceUploader ||
    "";
  if (raw.trim()) return stripCreatorNoise(raw.trim());

  const source = input.sourceTitle || "";
  // "Name - something" or "Name | something"
  const m = source.match(/^([^|\-–—:]{2,40})\s*[|\-–—:]/);
  if (m) return stripCreatorNoise(m[1]);
  return "";
}

function extractPlaceOrTheme(sourceTitle: string, transcript: string): string {
  const src = sourceTitle || "";
  const countries = [
    "norway", "japan", "india", "korea", "china", "london", "new york", "hawaii",
    "shanghai", "france", "italy", "brazil", "mexico", "canada", "uk", "usa",
  ];
  const lowAll = `${src} ${transcript}`.toLowerCase();
  for (const c of countries) {
    if (lowAll.includes(c)) {
      return c.replace(/\b\w/g, (ch) => ch.toUpperCase());
    }
  }
  // Prefer "Speed Vs. Cole Palmer" style matchup from source titles
  const cleanedSrc = src
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[^\w\s.+\-|:&']/gu, " ");
  const vs = cleanedSrc.match(/([^|+]+?\s+v(?:s\.?|ersus)\s+[^|+]+)/i);
  if (vs) {
    return vs[1].replace(/\s+/g, " ").trim().replace(/^[.+|\-\s]+|[.+|\-\s]+$/g, "").slice(0, 42);
  }
  // From source title: drop emoji / filler livestream words
  let theme = src
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/\b(let'?s have fun|irl|livestream|live stream|stream)\b/gi, "")
    .replace(/[+|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (theme.length > 40) theme = theme.slice(0, 37).trim();
  return theme;
}

function detectSignals(text: string): Set<string> {
  const low = text.toLowerCase();
  const found = new Set<string>();
  for (const g of SIGNAL_GROUPS) {
    if (g.words.some((w) => low.includes(w))) found.add(g.id);
  }
  if (/\bcalling the police\b|\bi'?m calling the police\b|\bi am calling the police\b/i.test(text)) {
    found.add("police");
  }
  if (/\bswatted\b|\bswatting\b/i.test(text)) found.add("swatted");
  return found;
}

function scoreChunk(text: string): number {
  const low = text.toLowerCase();
  let score = 0;
  for (const g of SIGNAL_GROUPS) {
    if (g.words.some((w) => low.includes(w))) score += g.weight;
  }
  if (/\b(oh my god|omg|what the)\b/i.test(text)) score += 2;
  if (text.includes("!")) score += 1;
  // Prefer concrete actions over filler
  if (/\b(call|called|calling|fight|lose|lost|first|never)\b/i.test(text)) score += 2;
  return score;
}

function peakMoment(transcript: string, surrounding: string): string {
  const combined = [surrounding, transcript].filter(Boolean).join(" ").trim();
  if (!combined) return "";
  const chunks = combined
    .split(/(?<=[.!?])\s+|(?<=\byeah\b)\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 18 && s.length <= 220);
  if (!chunks.length) {
    return combined.slice(0, 160);
  }
  let best = chunks[0];
  let bestScore = -1;
  for (const c of chunks) {
    const s = scoreChunk(c);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

function titleCaseLite(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => {
      if (!w) return w;
      if (w === w.toUpperCase() && w.length <= 4) return w;
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function buildMomentSummary(opts: {
  creator: string;
  signals: Set<string>;
  place: string;
  peak: string;
  sourceTitle: string;
}): string {
  const { creator, signals, place, peak, sourceTitle } = opts;
  const who = creator || "The creator";
  if (signals.has("police")) {
    return `${who} starts calling the police${place ? ` during a ${place} IRL moment` : ""}.`;
  }
  if (signals.has("swatted")) {
    return `${who} gets swatted live${place ? ` in ${place}` : ""}.`;
  }
  if (signals.has("anger") && signals.has("sports")) {
    return `${who} gets furious over lag/gameplay${place ? ` (${place})` : ""}.`;
  }
  if (signals.has("anger")) {
    return `${who} gets furious${place ? ` during ${place}` : " on stream"}.`;
  }
  if (signals.has("first")) {
    return `${who} realizes this may be a first-time collab/content moment.`;
  }
  if (signals.has("apology")) {
    return `${who} keeps apologizing as the situation escalates${place ? ` in ${place}` : ""}.`;
  }
  if (signals.has("comedy")) {
    return `${who} tries (and struggles) not to laugh.`;
  }
  const hint = (peak.slice(0, 90) || sourceTitle.slice(0, 90))
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .trim();
  return hint ? `${who}: ${hint}` : `${who} has a notable moment on stream.`;
}

function buildTitleOptions(opts: {
  creator: string;
  place: string;
  sourceTitle: string;
  signals: Set<string>;
  peak: string;
  kws: string[];
}): TitleOption[] {
  const { creator, place, sourceTitle, signals, kws } = opts;
  const who = creator || "This Creator";
  const theme = place || extractPlaceOrTheme(sourceTitle, "") || "This Stream";
  const topic = titleCaseLite(kws.slice(0, 2).join(" ")) || theme;

  const curiosity: string[] = [];
  const emotion: string[] = [];
  const event: string[] = [];

  if (signals.has("police") || signals.has("swatted")) {
    curiosity.push(`Why ${who} Just Called the Police${place ? ` in ${place}` : ""}`);
    emotion.push(`${who} Completely Panics During His ${theme} Stream`);
    if (signals.has("swatted")) {
      event.push(`${who} Gets Swatted Live${place ? ` in ${place}` : ""}`);
    } else {
      event.push(`${who} Calls the Police Live${place ? ` in ${place}` : ""}`);
    }
  }

  if (signals.has("anger") && !signals.has("sports")) {
    curiosity.push(`Why ${who} Is Losing It Over ${topic}`);
    emotion.push(`${who} Gets Furious${place ? ` During ${theme}` : " On Stream"}`);
    event.push(`${who} Snaps Mid-Stream${place ? ` in ${place}` : ""}`);
  }

  if (signals.has("first")) {
    curiosity.push(`Is ${who} Really the First to Film This?`);
    emotion.push(`${who} Can't Believe This Is Happening`);
    event.push(`${who} Films a First-Time Moment${place ? ` in ${place}` : ""}`);
  }

  if (signals.has("apology")) {
    curiosity.push(`Why ${who} Won't Stop Apologizing`);
    emotion.push(`${who} Sounds Genuinely Sorry as Things Go Sideways`);
    event.push(`${who} Apologizes Live as Chaos Breaks Out`);
  }

  if (signals.has("comedy")) {
    curiosity.push(`Can ${who} Survive This Try Not to Laugh?`);
    emotion.push(`${who} Breaks Character Trying Not to Laugh`);
    event.push(`${who} Fails a Try Not to Laugh Challenge`);
  }

  if (signals.has("sports")) {
    const matchup = /v(?:s\.?|ersus)/i.test(theme) ? theme : "";
    curiosity.push(
      signals.has("anger")
        ? `Why ${who} Is Losing It Over This Lag`
        : `Why ${who}'s Keeper Won't Save Anything`,
    );
    emotion.push(`${who} Loses It Over Insane Lag${matchup ? ` vs ${matchup.replace(/^.*?\bv(?:s\.?|ersus)\s+/i, "")}` : ""}`);
    event.push(
      matchup
        ? `${who} Rages Mid-Match During ${matchup}`
        : `${who} Rages Mid-Match On Stream`,
    );
  }

  // Safe grounded fallbacks — never invent police/swatting without signals
  if (!curiosity.length) {
    curiosity.push(
      creator
        ? `What ${who} Just Said About ${topic}`
        : `The Moment That Makes This ${theme} Clip Hit`,
    );
  }
  if (!emotion.length) {
    emotion.push(
      creator
        ? `${who}'s Real Reaction to ${topic}`
        : `The Emotional Peak of This ${theme} Clip`,
    );
  }
  if (!event.length) {
    event.push(
      creator
        ? `${who} Hits a Wild Moment${place ? ` in ${place}` : " On Stream"}`
        : `Unexpected Turn in ${theme}`,
    );
  }

  const uniq = (list: string[], angle: TitleOption["angle"]): TitleOption => {
    const fallback = `${who} ${theme}`.trim();
    for (const candidate of list) {
      const cleaned = cleanTitle(candidate, fallback);
      if (cleaned && !looksLikeDialogueDump(cleaned)) {
        return { angle, title: cleaned };
      }
    }
    return { angle, title: cleanTitle(list[0] || fallback, fallback) };
  };

  return [
    uniq(curiosity, "curiosity"),
    uniq(emotion, "emotion"),
    uniq(event, "event"),
  ];
}

function hashtags(kws: string[], language: string, extra: string[]): string[] {
  const tags: string[] = [];
  const push = (h: string) => {
    const v = h.startsWith("#") ? h : `#${h}`;
    if (!tags.some((x) => x.toLowerCase() === v.toLowerCase())) tags.push(v);
  };
  extra.forEach(push);
  for (const kw of kws) {
    const h = `#${kw.replace(/[^A-Za-z0-9\u0900-\u097F]/g, "")}`;
    if (h.length >= 3) push(h);
    if (tags.length >= 10) break;
  }
  const lang = language.toLowerCase();
  if ((lang === "hi" || lang === "hinglish") && !tags.includes("#Hinglish")) push("#Hinglish");
  if (lang === "ur" && !tags.includes("#Urdu")) push("#Urdu");
  return tags.slice(0, 12);
}

export function heuristicViralMetadata(input: ViralGenerateInput): ViralMetadata {
  const language = (input.language || "en").toLowerCase();
  const transcript = (input.transcript || "").trim();
  const surrounding = (input.surroundingContext || "").trim();
  const sourceTitle = (input.sourceTitle || "").trim();
  const clipTitle = (input.clipTitle || "").trim();
  const text = transcript || surrounding || clipTitle || sourceTitle;
  const creator = extractCreator(input);
  const place = extractPlaceOrTheme(sourceTitle, text);
  const peak = peakMoment(transcript, surrounding);
  const signals = detectSignals(`${peak} ${transcript} ${sourceTitle}`);
  const kws = keywords(`${transcript} ${sourceTitle} ${creator}`);
  const titleOptions = buildTitleOptions({
    creator,
    place,
    sourceTitle,
    signals,
    peak,
    kws,
  });
  const primary = titleOptions[1]?.title || titleOptions[0]?.title || clipTitle || "Short Clip";
  const moment_summary = buildMomentSummary({
    creator,
    signals,
    place,
    peak,
    sourceTitle,
  });

  const tags = hashtags(
    [...(creator ? [creator.replace(/\s+/g, "")] : []), ...kws],
    language,
    ["shorts", "viral", "fyp", ...(creator ? [creator.replace(/\s+/g, "")] : [])],
  );

  const ytDesc = [
    moment_summary,
    creator || sourceTitle
      ? `From ${[creator, sourceTitle].filter(Boolean).join(" — ")}.`
      : "",
    "Clipped with Shortlio. Watch the full stream for context.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const captionHook = titleOptions[0]?.title || primary;

  return {
    language,
    youtube: {
      title: primary,
      description: ytDesc,
      hashtags: tags,
      tags: [...new Set([...(creator ? [creator] : []), ...kws, "shorts", "youtube shorts"])].slice(
        0,
        15,
      ),
    },
    tiktok: {
      caption: `${captionHook} ${tags.slice(0, 5).join(" ")}`.trim().slice(0, 2200),
      hashtags: tags,
    },
    instagram: {
      caption: `${captionHook}\n\n${moment_summary}\n\n${tags.slice(0, 6).join(" ")}`
        .trim()
        .slice(0, 2200),
      keywords: [...(creator ? [creator] : []), ...kws].slice(0, 10),
      hashtags: tags,
    },
    title_options: titleOptions,
    moment_summary,
    generated_at: new Date().toISOString(),
    provider: "heuristic",
  };
}

function buildPrompt(input: ViralGenerateInput): string {
  const language = (input.language || "en").toLowerCase();
  const langNote: Record<string, string> = {
    en: "Write all copy in natural English.",
    hi: "Write titles/captions in Hindi (Devanagari) where natural; keep hashtags mostly Latin.",
    ur: "Write titles/captions in Urdu (Arabic script) where natural; keep hashtags mostly Latin.",
    hinglish: "Write in Hinglish (Roman Hindi + English mix), natural spoken style.",
  };
  return [
    "You are a professional Shorts/TikTok/Reels title writer for viral clips.",
    langNote[language] || "Write in the language that matches the transcript.",
    "",
    "STEP 1 — Understand the clip before writing:",
    "- Infer what is ACTUALLY happening: emotion, conflict, surprise, comedy, argument, first-time moment, etc.",
    "- Use creator name, event, and recognizable context ONLY when supported by transcript or source metadata.",
    "- NEVER invent events (no fake swatting, fights, arrests, breakups, etc.).",
    "- Do NOT copy or lightly paraphrase raw dialogue as the title.",
    "- Do NOT wrap titles in quotation marks. No keyword stuffing. No generic summaries.",
    "",
    "STEP 2 — Write 3 DISTINCT title options with different angles:",
    '1) curiosity — open a loop ("Why…", "What happens when…")',
    "2) emotion — highlight the feeling/reaction (furious, panicked, shocked, laughing)",
    "3) event — name the concrete thing that happens, only if evidenced",
    "Examples of GOOD style (only if true for THIS clip):",
    '- "IShowSpeed Gets Furious During His IRL Stream"',
    '- "IShowSpeed Calls the Police Live in Norway"',
    "Examples of BAD style:",
    '- "way we just came for stay oh my God bro Chad I\'m so sorry"',
    '- "Consistency beats talent when you are building"',
    "",
    "STEP 3 — Platform copy:",
    "- youtube.title = best overall title (pick one of the 3)",
    "- youtube.description = 2 short paragraphs: what happens + source context",
    "- youtube.hashtags + youtube.tags",
    "- tiktok.caption + hashtags (natural, curiosity-driven)",
    "- instagram.caption + keywords + hashtags",
    "",
    "Return JSON with keys:",
    "moment_summary (1 sentence), title_options (array of {angle, title}), youtube, tiktok, instagram",
    `Creator/channel: ${input.sourceChannel || input.sourceUploader || "(unknown)"}`,
    `Source video title: ${input.sourceTitle || "(unknown)"}`,
    `Clip title hint (may be noisy dialogue — do not copy): ${input.clipTitle}`,
    `Language code: ${language}`,
    `Surrounding context:\n${(input.surroundingContext || "").slice(0, 2500)}`,
    `Clip transcript:\n${(input.transcript || "").slice(0, 6000)}`,
  ].join("\n");
}

async function generateWithGroq(apiKey: string, input: ViralGenerateInput): Promise<ViralMetadata> {
  const language = (input.language || "en").toLowerCase();
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: buildPrompt(input) }],
      response_format: { type: "json_object" },
      temperature: 0.55,
    }),
  });
  if (!res.ok) throw new Error(`Groq metadata failed: ${res.status}`);
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const meta = normalizeViralMetadata(parsed.metadata ?? parsed, language);
  const fallback = heuristicViralMetadata(input);
  return finalizeLlmMeta(meta, fallback, "groq", input.clipTitle || fallback.youtube!.title);
}

async function generateWithGemini(
  apiKey: string,
  input: ViralGenerateInput,
): Promise<ViralMetadata> {
  const language = (input.language || "en").toLowerCase();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(input) }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.55 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini metadata failed: ${res.status}`);
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const meta = normalizeViralMetadata(parsed.metadata ?? parsed, language);
  const fallback = heuristicViralMetadata(input);
  return finalizeLlmMeta(meta, fallback, "gemini", input.clipTitle || fallback.youtube!.title);
}

function finalizeLlmMeta(
  meta: ViralMetadata,
  fallback: ViralMetadata,
  provider: string,
  clipTitle: string,
): ViralMetadata {
  const titleOptions =
    meta.title_options && meta.title_options.length >= 3
      ? meta.title_options.map((o) => ({
          ...o,
          title: cleanTitle(o.title, fallback.youtube?.title || clipTitle),
        }))
      : fallback.title_options;

  const primary = cleanTitle(
    meta.youtube?.title || titleOptions?.[0]?.title || "",
    fallback.youtube?.title || clipTitle,
  );

  return {
    ...fallback,
    ...meta,
    youtube: {
      title: primary,
      description: meta.youtube?.description || fallback.youtube!.description,
      hashtags: meta.youtube?.hashtags?.length
        ? meta.youtube.hashtags
        : fallback.youtube!.hashtags,
      tags: meta.youtube?.tags?.length ? meta.youtube.tags : fallback.youtube!.tags,
    },
    tiktok: {
      caption: meta.tiktok?.caption || fallback.tiktok!.caption,
      hashtags: meta.tiktok?.hashtags?.length
        ? meta.tiktok.hashtags
        : fallback.tiktok!.hashtags,
    },
    instagram: {
      caption: meta.instagram?.caption || fallback.instagram!.caption,
      keywords: meta.instagram?.keywords?.length
        ? meta.instagram.keywords
        : fallback.instagram!.keywords,
      hashtags: meta.instagram?.hashtags?.length
        ? meta.instagram.hashtags
        : fallback.instagram!.hashtags,
    },
    title_options: titleOptions,
    moment_summary: meta.moment_summary || fallback.moment_summary,
    provider,
    generated_at: new Date().toISOString(),
  };
}

/** Generate viral metadata using the same provider env as the worker (LLM_PROVIDER). */
export async function generateViralMetadata(input: ViralGenerateInput): Promise<ViralMetadata> {
  const language = (input.language || "en").toLowerCase();
  const normalized: ViralGenerateInput = {
    ...input,
    language,
    clipTitle: (input.clipTitle || "Clip").trim() || "Clip",
    transcript: (input.transcript || "").trim(),
  };
  const provider = (process.env.LLM_PROVIDER || "heuristic").toLowerCase();
  const groqKey = process.env.GROQ_API_KEY || "";
  const geminiKey = process.env.GEMINI_API_KEY || "";

  try {
    if (provider === "groq" && groqKey) {
      return await generateWithGroq(groqKey, normalized);
    }
    if (provider === "gemini" && geminiKey) {
      return await generateWithGemini(geminiKey, normalized);
    }
  } catch {
    // fall through to heuristic
  }
  return heuristicViralMetadata(normalized);
}

export function mergePlatformMetadata(
  existing: ViralMetadata,
  next: ViralMetadata,
  platforms?: string[],
): ViralMetadata {
  if (!platforms?.length) return next;
  const keep = new Set(platforms.map((p) => p.toLowerCase()));
  const out = normalizeViralMetadata(existing, existing.language || next.language || "en");
  if (keep.has("youtube") && next.youtube) {
    out.youtube = next.youtube;
    out.title_options = next.title_options ?? out.title_options;
    out.moment_summary = next.moment_summary || out.moment_summary;
  }
  if (keep.has("tiktok") && next.tiktok) out.tiktok = next.tiktok;
  if (keep.has("instagram") && next.instagram) out.instagram = next.instagram;
  out.generated_at = next.generated_at;
  out.provider = next.provider;
  out.language = next.language || out.language;
  return out;
}

export { emptyViralMetadata };
