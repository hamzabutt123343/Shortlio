from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any

from config import Settings, get_settings, run_subprocess
from pipeline.captions import write_ass_file
from pipeline.reframe import (
    ReframePlan,
    compute_reframe_plan,
    ffmpeg_vf_chain,
    load_cached_plan,
    save_plan,
    tracking_cache_path,
    write_sendcmd,
)
from pipeline.transcript import TranscriptSegment
from pipeline.translate import TranslationError, translate_segments

logger = logging.getLogger(__name__)

OUTPUT_PRESETS = {
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
    "16:9": (1920, 1080),
}

QUALITY_PRESETS = {
    "draft": {"preset": "ultrafast", "crf": "28", "audio_bitrate": "128k", "scale": 0.75},
    "fast": {"preset": "ultrafast", "crf": "28", "audio_bitrate": "128k", "scale": 0.75},
    "balanced": {"preset": "veryfast", "crf": "23", "audio_bitrate": "160k", "scale": 1.0},
    "high": {"preset": "faster", "crf": "20", "audio_bitrate": "192k", "scale": 1.0},
}


def _settings_fingerprint(caption_settings: dict[str, Any] | None) -> str:
    if not caption_settings:
        return "none"
    raw = json.dumps(caption_settings, sort_keys=True, ensure_ascii=False)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]


def validate_caption_filters(*, burn_captions: bool, ass_path: Path | None, vf: str) -> None:
    """Ensure captions are burned at most once (no duplicate ASS filters)."""
    ass_hits = vf.count("ass=")
    if burn_captions:
        if ass_path is None or not ass_path.exists():
            raise RuntimeError("burn_captions=True but ASS subtitle file is missing")
        if ass_hits == 0:
            raise RuntimeError("burn_captions=True but no ASS filter in ffmpeg vf chain")
        if ass_hits > 1:
            raise RuntimeError(f"Duplicate ASS caption filters in vf chain ({ass_hits})")
        dialogue_n = sum(
            1
            for line in ass_path.read_text(encoding="utf-8-sig").splitlines()
            if line.startswith("Dialogue:")
        )
        if dialogue_n == 0:
            logger.warning("ASS has zero dialogue lines — export captions will be blank")
    else:
        if ass_hits > 0:
            raise RuntimeError("burn_captions=False but ASS filter present in vf chain")
        if ass_path is not None:
            raise RuntimeError("burn_captions=False but ASS path was provided")


def render_clip(
    *,
    input_path: Path,
    output_path: Path,
    plan: ReframePlan,
    ass_path: Path | None,
    aspect: str = "9:16",
    quality: str = "draft",
    burn_captions: bool | None = None,
    settings: Settings | None = None,
) -> Path:
    settings = settings or get_settings()
    ffmpeg = settings.resolved_ffmpeg()
    out_w, out_h = OUTPUT_PRESETS.get(aspect, OUTPUT_PRESETS["9:16"])
    q = QUALITY_PRESETS.get(quality, QUALITY_PRESETS["draft"])
    scale = float(q.get("scale", 1.0))
    if scale < 1.0:
        out_w = int(out_w * scale) // 2 * 2
        out_h = int(out_h * scale) // 2 * 2

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sendcmd_path = output_path.with_suffix(".sendcmd.txt")
    write_sendcmd(sendcmd_path, plan)
    vf = ffmpeg_vf_chain(
        plan,
        out_w=out_w,
        out_h=out_h,
        ass_path=ass_path,
        sendcmd_path=sendcmd_path if plan.keyframes else None,
    )
    burn = bool(ass_path) if burn_captions is None else burn_captions
    validate_caption_filters(burn_captions=burn, ass_path=ass_path, vf=vf)

    cmd = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(input_path),
        "-vf",
        vf,
        "-af",
        "asetpts=PTS-STARTPTS",
        "-c:v",
        "libx264",
        "-preset",
        q["preset"],
        "-crf",
        q["crf"],
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        q["audio_bitrate"],
        "-ac",
        "2",
        "-sn",  # never mux softsubs — captions are burned (or omitted) only once
        "-movflags",
        "+faststart",
        "-fflags",
        "+genpts",
        "-threads",
        "0",
        str(output_path),
    ]
    logger.info(
        "Rendering %s quality=%s preset=%s size=%dx%d animated=%s",
        output_path.name,
        quality,
        q["preset"],
        out_w,
        out_h,
        bool(plan.keyframes),
    )
    run_subprocess(cmd, timeout=3600)
    return output_path


def _parse_crop_settings(
    crop_settings: dict[str, Any] | None,
) -> tuple[float | None, bool, bool, str]:
    """Return focal_x, manual, speaker_focus, switch_style."""
    if not crop_settings:
        return None, False, True, "hard_cut"
    focal = crop_settings.get("focal_x")
    mode = str(crop_settings.get("mode") or "")
    manual = mode in ("manual_override", "manual") or bool(crop_settings.get("manual"))
    if "speaker_focus" in crop_settings:
        speaker_focus = bool(crop_settings.get("speaker_focus"))
    elif "smart_speaker_switch" in crop_settings:
        speaker_focus = bool(crop_settings.get("smart_speaker_switch"))
    else:
        speaker_focus = True
    tracking = str(
        crop_settings.get("tracking_mode")
        or crop_settings.get("switch_style")
        or ("hard_cut" if speaker_focus else "subject")
    ).lower()
    if tracking in ("smooth", "pan", "follow", "subject_track"):
        tracking = "subject"
    if tracking not in ("hard_cut", "subject"):
        tracking = "hard_cut" if speaker_focus else "subject"
    if not speaker_focus:
        tracking = "subject"
    try:
        focal_f = float(focal) if focal is not None else None
    except (TypeError, ValueError):
        focal_f = None
    return focal_f, manual, speaker_focus, tracking


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
    caption_settings: dict[str, Any] | None = None,
    burn_captions: bool = True,
    crop_settings: dict[str, Any] | None = None,
    quality: str = "draft",
    settings: Settings | None = None,
) -> tuple[Path, ReframePlan]:
    settings = settings or get_settings()
    work_dir = settings.resolved_temp_dir() / job_id / "render"
    work_dir.mkdir(parents=True, exist_ok=True)
    track_root = settings.resolved_temp_dir() / "tracking_cache"
    model_cache = settings.resolved_temp_dir() / "models"
    translation_cache = settings.resolved_temp_dir() / "translations"

    # Apply caption language (Hinglish romanization / translation). Fail loudly on unsupported pairs.
    transcript_lang = transcript[0].language if transcript else "en"
    hint = (language_hint or "en").lower().strip()
    src = (transcript_lang or "en").lower().strip()
    if hint and hint not in ("auto",) and hint != src:
        logger.info(
            "Applying caption language %s → %s for clip %d",
            src,
            hint,
            index,
        )
        try:
            transcript = translate_segments(
                transcript, hint, cache_dir=translation_cache, strict=True
            )
        except TranslationError:
            raise
        except Exception as exc:
            raise TranslationError(
                f"Caption language processing failed ({src} → {hint}): {exc}"
            ) from exc
    
    focal_x, manual, speaker_focus, switch_style = _parse_crop_settings(crop_settings)
    cache_path = tracking_cache_path(
        track_root,
        segment_path,
        aspect,
        focal_x,
        manual,
        speaker_focus=speaker_focus,
        switch_style=switch_style,
    )
    plan = load_cached_plan(cache_path)
    if plan is None:
        # Also check job-local plan for mid-job retries
        plan_path = work_dir / f"plan_{index:03d}.json"
        plan = load_cached_plan(plan_path)
        if plan is None:
            transcript_speakers = [
                (s.start, s.end, s.speaker)
                for s in transcript
                if getattr(s, "speaker", None)
            ]
            plan = compute_reframe_plan(
                segment_path,
                aspect=aspect,
                focal_x=focal_x,
                manual_override=manual and focal_x is not None,
                model_cache_dir=model_cache,
                speaker_focus=speaker_focus,
                switch_style=switch_style,
                transcript_speakers=transcript_speakers or None,
            )
            save_plan(plan_path, plan)
            save_plan(cache_path, plan)
        else:
            save_plan(cache_path, plan)
    else:
        # Mirror into job dir for debugging
        save_plan(work_dir / f"plan_{index:03d}.json", plan)

    pad = settings.segment_padding_seconds
    clip_start = max(0.0, moment_start - pad)
    clip_end = moment_end + pad

    ass_path: Path | None = None
    if burn_captions:
        ass_path = work_dir / f"subs_{index:03d}.ass"
        write_ass_file(
            ass_path,
            transcript,
            clip_start,
            clip_end,
            preset=caption_preset,
            language_hint=language_hint,
            caption_settings=caption_settings,
        )

    settings_fp = _settings_fingerprint(caption_settings)
    crop_fp = _settings_fingerprint(crop_settings)
    burn_flag = "burn" if burn_captions else "noburn"
    out_path = work_dir / f"clip_{index:03d}.mp4"
    marker = (
        work_dir
        / (
            f"clip_{index:03d}.{quality}.{caption_preset}.{language_hint}."
            f"{settings_fp}.{crop_fp}.{burn_flag}.done"
        )
    )
    if out_path.exists() and out_path.stat().st_size > 0 and marker.exists():
        return out_path, plan
    if out_path.exists():
        try:
            out_path.unlink()
        except OSError:
            pass

    render_clip(
        input_path=segment_path,
        output_path=out_path,
        plan=plan,
        ass_path=ass_path,
        aspect=aspect,
        quality=quality,
        burn_captions=burn_captions,
        settings=settings,
    )
    marker.write_text("ok", encoding="utf-8")
    return out_path, plan
