"""Caption translation with caching."""
from __future__ import annotations

import hashlib
import json
import logging
import re
from pathlib import Path

from pipeline.hinglish import to_hinglish
from pipeline.transcript import TranscriptSegment

logger = logging.getLogger(__name__)

_HINGLISH = frozenset({"hinglish", "hi-en", "hi_en"})
_HINDI = frozenset({"hi", "hindi"})
_ENGLISH = frozenset({"en", "english", "auto"})
_URDU = frozenset({"ur", "urdu"})
_ARABIC = frozenset({"ar", "arabic"})
_DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")


class TranslationError(RuntimeError):
    """Raised when the requested caption language cannot be applied faithfully."""


def _norm(lang: str | None) -> str:
    return (lang or "en").lower().strip()


def _cache_key(text: str, src_lang: str, target_lang: str) -> str:
    identity = f"{src_lang}→{target_lang}:{text}"
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]


def _translation_cache_path(cache_dir: Path, src_lang: str, target_lang: str) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    safe_src = src_lang.replace("/", "_").replace("\\", "_")
    safe_tgt = target_lang.replace("/", "_").replace("\\", "_")
    return cache_dir / f"translations_{safe_src}_to_{safe_tgt}.json"


def _load_translation_cache(cache_path: Path) -> dict[str, str]:
    if not cache_path.exists():
        return {}
    try:
        return json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Failed to load translation cache: %s", exc)
        return {}


def _save_translation_cache(cache_path: Path, cache: dict[str, str]) -> None:
    try:
        cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        logger.warning("Failed to save translation cache: %s", exc)


def _has_devanagari(text: str) -> bool:
    return bool(_DEVANAGARI_RE.search(text or ""))


def _compatible(src: str, tgt: str) -> bool:
    if src == tgt or tgt == "auto":
        return True
    if src in _HINGLISH and tgt in _HINGLISH:
        return True
    if src in _HINDI and tgt in _HINDI:
        return True
    if src in _ENGLISH and tgt in _ENGLISH:
        return True
    if src in _URDU and tgt in _URDU:
        return True
    if src in _ARABIC and tgt in _ARABIC:
        return True
    # Hinglish accepts English / Hindi / already-roman sources.
    if tgt in _HINGLISH and (src in _ENGLISH | _HINDI | _HINGLISH):
        return True
    return False


def translate_text_simple(
    text: str,
    src_lang: str,
    target_lang: str,
    cache_dir: Path | None = None,
    *,
    strict: bool = True,
) -> str:
    """
    Translate / romanize caption text.

    Supports:
    - Hinglish (Roman Hindi-English mix): preserve English, romanize Devanagari
    - Same-language / auto passthrough
    Raises TranslationError for unsupported pairs when strict=True.
    """
    del cache_dir  # reserved for future external MT APIs
    src = _norm(src_lang)
    tgt = _norm(target_lang)
    raw = (text or "").strip()
    if not raw:
        return text

    if src == tgt or tgt == "auto":
        return text

    # Hinglish: natural code-switching in Roman script.
    if tgt in _HINGLISH:
        if _has_devanagari(raw) or src in _HINDI:
            return to_hinglish(raw)
        # English / Roman Urdu / already Hinglish — keep slang & names.
        return raw

    if src in _HINDI and tgt in _HINDI:
        return text
    if src in _URDU and tgt in _URDU:
        return text
    if src in _ARABIC and tgt in _ARABIC:
        return text
    if src in _ENGLISH and tgt in _ENGLISH:
        return text

    if not _compatible(src, tgt):
        msg = (
            f"Caption language '{tgt}' cannot be produced from transcript language '{src}'. "
            "Choose matching language, Hinglish, or Auto."
        )
        if strict:
            raise TranslationError(msg)
        logger.warning("%s; using original text", msg)
        return text

    return text


def translate_segments(
    segments: list[TranscriptSegment],
    target_language: str,
    cache_dir: Path | None = None,
    *,
    strict: bool = True,
) -> list[TranscriptSegment]:
    """
    Apply target caption language to segments, preserving timestamps.

    Raises TranslationError if the language cannot be applied faithfully.
    """
    if not segments:
        return []

    src_lang = _norm(segments[0].language)
    tgt_lang = _norm(target_language)

    if src_lang == tgt_lang or tgt_lang == "auto":
        return segments

    # Detect Devanagari in body even if language tag says "en".
    sample = next((s.text for s in segments if (s.text or "").strip()), "")
    if tgt_lang in _HINGLISH and (_has_devanagari(sample) or src_lang in _HINDI):
        effective_src = "hi" if _has_devanagari(sample) else src_lang
    else:
        effective_src = src_lang

    if not _compatible(effective_src, tgt_lang) and not (
        tgt_lang in _HINGLISH and (_has_devanagari(sample) or effective_src in _ENGLISH | _HINDI | _HINGLISH)
    ):
        raise TranslationError(
            f"Caption language '{tgt_lang}' cannot be produced from transcript language '{src_lang}'. "
            "Choose matching language, Hinglish, or Auto."
        )

    cache: dict[str, str] = {}
    cache_path: Path | None = None
    if cache_dir:
        cache_path = _translation_cache_path(cache_dir, effective_src, tgt_lang)
        cache = _load_translation_cache(cache_path)

    translated: list[TranscriptSegment] = []
    cache_updated = False

    for seg in segments:
        text = (seg.text or "").strip()
        if not text:
            translated.append(seg)
            continue

        key = _cache_key(text, effective_src, tgt_lang)
        if key in cache:
            trans_text = cache[key]
        else:
            seg_src = _norm(seg.language) or effective_src
            if tgt_lang in _HINGLISH and _has_devanagari(text):
                seg_src = "hi"
            trans_text = translate_text_simple(
                text, seg_src, tgt_lang, cache_dir, strict=strict
            )
            cache[key] = trans_text
            cache_updated = True

        translated.append(
            TranscriptSegment(
                start=seg.start,
                end=seg.end,
                text=trans_text,
                speaker=seg.speaker,
                language=tgt_lang,
            )
        )

    if cache_updated and cache_path:
        _save_translation_cache(cache_path, cache)
        logger.info(
            "Saved %d translations to cache (%s → %s)",
            len(cache),
            effective_src,
            tgt_lang,
        )

    return translated
