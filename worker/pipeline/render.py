from __future__ import annotations

import logging
from pathlib import Path

from config import Settings, get_settings, run_subprocess
from pipeline.captions import write_ass_file
from pipeline.reframe import ReframePlan, compute_reframe_plan
from pipeline.transcript import TranscriptSegment

logger = logging.getLogger(__name__)

OUTPUT_PRESETS = {
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
    "16:9": (1920, 1080),
}

QUALITY_PRESETS = {
    "fast": {"preset": "veryfast", "crf": "23"},
    "balanced": {"preset": "medium", "crf": "20"},
    "high": {"preset": "slow", "crf": "18"},
}


def render_clip(
    *,
    input_path: Path,
    output_path: Path,
    plan: ReframePlan,
    ass_path: Path | None,
    aspect: str = "9:16",
    quality: str = "balanced",
    settings: Settings | None = None,
) -> Path:
    settings = settings or get_settings()
    ffmpeg = settings.resolved_ffmpeg()
    out_w, out_h = OUTPUT_PRESETS.get(aspect, OUTPUT_PRESETS["9:16"])
    q = QUALITY_PRESETS.get(quality, QUALITY_PRESETS["balanced"])

    vf_parts = [
        f"crop={plan.crop_w}:{plan.crop_h}:{plan.crop_x}:{plan.crop_y}",
        f"scale={out_w}:{out_h}:force_original_aspect_ratio=decrease",
        f"pad={out_w}:{out_h}:(ow-iw)/2:(oh-ih)/2",
    ]
    if ass_path and ass_path.exists():
        ass_esc = str(ass_path).replace("\\", "/").replace(":", "\\:")
        vf_parts.append(f"ass='{ass_esc}'")
    vf = ",".join(vf_parts)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg,
        "-y",
        "-i",
        str(input_path),
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        q["preset"],
        "-crf",
        q["crf"],
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        str(output_path),
    ]
    run_subprocess(cmd, timeout=3600)
    return output_path


def render_moment_clip(
    *,
    job_id: str,
    index: int,
    segment_path: Path,
    moment_start: float,
    moment_end: float,
    transcript: list[TranscriptSegment],
    aspect: str = "9:16",
    caption_preset: str = "classic_white",
    language_hint: str = "en",
    quality: str = "balanced",
    settings: Settings | None = None,
) -> tuple[Path, ReframePlan]:
    settings = settings or get_settings()
    work_dir = settings.resolved_temp_dir() / job_id / "render"
    work_dir.mkdir(parents=True, exist_ok=True)

    plan_path = work_dir / f"plan_{index:03d}.json"
    if plan_path.exists():
        import json

        plan_data = json.loads(plan_path.read_text(encoding="utf-8"))
        plan = ReframePlan(**plan_data)
    else:
        plan = compute_reframe_plan(segment_path, aspect=aspect)
        import json

        plan_path.write_text(json.dumps(plan.to_dict(), indent=2), encoding="utf-8")

    pad = settings.segment_padding_seconds
    clip_start = max(0.0, moment_start - pad)
    clip_end = moment_end + pad

    ass_path = work_dir / f"subs_{index:03d}.ass"
    if not ass_path.exists():
        write_ass_file(
            ass_path,
            transcript,
            clip_start,
            clip_end,
            preset=caption_preset,
            language_hint=language_hint,
        )

    out_path = work_dir / f"clip_{index:03d}.mp4"
    if out_path.exists() and out_path.stat().st_size > 0:
        return out_path, plan

    render_clip(
        input_path=segment_path,
        output_path=out_path,
        plan=plan,
        ass_path=ass_path,
        aspect=aspect,
        quality=quality,
        settings=settings,
    )
    return out_path, plan
