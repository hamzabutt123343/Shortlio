from pipeline.captions import (
    build_ass_subtitles,
    collapse_rolling_segments,
    resolve_caption_style,
)
from pipeline.render import validate_caption_filters
from pipeline.transcript import TranscriptSegment
from pathlib import Path


def test_settings_override_colors_and_position():
    style = resolve_caption_style(
        "classic_white",
        {
            "__mode": "finetune",
            "textColor": "#FF0000",
            "position": "top",
            "fontSize": 70,
            "animation": "karaoke",
        },
    )
    assert style["textColor"] == "#FF0000"
    assert style["position"] == "top"
    assert style["fontSize"] == 70
    assert style["animation"] == "karaoke"


def test_preset_mode_ignores_finetune_overrides():
    style = resolve_caption_style(
        "gaming_hype",
        {
            "__mode": "preset",
            "textColor": "#FF0000",
            "position": "top",
            "fontSize": 12,
        },
    )
    assert style["textColor"] == "#FFFFFF"
    assert style["highlightColor"] == "#00FF00"
    assert style["position"] == "center"
    assert style["animation"] == "word_pop"
    assert style["fontSize"] == 80


def test_ass_includes_settings_and_karaoke():
    segs = [
        TranscriptSegment(start=0.5, end=2.5, text="hello world from shortlio", language="en"),
    ]
    ass = build_ass_subtitles(
        segs,
        0.0,
        5.0,
        preset="classic_white",
        language_hint="en",
        caption_settings={
            "__mode": "finetune",
            "animation": "karaoke",
            "textColor": "#EEEEEE",
            "highlightColor": "#3DD6C6",
            "position": "center",
            "maxWordsPerCaption": 4,
        },
    )
    assert "Dialogue:" in ass
    # Karaoke: per-word \c color steps + scale pop on the active word
    assert r"\c&H" in ass
    assert r"\kf" not in ass
    assert r"\fscx" in ass
    assert "Alignment" in ass or "Style: Default" in ass
    dialogue_n = sum(1 for line in ass.splitlines() if line.startswith("Dialogue:"))
    assert dialogue_n >= 2  # one event per highlighted word step


def test_pop_animation_steps_colors_and_scale():
    segs = [TranscriptSegment(start=0.0, end=2.0, text="to open up", language="en")]
    ass = build_ass_subtitles(segs, 0.0, 3.0, preset="classic_white")
    dialogue = [l for l in ass.splitlines() if l.startswith("Dialogue:")]
    assert len(dialogue) >= 3  # one step per word
    assert all(r"\fscx" in l for l in dialogue)
    assert any(r"\c&H" in l for l in dialogue)


def test_hinglish_strips_devanagari():
    segs = [
        TranscriptSegment(start=1.0, end=3.0, text="यह पल बहुत खास है", language="hi"),
    ]
    ass = build_ass_subtitles(
        segs, 0.0, 5.0, preset="classic_white", language_hint="hinglish"
    )
    dialogue = "\n".join(l for l in ass.splitlines() if l.startswith("Dialogue:"))
    assert dialogue
    assert not any("\u0900" <= ch <= "\u097F" for ch in dialogue)


def test_burn_style_fade_tag():
    segs = [TranscriptSegment(start=0.0, end=2.0, text="fade me in", language="en")]
    ass = build_ass_subtitles(
        segs,
        0.0,
        3.0,
        preset="classic_white",
        caption_settings={"animation": "fade"},
    )
    assert r"\fad" in ass


def test_collapse_rolling_youtube_captions():
    # Typical stacked ASR: each cue overlaps and grows
    segs = [
        TranscriptSegment(0.0, 2.0, "aap", "hi"),
        TranscriptSegment(0.3, 2.2, "aap ke", "hi"),
        TranscriptSegment(0.6, 2.5, "aap ke paas", "hi"),
        TranscriptSegment(2.6, 3.5, "hai", "hi"),
    ]
    out = collapse_rolling_segments(segs)
    assert len(out) <= 3
    # No overlapping windows
    for a, b in zip(out, out[1:]):
        assert a.end <= b.start + 1e-6
    ass = build_ass_subtitles(segs, 0.0, 4.0, language_hint="hinglish")
    dialogue_count = sum(1 for line in ass.splitlines() if line.startswith("Dialogue:"))
    assert dialogue_count <= 8
    assert r"{\\r}" not in ass


def test_viral_word_pop_is_outline_not_box():
    """Gaming/viral styles must burn neon outline text, not a black rectangle."""
    segs = [TranscriptSegment(start=0.0, end=1.0, text="bro", language="en")]
    ass = build_ass_subtitles(segs, 0.0, 1.5, preset="gaming_hype")
    style_line = next(l for l in ass.splitlines() if l.startswith("Style: Default"))
    parts = style_line.split(",")
    assert parts[15] == "1"  # BorderStyle outline (not opaque box)
    assert int(parts[16]) >= 6  # thick outline (scaled for burn)
    # Shadow/back colour should be opaque black for drop-shadow (not a fill box).
    assert parts[6].upper().startswith("&H00")
    dialogue = "\n".join(l for l in ass.splitlines() if l.startswith("Dialogue:"))
    assert "bro" in dialogue
    assert r"\c&H00FF00&" in dialogue  # neon green highlight fill
    assert r"\fscx" in dialogue  # pop scale animation


def test_boxed_preset_still_uses_border_style_3():
    segs = [TranscriptSegment(start=0.0, end=2.0, text="to open up more", language="en")]
    ass = build_ass_subtitles(segs, 0.0, 3.0, preset="cinematic_box")
    style_line = next(l for l in ass.splitlines() if l.startswith("Style: Default"))
    parts = style_line.split(",")
    assert parts[15] == "3"


def test_capite_bounce_and_pos_tags():
    segs = [TranscriptSegment(start=0.0, end=2.0, text="move with bounce", language="en")]
    ass = build_ass_subtitles(segs, 0.0, 3.0, preset="bounce_pop")
    dialogue = [l for l in ass.splitlines() if l.startswith("Dialogue:")]
    assert dialogue
    assert any(r"\pos(" in l for l in dialogue)
    assert any(r"\t(0,50," in l for l in dialogue)


def test_capite_box_preset_uses_border_style_3():
    segs = [TranscriptSegment(start=0.0, end=1.5, text="hook line now", language="en")]
    ass = build_ass_subtitles(segs, 0.0, 2.0, preset="crimson_pop")
    style_line = next(l for l in ass.splitlines() if l.startswith("Style: Default"))
    parts = style_line.split(",")
    assert parts[15] == "3"
    # BackColour must be transparent (AA=FF) — opaque black baked a full-width bar.
    assert parts[6].upper().startswith("&HFF")
    dialogue = "\n".join(l for l in ass.splitlines() if l.startswith("Dialogue:"))
    assert r"\3a&H00&" in dialogue


def test_word_timestamps_drive_ass_timing():
    from pipeline.transcript import TranscriptWord

    segs = [
        TranscriptSegment(
            start=0.0,
            end=1.2,
            text="one two three",
            language="en",
            words=[
                TranscriptWord("one", 0.0, 0.3),
                TranscriptWord("two", 0.35, 0.7),
                TranscriptWord("three", 0.75, 1.2),
            ],
        )
    ]
    ass = build_ass_subtitles(segs, 0.0, 2.0, preset="hormozi")
    dialogue = [l for l in ass.splitlines() if l.startswith("Dialogue:")]
    assert len(dialogue) >= 3
    # First event should start near 0:00:00.00 (real stamp), not an even third of 1.2s
    assert "0:00:00.00" in dialogue[0] or "0:00:00.0" in dialogue[0]


def test_ass_reset_tag_is_single_backslash_r():
    """rf-string bug once emitted {\\\\r} which broke libass mid-line."""
    segs = [TranscriptSegment(start=0.0, end=2.0, text="small clips of", language="en")]
    ass = build_ass_subtitles(segs, 0.0, 3.0, preset="neon_accent")
    assert r"{\\r}" not in ass
    assert r"{\r}" in ass


def test_collapse_does_not_create_minute_long_cues():
    # Continuous overlapping rolls across a long monologue must NOT become one cue.
    segs = []
    words = "small clips of this long episode so that viewers stay hooked always".split()
    t = 0.0
    for i in range(len(words)):
        text = " ".join(words[: i + 1])
        segs.append(TranscriptSegment(start=t, end=t + 2.5, text=text, language="en"))
        t += 0.4
    out = collapse_rolling_segments(segs)
    assert out
    assert max(s.end - s.start for s in out) <= 5.5
    assert len(out) >= 2


def test_ass_lead_pulls_captions_realtime_vs_late_asr():
    """~150ms lead counters ASR lag so burns land with spoken audio."""
    segs = [TranscriptSegment(start=1.0, end=2.2, text="hello world", language="en")]
    ass = build_ass_subtitles(segs, 0.0, 3.0, preset="classic_white")
    dialogue = [l for l in ass.splitlines() if l.startswith("Dialogue:")]
    assert dialogue
    from pipeline.captions import _ass_to_sec

    start_sec = _ass_to_sec(dialogue[0].split(",")[1])
    assert 0.82 <= start_sec <= 0.90


def test_rolling_collapse_synthesizes_later_word_onsets():
    segs = [
        TranscriptSegment(0.0, 2.0, "aap", language="hi"),
        TranscriptSegment(0.4, 2.2, "aap ke", language="hi"),
        TranscriptSegment(0.9, 2.5, "aap ke paas", language="hi"),
    ]
    out = collapse_rolling_segments(segs)
    assert out
    words = out[0].words
    assert words is not None
    assert len(words) >= 3
    # Later words must not share the group's earliest start.
    assert words[-1].start >= words[0].start + 0.3


def test_json3_word_offsets_parsed():
    from pipeline.transcript import _parse_json3

    data = {
        "events": [
            {
                "tStartMs": 1000,
                "dDurationMs": 1500,
                "segs": [
                    {"utf8": "hello", "tOffsetMs": 0},
                    {"utf8": " ", "tOffsetMs": 0},
                    {"utf8": "world", "tOffsetMs": 400},
                ],
            }
        ]
    }
    segs = _parse_json3(data, language="en")
    assert len(segs) == 1
    assert segs[0].text.strip() == "hello world"
    assert segs[0].words is not None
    assert len(segs[0].words) == 2
    assert abs(segs[0].words[0].start - 1.0) < 1e-6
    assert abs(segs[0].words[1].start - 1.4) < 1e-6


def test_validate_caption_filters_rejects_duplicates(tmp_path: Path):
    ass = tmp_path / "subs.ass"
    ass.write_text(
        "[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,hi\n",
        encoding="utf-8",
    )
    vf_ok = "setpts=PTS-STARTPTS,scale=1080:1920,ass='subs.ass'"
    validate_caption_filters(burn_captions=True, ass_path=ass, vf=vf_ok)

    vf_dup = vf_ok + ",ass='subs2.ass'"
    try:
        validate_caption_filters(burn_captions=True, ass_path=ass, vf=vf_dup)
        raise AssertionError("expected duplicate ASS filter to fail")
    except RuntimeError as exc:
        assert "Duplicate" in str(exc)

    try:
        validate_caption_filters(burn_captions=False, ass_path=None, vf=vf_ok)
        raise AssertionError("expected burn=False with ASS filter to fail")
    except RuntimeError as exc:
        assert "burn_captions=False" in str(exc)
