import random

from pipeline.moments import (
    HeuristicAnalyzer,
    MomentCandidate,
    _dedupe_moments,
    _fit_window_to_target,
    _quality_gate,
    _score_text,
    _select_moments_with_variety,
    analyze_moments,
    effective_intro_skip_seconds,
    filter_segments_after_intro,
)
from pipeline.transcript import TranscriptSegment


def _segs(*rows: tuple[float, float, str]) -> list[TranscriptSegment]:
    return [TranscriptSegment(start=a, end=b, text=t, language="en") for a, b, t in rows]


def _dense_drama_segs(total: float = 600.0) -> list[TranscriptSegment]:
    """Continuous transcript with a clear viral beat and filler elsewhere."""
    rows: list[tuple[float, float, str]] = []
    t = 0.0
    while t < total:
        end = min(total, t + 20.0)
        if 180.0 <= t < 220.0:
            text = "Wait hold on oh my god no way he just got caught lying on stream! Everyone is screaming about the fight!"
        elif 360.0 <= t < 400.0:
            text = "Bro look at this clutch play! He exposed the scam and the whole chat lost it!"
        else:
            text = "um so yeah like basically talking about the usual stream stuff okay right and um"
        rows.append((t, end, text))
        t = end
    return _segs(*rows)


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


def test_score_penalizes_short_clips_vs_target():
    text = "Wait bro look at this fight! He just exposed the scam and everyone is screaming!"
    short, short_reasons = _score_text(text, duration=20.0, target_duration=60.0)
    on_target, on_reasons = _score_text(text, duration=60.0, target_duration=60.0)
    assert on_target > short
    assert "too_short_vs_target" in short_reasons
    assert "on_target_len" in on_reasons


def test_fit_window_honors_60_and_120():
    segs = _dense_drama_segs(600.0)
    for target in (60.0, 120.0):
        fitted = _fit_window_to_target(180.0, 200.0, segs, target, media_end=600.0)
        assert fitted is not None
        start, end, text = fitted
        assert abs((end - start) - target) <= 1.5
        assert "oh my god" in text.lower() or "caught" in text.lower()


def test_heuristic_honors_selected_clip_duration():
    segs = _dense_drama_segs(600.0)
    for target in (20.0, 60.0, 120.0):
        out = HeuristicAnalyzer().analyze(
            segs,
            clip_count=2,
            max_clip_duration=target,
            intro_skip_seconds=120.0,
            source_duration=600.0,
            rng=random.Random(0),
        )
        assert out
        for c in out[:2]:
            assert abs((c.end - c.start) - target) <= 1.5, (
                f"expected ~{target}s, got {c.end - c.start:.1f}s"
            )


def test_heuristic_ranks_viral_moment_first():
    segs = _segs(
        (0.0, 20.0, "Hey guys welcome back to the channel don't forget to subscribe and like"),
        (40.0, 62.0, "Wait hold on oh my god no way he just got caught lying on stream!"),
        (90.0, 140.0, "Thanks for watching leave a comment below and hit the bell " * 3),
    )
    out = HeuristicAnalyzer().analyze(
        segs,
        clip_count=1,
        max_clip_duration=45.0,
        source_duration=140.0,
        rng=random.Random(1),
    )
    assert out
    top = out[0]
    assert abs((top.end - top.start) - 45.0) <= 1.5
    assert "oh my god" in top.hook.lower() or "caught" in top.hook.lower()
    # CTA / outro windows must not outrank the drama beat.
    assert "subscribe" not in top.hook.lower()


def test_variety_avoids_previously_used_ranges():
    cands = [
        MomentCandidate(100, 160, "a", "first viral fight moment here", 0.9, "a"),
        MomentCandidate(200, 260, "b", "second clutch play moment here", 0.85, "b"),
        MomentCandidate(300, 360, "c", "third expose scam moment here", 0.8, "c"),
    ]
    picked = _select_moments_with_variety(
        cands,
        clip_count=1,
        exclude_ranges=[(100.0, 160.0)],
        rng=random.Random(0),
    )
    assert picked
    assert not (picked[0].start == 100 and picked[0].end == 160)
    assert picked[0].start in (200.0, 300.0)


def test_quality_gate_returns_fewer_when_weak():
    weak = [
        MomentCandidate(0, 20, "a", "a", 0.15, "weak"),
        MomentCandidate(30, 50, "b", "b", 0.12, "weak"),
        MomentCandidate(60, 80, "c", "c", 0.11, "weak"),
    ]
    gated = _quality_gate(weak, clip_count=3)
    assert len(gated) == 1


def test_quality_gate_honors_requested_clip_count():
    cands = [
        MomentCandidate(0, 20, "a", "strong", 0.55, "strong"),
        MomentCandidate(40, 60, "b", "ok", 0.35, "ok"),
        MomentCandidate(80, 100, "c", "ok2", 0.33, "ok"),
    ]
    gated = _quality_gate(cands, clip_count=2)
    assert len(gated) >= 2
    assert gated[0].score >= gated[1].score


def test_dedupe_drops_overlapping_duplicates():
    cands = [
        MomentCandidate(10, 40, "t1", "same hook line about the fight", 0.9, "a"),
        MomentCandidate(12, 42, "t2", "same hook line about the fight again", 0.8, "b"),
        MomentCandidate(80, 110, "t3", "totally different payoff moment here", 0.7, "c"),
    ]
    kept = _dedupe_moments(cands)
    assert len(kept) == 2
    assert kept[0].score >= kept[1].score


def test_filter_segments_after_intro_trims_and_drops():
    segs = _segs(
        (0.0, 30.0, "welcome back subscribe"),
        (100.0, 130.0, "half in intro"),
        (150.0, 180.0, "after intro drama fight exposed"),
    )
    out = filter_segments_after_intro(segs, 120.0)
    assert len(out) == 2
    assert out[0].start == 120.0
    assert out[0].end == 130.0
    assert out[1].start == 150.0


def test_effective_intro_skip_shrinks_for_short_media():
    segs = _segs((0.0, 90.0, "short vod text " * 5))
    # 90s media, 45s clip reserve → max skip 45.
    assert effective_intro_skip_seconds(120.0, segs, max_clip_duration=45.0) == 45.0
    long_segs = _segs((0.0, 600.0, "long"))
    assert effective_intro_skip_seconds(120.0, long_segs, max_clip_duration=45.0) == 120.0


def test_ai_intro_skip_excludes_early_viral_beats():
    segs = _dense_drama_segs(500.0)
    # Direct analyzer with default intro_skip=0 still sees beats before 120s.
    early = HeuristicAnalyzer().analyze(
        segs,
        clip_count=2,
        max_clip_duration=45.0,
        source_duration=500.0,
        rng=random.Random(2),
    )
    assert early

    skipped = HeuristicAnalyzer().analyze(
        segs,
        clip_count=2,
        max_clip_duration=45.0,
        intro_skip_seconds=120.0,
        source_duration=500.0,
        rng=random.Random(2),
    )
    assert skipped
    assert all(c.start >= 120.0 for c in skipped)
    assert abs((skipped[0].end - skipped[0].start) - 45.0) <= 1.5


def test_analyze_moments_default_intro_skip_from_settings():
    from config import Settings

    settings = Settings(AI_INTRO_SKIP_SECONDS=120, LLM_PROVIDER="heuristic")
    segs = _dense_drama_segs(500.0)
    out = analyze_moments(
        segs,
        clip_count=2,
        max_clip_duration=45.0,
        settings=settings,
        source_duration=500.0,
        rng=random.Random(3),
    )
    assert out
    assert all(c.start >= 120.0 for c in out)
