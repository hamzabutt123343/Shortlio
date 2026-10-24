from pipeline.moments import HeuristicAnalyzer, _dedupe_moments, _quality_gate, _score_text
from pipeline.moments import MomentCandidate
from pipeline.transcript import TranscriptSegment


def _segs(*rows: tuple[float, float, str]) -> list[TranscriptSegment]:
    return [TranscriptSegment(start=a, end=b, text=t, language="en") for a, b, t in rows]


def test_score_prefers_drama_over_filler():
    drama, _ = _score_text(
        "Wait bro look at this fight! He just exposed the scam and everyone is screaming!",
        duration=28.0,
    )
    filler, _ = _score_text(
        "um so yeah like basically you know okay right and um like yeah okay so",
        duration=28.0,
    )
    assert drama > filler
    assert drama >= 0.48


def test_heuristic_ranks_viral_moment_first():
    segs = _segs(
        (0.0, 20.0, "Hey guys welcome back to the channel don't forget to subscribe and like"),
        (40.0, 62.0, "Wait hold on oh my god no way he just got caught lying on stream!"),
        (90.0, 110.0, "Thanks for watching leave a comment below and hit the bell"),
    )
    out = HeuristicAnalyzer().analyze(segs, clip_count=3, max_clip_duration=45.0)
    assert out
    top = out[0]
    assert "oh my god" in top.hook.lower() or "caught" in top.hook.lower()
    assert top.score >= out[-1].score
    # CTA / outro windows must not outrank the drama beat.
    assert "subscribe" not in top.hook.lower()
    assert "thanks for watching" not in top.hook.lower()


def test_quality_gate_returns_fewer_when_weak():
    weak = [
        MomentCandidate(0, 20, "a", "a", 0.3, "weak"),
        MomentCandidate(30, 50, "b", "b", 0.32, "weak"),
        MomentCandidate(60, 80, "c", "c", 0.31, "weak"),
    ]
    gated = _quality_gate(weak, clip_count=3)
    assert len(gated) == 1


def test_dedupe_drops_overlapping_duplicates():
    cands = [
        MomentCandidate(10, 40, "t1", "same hook line about the fight", 0.9, "a"),
        MomentCandidate(12, 42, "t2", "same hook line about the fight again", 0.8, "b"),
        MomentCandidate(80, 110, "t3", "totally different payoff moment here", 0.7, "c"),
    ]
    kept = _dedupe_moments(cands)
    assert len(kept) == 2
    assert kept[0].score >= kept[1].score
