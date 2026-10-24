"""Unit tests for Capite-adapted ASS animation tag helpers."""
from pipeline.ass_animations import active_word_override, playres_pos, pos_tag


def test_bounce_and_glow_tags():
    bounce = active_word_override("bounce", highlight_ass_c="&H0000FF&")
    assert r"\t(0,50," in bounce
    assert r"\c&H0000FF&" in bounce
    glow = active_word_override("glow", highlight_ass_c="&H00FFFF&")
    assert r"\blur4" in glow


def test_box_tag_enables_outline_alpha():
    tags = active_word_override(
        "box",
        highlight_ass_c="&H481DE1&",
        primary_ass_c="&HFFFFFF&",
        box_ass_c="&H481DE1&",
    )
    assert r"\3a&H00&" in tags
    assert r"\3c&H481DE1&" in tags


def test_pos_anchor_by_position():
    assert pos_tag("center").startswith(r"\pos(540,")
    top = playres_pos("top")
    bottom = playres_pos("bottom")
    assert top[1] < bottom[1]
