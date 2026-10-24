from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

import httpx

from config import Settings, get_settings
from pipeline.transcript import TranscriptSegment

logger = logging.getLogger(__name__)

_STOP = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "is",
    "are", "was", "were", "be", "this", "that", "it", "with", "as", "by", "from",
    "you", "i", "we", "they", "he", "she", "my", "your", "our", "so", "if", "not",
    "just", "like", "really", "very", "hai", "ho", "ka", "ki", "ke", "mein", "yeh",
    "woh", "aur", "toh", "bhi", "nahi", "kya", "bro", "yeah", "chat", "gonna",
    "gotta", "dont", "im", "ive", "thats", "whats",
}

_SIGNAL_GROUPS: list[tuple[str, tuple[str, ...], int]] = [
    ("police", ("police", "cops", "swat", "arrest", "911", "ambulance"), 6),
    ("anger", ("mad", "furious", "angry", "rage", "yelling", "screaming", "pissed", "bull"), 5),
    ("apology", ("sorry", "apologize", "apology", "genuinely", "genely"), 4),
    ("shock", ("omg", "oh my god", "unbelievable", "insane", "crazy", "wild", "no way"), 3),
    (
        "first",
        (
            "first time",
            "first guy",
            "the first",
            "never done",
            "never been",
            "am i the first",
            "i'm the first",
            "im the first",
        ),
        5,
    ),
    ("comedy", ("laugh", "funny", "hilarious", "meme", "try not to laugh"), 3),
    ("sports", ("goal", "keeper", "lag", "score", "football", "soccer", "match"), 3),
    ("fear", ("scared", "terrified", "afraid", "help"), 4),
    ("conflict", ("fight", "argue", "beef", "vs", "versus", "against"), 3),
    ("travel", ("norway", "japan", "country", "irl", "stream", "abroad"), 2),
]

_COUNTRIES = (
    "norway", "japan", "india", "korea", "china", "london", "new york", "hawaii",
    "shanghai", "france", "italy", "brazil", "mexico", "canada", "uk", "usa",
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def transcript_window_text(
    segments: list[TranscriptSegment],
    start: float,
    end: float,
    *,
    pad: float = 0.5,
) -> str:
    parts: list[str] = []
    for s in segments:
        if s.end < start - pad or s.start > end + pad:
            continue
        t = (s.text or "").strip()
        if t:
            parts.append(t)
    return " ".join(parts).strip()


def surrounding_context_text(
    segments: list[TranscriptSegment],
    start: float,
    end: float,
    *,
    before: float = 12.0,
    after: float = 4.0,
) -> str:
    """Context around the clip window for better title grounding."""
    left = transcript_window_text(segments, start - before, start, pad=0.0)
    right = transcript_window_text(segments, end, end + after, pad=0.0)
    return " ".join(p for p in (left, right) if p).strip()


def _keywords(text: str, limit: int = 8) -> list[str]:
    words = re.findall(r"[A-Za-z\u0900-\u097F']{3,}", text.lower())
    freq: dict[str, int] = {}
    for w in words:
        if w in _STOP:
            continue
        freq[w] = freq.get(w, 0) + 1
    ranked = sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))
    return [w for w, _ in ranked[:limit]]


def _looks_like_dialogue_dump(title: str) -> bool:
    low = title.lower()
    dialogue_marks = len(re.findall(r"\b(bro|chat|yo|um+|uh+|like)\b", low))
    commas = title.count(",")
    return dialogue_marks >= 2 or commas >= 3 or bool(re.search(r"\bi'?m so sorry\b", low))


def _clean_title(raw: str, fallback: str) -> str:
    t = re.sub(r"\s+", " ", (raw or "").strip())
    t = t.strip("\"'`“”")
    t = re.sub(r"[!?]{2,}", "!", t)
    t = re.sub(r"…+$", "", t).strip()
    banned = ("you won't believe", "gone wrong", "shocking", "must watch!!!", "clickbait")
    low = t.lower()
    if any(b in low for b in banned) or _looks_like_dialogue_dump(t):
        t = fallback
    if len(t) > 85:
        t = t[:82].rstrip()
    return t or fallback


def _strip_creator_noise(name: str) -> str:
    name = re.sub(r"\s*(live|official|yt|youtube|streams?|clips?)\s*$", "", name, flags=re.I)
    return re.sub(r"\s+", " ", name).strip()


def _extract_creator(
    *,
    source_channel: str = "",
    source_uploader: str = "",
    source_title: str = "",
) -> str:
    raw = (source_channel or source_uploader or "").strip()
    if raw:
        return _strip_creator_noise(raw)
    m = re.match(r"^([^|\-–—:]{2,40})\s*[|\-–—:]", source_title or "")
    if m:
        return _strip_creator_noise(m.group(1))
    return ""


def _extract_place_or_theme(source_title: str, transcript: str) -> str:
    low_all = f"{source_title} {transcript}".lower()
    for c in _COUNTRIES:
        if c in low_all:
            return c.title() if " " not in c else " ".join(w.title() for w in c.split())
    cleaned_src = re.sub(r"[\U0001F300-\U0001FAFF]", "", source_title or "")
    cleaned_src = re.sub(r"[^\w\s.+\-|:&']+", " ", cleaned_src, flags=re.UNICODE)
    vs = re.search(r"([^|+]+?\s+v(?:s\.?|ersus)\s+[^|+]+)", cleaned_src, flags=re.I)
    if vs:
        theme = re.sub(r"\s+", " ", vs.group(1)).strip(" .+|-")
        return theme[:42]
    theme = re.sub(r"[\U0001F300-\U0001FAFF]", "", source_title or "")
    theme = re.sub(
        r"\b(let'?s have fun|irl|livestream|live stream|stream)\b",
        "",
        theme,
        flags=re.I,
    )
    theme = re.sub(r"[+|]+", " ", theme)
    theme = re.sub(r"\s+", " ", theme).strip()
    if len(theme) > 40:
        theme = theme[:37].rstrip()
    return theme


def _detect_signals(text: str) -> set[str]:
    low = text.lower()
    found: set[str] = set()
    for sid, words, _weight in _SIGNAL_GROUPS:
        if any(w in low for w in words):
            found.add(sid)
    if re.search(r"\bcalling the police\b|\bi'?m calling the police\b|\bi am calling the police\b", text, re.I):
        found.add("police")
    if re.search(r"\bswatted\b|\bswatting\b", text, re.I):
        found.add("swatted")
    return found


def _score_chunk(text: str) -> int:
    low = text.lower()
    score = 0
    for _sid, words, weight in _SIGNAL_GROUPS:
        if any(w in low for w in words):
            score += weight
    if re.search(r"\b(oh my god|omg|what the)\b", text, re.I):
        score += 2
    if "!" in text:
        score += 1
    if re.search(r"\b(call|called|calling|fight|lose|lost|first|never)\b", text, re.I):
        score += 2
    return score


def _peak_moment(transcript: str, surrounding: str) -> str:
    combined = " ".join(p for p in (surrounding, transcript) if p).strip()
    if not combined:
        return ""
    chunks = [
        re.sub(r"\s+", " ", s).strip()
        for s in re.split(r"(?<=[.!?])\s+|\n+", combined)
        if 18 <= len(re.sub(r"\s+", " ", s).strip()) <= 220
    ]
    if not chunks:
        return combined[:160]
    best = chunks[0]
    best_score = -1
    for c in chunks:
        s = _score_chunk(c)
        if s > best_score:
            best_score = s
            best = c
    return best


def _title_case_lite(s: str) -> str:
    parts = []
    for w in s.split():
        if not w:
            continue
        if w.isupper() and len(w) <= 4:
            parts.append(w)
        else:
            parts.append(w[0].upper() + w[1:])
    return " ".join(parts)


def _build_moment_summary(
    *,
    creator: str,
    signals: set[str],
    place: str,
    peak: str,
    source_title: str,
) -> str:
    who = creator or "The creator"
    if "police" in signals:
        return f"{who} starts calling the police{f' during a {place} IRL moment' if place else ''}."
    if "swatted" in signals:
        return f"{who} gets swatted live{f' in {place}' if place else ''}."
    if "anger" in signals and "sports" in signals:
        return f"{who} gets furious over lag/gameplay{f' ({place})' if place else ''}."
    if "anger" in signals:
        return f"{who} gets furious{f' during {place}' if place else ' on stream'}."
    if "first" in signals:
        return f"{who} realizes this may be a first-time collab/content moment."
    if "apology" in signals:
        return f"{who} keeps apologizing as the situation escalates{f' in {place}' if place else ''}."
    if "comedy" in signals:
        return f"{who} tries (and struggles) not to laugh."
    hint = re.sub(r"[\U0001F300-\U0001FAFF]", "", (peak or source_title)[:90]).strip()
    return f"{who}: {hint}" if hint else f"{who} has a notable moment on stream."


def _build_title_options(
    *,
    creator: str,
    place: str,
    source_title: str,
    signals: set[str],
    kws: list[str],
) -> list[dict[str, str]]:
    who = creator or "This Creator"
    theme = place or _extract_place_or_theme(source_title, "") or "This Stream"
    topic = _title_case_lite(" ".join(kws[:2])) or theme

    curiosity: list[str] = []
    emotion: list[str] = []
    event: list[str] = []

    if "police" in signals or "swatted" in signals:
        curiosity.append(f"Why {who} Just Called the Police{f' in {place}' if place else ''}")
        emotion.append(f"{who} Completely Panics During His {theme} Stream")
        if "swatted" in signals:
            event.append(f"{who} Gets Swatted Live{f' in {place}' if place else ''}")
        else:
            event.append(f"{who} Calls the Police Live{f' in {place}' if place else ''}")

    if "anger" in signals and "sports" not in signals:
        curiosity.append(f"Why {who} Is Losing It Over {topic}")
        emotion.append(f"{who} Gets Furious{f' During {theme}' if place else ' On Stream'}")
        event.append(f"{who} Snaps Mid-Stream{f' in {place}' if place else ''}")

    if "first" in signals:
        curiosity.append(f"Is {who} Really the First to Film This?")
        emotion.append(f"{who} Can't Believe This Is Happening")
        event.append(f"{who} Films a First-Time Moment{f' in {place}' if place else ''}")

    if "apology" in signals:
        curiosity.append(f"Why {who} Won't Stop Apologizing")
        emotion.append(f"{who} Sounds Genuinely Sorry as Things Go Sideways")
        event.append(f"{who} Apologizes Live as Chaos Breaks Out")

    if "comedy" in signals:
        curiosity.append(f"Can {who} Survive This Try Not to Laugh?")
        emotion.append(f"{who} Breaks Character Trying Not to Laugh")
        event.append(f"{who} Fails a Try Not to Laugh Challenge")

    if "sports" in signals:
        matchup = theme if re.search(r"v(?:s\.?|ersus)", theme, re.I) else ""
        opponent = ""
        if matchup:
            m = re.search(r"v(?:s\.?|ersus)\s+(.+)$", matchup, re.I)
            opponent = (m.group(1).strip() if m else "")
        curiosity.append(
            f"Why {who} Is Losing It Over This Lag"
            if "anger" in signals
            else f"Why {who}'s Keeper Won't Save Anything"
        )
        emotion.append(
            f"{who} Loses It Over Insane Lag{f' vs {opponent}' if opponent else ''}"
        )
        event.append(
            f"{who} Rages Mid-Match During {matchup}"
            if matchup
            else f"{who} Rages Mid-Match On Stream"
        )

    if not curiosity:
        curiosity.append(
            f"What {who} Just Said About {topic}"
            if creator
            else f"The Moment That Makes This {theme} Clip Hit"
        )
    if not emotion:
        emotion.append(
            f"{who}'s Real Reaction to {topic}"
            if creator
            else f"The Emotional Peak of This {theme} Clip"
        )
    if not event:
        event.append(
            f"{who} Hits a Wild Moment{f' in {place}' if place else ' On Stream'}"
            if creator
            else f"Unexpected Turn in {theme}"
        )

    def uniq(options: list[str], angle: str) -> dict[str, str]:
        fallback = f"{who} {theme}".strip()
        for candidate in options:
            cleaned = _clean_title(candidate, fallback)
            if cleaned and not _looks_like_dialogue_dump(cleaned):
                return {"angle": angle, "title": cleaned}
        return {"angle": angle, "title": _clean_title(options[0] if options else fallback, fallback)}

    return [uniq(curiosity, "curiosity"), uniq(emotion, "emotion"), uniq(event, "event")]


def _hashtags(keywords: list[str], language: str, extra: list[str]) -> list[str]:
    tags: list[str] = []
    for e in extra:
        h = e if e.startswith("#") else f"#{e}"
        if h.lower() not in {x.lower() for x in tags}:
            tags.append(h)
    for kw in keywords:
        h = "#" + re.sub(r"[^A-Za-z0-9\u0900-\u097F]", "", kw)
        if len(h) < 3:
            continue
        if h.lower() not in {x.lower() for x in tags}:
            tags.append(h)
        if len(tags) >= 10:
            break
    lang = (language or "en").lower()
    if lang in ("hi", "hinglish") and "#Hinglish" not in tags:
        tags.append("#Hinglish")
    if lang == "ur" and "#Urdu" not in tags:
        tags.append("#Urdu")
    return tags[:12]


def _heuristic_payload(
    *,
    transcript: str,
    clip_title: str,
    language: str,
    source_title: str = "",
    source_channel: str = "",
    source_uploader: str = "",
    surrounding_context: str = "",
) -> dict[str, Any]:
    text = (transcript or surrounding_context or clip_title or source_title).strip()
    creator = _extract_creator(
        source_channel=source_channel,
        source_uploader=source_uploader,
        source_title=source_title,
    )
    place = _extract_place_or_theme(source_title, text)
    peak = _peak_moment(transcript, surrounding_context)
    signals = _detect_signals(f"{peak} {transcript} {source_title}")
    kws = _keywords(f"{transcript} {source_title} {creator}")
    title_options = _build_title_options(
        creator=creator,
        place=place,
        source_title=source_title,
        signals=signals,
        kws=kws,
    )
    primary = (
        title_options[1]["title"]
        if len(title_options) > 1
        else (title_options[0]["title"] if title_options else clip_title or "Short Clip")
    )
    moment_summary = _build_moment_summary(
        creator=creator,
        signals=signals,
        place=place,
        peak=peak,
        source_title=source_title,
    )

    creator_tag = re.sub(r"\s+", "", creator) if creator else ""
    platform_tags = _hashtags(
        [creator_tag, *kws] if creator_tag else kws,
        language,
        ["shorts", "viral", "fyp", *([creator_tag] if creator_tag else [])],
    )
    yt_tags = list(
        dict.fromkeys([*( [creator] if creator else [] ), *kws, "shorts", "youtube shorts"])
    )[:15]

    yt_desc = "\n\n".join(
        b
        for b in (
            moment_summary,
            f"From {' — '.join(x for x in (creator, source_title) if x)}."
            if (creator or source_title)
            else "",
            "Clipped with Shortlio. Watch the full stream for context.",
        )
        if b
    )
    caption_hook = title_options[0]["title"] if title_options else primary
    tiktok_caption = f"{caption_hook} {' '.join(platform_tags[:5])}".strip()
    ig_caption = f"{caption_hook}\n\n{moment_summary}\n\n{' '.join(platform_tags[:6])}".strip()

    return {
        "language": language or "en",
        "youtube": {
            "title": primary,
            "description": yt_desc,
            "hashtags": platform_tags,
            "tags": yt_tags,
        },
        "tiktok": {
            "caption": tiktok_caption[:2200],
            "hashtags": platform_tags,
        },
        "instagram": {
            "caption": ig_caption[:2200],
            "keywords": ([creator] if creator else []) + kws[:10],
            "hashtags": platform_tags,
        },
        "title_options": title_options,
        "moment_summary": moment_summary,
        "generated_at": _now_iso(),
        "provider": "heuristic",
    }


def _parse_json_object(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    data = json.loads(text)
    if isinstance(data, dict) and "metadata" in data and isinstance(data["metadata"], dict):
        return data["metadata"]
    if not isinstance(data, dict):
        raise ValueError("Expected JSON object")
    return data


def _normalize_payload(
    data: dict[str, Any],
    *,
    language: str,
    provider: str,
    fallback: dict[str, Any],
) -> dict[str, Any]:
    yt = data.get("youtube") if isinstance(data.get("youtube"), dict) else {}
    tt = data.get("tiktok") if isinstance(data.get("tiktok"), dict) else {}
    ig = data.get("instagram") if isinstance(data.get("instagram"), dict) else {}

    def _list(val: Any) -> list[str]:
        if not isinstance(val, list):
            return []
        out: list[str] = []
        for x in val:
            s = str(x).strip()
            if s:
                out.append(s)
        return out

    options_raw = data.get("title_options")
    title_options: list[dict[str, str]] = []
    if isinstance(options_raw, list):
        for item in options_raw:
            if not isinstance(item, dict):
                continue
            angle = str(item.get("angle") or "").lower()
            title = str(item.get("title") or "").strip()
            if angle in ("curiosity", "emotion", "event") and title:
                title_options.append(
                    {
                        "angle": angle,
                        "title": _clean_title(title, fallback["youtube"]["title"]),
                    }
                )
        title_options = title_options[:3]
    if len(title_options) < 3:
        title_options = fallback.get("title_options") or title_options

    fallback_title = fallback["youtube"]["title"]
    youtube = {
        "title": _clean_title(str(yt.get("title") or fallback_title), fallback_title),
        "description": str(yt.get("description") or fallback["youtube"]["description"])[:5000],
        "hashtags": _list(yt.get("hashtags")) or fallback["youtube"]["hashtags"],
        "tags": _list(yt.get("tags")) or fallback["youtube"]["tags"],
    }
    tiktok = {
        "caption": str(tt.get("caption") or fallback["tiktok"]["caption"])[:2200],
        "hashtags": _list(tt.get("hashtags")) or fallback["tiktok"]["hashtags"],
    }
    instagram = {
        "caption": str(ig.get("caption") or fallback["instagram"]["caption"])[:2200],
        "keywords": _list(ig.get("keywords")) or fallback["instagram"]["keywords"],
        "hashtags": _list(ig.get("hashtags")) or fallback["instagram"]["hashtags"],
    }
    return {
        "language": language or "en",
        "youtube": youtube,
        "tiktok": tiktok,
        "instagram": instagram,
        "title_options": title_options,
        "moment_summary": str(data.get("moment_summary") or fallback.get("moment_summary") or ""),
        "generated_at": _now_iso(),
        "provider": provider,
    }


def _llm_prompt(
    *,
    transcript: str,
    clip_title: str,
    language: str,
    source_title: str,
    source_channel: str,
    surrounding_context: str,
) -> str:
    lang = (language or "en").lower()
    lang_note = {
        "en": "Write all copy in natural English.",
        "hi": "Write titles/captions in Hindi (Devanagari) where natural; keep hashtags mostly Latin.",
        "ur": "Write titles/captions in Urdu (Arabic script) where natural; keep hashtags mostly Latin.",
        "hinglish": "Write in Hinglish (Roman Hindi + English mix), natural spoken style.",
    }.get(lang, "Write in the language that matches the transcript.")
    return (
        "You are a professional Shorts/TikTok/Reels title writer for viral clips.\n"
        f"{lang_note}\n\n"
        "STEP 1 — Understand the clip before writing:\n"
        "- Infer what is ACTUALLY happening: emotion, conflict, surprise, comedy, argument, first-time moment, etc.\n"
        "- Use creator name, event, and recognizable context ONLY when supported by transcript or source metadata.\n"
        "- NEVER invent events (no fake swatting, fights, arrests, breakups, etc.).\n"
        "- Do NOT copy or lightly paraphrase raw dialogue as the title.\n"
        "- Do NOT wrap titles in quotation marks. No keyword stuffing. No generic summaries.\n\n"
        "STEP 2 — Write 3 DISTINCT title options with different angles:\n"
        "1) curiosity — open a loop\n"
        "2) emotion — highlight the feeling/reaction\n"
        "3) event — name the concrete thing that happens, only if evidenced\n"
        "GOOD only if true: \"IShowSpeed Gets Furious During His IRL Stream\"\n"
        "BAD: dialogue dumps like \"oh my God bro Chad I'm so sorry\"\n\n"
        "STEP 3 — Platform copy for youtube/tiktok/instagram.\n"
        "Return JSON with keys: moment_summary, title_options "
        "(array of {angle,title}), youtube, tiktok, instagram.\n"
        f"Creator/channel: {source_channel or '(unknown)'}\n"
        f"Source video title: {source_title or '(unknown)'}\n"
        f"Clip title hint (may be noisy dialogue — do not copy): {clip_title}\n"
        f"Language code: {lang}\n"
        f"Surrounding context:\n{(surrounding_context or '')[:2500]}\n"
        f"Clip transcript:\n{(transcript or '')[:6000]}"
    )


def _generate_groq(
    settings: Settings,
    *,
    transcript: str,
    clip_title: str,
    language: str,
    source_title: str,
    source_channel: str,
    surrounding_context: str,
    fallback: dict[str, Any],
) -> dict[str, Any]:
    if not settings.groq_api_key.strip():
        raise RuntimeError("GROQ_API_KEY not set")
    prompt = _llm_prompt(
        transcript=transcript,
        clip_title=clip_title,
        language=language,
        source_title=source_title,
        source_channel=source_channel,
        surrounding_context=surrounding_context,
    )
    headers = {
        "Authorization": f"Bearer {settings.groq_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": "llama-3.3-70b-versatile",
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"},
        "temperature": 0.55,
    }
    with httpx.Client(timeout=90.0) as client:
        resp = client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers,
            json=body,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
    data = _parse_json_object(content)
    return _normalize_payload(data, language=language, provider="groq", fallback=fallback)


def _generate_gemini(
    settings: Settings,
    *,
    transcript: str,
    clip_title: str,
    language: str,
    source_title: str,
    source_channel: str,
    surrounding_context: str,
    fallback: dict[str, Any],
) -> dict[str, Any]:
    if not settings.gemini_api_key.strip():
        raise RuntimeError("GEMINI_API_KEY not set")
    prompt = _llm_prompt(
        transcript=transcript,
        clip_title=clip_title,
        language=language,
        source_title=source_title,
        source_channel=source_channel,
        surrounding_context=surrounding_context,
    )
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.0-flash:generateContent?key={settings.gemini_api_key}"
    )
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.55},
    }
    with httpx.Client(timeout=90.0) as client:
        resp = client.post(url, json=body)
        resp.raise_for_status()
        content = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
    data = _parse_json_object(content)
    return _normalize_payload(data, language=language, provider="gemini", fallback=fallback)


def generate_viral_metadata(
    *,
    transcript: str,
    clip_title: str,
    language: str = "en",
    settings: Settings | None = None,
    platforms: list[str] | None = None,
    source_title: str = "",
    source_channel: str = "",
    source_uploader: str = "",
    surrounding_context: str = "",
) -> dict[str, Any]:
    """Generate platform metadata from clip transcript + source context. Never re-transcribes."""
    settings = settings or get_settings()
    title = (clip_title or "Clip").strip() or "Clip"
    lang = (language or "en").lower().strip() or "en"
    text = (transcript or "").strip()
    channel = (source_channel or source_uploader or "").strip()

    fallback = _heuristic_payload(
        transcript=text,
        clip_title=title,
        language=lang,
        source_title=source_title or "",
        source_channel=channel,
        source_uploader=source_uploader or "",
        surrounding_context=surrounding_context or "",
    )

    payload: dict[str, Any]
    try:
        if settings.llm_provider == "groq":
            payload = _generate_groq(
                settings,
                transcript=text or title,
                clip_title=title,
                language=lang,
                source_title=source_title or "",
                source_channel=channel,
                surrounding_context=surrounding_context or "",
                fallback=fallback,
            )
        elif settings.llm_provider == "gemini":
            payload = _generate_gemini(
                settings,
                transcript=text or title,
                clip_title=title,
                language=lang,
                source_title=source_title or "",
                source_channel=channel,
                surrounding_context=surrounding_context or "",
                fallback=fallback,
            )
        else:
            payload = fallback
    except Exception as exc:
        logger.warning("Viral metadata LLM failed (%s); using heuristic", exc)
        payload = fallback

    if platforms:
        keep = {p.lower().strip() for p in platforms}
        filtered = {
            "language": payload.get("language", lang),
            "generated_at": payload.get("generated_at"),
            "provider": payload.get("provider"),
            "title_options": payload.get("title_options"),
            "moment_summary": payload.get("moment_summary"),
        }
        for key in ("youtube", "tiktok", "instagram"):
            if key in keep or not keep:
                filtered[key] = payload.get(key)
        for key in ("youtube", "tiktok", "instagram"):
            if key not in filtered:
                filtered[key] = payload.get(key)
        return filtered
    return payload
