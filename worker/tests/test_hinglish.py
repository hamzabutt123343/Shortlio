from pipeline.captions import build_ass_subtitles
from pipeline.hinglish import to_hinglish
from pipeline.transcript import TranscriptSegment


def test_devanagari_to_hinglish_common_words():
    assert "hai" in to_hinglish("यह अच्छा है").lower()
    assert "kya" in to_hinglish("क्या").lower()
    assert "nahi" in to_hinglish("नहीं").lower()


def test_already_roman_passthrough():
    assert to_hinglish("Yeh moment viral hai") == "Yeh moment viral hai"


def test_ass_contains_roman_for_hinglish():
    segs = [
        TranscriptSegment(start=1.0, end=3.0, text="यह पल बहुत खास है", language="hi"),
    ]
    ass = build_ass_subtitles(segs, 0.0, 5.0, preset="classic_white", language_hint="hinglish")
    # Should not contain Devanagari in dialogue lines
    dialogue = "\n".join(line for line in ass.splitlines() if line.startswith("Dialogue:"))
    assert dialogue
    assert not any("\u0900" <= ch <= "\u097F" for ch in dialogue)
    assert "hai" in dialogue.lower() or "pal" in dialogue.lower() or "bahut" in dialogue.lower()
