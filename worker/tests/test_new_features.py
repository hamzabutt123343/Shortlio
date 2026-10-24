"""Manual test for new caption presets and translation."""
from pipeline.captions import resolve_caption_style, build_ass_subtitles, _PRESET_STYLES
from pipeline.translate import translate_segments
from pipeline.transcript import TranscriptSegment


def test_new_presets():
    """Verify new presets are defined."""
    expected = {
        "classic_white",
        "bold_yellow",
        "karaoke_highlight",
        "word_by_word_pop",
        "clean_minimal",
        "neon_accent",
        "podcast_bold",
        "creator_style",
        "cinematic_box",
        "gaming_hype",
        "typewriter",
        # Capite-adapted
        "hormozi",
        "mrbeast",
        "crimson_pop",
        "bounce_pop",
        "neon_glow",
        "scale_clean",
    }
    actual = set(_PRESET_STYLES.keys())
    assert actual == expected, f"Presets mismatch: {actual ^ expected}"
    print(f"[OK] All {len(expected)} presets defined")


def test_preset_resolution():
    """Verify new presets can be resolved."""
    for preset_id in ["cinematic_box", "gaming_hype", "typewriter"]:
        style = resolve_caption_style(preset_id)
        assert style["fontFamily"], f"{preset_id} missing fontFamily"
        assert style["fontSize"] > 0, f"{preset_id} invalid fontSize"
        print(f"[OK] {preset_id}: {style['fontFamily']}")


def test_translation_passthrough():
    """Verify translation module basic functionality."""
    segments = [
        TranscriptSegment(0.0, 2.0, "Hello world", language="en"),
        TranscriptSegment(2.0, 4.0, "This is a test", language="en"),
    ]
    
    # Same language = passthrough
    result = translate_segments(segments, "en")
    assert len(result) == 2
    assert result[0].text == "Hello world"
    print("[OK] Translation passthrough works")


def test_hinglish_conversion():
    """Verify Hinglish conversion in translation."""
    segments = [
        TranscriptSegment(0.0, 2.0, "Hello world", language="en"),
    ]
    
    # English -> Hinglish should preserve text (it's already Latin)
    result = translate_segments(segments, "hinglish")
    assert len(result) == 1
    assert result[0].language == "hinglish"
    print("[OK] Hinglish language marking works")


def test_new_presets_in_ass():
    """Verify new presets work in ASS generation."""
    segments = [
        TranscriptSegment(0.0, 2.0, "Testing new preset", language="en"),
    ]
    
    for preset_id in ["cinematic_box", "gaming_hype", "typewriter"]:
        ass = build_ass_subtitles(
            segments,
            0.0,
            3.0,
            preset=preset_id,
            language_hint="en",
        )
        assert "Dialogue:" in ass, f"{preset_id} ASS has no dialogue"
        print(f"[OK] {preset_id} generates valid ASS")


if __name__ == "__main__":
    test_new_presets()
    test_preset_resolution()
    test_translation_passthrough()
    test_hinglish_conversion()
    test_new_presets_in_ass()
    print("\n[PASS] All manual tests passed!")

