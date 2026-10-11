from __future__ import annotations

import re
from pathlib import Path
from typing import Callable

from pipeline.transcript import TranscriptSegment

# Simple Hinglish romanization rules (editable map).
HINGLISH_MAP: dict[str, str] = {
    "kya": "kya",
    "nahi": "nahi",
    "haan": "haan",
    "bhai": "bhai",
    "yaar": "yaar",
    "matlab": "matlab",
    "bas": "bas",
    "achha": "achha",
    "theek": "theek",
}


def romanize_hinglish(text: str) -> str:
    """Light-touch romanization helper; extend HINGLISH_MAP as needed."""
    out = text
    for word, repl in HINGLISH_MAP.items():
        out = re.sub(rf"\b{word}\b", repl, out, flags=re.I)
    return out


def _sec_to_ass(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h:d}:{m:02d}:{s:05.2f}"


def _style_block(preset: str) -> tuple[str, Callable[[str], str]]:
    presets = {
        "classic_white": (
            "Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,30,30,40,1",
            lambda t: t,
        ),
        "bold_yellow": (
            "Style: Default,Impact,52,&H0000FFFF,&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,4,0,2,40,40,20,1",
            lambda t: t.upper(),
        ),
        "karaoke_highlight": (
            "Style: Default,Arial,46,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,2,35,35,30,1",
            lambda t: t,
        ),
        "word_by_word_pop": (
            "Style: Default,Montserrat,50,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,110,110,0,0,1,4,0,2,45,45,10,1",
            lambda t: t,
        ),
        "clean_minimal": (
            "Style: Default,Helvetica,42,&H00F0F0F0,&H000000FF,&H00000000,&H60000000,0,0,0,0,100,100,0,0,1,2,0,2,50,50,50,1",
            lambda t: t,
        ),
        "neon_accent": (
            "Style: Default,Arial Black,48,&H00FF6EC7,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,2,30,30,35,1",
            lambda t: t,
        ),
        "podcast_bold": (
            "Style: Default,Segoe UI,44,&H00FFFFFF,&H000000FF,&H00202020,&H90000000,-1,0,0,0,100,100,0,0,1,3,0,2,60,60,25,1",
            lambda t: t,
        ),
        "creator_style": (
            "Style: Default,Comic Sans MS,46,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,105,105,0,0,1,4,0,2,35,35,15,1",
            lambda t: t,
        ),
    }
    return presets.get(preset, presets["classic_white"])


def _segments_for_range(
    segments: list[TranscriptSegment],
    start: float,
    end: float,
) -> list[TranscriptSegment]:
    return [s for s in segments if s.end >= start and s.start <= end]


def build_ass_subtitles(
    segments: list[TranscriptSegment],
    clip_start: float,
    clip_end: float,
    *,
    preset: str = "classic_white",
    language_hint: str = "en",
) -> str:
    style_line, transform = _style_block(preset)
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{style_line}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header]
    rel_segments = _segments_for_range(segments, clip_start, clip_end)

    for seg in rel_segments:
        text = seg.text.strip()
        if language_hint.lower() in ("hi", "hinglish", "hi-en"):
            text = romanize_hinglish(text)
        text = transform(text).replace("\n", " ")
        if preset == "word_by_word_pop":
            words = text.split()
            if not words:
                continue
            dur = max(0.05, seg.end - seg.start)
            wdur = dur / len(words)
            for i, w in enumerate(words):
                ws = seg.start + i * wdur
                we = ws + wdur
                rs = max(clip_start, ws) - clip_start
                re = min(clip_end, we) - clip_start
                if re <= rs:
                    continue
                lines.append(
                    f"Dialogue: 0,{_sec_to_ass(rs)},{_sec_to_ass(re)},Default,,0,0,0,,{w.upper()}"
                )
            continue

        if preset == "karaoke_highlight":
            words = text.split()
            if words:
                k_text = " ".join(r"{\kf30}" + w for w in words)
                text = k_text

        rs = max(clip_start, seg.start) - clip_start
        re = min(clip_end, seg.end) - clip_start
        if re <= rs:
            continue
        lines.append(
            f"Dialogue: 0,{_sec_to_ass(rs)},{_sec_to_ass(re)},Default,,0,0,0,,{text}"
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
) -> Path:
    content = build_ass_subtitles(
        segments,
        clip_start,
        clip_end,
        preset=preset,
        language_hint=language_hint,
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path
