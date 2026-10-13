from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

from pipeline.hinglish import to_hinglish
from pipeline.transcript import TranscriptSegment

logger = logging.getLogger(__name__)

# Preset defaults aligned with src/lib/captions/presets.ts
_PRESET_STYLES: dict[str, dict[str, Any]] = {
    "classic_white": {
        "fontFamily": "Montserrat",
        "fontSize": 72,
        "fontWeight": 900,
        "textColor": "#FFFFFF",
        "highlightColor": "#FFD700",
        "outlineColor": "#000000",
        "outlineWidth": 6,
        "backgroundColor": "#000000",
        "backgroundOpacity": 0.0,
        "shadow": True,
        "position": "center",
        "maxWordsPerCaption": 3,
        "animation": "pop",
    },
    "bold_yellow": {
        "fontFamily": "Impact",
        "fontSize": 78,
        "fontWeight": 900,
        "textColor": "#FFF000",
        "highlightColor": "#FF0080",
        "outlineColor": "#000000",
        "outlineWidth": 7,
        "backgroundColor": "#000000",
        "backgroundOpacity": 0.0,
        "shadow": True,
        "position": "center",
        "maxWordsPerCaption": 3,
        "animation": "word_pop",
    },
    "karaoke_highlight": {
        "fontFamily": "Poppins",
        "fontSize": 68,
        "fontWeight": 800,
        "textColor": "#CCCCCC",
        "highlightColor": "#00FFFF",
        "outlineColor": "#000000",
        "outlineWidth": 5,
        "backgroundColor": "#000000",
        "backgroundOpacity": 0.0,
        "shadow": True,
        "position": "center",
        "maxWordsPerCaption": 4,
        "animation": "karaoke",
    },
    "word_by_word_pop": {
        "fontFamily": "Anton",
        "fontSize": 88,
        "fontWeight": 900,
        "textColor": "#FFFFFF",
        "highlightColor": "#FF4444",
        "outlineColor": "#000000",
        "outlineWidth": 8,
        "backgroundColor": "#000000",
        "backgroundOpacity": 0.0,
        "shadow": True,
        "position": "center",
        "maxWordsPerCaption": 1,
        "animation": "word_pop",
    },
    "clean_minimal": {
        "fontFamily": "Inter",
        "fontSize": 52,
        "fontWeight": 600,
        "textColor": "#FFFFFF",
        "highlightColor": "#FFFFFF",
        "outlineColor": "#000000",
        "outlineWidth": 0,
        "backgroundColor": "#000000",
        "backgroundOpacity": 0.7,
        "shadow": False,
        "position": "bottom",
        "maxWordsPerCaption": 8,
        "animation": "fade",
    },
    "neon_accent": {
        "fontFamily": "Montserrat",
        "fontSize": 70,
        "fontWeight": 800,
        "textColor": "#FFFFFF",
        "highlightColor": "#00FFFF",
        "outlineColor": "#000033",
        "outlineWidth": 5,
        "backgroundColor": "#000000",
        "backgroundOpacity": 0.0,
        "shadow": True,
        "position": "center",
        "maxWordsPerCaption": 3,
        "animation": "karaoke",
    },
    "podcast_bold": {
        "fontFamily": "Roboto",
        "fontSize": 64,
        "fontWeight": 800,
        "textColor": "#FFFFFF",
        "highlightColor": "#FFB800",
        "outlineColor": "#000000",
        "outlineWidth": 4,
        "backgroundColor": "#1A1A1A",
        "backgroundOpacity": 0.65,
        "shadow": True,
        "position": "bottom",
        "maxWordsPerCaption": 4,
        "animation": "pop",
    },
    "creator_style": {
        "fontFamily": "Poppins",
        "fontSize": 74,
        "fontWeight": 900,
        "textColor": "#FFFFFF",
        "highlightColor": "#FF0099",
        "outlineColor": "#000000",
        "outlineWidth": 6,
        "backgroundColor": "#000000",
        "backgroundOpacity": 0.0,
        "shadow": True,
        "position": "center",
        "maxWordsPerCaption": 3,
        "animation": "pop",
    },
    "cinematic_box": {
        "fontFamily": "Roboto",
        "fontSize": 58,
        "fontWeight": 600,
        "textColor": "#FFFFFF",
        "highlightColor": "#FFD700",
        "outlineColor": "#000000",
        "outlineWidth": 0,
        "backgroundColor": "#0D0D0D",
        "backgroundOpacity": 0.85,
        "shadow": False,
        "position": "bottom",
        "maxWordsPerCaption": 6,
        "animation": "fade",
    },
    "gaming_hype": {
        "fontFamily": "Anton",
        "fontSize": 80,
        "fontWeight": 900,
        "textColor": "#FFFFFF",
        "highlightColor": "#00FF00",
        "outlineColor": "#000000",
        "outlineWidth": 7,
        "backgroundColor": "#000000",
        "backgroundOpacity": 0.0,
        "shadow": True,
        "position": "center",
        "maxWordsPerCaption": 1,
        "animation": "word_pop",
    },
    "typewriter": {
        "fontFamily": "Montserrat",
        "fontSize": 66,
        "fontWeight": 700,
        "textColor": "#DDDDDD",
        "highlightColor": "#FF6BFF",
        "outlineColor": "#000000",
        "outlineWidth": 4,
        "backgroundColor": "#000000",
        "backgroundOpacity": 0.0,
        "shadow": True,
        "position": "center",
        "maxWordsPerCaption": 4,
        "animation": "karaoke",
    },
}

# Prefer real family names so libass/fontsdir can match preview fonts when installed.
# Fallbacks are applied in _ass_font when the preferred face is unavailable.
_FONT_ASS = {
    "Montserrat": "Montserrat",
    "Anton": "Anton",
    "Poppins": "Poppins",
    "Inter": "Inter",
    "Roboto": "Roboto",
    "Impact": "Impact",
    "Noto Sans": "Noto Sans",
    "Arial": "Arial",
}
_FONT_FALLBACK = {
    "Montserrat": "Arial",
    "Anton": "Impact",
    "Poppins": "Arial",
    "Inter": "Arial",
    "Roboto": "Arial",
    "Noto Sans": "Segoe UI",
}

_RTL_LANGS = frozenset({"ar", "arabic", "ur", "urdu", "fa", "persian", "he", "hebrew"})
_HINGLISH_HINTS = frozenset({"hinglish", "hi-en", "hi_en"})
_DEVANAGARI_KEEP = frozenset({"hi", "hindi"})


_STYLE_MODE_KEY = "__mode"
_STYLE_OVERRIDE_KEYS = (
    "fontFamily",
    "fontSize",
    "fontWeight",
    "textColor",
    "highlightColor",
    "outlineColor",
    "outlineWidth",
    "backgroundColor",
    "backgroundOpacity",
    "shadow",
    "position",
    "maxWordsPerCaption",
    "animation",
)


def _caption_style_mode(settings: dict[str, Any] | None) -> str:
    """Return 'preset' | 'finetune'. Preset has highest priority when selected."""
    if not settings:
        return "preset"
    mode = settings.get(_STYLE_MODE_KEY) or settings.get("styleMode")
    if mode in ("preset", "finetune"):
        return str(mode)
    # Legacy rows without __mode: any override key ⇒ finetune
    for key in _STYLE_OVERRIDE_KEYS:
        snake = re.sub(r"([A-Z])", r"_\1", key).lower().lstrip("_")
        if key in settings or snake in settings:
            return "finetune"
    return "preset"


def resolve_caption_style(
    preset: str,
    settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    base = dict(_PRESET_STYLES.get(preset, _PRESET_STYLES["classic_white"]))
    mode = _caption_style_mode(settings)
    # Preset mode wins: ignore leftover fine-tune fields entirely.
    if mode == "preset" or not settings:
        return base
    for key in _STYLE_OVERRIDE_KEYS:
        # Accept both camelCase (UI) and snake_case
        snake = re.sub(r"([A-Z])", r"_\1", key).lower().lstrip("_")
        if key in settings and settings[key] is not None:
            base[key] = settings[key]
        elif snake in settings and settings[snake] is not None:
            base[key] = settings[snake]
    return base


def _parse_hex_rgb(hex_color: str) -> tuple[int, int, int]:
    raw = (hex_color or "#FFFFFF").strip().lstrip("#")
    if len(raw) == 3:
        raw = "".join(c * 2 for c in raw)
    if len(raw) != 6:
        raw = "FFFFFF"
    return int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16)


def _hex_to_ass_bgr(hex_color: str, alpha: float = 0.0) -> str:
    """Style colour &HAABBGGRR (AA = inverse opacity)."""
    r, g, b = _parse_hex_rgb(hex_color)
    aa = int(max(0.0, min(1.0, alpha)) * 255)
    # ASS alpha: 00 opaque, FF transparent
    ass_a = 255 - aa if alpha > 0 else 0
    return f"&H{ass_a:02X}{b:02X}{g:02X}{r:02X}"


def _hex_to_ass_c(hex_color: str) -> str:
    """Inline \\c / \\1c override: &HBBGGRR& (no alpha byte)."""
    r, g, b = _parse_hex_rgb(hex_color)
    return f"&H{b:02X}{g:02X}{r:02X}&"


def _ass_font(family: str, language_hint: str) -> str:
    hint = (language_hint or "en").lower().strip()
    # Hinglish is romanized — use Latin fonts. Keep Devanagari fonts only for hi.
    if hint in _DEVANAGARI_KEEP:
        return "Nirmala UI"
    if hint in _RTL_LANGS:
        return "Segoe UI"
    preferred = _FONT_ASS.get(family, family if family else "Arial")
    # Keep preferred name in the ASS so fontsdir can resolve Google/preview faces.
    # If missing at burn time, libass falls back; map only empty/unknown families.
    if not preferred:
        return _FONT_FALLBACK.get(family, "Arial")
    return preferred


def _alignment_and_margin(position: str) -> tuple[int, int]:
    """ASS alignment + MarginV. Bottom sits in lower-third, clear of faces."""
    pos = (position or "bottom").lower()
    if pos == "top":
        return 8, 140
    if pos == "center":
        # Slightly below true center so captions don't sit on the mouth/chin
        return 5, 280
    return 2, 220  # bottom / lower-third


def _ass_escape(text: str) -> str:
    return (
        text.replace("\\", r"\\")
        .replace("{", r"\{")
        .replace("}", r"\}")
        .replace("\n", r"\N")
        .replace("\r", "")
    )


def _sec_to_ass(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h:d}:{m:02d}:{s:05.2f}"


def _prepare_caption_text(text: str, language_hint: str) -> str:
    hint = (language_hint or "en").lower().strip()
    # Hinglish must be Roman script — romanize any leftover Devanagari.
    # Idempotent if translate_segments already converted.
    if hint in _HINGLISH_HINTS:
        text = to_hinglish(text)
    # hi/hindi keep Devanagari; ur/ar keep original script
    text = re.sub(r"\s+", " ", text).strip()
    if hint in _RTL_LANGS:
        # ASS has limited RTL; mark with RLE for better libass behaviour
        text = "\u202b" + text + "\u202c"
    return text


def _chunk_words(text: str, max_words: int) -> list[str]:
    words = text.split()
    if not words:
        return []
    max_words = max(1, int(max_words or 8))
    return [" ".join(words[i : i + max_words]) for i in range(0, len(words), max_words)]


# Preview CSS uses ~0.72× fontSize on a ~640px player; burned ASS is scaled to
# PlayRes 1920, so we bump size/outline so mobile/fullscreen matches the chunky preview.
_ASS_SIZE_SCALE = 1.45
_ASS_OUTLINE_SCALE = 1.3


def _style_line(style: dict[str, Any], language_hint: str) -> str:
    font = _ass_font(str(style.get("fontFamily") or "Arial"), language_hint)
    raw_size = int(style.get("fontSize") or 52)
    size = max(56, int(round(raw_size * _ASS_SIZE_SCALE)))
    # Viral word-pop styles use highlight as the visible fill (preview does the same).
    animation = str(style.get("animation") or "none").lower()
    text_color = str(style.get("textColor") or "#FFFFFF")
    highlight = str(style.get("highlightColor") or text_color)
    fill = highlight if animation == "word_pop" else text_color
    primary = _hex_to_ass_bgr(fill)
    secondary = _hex_to_ass_bgr(highlight)
    outline_c = _hex_to_ass_bgr(str(style.get("outlineColor") or "#000000"))
    bg_opacity = float(style.get("backgroundOpacity") or 0)
    bold = -1 if int(style.get("fontWeight") or 700) >= 600 else 0
    outline = max(0, int(round(int(style.get("outlineWidth") or 0) * _ASS_OUTLINE_SCALE)))
    shadow = 3 if style.get("shadow") else 0
    # BorderStyle 3 = opaque box. libass often ignores alpha and paints a solid black
    # rectangle, so only enable it for intentional boxed presets (opacity >= 40%).
    # Low decorative opacities must stay BorderStyle 1 (outline + shadow) like CapCut viral.
    boxed = bg_opacity >= 0.4
    border_style = 3 if boxed else 1
    if boxed:
        # Opaque box fill; Outline becomes box padding thickness.
        back = _hex_to_ass_bgr(str(style.get("backgroundColor") or "#000000"), alpha=bg_opacity)
        outline = max(outline, 10)  # readable padding around glyphs
        shadow = 0
    else:
        # Shadow colour (not a box). Keep fully opaque so drop-shadow reads cleanly.
        back = _hex_to_ass_bgr("#000000", alpha=0.0)
    align, margin_v = _alignment_and_margin(str(style.get("position") or "bottom"))
    return (
        f"Style: Default,{font},{size},{primary},{secondary},{outline_c},{back},"
        f"{bold},0,0,0,100,100,0,0,{border_style},{outline},{shadow},{align},40,40,{margin_v},1"
    )


def _anim_prefix(animation: str) -> str:
    anim = (animation or "none").lower()
    if anim == "fade":
        return r"{\fad(160,160)}"
    if anim in ("pop", "word_pop"):
        # Strong overshoot so burns match the CSS caption-anim-pop preview.
        return r"{\fscx155\fscy155\t(0,200,\fscx100\fscy100)}"
    return ""


def _pop_active_tags(color: str, *, strong: bool = False) -> str:
    """Scale-up the active word, then settle (preview pop / word_pop)."""
    start = 165 if strong else 145
    return rf"{{\c{color}\fscx{start}\fscy{start}\t(0,220,\fscx100\fscy100)}}"


def _word_durations(total: float, n: int, *, min_word: float = 0.16) -> list[float]:
    """Split a cue across words with a readable minimum so highlights track speech."""
    if n <= 0:
        return []
    if n == 1:
        return [max(min_word, total)]
    # Prefer even split, but never go below min_word unless the cue is too short.
    ideal = total / n
    if ideal >= min_word:
        return [ideal] * n
    # Compress evenly when the cue is short.
    each = max(0.08, total / n)
    return [each] * n


def _dialogue_word_steps(
    *,
    words: list[str],
    rs: float,
    re: float,
    hi: str,
    base: str,
    accumulate: bool,
    pop_active: bool,
    strong_pop: bool = False,
) -> list[str]:
    """Emit one ASS dialogue event per word step (color + optional pop on active word)."""
    out: list[str] = []
    durs = _word_durations(max(0.08, re - rs), len(words))
    t = rs
    no_wrap = r"{\q2}"
    for i, dur in enumerate(durs):
        ws = t
        we = min(re, t + dur)
        t = we
        if we <= ws:
            continue
        parts: list[str] = []
        for j, w in enumerate(words):
            is_active = j == i
            lit = (j <= i) if accumulate else is_active
            color = hi if lit else base
            if pop_active and is_active:
                parts.append(f"{_pop_active_tags(color, strong=strong_pop)}{_ass_escape(w)}")
            else:
                parts.append(rf"{{\c{color}\fscx100\fscy100}}{_ass_escape(w)}")
        out.append(
            f"Dialogue: 0,{_sec_to_ass(ws)},{_sec_to_ass(we)},Default,,0,0,0,,"
            f"{no_wrap}{' '.join(parts)}"
        )
    return out


def _segments_for_range(
    segments: list[TranscriptSegment],
    start: float,
    end: float,
) -> list[TranscriptSegment]:
    return [s for s in segments if s.end >= start and s.start <= end]


def _norm_caption_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def collapse_rolling_segments(
    segments: list[TranscriptSegment],
) -> list[TranscriptSegment]:
    """Collapse YouTube-style rolling/overlapping cues into non-overlapping lines.

    ASR captions often stack many short overlapping events (each adding a word).
    Burning them all causes ghosted/stacked text like the 'aapake' bug.

    Rule: any cues that overlap (or sit within 80ms) belong to one utterance —
    keep the longest text and the full time span, then hard-cut neighbors.
    """
    ordered = sorted(
        (s for s in segments if _norm_caption_text(s.text)),
        key=lambda s: (s.start, s.end),
    )
    if not ordered:
        return []

    groups: list[TranscriptSegment] = []
    cur = TranscriptSegment(
        start=ordered[0].start,
        end=max(ordered[0].end, ordered[0].start + 0.08),
        text=_norm_caption_text(ordered[0].text),
        speaker=ordered[0].speaker,
        language=ordered[0].language,
    )

    for seg in ordered[1:]:
        text = _norm_caption_text(seg.text)
        # True overlap only (don't glue separate sentences across gaps)
        if seg.start < cur.end:
            cur.end = max(cur.end, seg.end, cur.start + 0.08)
            if len(text) >= len(cur.text):
                cur = TranscriptSegment(
                    start=cur.start,
                    end=cur.end,
                    text=text,
                    speaker=seg.speaker or cur.speaker,
                    language=seg.language or cur.language,
                )
            else:
                cur = TranscriptSegment(
                    start=cur.start,
                    end=cur.end,
                    text=cur.text,
                    speaker=cur.speaker,
                    language=cur.language,
                )
        else:
            groups.append(cur)
            cur = TranscriptSegment(
                start=seg.start,
                end=max(seg.end, seg.start + 0.08),
                text=text,
                speaker=seg.speaker,
                language=seg.language,
            )
    groups.append(cur)

    # Enforce non-overlap + drop 1-char Indic leftovers
    clean: list[TranscriptSegment] = []
    for seg in groups:
        if clean and seg.start < clean[-1].end:
            seg = TranscriptSegment(
                start=clean[-1].end,
                end=max(clean[-1].end + 0.06, seg.end),
                text=seg.text,
                speaker=seg.speaker,
                language=seg.language,
            )
        if seg.end <= seg.start:
            continue
        if len(seg.text.strip()) <= 1:
            continue
        clean.append(seg)
    return clean


def build_ass_subtitles(
    segments: list[TranscriptSegment],
    clip_start: float,
    clip_end: float,
    *,
    preset: str = "classic_white",
    language_hint: str = "en",
    caption_settings: dict[str, Any] | None = None,
) -> str:
    style = resolve_caption_style(preset, caption_settings)
    animation = str(style.get("animation") or "none").lower()
    max_words = int(style.get("maxWordsPerCaption") or 8)
    # No lead - keep captions exactly in sync with speech
    lead = 0.0
    
    logger.info(
        "Building ASS with preset=%s, animation=%s, fontSize=%s, maxWords=%d",
        preset,
        animation,
        style.get("fontSize"),
        max_words,
    )

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{_style_line(style, language_hint)}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header]
    rel_segments = collapse_rolling_segments(
        _segments_for_range(segments, clip_start, clip_end)
    )
    if not rel_segments:
        logger.warning(
            "No transcript segments overlap clip range %.2f–%.2f (language=%s)",
            clip_start,
            clip_end,
            language_hint,
        )

    for seg in rel_segments:
        text = _prepare_caption_text(seg.text, language_hint)
        if not text:
            continue
        chunks = _chunk_words(text, max_words)
        if not chunks:
            continue

        seg_start = max(clip_start, seg.start - lead)
        seg_end = min(clip_end, seg.end)
        seg_dur = max(0.15, seg_end - seg_start)  # Minimum 150ms per segment
        chunk_dur = seg_dur / len(chunks)
        min_chunk_dur = 0.15  # Minimum 150ms per chunk

        for ci, chunk in enumerate(chunks):
            cs = seg_start + ci * chunk_dur
            ce = min(cs + max(min_chunk_dur, chunk_dur), seg_end)  # Clamp to segment end
            rs = max(0.0, cs - clip_start)
            re = max(rs + min_chunk_dur, min(seg_end - clip_start, ce - clip_start))
            
            # Skip if duration too short or timing invalid
            if re <= rs or (re - rs) < 0.08:
                continue

            # \q2 = no wrapping (prevents vertical one-glyph-per-line stacks)
            no_wrap = r"{\q2}"
            words = [w for w in chunk.split() if w]
            hi = _hex_to_ass_c(
                str(style.get("highlightColor") or style.get("textColor") or "#FFFFFF")
            )
            base_c = _hex_to_ass_c(str(style.get("textColor") or "#FFFFFF"))

            if animation == "word_pop":
                if not words:
                    continue
                # One emphatic word at a time — big pop + highlight fill.
                durs = _word_durations(max(0.08, re - rs), len(words), min_word=0.18)
                t = rs
                for w, dur in zip(words, durs):
                    ws, we = t, min(re, t + dur)
                    t = we
                    if we <= ws:
                        continue
                    lines.append(
                        f"Dialogue: 0,{_sec_to_ass(ws)},{_sec_to_ass(we)},Default,,0,0,0,,"
                        f"{no_wrap}{_pop_active_tags(hi, strong=True)}{_ass_escape(w)}"
                    )
                continue

            if animation in ("karaoke", "pop"):
                # Multi-word line: color steps word-by-word (engaging) + scale pop on active.
                # karaoke = accumulate highlights; pop = only the spoken word highlighted.
                if not words:
                    continue
                lines.extend(
                    _dialogue_word_steps(
                        words=words,
                        rs=rs,
                        re=re,
                        hi=hi,
                        base=base_c,
                        accumulate=(animation == "karaoke"),
                        pop_active=True,
                        strong_pop=(animation == "pop"),
                    )
                )
                continue

            prefix = no_wrap + _anim_prefix(animation)
            display = chunk
            if preset == "bold_yellow" or str(style.get("fontFamily")) == "Impact":
                # Only uppercase Latin — leave Indic/Arabic alone
                if not any("\u0900" <= ch <= "\u097F" or "\u0600" <= ch <= "\u06FF" for ch in chunk):
                    display = chunk.upper()
            lines.append(
                f"Dialogue: 0,{_sec_to_ass(rs)},{_sec_to_ass(re)},Default,,0,0,0,,"
                f"{prefix}{_ass_escape(display)}"
            )

    return "\n".join(lines)


def write_ass_file(
    path: Path,
    segments: list[TranscriptSegment],
    clip_start: float,
    clip_end: float,
    *,
    preset: str = "classic_white",
    language_hint: str = "en",
    caption_settings: dict[str, Any] | None = None,
) -> Path:
    content = build_ass_subtitles(
        segments,
        clip_start,
        clip_end,
        preset=preset,
        language_hint=language_hint,
        caption_settings=caption_settings,
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\ufeff" + content, encoding="utf-8")
    dialogue_n = sum(1 for line in content.splitlines() if line.startswith("Dialogue:"))
    logger.info(
        "Wrote ASS %s (%d dialogue lines, preset=%s, lang=%s)",
        path.name,
        dialogue_n,
        preset,
        language_hint,
    )
    if dialogue_n == 0:
        logger.warning("ASS has zero dialogue lines — captions will be blank")
    return path
