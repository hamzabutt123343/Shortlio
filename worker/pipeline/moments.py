from __future__ import annotations

import json
import logging
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

import httpx

from config import Settings, get_settings
from pipeline.transcript import TranscriptSegment

logger = logging.getLogger(__name__)

# Prefer candidates at/above this score when plenty exist.
_MIN_QUALITY_SCORE = 0.48
# Soft floor used to fill remaining slots so requested clip_count is honored.
_SOFT_QUALITY_SCORE = 0.20
# Prefer at least this much separation between auto-picked clips.
_OVERLAP_IOU_MAX = 0.35
# Default AI intro exclusion (greetings / welcome-back); overridden by Settings.
DEFAULT_AI_INTRO_SKIP_SECONDS = 120.0
_WORD_RE = re.compile(r"[A-Za-z\u0900-\u097F']+")
SENTENCE_END = re.compile(r"[.!?…]\s+")


def effective_intro_skip_seconds(
    intro_skip_seconds: float,
    segments: list[TranscriptSegment],
    *,
    max_clip_duration: float,
) -> float:
    """Clamp intro skip so short VODs still have room for at least one clip."""
    skip = max(0.0, float(intro_skip_seconds or 0.0))
    if skip <= 0 or not segments:
        return 0.0
    media_end = max(float(s.end) for s in segments)
    # Keep enough timeline after the skip for one max-duration clip (floor 30s).
    reserve = max(30.0, float(max_clip_duration or 45.0))
    max_skip = max(0.0, media_end - reserve)
    return min(skip, max_skip)


def filter_segments_after_intro(
    segments: list[TranscriptSegment],
    intro_skip_seconds: float,
) -> list[TranscriptSegment]:
    """Drop / trim transcript coverage that falls inside the excluded intro."""
    skip = max(0.0, float(intro_skip_seconds or 0.0))
    if skip <= 0:
        return list(segments)
    out: list[TranscriptSegment] = []
    for s in segments:
        if float(s.end) <= skip:
            continue
        if float(s.start) < skip:
            out.append(
                TranscriptSegment(
                    start=skip,
                    end=float(s.end),
                    text=s.text,
                    speaker=s.speaker,
                    language=s.language,
                    words=s.words,
                )
            )
        else:
            out.append(s)
    return out


@dataclass
class MomentCandidate:
    start: float
    end: float
    title: str
    hook: str
    score: float
    explanation: str
    id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id or f"{self.start:.2f}-{self.end:.2f}",
            "start": self.start,
            "end": self.end,
            "title": self.title,
            "hook": self.hook,
            "score": self.score,
            "explanation": self.explanation,
        }


# Viral-signal lexicon: (label, phrases/words, weight). Grounded in transcript only.
_SIGNAL_GROUPS: list[tuple[str, tuple[str, ...], float]] = [
    (
        "hook",
        (
            "wait",
            "hold on",
            "oh my god",
            "omg",
            "no way",
            "what the",
            "dude",
            "bro look",
            "watch this",
            "check this",
            "you won't",
            "you wont",
            "listen",
            "look at",
        ),
        0.12,
    ),
    (
        "shock",
        (
            "unbelievable",
            "insane",
            "crazy",
            "wild",
            "holy",
            "wtf",
            "impossible",
            "no shot",
            "are you kidding",
            "shocked",
            "surprised",
        ),
        0.11,
    ),
    (
        "drama",
        (
            "fight",
            "argue",
            "argument",
            "beef",
            "versus",
            "against",
            "hate",
            "betray",
            "lie",
            "liar",
            "scam",
            "exposed",
            "caught",
            "banned",
            "fired",
            "quit",
            "break up",
            "broke up",
        ),
        0.12,
    ),
    (
        "emotion",
        (
            "cry",
            "crying",
            "tears",
            "scared",
            "terrified",
            "afraid",
            "love",
            "heart",
            "sorry",
            "apologize",
            "apology",
            "mad",
            "furious",
            "angry",
            "rage",
            "yelling",
            "screaming",
            "emotional",
        ),
        0.10,
    ),
    (
        "humor",
        (
            "laugh",
            "laughing",
            "funny",
            "hilarious",
            "joke",
            "meme",
            "lol",
            "lmao",
            "roast",
            "troll",
            "prank",
            "bro fell",
            "sheesh",
            "skill issue",
            "copium",
            "ratio",
        ),
        0.09,
    ),
    (
        "stream_reaction",
        (
            "chat",
            "chat is",
            "in the chat",
            "donated",
            "donation",
            "subscribe",
            "subscribed",
            "subbed",
            "gift sub",
            "gifted",
            "raid",
            "raided",
            "hosting",
            "hype train",
            "bits",
            "pog",
            "poggers",
            "kappa",
            "clip it",
            "clip that",
            "someone clip",
            "mods",
            "timeout",
            "banned",
            "emote",
            "lurking",
            "first time chatter",
            "kick",
            "twitch",
        ),
        0.11,
    ),
    (
        "game_moment",
        (
            "clutch",
            "ace",
            "headshot",
            "one tap",
            "no scope",
            "flawless",
            "gg",
            "ez",
            "throw",
            "diff",
            "carry",
            "nerf",
            "buff",
            "boss fight",
            "final boss",
            "speedrun",
            "pb",
            "world record",
            "died",
            "respawn",
        ),
        0.08,
    ),
    (
        "stakes",
        (
            "million",
            "thousand",
            "money",
            "bet",
            "challenge",
            "win",
            "lose",
            "lost",
            "died",
            "dead",
            "kill",
            "danger",
            "police",
            "cops",
            "arrest",
            "help",
            "emergency",
        ),
        0.10,
    ),
    (
        "payoff",
        (
            "finally",
            "that's why",
            "thats why",
            "because",
            "so then",
            "turns out",
            "the truth",
            "secret",
            "reveal",
            "ending",
            "result",
            "won",
            "clutch",
            "first time",
            "never done",
            "never been",
        ),
        0.09,
    ),
    (
        "curiosity",
        (
            "why",
            "how",
            "what if",
            "secret",
            "truth",
            "mistake",
            "hack",
            "tip",
            "never",
            "always",
            "worst",
            "best",
            "only",
        ),
        0.06,
    ),
]

_FILLER = {
    "um",
    "uh",
    "uhm",
    "like",
    "you know",
    "basically",
    "literally",
    "actually",
    "kinda",
    "sorta",
    "yeah",
    "okay",
    "ok",
    "right",
    "so",
    "and",
    "the",
    "a",
    "an",
}


def _sentences_from_segments(
    segments: list[TranscriptSegment], max_duration: float, min_duration: float = 12.0
) -> list[tuple[float, float, str]]:
    """Merge transcript into sentence-bounded chunks within duration limits."""
    if not segments:
        return []

    chunks: list[tuple[float, float, str]] = []
    buf: list[str] = []
    start = segments[0].start
    end = segments[0].end
    floor = min(min_duration, max(8.0, max_duration * 0.35))

    def flush() -> None:
        nonlocal buf, start, end
        if not buf:
            return
        text = " ".join(buf).strip()
        if text and (end - start) >= floor:
            chunks.append((start, end, text))
        buf = []

    for seg in segments:
        if not buf:
            start = seg.start
        piece = (seg.text or "").strip()
        if not piece:
            continue
        buf.append(piece)
        end = seg.end
        text = " ".join(buf)
        if (end - start) >= max_duration:
            flush()
            continue
        if SENTENCE_END.search(text + " ") and (end - start) >= floor:
            flush()

    if buf:
        text = " ".join(buf).strip()
        if text and (end - start) >= 5.0:
            chunks.append((start, end, text))

    return chunks


def _sliding_windows(
    segments: list[TranscriptSegment],
    max_duration: float,
    *,
    step: float = 8.0,
) -> list[tuple[float, float, str]]:
    """Dense candidate windows so peak moments aren't missed between sentences."""
    if not segments:
        return []
    t0 = float(segments[0].start)
    t1 = float(segments[-1].end)
    if t1 <= t0:
        return []
    windows: list[tuple[float, float, str]] = []
    # Honor user max length (45s–180s); previously hard-capped at 45s.
    target = max(12.0, min(float(max_duration), 180.0))
    stride = max(8.0, min(float(step), target * 0.25))
    cur = t0
    while cur < t1:
        end = min(t1, cur + target)
        text = " ".join(
            (s.text or "").strip()
            for s in segments
            if s.end > cur and s.start < end and (s.text or "").strip()
        ).strip()
        if text and (end - cur) >= 8.0:
            windows.append((cur, end, text))
        if end >= t1:
            break
        cur += stride
    return windows


def _normalize_words(text: str) -> list[str]:
    return [w.lower() for w in _WORD_RE.findall(text or "")]


def _signal_hits(lower: str) -> list[str]:
    hits: list[str] = []
    for label, phrases, _weight in _SIGNAL_GROUPS:
        if any(p in lower for p in phrases):
            hits.append(label)
    return hits


def _score_text(text: str, *, duration: float) -> tuple[float, list[str]]:
    """Score viral potential from grounded transcript signals only."""
    lower = (text or "").lower()
    words = _normalize_words(text)
    n = len(words)
    if n < 6:
        return 0.0, ["too_short"]

    score = 0.18
    reasons: list[str] = []

    # Signal lexicon
    for label, phrases, weight in _SIGNAL_GROUPS:
        count = sum(1 for p in phrases if p in lower)
        if count:
            score += min(weight * 1.6, weight + count * 0.03)
            reasons.append(label)

    # Opening hook: question / imperative / strong punctuation early
    head = lower[:120]
    if "?" in text[:160] or "؟" in text[:160] or any(
        head.startswith(p) for p in ("wait", "oh", "bro", "dude", "what", "why", "how", "look", "no ")
    ):
        score += 0.08
        reasons.append("open_hook")
    if "!" in text:
        score += 0.05
        reasons.append("exclaim")
    if "?" in text or "؟" in text:
        score += 0.06
        reasons.append("question")

    # Devanagari / Urdu body text — English lexicons miss these; reward density + punctuation.
    if re.search(r"[\u0900-\u097F\u0600-\u06FF]", text or ""):
        score += 0.05
        reasons.append("indic_script")
        if any(tok in (text or "") for tok in ("क्या", "क्यों", "كيف", "کیوں", "کیا", "नहीं", "نہیں")):
            score += 0.04
            reasons.append("indic_hook")

    # Density of content words vs filler (boring monologues score lower)
    filler_n = sum(1 for w in words if w in _FILLER)
    content_ratio = 1.0 - (filler_n / max(1, n))
    if content_ratio >= 0.72:
        score += 0.06
        reasons.append("dense")
    elif content_ratio < 0.45:
        score -= 0.08
        reasons.append("filler_heavy")

    # Prefer Shorts-friendly length; allow up to 3 min without hard penalty
    # (user can request 1–3 min via max_clip_duration).
    if 15.0 <= duration <= 60.0:
        score += 0.07
        reasons.append("ideal_len")
    elif duration < 10.0 or duration > 180.0:
        score -= 0.06
        reasons.append("awkward_len")
    elif duration > 120.0:
        score -= 0.02
        reasons.append("long_clip")

    # Payoff near the end of the window
    tail = lower[max(0, len(lower) - 140) :]
    if any(
        p in tail
        for p in ("finally", "turns out", "that's why", "thats why", "won", "lost", "dead", "sorry")
    ):
        score += 0.07
        reasons.append("payoff_tail")

    # ALL-CAPS / elongated words ≈ energy
    if re.search(r"\b[A-Z]{3,}\b", text or "") or re.search(r"(.)\1{2,}", lower):
        score += 0.04
        reasons.append("energy")

    # Penalize pure greetings / housekeeping
    boring = (
        "subscribe",
        "like and subscribe",
        "comment below",
        "thanks for watching",
        "welcome back",
        "don't forget to",
        "link in bio",
        "follow me",
    )
    if any(b in lower for b in boring):
        score -= 0.15
        reasons.append("cta_spam")

    score = max(0.0, min(0.99, score))
    return score, reasons


def _title_from_text(text: str) -> str:
    clean = re.sub(r"\s+", " ", (text or "").strip())
    # Prefer first sentence / clause as title seed
    m = re.split(r"[.!?…]+\s+", clean, maxsplit=1)
    seed = (m[0] if m else clean).strip()
    if len(seed) < 12:
        seed = clean
    if len(seed) > 72:
        seed = seed[:69].rstrip() + "…"
    return seed or "Clip"


def _hook_from_text(text: str) -> str:
    clean = re.sub(r"\s+", " ", (text or "").strip())
    if len(clean) > 140:
        return clean[:137].rstrip() + "…"
    return clean


def _iou(a0: float, a1: float, b0: float, b1: float) -> float:
    inter = max(0.0, min(a1, b1) - max(a0, b0))
    if inter <= 0:
        return 0.0
    union = max(a1, b1) - min(a0, b0)
    return inter / union if union > 0 else 0.0


def _dedupe_moments(cands: list[MomentCandidate]) -> list[MomentCandidate]:
    """Keep highest-scoring non-overlapping moments."""
    kept: list[MomentCandidate] = []
    for c in sorted(cands, key=lambda x: x.score, reverse=True):
        if any(_iou(c.start, c.end, k.start, k.end) > _OVERLAP_IOU_MAX for k in kept):
            continue
        # Near-duplicate text
        c_words = set(_normalize_words(c.hook)[:18])
        if c_words and any(
            len(c_words & set(_normalize_words(k.hook)[:18])) / max(1, len(c_words)) > 0.72
            for k in kept
        ):
            continue
        kept.append(c)
    return kept


def _quality_gate(
    cands: list[MomentCandidate],
    *,
    clip_count: int,
) -> list[MomentCandidate]:
    """Prefer strong moments, but honor requested clip_count when possible.

    Previously returned only candidates ≥ 0.48 (or a single best). That collapsed
    many Hinglish/long-form jobs from clip_count=2 → 1. We still avoid padding
    with utter junk (below soft floor) when stronger options exist.
    """
    if not cands:
        return []
    want = max(1, int(clip_count))
    ranked = sorted(cands, key=lambda c: c.score, reverse=True)
    strong = [c for c in ranked if c.score >= _MIN_QUALITY_SCORE]
    pool_limit = max(want, min(len(ranked), want * 2))

    if len(strong) >= want:
        return strong[:pool_limit]

    filled = list(strong)
    for c in ranked:
        if len(filled) >= want:
            break
        if c in filled:
            continue
        if c.score < _SOFT_QUALITY_SCORE and filled:
            continue
        filled.append(c)

    if not filled:
        return ranked[:1]
    return filled[:pool_limit]


def _snap_to_segments(
    start: float,
    end: float,
    segments: list[TranscriptSegment],
    max_duration: float,
) -> tuple[float, float, str] | None:
    """Clamp LLM times onto real transcript coverage."""
    if not segments or end <= start:
        return None
    covered = [s for s in segments if s.end >= start and s.start <= end]
    if not covered:
        # Nearest segment window
        nearest = min(segments, key=lambda s: abs(((s.start + s.end) / 2) - (start + end) / 2))
        covered = [nearest]
    s0 = float(covered[0].start)
    s1 = float(covered[-1].end)
    if s1 - s0 > max_duration:
        s1 = s0 + max_duration
    text = " ".join((s.text or "").strip() for s in covered if (s.text or "").strip()).strip()
    if not text or s1 - s0 < 5.0:
        return None
    return s0, s1, text


class MomentAnalyzer(ABC):
    @abstractmethod
    def analyze(
        self,
        segments: list[TranscriptSegment],
        *,
        clip_count: int,
        max_clip_duration: float,
        intro_skip_seconds: float = 0.0,
    ) -> list[MomentCandidate]:
        raise NotImplementedError


class HeuristicAnalyzer(MomentAnalyzer):
    """Offline viral scoring: hooks, drama, humor, payoffs — no LLM cost."""

    def analyze(
        self,
        segments: list[TranscriptSegment],
        *,
        clip_count: int,
        max_clip_duration: float,
        intro_skip_seconds: float = 0.0,
    ) -> list[MomentCandidate]:
        skip = effective_intro_skip_seconds(
            intro_skip_seconds, segments, max_clip_duration=max_clip_duration
        )
        usable = filter_segments_after_intro(segments, skip)
        if not usable:
            return []

        sentence_chunks = _sentences_from_segments(usable, max_clip_duration)
        window_chunks = _sliding_windows(usable, max_clip_duration)
        # Prefer sentence boundaries; fill gaps with sliding windows.
        seen: set[tuple[int, int]] = set()
        pooled: list[tuple[float, float, str]] = []
        for start, end, text in [*sentence_chunks, *window_chunks]:
            if start < skip:
                continue
            key = (int(start * 10), int(end * 10))
            if key in seen:
                continue
            seen.add(key)
            pooled.append((start, end, text))

        candidates: list[MomentCandidate] = []
        for start, end, text in pooled:
            if start < skip:
                continue
            words = _normalize_words(text)
            if len(words) < 8:
                continue
            duration = max(0.1, end - start)
            score, reasons = _score_text(text, duration=duration)
            # Keep a wide pool; _quality_gate trims to clip_count with a soft floor.
            # (0.28 was dropping most Hinglish windows → only 1 clip rendered.)
            if score < 0.18:
                continue
            hits = _signal_hits(text.lower())
            explanation = (
                "Viral signals: " + ", ".join(dict.fromkeys(reasons + hits))
                if reasons or hits
                else "Speech density and pacing"
            )
            candidates.append(
                MomentCandidate(
                    start=start,
                    end=end,
                    title=_title_from_text(text),
                    hook=_hook_from_text(text),
                    score=score,
                    explanation=explanation[:280],
                )
            )

        candidates = _dedupe_moments(candidates)
        return _quality_gate(candidates, clip_count=clip_count)


class GroqJsonAnalyzer(MomentAnalyzer):
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def analyze(
        self,
        segments: list[TranscriptSegment],
        *,
        clip_count: int,
        max_clip_duration: float,
        intro_skip_seconds: float = 0.0,
    ) -> list[MomentCandidate]:
        if not self.settings.groq_api_key.strip():
            raise RuntimeError("GROQ_API_KEY not set")
        skip = effective_intro_skip_seconds(
            intro_skip_seconds, segments, max_clip_duration=max_clip_duration
        )
        usable = filter_segments_after_intro(segments, skip)
        if not usable:
            return []
        transcript = "\n".join(
            f"[{s.start:.1f}-{s.end:.1f}] {s.text}" for s in usable[:500]
        )
        prompt = (
            "You pick viral short-form clip moments from a timestamped transcript.\n"
            "Rules:\n"
            "- Prefer strong hooks, drama, humor, surprises, or emotional payoffs.\n"
            "- Use ONLY events stated in the transcript — never invent.\n"
            "- Align start/end to the given timestamps; clips <= "
            f"{max_clip_duration}s.\n"
            "- Skip boring greetings, CTAs, and duplicate moments.\n"
            f"- NEVER select a clip that starts before {skip:.0f}s "
            "(intro / cold-open exclusion).\n"
            f"- Return up to {clip_count * 2} candidates ranked by viral potential.\n"
            "JSON object with key \"moments\": array of "
            "{start, end, title, hook, score (0-1), explanation}.\n\n"
            f"Transcript:\n{transcript}"
        )
        headers = {
            "Authorization": f"Bearer {self.settings.groq_api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": "llama-3.3-70b-versatile",
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"},
            "temperature": 0.25,
        }
        with httpx.Client(timeout=120.0) as client:
            resp = client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=body,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
        return _parse_llm_moments(
            content,
            clip_count=clip_count,
            segments=usable,
            max_clip_duration=max_clip_duration,
            intro_skip_seconds=skip,
        )


class GeminiJsonAnalyzer(MomentAnalyzer):
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def analyze(
        self,
        segments: list[TranscriptSegment],
        *,
        clip_count: int,
        max_clip_duration: float,
        intro_skip_seconds: float = 0.0,
    ) -> list[MomentCandidate]:
        if not self.settings.gemini_api_key.strip():
            raise RuntimeError("GEMINI_API_KEY not set")
        skip = effective_intro_skip_seconds(
            intro_skip_seconds, segments, max_clip_duration=max_clip_duration
        )
        usable = filter_segments_after_intro(segments, skip)
        if not usable:
            return []
        transcript = "\n".join(
            f"[{s.start:.1f}-{s.end:.1f}] {s.text}" for s in usable[:500]
        )
        prompt = (
            "Pick viral short-form moments from this timestamped transcript. "
            "Prefer hooks, drama, humor, surprise, emotional payoff. "
            "Never invent events. Clips <= "
            f"{max_clip_duration}s. Up to {clip_count * 2} items. "
            f"NEVER start a clip before {skip:.0f}s (intro exclusion). "
            'Return JSON {"moments":[{start,end,title,hook,score,explanation}]}.\n\n'
            f"{transcript}"
        )
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"gemini-2.0-flash:generateContent?key={self.settings.gemini_api_key}"
        )
        body = {"contents": [{"parts": [{"text": prompt}]}]}
        with httpx.Client(timeout=120.0) as client:
            resp = client.post(url, json=body)
            resp.raise_for_status()
            content = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        return _parse_llm_moments(
            content,
            clip_count=clip_count,
            segments=usable,
            max_clip_duration=max_clip_duration,
            intro_skip_seconds=skip,
        )


def _parse_llm_moments(
    raw: str,
    *,
    clip_count: int,
    segments: list[TranscriptSegment] | None = None,
    max_clip_duration: float = 45.0,
    intro_skip_seconds: float = 0.0,
) -> list[MomentCandidate]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    data = json.loads(text)
    items = data if isinstance(data, list) else data.get("moments") or data.get("candidates") or []
    skip = max(0.0, float(intro_skip_seconds or 0.0))
    out: list[MomentCandidate] = []
    for item in items:
        try:
            start = float(item["start"])
            end = float(item["end"])
            if start < skip:
                continue
            title = str(item.get("title", "Clip"))
            hook = str(item.get("hook", ""))
            score = float(item.get("score", 0.5))
            explanation = str(item.get("explanation", "LLM selected"))
            if segments:
                snapped = _snap_to_segments(start, end, segments, max_clip_duration)
                if not snapped:
                    continue
                start, end, snap_text = snapped
                if start < skip:
                    continue
                # Re-score lightly with heuristics so invented high scores don't dominate.
                h_score, reasons = _score_text(snap_text, duration=end - start)
                score = max(0.0, min(0.99, 0.55 * score + 0.45 * h_score))
                if not hook.strip():
                    hook = _hook_from_text(snap_text)
                if not title.strip() or title.strip().lower() == "clip":
                    title = _title_from_text(snap_text)
                if reasons:
                    explanation = f"{explanation} | signals: {', '.join(reasons[:6])}"
            if end - start < 5.0:
                continue
            out.append(
                MomentCandidate(
                    start=start,
                    end=end,
                    title=title,
                    hook=hook,
                    score=score,
                    explanation=explanation[:280],
                    id=str(item.get("id")) if item.get("id") else None,
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    out = _dedupe_moments(out)
    return _quality_gate(out, clip_count=clip_count)


def get_analyzer(settings: Settings | None = None) -> MomentAnalyzer:
    settings = settings or get_settings()
    if settings.llm_provider == "groq":
        return GroqJsonAnalyzer(settings)
    if settings.llm_provider == "gemini":
        return GeminiJsonAnalyzer(settings)
    return HeuristicAnalyzer()


def analyze_moments(
    segments: list[TranscriptSegment],
    *,
    clip_count: int = 3,
    max_clip_duration: float = 45.0,
    settings: Settings | None = None,
    intro_skip_seconds: float | None = None,
) -> list[MomentCandidate]:
    settings = settings or get_settings()
    skip = (
        float(settings.ai_intro_skip_seconds)
        if intro_skip_seconds is None
        else float(intro_skip_seconds)
    )
    skip = effective_intro_skip_seconds(
        skip, segments, max_clip_duration=max_clip_duration
    )
    if skip > 0:
        logger.info(
            "AI intro skip: excluding first %.0fs from viral moment detection",
            skip,
        )
    primary = get_analyzer(settings)
    try:
        return primary.analyze(
            segments,
            clip_count=clip_count,
            max_clip_duration=max_clip_duration,
            intro_skip_seconds=skip,
        )
    except Exception as exc:
        logger.warning("Primary analyzer failed (%s), using heuristic", exc)
        return HeuristicAnalyzer().analyze(
            segments,
            clip_count=clip_count,
            max_clip_duration=max_clip_duration,
            intro_skip_seconds=skip,
        )
