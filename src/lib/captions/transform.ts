/**
 * Client-side caption text transformations for live preview.
 * Mirrors worker/pipeline/hinglish.py + translate.py for Hinglish;
 * other language pairs are handled on export (and surface errors there).
 */

const HINGLISH_TARGETS = new Set(["hinglish", "hi-en", "hi_en"]);
const HINDI_SOURCES = new Set(["hi", "hindi"]);
const DEVANAGARI_RE = /[\u0900-\u097F]/;

const HINDI_TO_HINGLISH: Record<string, string> = {
  है: "hai",
  हैं: "hain",
  था: "tha",
  थी: "thi",
  थे: "the",
  करना: "karna",
  होना: "hona",
  कहना: "kahna",
  देना: "dena",
  लेना: "lena",
  आना: "aana",
  जाना: "jaana",
  यह: "yeh",
  वह: "woh",
  मैं: "main",
  तुम: "tum",
  वो: "wo",
  और: "aur",
  भी: "bhi",
  नहीं: "nahi",
  क्या: "kya",
  कैसे: "kaise",
  कब: "kab",
  कहाँ: "kahan",
  कौन: "kaun",
  बहुत: "bahut",
  अच्छा: "achha",
  बड़ा: "bada",
  पल: "pal",
  खास: "khaas",
  सब: "sab",
  कुछ: "kuch",
  बदल: "badal",
  देगा: "dega",
};

function hasDevanagari(text: string): boolean {
  return DEVANAGARI_RE.test(text);
}

/**
 * Best-effort Devanagari → Roman for preview (common words + leave rest).
 * Backend `to_hinglish` is authoritative for export.
 */
function toHinglishSimple(text: string): string {
  if (!text || !hasDevanagari(text)) return text.trim();

  let result = text;
  // Longer keys first so multi-char words win over single glyphs.
  const entries = Object.entries(HINDI_TO_HINGLISH).sort((a, b) => b[0].length - a[0].length);
  for (const [hindi, roman] of entries) {
    result = result.split(hindi).join(roman);
  }
  // Strip remaining Devanagari so preview never mixes scripts for Hinglish.
  result = result.replace(/[\u0900-\u097F]+/g, "").replace(/\s+/g, " ").trim();
  return result || text.trim();
}

export type CaptionTransformResult = {
  text: string;
  /** True when preview cannot faithfully apply the language (export will error). */
  unsupported: boolean;
  message?: string;
};

function normalizeLang(lang: string): string {
  return (lang || "en").toLowerCase().trim();
}

function isHinglish(lang: string): boolean {
  return HINGLISH_TARGETS.has(normalizeLang(lang));
}

/**
 * Transform caption text for preview based on language hint.
 * Preserves English words / code-switching for Hinglish; romanizes Hindi script.
 */
export function transformCaptionText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): string {
  return transformCaptionTextDetailed(text, sourceLanguage, targetLanguage).text;
}

export function transformCaptionTextDetailed(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): CaptionTransformResult {
  const src = normalizeLang(sourceLanguage);
  const tgt = normalizeLang(targetLanguage);

  if (!text?.trim()) return { text: text ?? "", unsupported: false };

  if (src === tgt || tgt === "auto") {
    return { text, unsupported: false };
  }

  // Hinglish: keep Latin as-is; romanize any Devanagari (source tag may be wrong).
  if (isHinglish(tgt)) {
    if (hasDevanagari(text) || HINDI_SOURCES.has(src)) {
      return { text: toHinglishSimple(text), unsupported: false };
    }
    // Already Roman / English / mixed — preserve slang & code-switching.
    return { text, unsupported: false };
  }

  // Same-script / already matching content — pass through.
  if (HINDI_SOURCES.has(src) && HINDI_SOURCES.has(tgt)) {
    return { text, unsupported: false };
  }
  if ((src === "ur" || src === "urdu") && (tgt === "ur" || tgt === "urdu")) {
    return { text, unsupported: false };
  }
  if ((src === "ar" || src === "arabic") && (tgt === "ar" || tgt === "arabic")) {
    return { text, unsupported: false };
  }

  // Unsupported pairs (e.g. en→hi formal translate) — keep source text but flag.
  if (src !== tgt && !isHinglish(src)) {
    return {
      text,
      unsupported: true,
      message: `Caption language "${tgt}" needs server translation from "${src}". Re-render to apply, or pick Hinglish/English.`,
    };
  }

  return { text, unsupported: false };
}

/** Detect if a language uses right-to-left script. */
export function isRTLLanguage(language: string): boolean {
  const lang = normalizeLang(language);
  return ["ar", "arabic", "ur", "urdu", "fa", "persian", "he", "hebrew"].includes(lang);
}

/** Get appropriate font hint for a language. */
export function getFontHintForLanguage(language: string): string | null {
  const lang = normalizeLang(language);

  if (lang === "hi" || lang === "hindi") {
    return "Noto Sans Devanagari, Nirmala UI";
  }
  if (isHinglish(lang)) {
    return null; // Latin fonts
  }
  if (lang === "ar" || lang === "arabic") {
    return "Noto Sans Arabic, Segoe UI";
  }
  if (lang === "ur" || lang === "urdu") {
    return "Noto Nastaliq Urdu, Segoe UI";
  }
  return null;
}
