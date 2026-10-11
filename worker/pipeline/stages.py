from __future__ import annotations

from enum import Enum


class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ProgressStage(str, Enum):
    QUEUED = "queued"
    FETCHING_TRANSCRIPT = "fetching_transcript"
    TRANSCRIBING_AUDIO = "transcribing_audio"
    ANALYZING_MOMENTS = "analyzing_moments"
    FETCHING_SELECTED_SEGMENTS = "fetching_selected_segments"
    DETECTING_SUBJECTS = "detecting_subjects"
    RENDERING_CLIPS = "rendering_clips"
    READY = "ready"
    FAILED = "failed"
    CANCELLED = "cancelled"


# Order used for idempotent resume (skip stages already completed).
PIPELINE_ORDER: list[ProgressStage] = [
    ProgressStage.FETCHING_TRANSCRIPT,
    ProgressStage.TRANSCRIBING_AUDIO,
    ProgressStage.ANALYZING_MOMENTS,
    ProgressStage.FETCHING_SELECTED_SEGMENTS,
    ProgressStage.DETECTING_SUBJECTS,
    ProgressStage.RENDERING_CLIPS,
]


def stage_index(stage: ProgressStage | str) -> int:
    try:
        s = ProgressStage(stage)
    except ValueError:
        return -1
    if s in PIPELINE_ORDER:
        return PIPELINE_ORDER.index(s)
    return -1


def should_run_stage(current: ProgressStage | str, target: ProgressStage) -> bool:
    """True if `target` should run given job already reached `current`."""
    cur_i = stage_index(current)
    tgt_i = stage_index(target)
    if tgt_i < 0:
        return False
    if cur_i < 0:
        return True
    return tgt_i >= cur_i
