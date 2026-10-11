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


SENTENCE_END = re.compile(r"[.!?…]\s+")


def _sentences_from_segments(
    segments: list[TranscriptSegment], max_duration: float, min_duration: float = 15.0
) -> list[tuple[float, float, str]]:
    """Merge transcript into sentence-bounded chunks within duration limits."""
    if not segments:
        return []

    chunks: list[tuple[float, float, str]] = []
    buf: list[str] = []
    start = segments[0].start
    end = segments[0].end

    def flush() -> None:
        nonlocal buf, start, end
        if not buf:
            return
        text = " ".join(buf).strip()
        if text and (end - start) >= min(min_duration, max_duration * 0.5):
            chunks.append((start, end, text))
        buf = []

    for seg in segments:
        if not buf:
            start = seg.start
        buf.append(seg.text.strip())
        end = seg.end
        text = " ".join(buf)
        if (end - start) >= max_duration:
            flush()
            continue
        if SENTENCE_END.search(text + " "):
            flush()

    if buf:
        text = " ".join(buf).strip()
        if text and (end - start) >= 5.0:
            chunks.append((start, end, text))

    return chunks


class MomentAnalyzer(ABC):
    @abstractmethod
    def analyze(
        self,
        segments: list[TranscriptSegment],
        *,
        clip_count: int,
        max_clip_duration: float,
    ) -> list[MomentCandidate]:
        raise NotImplementedError


class HeuristicAnalyzer(MomentAnalyzer):
    """Free, offline scoring using keyword and pacing heuristics."""

    BOOST_WORDS = (
        "secret",
        "never",
        "always",
        "why",
        "how",
        "best",
        "worst",
        "mistake",
        "truth",
        "hack",
        "tip",
        "story",
        "crazy",
        "insane",
        "million",
        "free",
        "stop",
        "start",
        "you",
        "watch",
    )

    def analyze(
        self,
        segments: list[TranscriptSegment],
        *,
        clip_count: int,
        max_clip_duration: float,
    ) -> list[MomentCandidate]:
        chunks = _sentences_from_segments(segments, max_clip_duration)
        candidates: list[MomentCandidate] = []
        for start, end, text in chunks:
            lower = text.lower()
            words = re.findall(r"\w+", lower)
            if len(words) < 8:
                continue
            score = 0.35
            score += min(0.25, len(words) / 200.0)
            boosts = sum(1 for w in self.BOOST_WORDS if w in lower)
            score += min(0.25, boosts * 0.04)
            if "?" in text:
                score += 0.08
            if "!" in text:
                score += 0.05
            score = min(0.99, score)
            title = text[:80].rstrip() + ("…" if len(text) > 80 else "")
            hook = text[:140].rstrip() + ("…" if len(text) > 140 else "")
            candidates.append(
                MomentCandidate(
                    start=start,
                    end=end,
                    title=title,
                    hook=hook,
                    score=score,
                    explanation="Heuristic: keyword density, length, and punctuation.",
                )
            )
        candidates.sort(key=lambda c: c.score, reverse=True)
        return candidates[: max(clip_count * 3, clip_count)]


class GroqJsonAnalyzer(MomentAnalyzer):
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def analyze(
        self,
        segments: list[TranscriptSegment],
        *,
        clip_count: int,
        max_clip_duration: float,
    ) -> list[MomentCandidate]:
        if not self.settings.groq_api_key.strip():
            raise RuntimeError("GROQ_API_KEY not set")
        transcript = "\n".join(
            f"[{s.start:.1f}-{s.end:.1f}] {s.text}" for s in segments[:500]
        )
        prompt = (
            "Return JSON array of up to "
            f"{clip_count * 2} viral short-form clip candidates. Each object: "
            "start (seconds), end (seconds), title, hook, score (0-1), explanation. "
            f"Clips should be <= {max_clip_duration}s and align to sentence boundaries.\n\n"
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
            "temperature": 0.3,
        }
        with httpx.Client(timeout=120.0) as client:
            resp = client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=body,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
        return _parse_llm_moments(content, clip_count)


class GeminiJsonAnalyzer(MomentAnalyzer):
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def analyze(
        self,
        segments: list[TranscriptSegment],
        *,
        clip_count: int,
        max_clip_duration: float,
    ) -> list[MomentCandidate]:
        if not self.settings.gemini_api_key.strip():
            raise RuntimeError("GEMINI_API_KEY not set")
        transcript = "\n".join(
            f"[{s.start:.1f}-{s.end:.1f}] {s.text}" for s in segments[:500]
        )
        prompt = (
            "Return JSON with key moments as array. Fields: start, end, title, hook, score, explanation. "
            f"Max clip length {max_clip_duration}s. Pick up to {clip_count * 2} items.\n\n{transcript}"
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
        return _parse_llm_moments(content, clip_count)


def _parse_llm_moments(raw: str, clip_count: int) -> list[MomentCandidate]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    data = json.loads(text)
    items = data if isinstance(data, list) else data.get("moments") or data.get("candidates") or []
    out: list[MomentCandidate] = []
    for item in items:
        try:
            out.append(
                MomentCandidate(
                    start=float(item["start"]),
                    end=float(item["end"]),
                    title=str(item.get("title", "Clip")),
                    hook=str(item.get("hook", "")),
                    score=float(item.get("score", 0.5)),
                    explanation=str(item.get("explanation", "LLM selected")),
                    id=str(item.get("id")) if item.get("id") else None,
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    out.sort(key=lambda c: c.score, reverse=True)
    return out[: max(clip_count * 3, clip_count)]


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
    max_clip_duration: float = 60.0,
    settings: Settings | None = None,
) -> list[MomentCandidate]:
    settings = settings or get_settings()
    primary = get_analyzer(settings)
    try:
        return primary.analyze(
            segments, clip_count=clip_count, max_clip_duration=max_clip_duration
        )
    except Exception as exc:
        logger.warning("Primary analyzer failed (%s), using heuristic", exc)
        return HeuristicAnalyzer().analyze(
            segments, clip_count=clip_count, max_clip_duration=max_clip_duration
        )
