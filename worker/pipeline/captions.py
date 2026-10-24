from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

from pipeline.ass_animations import active_word_override, pos_tag
from pipeline.hinglish import to_hinglish
from pipeline.transcript import TranscriptSegment, TranscriptWord

logger = logging.getLogger(__name__)

# Capite-sourced presets (MIT) — keep IDs snake_case for Shortlio storage.

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
    # --- Capite-adapted presets (MIT, Capite Contributors) ---
    "hormozi": {
        "fontFamily": "Montserrat",
        "fontSize": 78,
        "fontWeight": 900,
        "textColor": "#FFFFFF",
        "highlightColor": "#00FFFF",
        "outlineColor": "#000000",
        "outlineWidth": 5,
        "backgroundColor": "#000000",
        "backgroundOpacity": 0.0,
        "shadow": True,
        "position": "center",
        "maxWordsPerCaption": 3,
        "animation": "highlight",
    },
    "mrbeast": {
        "fontFamily": "Anton",
        "fontSize": 88,
        "fontWeight": 900,
        "textColor": "#FFFF00",
        "highlightColor": "#FF6600",
        "outlineColor": "#000000",
        "outlineWidth": 8,
        "backgroundColor": "#000000",
        "backgroundOpacity": 0.0,
        "shadow": True,
        "position": "center",
        "maxWordsPerCaption": 3,
        "animation": "highlight",
    },
    "crimson_pop": {
        "fontFamily": "Montserrat",
        "fontSize": 78,
        "fontWeight": 900,
        "textColor": "#FFFFFF",
        "highlightColor": "#E11D48",
        "outlineColor": "#000000",
        "outlineWidth": 8,
        "backgroundColor": "#E11D48",
        "backgroundOpacity": 0.0,
        "shadow": False,
        "position": "center",
        "maxWordsPerCaption": 3,
        "animation": "box",
    },
    "bounce_pop": {
        "fontFamily": "Poppins",
        "fontSize": 74,
        "fontWeight": 900,
        "textColor": "#FFFFFF",
        "highlightColor": "#FF4D6D",
        "outlineColor": "#000000",
        "outlineWidth": 5,
        "backgroundColor": "#000000",
        "backgroundOpacity": 0.0,
        "shadow": True,
        "position": "center",
        "maxWordsPerCaption": 3,
        "animation": "bounce",
    },
    "neon_glow": {
        "fontFamily": "Montserrat",
        "fontSize": 72,
        "fontWeight": 800,
        "textColor": "#E0E7FF",
        "highlightColor": "#22D3EE",
        "outlineColor": "#0F172A",
        "outlineWidth": 4,
        "backgroundColor": "#000000",
        "backgroundOpacity": 0.0,
        "shadow": True,
        "position": "center",
        "maxWordsPerCaption": 3,
        "animation": "glow",
    },
    "scale_clean": {
        "fontFamily": "Inter",
        "fontSize": 64,
        "fontWeight": 700,
        "textColor": "#F8FAFC",
        "highlightColor": "#FFFFFF",
        "outlineColor": "#0F172A",
        "outlineWidth": 3,
        "backgroundColor": "#000000",
        "backgroundOpacity": 0.0,
        "shadow": True,
        "position": "center",
        "maxWordsPerCaption": 4,
        "animation": "scale",
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


def _ass_to_sec(ts: str) -> float:
    """Parse ASS H:MM:SS.cc (or H:MM:SS.xx) into seconds."""
    parts = ts.strip().split(":")
    if len(parts) != 3:
        return 0.0
    try:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    except ValueError:
        return 0.0


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
    # Capite "box" animation: BorderStyle 3 with transparent default outline so only
    # the active word paints a pill (via \\3a&H00& override). Classic boxed presets
    # still use opacity >= 0.4 for full-line opaque boxes.
    word_box = animation == "box"
    boxed = (not word_box) and bg_opacity >= 0.4
    border_style = 3 if (boxed or word_box) else 1
    if word_box:
        # Capite pill: BorderStyle 3, but BackColour must be fully transparent
        # (ASS AA=FF). alpha=0 in _hex_to_ass_bgr means opaque — that baked a
        # full-width black bar into crimson/box burns.
        r, g, b = _parse_hex_rgb(highlight)
        outline_c = f"&HFF{b:02X}{g:02X}{r:02X}"
        back = "&HFF000000"
        outline = max(outline, int(round(8 * _ASS_OUTLINE_SCALE)))
        shadow = 0
    elif boxed:
        # Opaque box fill; Outline becomes box padding thickness.
        back = _hex_to_ass_bgr(str(style.get("backgroundColor") or "#000000"), alpha=bg_opacity)
        outline = max(outline, 10)  # readable padding around glyphs
        shadow = 0
    else:
        # Shadow colour (not a box). Keep fully opaque so drop-shadow reads cleanly.
        back = _hex_to_ass_bgr("#000000", alpha=1.0)
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
    anim = "word_pop" if strong else "pop"
    return "{" + active_word_override(anim, highlight_ass_c=color) + "}"


# CapCut / OpusClip style: punchy karaoke locked to spoken pace (~180 WPM).
_SPEECH_WORD_SEC = 0.28
_MIN_WORD_SEC = 0.10
_MAX_WORD_SEC = 0.40
_LAST_WORD_HOLD = 0.18  # brief linger, then next phrase (not sticky)


def _word_durations(total: float, n: int, *, min_word: float = _MIN_WORD_SEC) -> list[float]:
    """Split a cue across words with CapCut-like clamps (snappy, not crawl)."""
    if n <= 0:
        return []
    if n == 1:
        return [max(min_word, min(total, _MAX_WORD_SEC + _LAST_WORD_HOLD))]
    ideal = total / n
    if ideal >= min_word:
        each = max(min_word, min(_MAX_WORD_SEC, ideal))
        if each * n <= total + 1e-6:
            durs = [each] * n
            leftover = total - each * n
            if leftover > 0:
                durs[-1] = min(durs[-1] + min(leftover, _LAST_WORD_HOLD), total)
            return durs
        return [ideal] * n
    each = max(0.08, total / n)
    return [each] * n


def _word_timings(
    words: list[str],
    rs: float,
    re: float,
    word_times: list[tuple[float, float]] | None = None,
) -> list[tuple[float, float]]:
    """CapCut/OpusClip karaoke: realtime with speech, snappy handoff."""
    if word_times and len(word_times) == len(words):
        out: list[tuple[float, float]] = []
        for i, (ws, we) in enumerate(word_times):
            # Stamps are already lag-compensated by _relative_word_times / synthesize.
            start = max(rs, float(ws))
            if i < len(word_times) - 1:
                end = min(re, max(start + 0.04, float(word_times[i + 1][0]) - 0.01))
            else:
                spoken = max(float(we), start + _MIN_WORD_SEC)
                end = min(re, spoken + _LAST_WORD_HOLD)
            if end <= start:
                end = min(re, start + _MIN_WORD_SEC)
            out.append((start, end))
        return out

    n = len(words)
    if n <= 0:
        return []
    total = max(0.08, re - rs)
    natural = n * _SPEECH_WORD_SEC + _LAST_WORD_HOLD

    if total <= natural * 1.15:
        # Window matches speech — distribute evenly (clamped).
        durs = _word_durations(total, n)
    else:
        # Silence tail — pack at speech rate; don't crawl through dead air.
        durs = [_SPEECH_WORD_SEC] * n
        durs[-1] = _SPEECH_WORD_SEC + _LAST_WORD_HOLD

    t = rs
    out: list[tuple[float, float]] = []
    for i, dur in enumerate(durs):
        ws = t
        we = min(re, t + dur)
        if i == n - 1:
            # Brief hold only — CapCut does not pin the last word across silence.
            we = min(re, max(we, ws + _MIN_WORD_SEC), ws + _MAX_WORD_SEC + _LAST_WORD_HOLD)
        if we <= ws:
            we = min(re, ws + _MIN_WORD_SEC)
        out.append((ws, we))
        t = we
    return out


def _relative_word_times(
    seg: TranscriptSegment,
    chunk_words: list[str],
    clip_start: float,
    rs: float,
    re: float,
) -> list[tuple[float, float]] | None:
    """Map segment word stamps onto the current chunk when counts align."""
    raw = getattr(seg, "words", None) or []
    if not raw or not chunk_words:
        return None
    # Flatten whisper words → (rel_start, rel_end, token)
    stamped: list[tuple[float, float, str]] = []
    for w in raw:
        token = str(getattr(w, "word", None) or (w.get("word") if isinstance(w, dict) else "") or "").strip()
        if not token:
            continue
        try:
            ws = float(getattr(w, "start", None) if not isinstance(w, dict) else w["start"])
            we = float(getattr(w, "end", None) if not isinstance(w, dict) else w["end"])
        except (KeyError, TypeError, ValueError):
            continue
        # Pull forward vs clip so karaoke lands with the spoken audio.
        stamped.append(
            (
                max(0.0, _pull_forward(ws - clip_start)),
                max(0.0, _pull_forward(we - clip_start)),
                token,
            )
        )
    if not stamped:
        return None
    # If the cue is a multi-chunk slice, try to locate this chunk as a contiguous run.
    tokens = [t for _, _, t in stamped]
    n = len(chunk_words)
    for start_i in range(0, len(tokens) - n + 1):
        window = tokens[start_i : start_i + n]
        if [a.lower().strip(".,!?") for a in window] == [
            b.lower().strip(".,!?") for b in chunk_words
        ]:
            return [
                (max(rs, stamped[start_i + i][0]), min(re, stamped[start_i + i][1]))
                for i in range(n)
            ]
    # Single-chunk segments: use stamps when lengths match.
    if len(stamped) == n:
        return [(max(rs, s), min(re, e)) for s, e, _ in stamped]
    return None


def _dialogue_word_steps(
    *,
    words: list[str],
    rs: float,
    re: float,
    hi: str,
    base: str,
    animation: str,
    position: str = "center",
    accumulate: bool | None = None,
    word_times: list[tuple[float, float]] | None = None,
) -> list[str]:
    """Emit one ASS dialogue event per word step (Capite-style full-line rewrite)."""
    anim = (animation or "highlight").lower()
    if accumulate is None:
        accumulate = anim in ("karaoke", "highlight")
    # Capite karaoke wipe uses \\kf on the active word only.
    wipe = anim == "karaoke_wipe"
    out: list[str] = []
    timings = _word_timings(words, rs, re, word_times)
    anchor = pos_tag(position)
    no_wrap = r"{\q2}"
    for i, (ws, we) in enumerate(timings):
        if we <= ws:
            continue
        parts: list[str] = []
        for j, w in enumerate(words):
            is_active = j == i
            lit = (j <= i) if accumulate else is_active
            if is_active:
                if wipe:
                    duration_cs = max(3, int(round((we - ws) * 100)))
                    tags = f"\\kf{duration_cs}\\c{hi}"
                else:
                    # karaoke/highlight: Capite color step + mild Capite pop on the spoken word
                    engine = (
                        "pop"
                        if anim in ("karaoke", "highlight")
                        else ("word_pop" if anim == "word_pop" else anim)
                    )
                    tags = active_word_override(
                        engine,
                        highlight_ass_c=hi,
                        primary_ass_c=base,
                        box_ass_c=hi,
                    )
                # Use plain f-strings (not rf-) so {\\r} becomes the ASS reset tag {\r}.
                parts.append(f"{{{tags}}}{_ass_escape(w)}{{\\r}}")
            elif lit and accumulate:
                parts.append(f"{{\\c{hi}\\fscx100\\fscy100}}{_ass_escape(w)}{{\\r}}")
            else:
                parts.append(f"{{\\c{base}\\fscx100\\fscy100}}{_ass_escape(w)}{{\\r}}")
        # Capite: prepend \\pos so overlapping word events never stack vertically.
        text = f"{{{anchor}}}{no_wrap}{' '.join(parts)}"
        out.append(
            f"Dialogue: 0,{_sec_to_ass(ws)},{_sec_to_ass(we)},Default,,0,0,0,,{text}"
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


def _token_words(text: str) -> list[str]:
    return _norm_caption_text(text).lower().split()


def _is_rolling_extension(prev: str, nxt: str) -> bool:
    """True when nxt is a YouTube/ASR rolling update of prev (grow or slide)."""
    p, n = _token_words(prev), _token_words(nxt)
    if not p or not n:
        return False
    # Growing roll: "small clips" → "small clips of"
    if len(n) >= len(p) and n[: len(p)] == p:
        return True
    # Sliding window: "small clips of this" → "clips of this long"
    max_k = min(len(p), len(n), 8)
    for k in range(max_k, 1, -1):
        if p[-k:] == n[:k]:
            return True
    return False


# CapCut-style short lines — don't freeze a whole monologue as one cue.
_MAX_ROLL_DURATION = 2.8
# YouTube/rolling ASR is typically late vs audio. Pull captions forward so they
# land as the person speaks (CapCut/OpusClip realtime feel).
_CAPTION_LEAD = 0.15


def _speech_paced_end(start: float, text: str, raw_end: float) -> float:
    """End near spoken length — snappy like CapCut, not sticky."""
    n = max(1, len(_token_words(text)))
    paced = start + n * _SPEECH_WORD_SEC + _LAST_WORD_HOLD
    soft_cap = paced + 0.22
    return max(start + 0.22, min(raw_end, soft_cap, start + _MAX_ROLL_DURATION))


def _pull_forward(t: float, *, floor: float = 0.0) -> float:
    """Shift a timestamp earlier by ASR lag compensation."""
    return max(floor, float(t) - _CAPTION_LEAD)


def _words_from_seg(seg: TranscriptSegment) -> list[TranscriptWord] | None:
    raw = getattr(seg, "words", None) or []
    if not raw:
        return None
    out: list[TranscriptWord] = []
    for w in raw:
        if isinstance(w, TranscriptWord):
            token = (w.word or "").strip()
            if token:
                out.append(w)
            continue
        if isinstance(w, dict):
            token = str(w.get("word") or w.get("text") or "").strip()
            if not token:
                continue
            try:
                out.append(
                    TranscriptWord(
                        word=token,
                        start=float(w["start"]),
                        end=float(w["end"]),
                    )
                )
            except (KeyError, TypeError, ValueError):
                continue
    return out or None


def _synthesize_roll_words(
    roll_steps: list[tuple[float, float, str]],
) -> list[TranscriptWord] | None:
    """Infer word onset times from YouTube rolling ASR updates.

    Each rolling cue typically adds one or more new trailing words. Using the
    cue's start as those words' onset keeps karaoke aligned without Whisper.
    """
    if not roll_steps:
        return None
    stamped: list[TranscriptWord] = []
    prev_tokens: list[str] = []
    for start, _end, text in roll_steps:
        tokens = _norm_caption_text(text).split()
        if not tokens:
            continue
        if not prev_tokens:
            # First cue: distribute across a short window if no stamps.
            if len(tokens) == 1:
                stamped.append(
                    TranscriptWord(word=tokens[0], start=start, end=start + _SPEECH_WORD_SEC)
                )
            else:
                t = start
                for tok in tokens:
                    stamped.append(
                        TranscriptWord(word=tok, start=t, end=t + _SPEECH_WORD_SEC)
                    )
                    t += _SPEECH_WORD_SEC
            prev_tokens = tokens
            continue
        # Growing roll: new trailing words appear at this cue's start.
        if len(tokens) >= len(prev_tokens) and [
            x.lower() for x in tokens[: len(prev_tokens)]
        ] == [x.lower() for x in prev_tokens]:
            for tok in tokens[len(prev_tokens) :]:
                stamped.append(
                    TranscriptWord(
                        word=tok,
                        start=start,
                        end=start + _SPEECH_WORD_SEC,
                    )
                )
            prev_tokens = tokens
            continue
        # Sliding window: find overlap and append only novel tokens.
        max_k = min(len(prev_tokens), len(tokens), 8)
        overlap = 0
        for k in range(max_k, 0, -1):
            if [x.lower() for x in prev_tokens[-k:]] == [
                x.lower() for x in tokens[:k]
            ]:
                overlap = k
                break
        novel = tokens[overlap:]
        # Drop words that slid out of the window from stamped prefix.
        drop = max(0, len(prev_tokens) - overlap)
        if drop and stamped:
            stamped = stamped[drop:]
        for tok in novel:
            stamped.append(
                TranscriptWord(word=tok, start=start, end=start + _SPEECH_WORD_SEC)
            )
        prev_tokens = tokens
    if not stamped:
        return None
    # Rolling ASR updates arrive after the word was spoken — pull onsets forward.
    stamped = [
        TranscriptWord(
            word=w.word,
            start=_pull_forward(w.start),
            end=max(_pull_forward(w.start) + 0.05, _pull_forward(w.end)),
        )
        for w in stamped
    ]
    # Chain ends to next word start for continuous karaoke.
    for i in range(len(stamped) - 1):
        nxt = stamped[i + 1].start
        stamped[i] = TranscriptWord(
            word=stamped[i].word,
            start=stamped[i].start,
            end=max(stamped[i].start + 0.05, min(stamped[i].end, nxt)),
        )
    return stamped


def collapse_rolling_segments(
    segments: list[TranscriptSegment],
) -> list[TranscriptSegment]:
    """Collapse YouTube-style rolling/overlapping cues into non-overlapping lines.

    ASR captions often stack many short overlapping events (each adding a word).
    Burning them all causes ghosted/stacked text like the 'aapake' bug.

    Only merge when the next cue is a rolling extension of the current text, and
    never let a merged group exceed ``_MAX_ROLL_DURATION`` — otherwise an entire
    monologue collapses into one mega-cue and captions freeze for seconds.

    While merging, synthesize word onset times from each roll step so later words
    do not appear at the group's earliest start (the main early-caption cause).
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
        words=_words_from_seg(ordered[0]),
    )
    roll_steps: list[tuple[float, float, str]] = [
        (ordered[0].start, ordered[0].end, cur.text)
    ]

    def _finalize_cur() -> TranscriptSegment:
        # Rolling ASR: synthesize onsets from each update (more accurate than even-split).
        words = (
            _synthesize_roll_words(roll_steps)
            if len(roll_steps) >= 2
            else _words_from_seg(cur)
        )
        if words is None:
            words = _words_from_seg(cur)
        # When we have word stamps, start at first word — never earlier than speech.
        start = cur.start
        end = cur.end
        if words:
            start = max(start, min(w.start for w in words))
            end = max(end, max(w.end for w in words))
        end = _speech_paced_end(start, cur.text, end)
        return TranscriptSegment(
            start=start,
            end=end,
            text=cur.text,
            speaker=cur.speaker,
            language=cur.language,
            words=words,
        )

    def _flush_and_start(seg: TranscriptSegment, text: str) -> TranscriptSegment:
        groups.append(_finalize_cur())
        # Prefer the real speech start; only push forward if the prior cue still overlaps.
        prior_end = groups[-1].end
        start = float(seg.start)
        if start < prior_end:
            start = prior_end
        return TranscriptSegment(
            start=start,
            end=_speech_paced_end(start, text, max(float(seg.end), start + 0.08)),
            text=text,
            speaker=seg.speaker,
            language=seg.language,
            words=_words_from_seg(seg),
        )

    for seg in ordered[1:]:
        text = _norm_caption_text(seg.text)
        overlaps = seg.start < cur.end
        roll = overlaps and _is_rolling_extension(cur.text, text)
        # Use spoken length (not raw ASR end stamps) — YouTube cues often span 2–3s
        # even for one new word, which falsely tripped the roll-duration cap.
        candidate_text = text if roll else cur.text
        would_be_long = (
            len(_token_words(candidate_text)) * _SPEECH_WORD_SEC + _LAST_WORD_HOLD
        ) > _MAX_ROLL_DURATION

        if overlaps and roll and not would_be_long:
            use_text = text if len(text) >= len(cur.text) else cur.text
            if _is_rolling_extension(cur.text, text) and len(text) >= len(cur.text) - 8:
                use_text = text
            # Keep the source end while rolling so later updates still overlap.
            # Speech-pacing happens only in _finalize_cur.
            raw_end = max(cur.end, float(seg.end), cur.start + 0.08)
            next_words = _words_from_seg(seg)
            roll_steps.append((float(seg.start), float(seg.end), use_text))
            cur = TranscriptSegment(
                start=cur.start,
                end=raw_end,
                text=use_text,
                speaker=seg.speaker or cur.speaker,
                language=seg.language or cur.language,
                words=next_words or cur.words,
            )
        else:
            cur = _flush_and_start(seg, text)
            roll_steps = [(float(cur.start), float(cur.end), text)]

    groups.append(_finalize_cur())

    # Enforce non-overlap + drop 1-char Indic leftovers
    clean: list[TranscriptSegment] = []
    for seg in groups:
        words = _words_from_seg(seg)
        if clean and seg.start < clean[-1].end:
            shift = clean[-1].end - seg.start
            if words:
                words = [
                    TranscriptWord(word=w.word, start=w.start + shift, end=w.end + shift)
                    for w in words
                ]
            seg = TranscriptSegment(
                start=clean[-1].end,
                end=max(clean[-1].end + 0.06, seg.end + shift),
                text=seg.text,
                speaker=seg.speaker,
                language=seg.language,
                words=words,
            )
        if seg.end <= seg.start:
            continue
        if len(seg.text.strip()) <= 1:
            continue
        end = seg.end
        if not _words_from_seg(seg):
            end = _speech_paced_end(seg.start, seg.text, seg.end)
        if end <= seg.start:
            continue
        clean.append(
            TranscriptSegment(
                start=seg.start,
                end=end,
                text=seg.text,
                speaker=seg.speaker,
                language=seg.language,
                words=_words_from_seg(seg),
            )
        )
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
    # Exact sync — never pull captions earlier than transcript timestamps.
    lead = _CAPTION_LEAD

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

    # Clip-relative cursor so lead never stacks overlapping dialogue events.
    next_ok = 0.0

    def _emit(dialogue_lines: list[str]) -> None:
        nonlocal next_ok
        for raw in dialogue_lines:
            # Dialogue: 0,start,end,Default,...
            parts = raw.split(",", 9)
            if len(parts) < 10 or not parts[0].startswith("Dialogue:"):
                lines.append(raw)
                continue
            ws = _ass_to_sec(parts[1])
            we = _ass_to_sec(parts[2])
            if we <= next_ok:
                continue
            if ws < next_ok:
                ws = next_ok
            if we <= ws:
                we = ws + _MIN_WORD_SEC
            parts[1] = _sec_to_ass(ws)
            parts[2] = _sec_to_ass(we)
            lines.append(",".join(parts))
            next_ok = we

    for seg in rel_segments:
        text = _prepare_caption_text(seg.text, language_hint)
        if not text:
            continue
        chunks = _chunk_words(text, max_words)
        if not chunks:
            continue

        seg_words = _words_from_seg(seg)
        seg_end = min(clip_end, seg.end)
        # Always pull the cue start forward vs late ASR — never re-lock to raw w0.
        if seg_words:
            w0 = min(w.start for w in seg_words)
            w1 = max(w.end for w in seg_words)
            seg_start = max(clip_start, _pull_forward(w0, floor=clip_start))
            seg_end = max(
                seg_start + 0.08,
                min(clip_end, _pull_forward(w1, floor=seg_start) + _LAST_WORD_HOLD),
            )
        else:
            seg_start = max(clip_start, _pull_forward(seg.start, floor=clip_start))
            n_words = max(1, len(text.split()))
            paced = n_words * _SPEECH_WORD_SEC + _LAST_WORD_HOLD
            seg_end = min(seg_end, max(seg_start + 0.22, seg_start + paced))
        seg_dur = max(0.15, seg_end - seg_start)

        # CapCut/Opus: each phrase is speech-timed; next phrase follows immediately.
        chunk_word_counts = [max(1, len(c.split())) for c in chunks]
        t_cursor = seg_start

        for ci, chunk in enumerate(chunks):
            natural_chunk = chunk_word_counts[ci] * _SPEECH_WORD_SEC + (
                _LAST_WORD_HOLD if ci == len(chunks) - 1 else 0.04
            )
            remaining = max(0.15, seg_end - t_cursor)
            # Prefer spoken length — never stretch a phrase across dead air.
            chunk_dur = min(remaining, max(0.15, natural_chunk))
            cs = t_cursor
            ce = min(seg_end, cs + chunk_dur)
            t_cursor = ce
            rs = max(0.0, cs - clip_start)
            re = max(rs + 0.12, min(seg_end - clip_start, ce - clip_start))

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
            position = str(style.get("position") or "center")
            # Prefer whisper word timestamps when present on the segment.
            word_times = _relative_word_times(seg, words, clip_start, rs, re)

            if animation == "word_pop":
                if not words:
                    continue
                # One emphatic word at a time — big pop + highlight fill.
                timings = _word_timings(words, rs, re, word_times)
                anchor = pos_tag(position)
                batch: list[str] = []
                for w, (ws, we) in zip(words, timings):
                    if we <= ws:
                        continue
                    batch.append(
                        f"Dialogue: 0,{_sec_to_ass(ws)},{_sec_to_ass(we)},Default,,0,0,0,,"
                        f"{{{anchor}}}{no_wrap}{_pop_active_tags(hi, strong=True)}{_ass_escape(w)}"
                    )
                _emit(batch)
                continue

            # Capite engines + Shortlio karaoke/pop: full-line rewrite per spoken word.
            if animation in (
                "karaoke",
                "pop",
                "highlight",
                "bounce",
                "glow",
                "scale",
                "box",
                "karaoke_wipe",
            ):
                if not words:
                    continue
                _emit(
                    _dialogue_word_steps(
                        words=words,
                        rs=rs,
                        re=re,
                        hi=hi,
                        base=base_c,
                        animation=animation,
                        position=position,
                        accumulate=(animation in ("karaoke", "highlight")),
                        word_times=word_times,
                    )
                )
                continue

            prefix = "{" + pos_tag(position) + "}" + no_wrap + _anim_prefix(animation)
            display = chunk
            if preset == "bold_yellow" or str(style.get("fontFamily")) == "Impact":
                # Only uppercase Latin — leave Indic/Arabic alone
                if not any("\u0900" <= ch <= "\u097F" or "\u0600" <= ch <= "\u06FF" for ch in chunk):
                    display = chunk.upper()
            _emit(
                [
                    f"Dialogue: 0,{_sec_to_ass(rs)},{_sec_to_ass(re)},Default,,0,0,0,,"
                    f"{prefix}{_ass_escape(display)}"
                ]
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
