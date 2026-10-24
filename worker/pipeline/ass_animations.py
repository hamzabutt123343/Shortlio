"""ASS per-word animation tags adapted from Capite (MIT).

Source: https://github.com/muneebkhan08/Capite — backend/subtitles.py
Copyright (c) 2026 Capite Contributors

Shortlio keeps its own ASS string builder, Hinglish prep, and rolling-segment
collapse; this module only reuses Capite's override-tag strategies so preview
and burn share the same motion vocabulary (highlight, karaoke wipe, scale,
bounce, pop, glow, box).
"""

from __future__ import annotations


def active_word_override(
    animation: str,
    *,
    highlight_ass_c: str,
    primary_ass_c: str | None = None,
    box_ass_c: str | None = None,
    font_scale: float = 1.0,
) -> str:
    """Return ASS override tags for the currently spoken word (no braces)."""
    anim = (animation or "highlight").lower().replace("-", "_")
    color = highlight_ass_c
    primary = primary_ass_c or color
    box = box_ass_c or color

    if anim in ("box",):
        pop_pct = 106 if font_scale >= 1.0 else 103
        return (
            f"\\3a&H00&\\3c{box}\\1c{primary}"
            f"\\t(0,40,\\fscx{pop_pct}\\fscy{pop_pct})"
            f"\\t(40,90,\\fscx100\\fscy100)"
        )
    if anim == "karaoke_wipe":
        # Caller supplies duration via \\kf separately when using wipe mode.
        return f"\\c{color}"
    if anim == "scale":
        return f"\\fscx110\\fscy110\\c{color}"
    if anim == "bounce":
        bounce_pct = 120 if font_scale >= 1.0 else 112
        return (
            f"\\t(0,50,\\fscx{bounce_pct}\\fscy{bounce_pct})"
            f"\\t(50,100,\\fscx100\\fscy100)"
            f"\\c{color}"
        )
    if anim == "pop":
        pop_pct = 115 if font_scale >= 1.0 else 108
        return (
            f"\\t(0,40,\\fscx{pop_pct}\\fscy{pop_pct})"
            f"\\t(40,90,\\fscx100\\fscy100)"
            f"\\c{color}"
        )
    if anim in ("pop_strong", "word_pop"):
        # Shortlio viral overshoot (stronger than Capite's 115%).
        return f"\\c{color}\\fscx165\\fscy165\\t(0,220,\\fscx100\\fscy100)"
    if anim == "glow":
        return f"\\blur4\\c{color}"
    if anim in ("highlight", "karaoke"):
        return f"\\c{color}"
    # fade / none / unknown — still tint active word for readability
    return f"\\c{color}"


def playres_pos(position: str, *, play_res_x: int = 1080, play_res_y: int = 1920) -> tuple[int, int]:
    """Fixed \\pos anchor (disables libass collision stacking). Capite pattern."""
    x = play_res_x // 2
    pos = (position or "bottom").lower()
    if pos == "top":
        # ~7% from top
        y = int(play_res_y * 0.07)
    elif pos == "center":
        # Slightly below true center (mouth/chin clearance)
        y = int(play_res_y * 0.55)
    else:
        # ~12% from bottom
        y = play_res_y - int(play_res_y * 0.12)
    return x, y


def pos_tag(position: str, *, play_res_x: int = 1080, play_res_y: int = 1920) -> str:
    x, y = playres_pos(position, play_res_x=play_res_x, play_res_y=play_res_y)
    return f"\\pos({x},{y})"
