import pytest

from pipeline.translate import TranslationError, translate_segments, translate_text_simple
from pipeline.transcript import TranscriptSegment


def test_hinglish_from_hindi_romanizes():
    out = translate_text_simple("यह अच्छा है", "hi", "hinglish")
    assert "hai" in out.lower()
    assert not any("\u0900" <= ch <= "\u097F" for ch in out)


def test_hinglish_from_english_preserves_words():
    text = "to open up more packs"
    assert translate_text_simple(text, "en", "hinglish") == text


def test_hinglish_mixed_preserves_english_names():
    text = "IShowSpeed ne bola yeh moment viral hai"
    assert translate_text_simple(text, "en", "hinglish") == text


def test_unsupported_language_raises():
    with pytest.raises(TranslationError):
        translate_text_simple("Hello world", "en", "hi", strict=True)


def test_translate_segments_marks_hinglish():
    segs = [
        TranscriptSegment(0.0, 2.0, "यह पल खास है", language="hi"),
        TranscriptSegment(2.0, 4.0, "open packs now", language="hi"),
    ]
    out = translate_segments(segs, "hinglish")
    assert out[0].language == "hinglish"
    assert "hai" in out[0].text.lower() or "pal" in out[0].text.lower()
    assert out[1].text == "open packs now"
    assert out[0].start == 0.0 and out[1].end == 4.0


def test_auto_passthrough():
    segs = [TranscriptSegment(0.0, 1.0, "hello", language="en")]
    assert translate_segments(segs, "auto")[0].text == "hello"
