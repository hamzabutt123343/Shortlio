from __future__ import annotations

import json
import logging
import shutil
import signal
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from config import configure_logging, get_settings, validate_public_http_url
from db import JobRepository
from job_queue import WorkerQueue
from pipeline.download import download_moment_segment
from pipeline.metadata import fetch_ytdlp_metadata, project_fields_from_metadata
from pipeline.moments import MomentCandidate, analyze_moments
from pipeline.render import OUTPUT_PRESETS, render_moment_clip
from pipeline.stages import ProgressStage, should_run_stage
from pipeline.storage import ensure_bucket_exists, upload_clip
from pipeline.transcript import TranscriptSegment, ensure_transcript, load_cached_transcript

logger = logging.getLogger(__name__)


def _job_payload(job: dict[str, Any]) -> dict[str, Any]:
    raw = job.get("payload") or {}
    if isinstance(raw, str):
        return json.loads(raw)
    return dict(raw)


def _project_id(job: dict[str, Any], payload: dict[str, Any]) -> str | None:
    pid = payload.get("project_id") or job.get("project_id")
    return str(pid) if pid else None


def _user_id(job: dict[str, Any], payload: dict[str, Any]) -> str | None:
    uid = payload.get("user_id") or job.get("user_id")
    return str(uid) if uid else None


def _resolution(aspect: str) -> str:
    w, h = OUTPUT_PRESETS.get(aspect, OUTPUT_PRESETS["9:16"])
    return f"{w}x{h}"


def _cleanup_job_temp(job_id: str) -> None:
    settings = get_settings()
    root = settings.resolved_temp_dir() / job_id
    if root.exists():
        shutil.rmtree(root, ignore_errors=True)
        logger.info("Cleaned temp dir for job %s", job_id)


def _moment_from_dict(m: dict[str, Any]) -> MomentCandidate:
    return MomentCandidate(
        start=float(m["start_time"] if "start_time" in m else m["start"]),
        end=float(m["end_time"] if "end_time" in m else m["end"]),
        title=str(m.get("title", "Clip")),
        hook=str(m.get("hook", "")),
        score=float(m.get("score", 0.5)),
        explanation=str(m.get("explanation", "")),
        id=str(m["id"]) if m.get("id") else None,
    )


@dataclass
class RenderTarget:
    moment: MomentCandidate
    candidate_id: str | None = None
    clip_id: str | None = None
    storage_path: str | None = None


def _persist_transcript(
    repo: JobRepository,
    *,
    project_id: str | None,
    source_url: str,
    segments: list[TranscriptSegment],
    settings,
) -> None:
    if not project_id:
        return
    repo.replace_transcript_segments(project_id, segments)
    meta = fetch_ytdlp_metadata(source_url, settings)
    if meta:
        repo.update_project(project_id, project_fields_from_metadata(meta))


def _load_or_build_transcript(
    repo: JobRepository,
    *,
    job_id: str,
    project_id: str | None,
    source_url: str,
    work_dir: Path,
    current_stage: str,
    check_cancel,
    settings,
) -> list[TranscriptSegment]:
    segments = load_cached_transcript(work_dir)
    from_db = False
    if segments is None and project_id:
        db_segments = repo.fetch_transcript_segments(project_id)
        if db_segments:
            segments = db_segments
            from_db = True

    if segments is None:
        if check_cancel():
            return []
        if should_run_stage(current_stage, ProgressStage.FETCHING_TRANSCRIPT):
            repo.update_progress(
                job_id, progress_stage=ProgressStage.FETCHING_TRANSCRIPT, progress_pct=5
            )
        if check_cancel():
            return []
        repo.update_progress(
            job_id, progress_stage=ProgressStage.TRANSCRIBING_AUDIO, progress_pct=10
        )
        segments = ensure_transcript(job_id=job_id, source_url=source_url, settings=settings)
        if project_id:
            _persist_transcript(
                repo,
                project_id=project_id,
                source_url=source_url,
                segments=segments,
                settings=settings,
            )
    elif project_id and not from_db:
        _persist_transcript(
            repo,
            project_id=project_id,
            source_url=source_url,
            segments=segments,
            settings=settings,
        )

    return segments


def _sync_moment_candidates(
    repo: JobRepository,
    *,
    project_id: str,
    candidates: list[MomentCandidate],
    clip_count: int,
    job_id: str,
) -> list[dict[str, Any]]:
    rows = repo.replace_clip_candidates(
        project_id,
        [c.to_dict() for c in candidates],
        selected_count=clip_count,
    )
    repo.update_progress(
        job_id,
        progress_stage=ProgressStage.ANALYZING_MOMENTS,
        progress_pct=35,
        partial_result={"moments": [c.to_dict() for c in candidates[: clip_count * 2]]},
    )
    return rows


def _targets_from_candidate_rows(rows: list[dict[str, Any]]) -> list[RenderTarget]:
    out: list[RenderTarget] = []
    for row in rows:
        moment = _moment_from_dict(row)
        moment.id = str(row["id"])
        out.append(RenderTarget(moment=moment, candidate_id=str(row["id"])))
    return out


def _render_and_upload_clips(
    repo: JobRepository,
    *,
    job: dict[str, Any],
    job_id: str,
    user_id: str | None,
    project_id: str | None,
    source_url: str,
    segments: list[TranscriptSegment],
    targets: list[RenderTarget],
    aspect: str,
    caption_preset: str,
    language_hint: str,
    quality: str,
    settings,
    check_cancel,
    confirm_quota: bool,
) -> list[dict[str, Any]]:
    repo.update_progress(job_id, progress_stage=ProgressStage.FETCHING_SELECTED_SEGMENTS, progress_pct=45)
    segment_paths: list[Path] = []
    for i, target in enumerate(targets):
        if check_cancel():
            return []
        moment = target.moment
        seg_path = download_moment_segment(
            job_id=job_id,
            source_url=source_url,
            start=moment.start,
            end=moment.end,
            index=i,
            settings=settings,
        )
        segment_paths.append(seg_path)
        pct = 45 + (i + 1) / len(targets) * 15
        repo.update_progress(
            job_id, progress_stage=ProgressStage.FETCHING_SELECTED_SEGMENTS, progress_pct=pct
        )

    if check_cancel():
        return []

    repo.update_progress(job_id, progress_stage=ProgressStage.DETECTING_SUBJECTS, progress_pct=62)
    repo.update_progress(job_id, progress_stage=ProgressStage.RENDERING_CLIPS, progress_pct=65)

    clips_out: list[dict[str, Any]] = []
    for i, (target, seg_path) in enumerate(zip(targets, segment_paths)):
        if check_cancel():
            return []
        moment = target.moment
        rendered, plan = render_moment_clip(
            job_id=job_id,
            index=i,
            segment_path=seg_path,
            moment_start=moment.start,
            moment_end=moment.end,
            transcript=segments,
            aspect=aspect,
            caption_preset=caption_preset,
            language_hint=language_hint,
            quality=quality,
            settings=settings,
        )
        meta = upload_clip(
            rendered,
            job_id=job_id,
            clip_index=i,
            settings=settings,
            storage_path=target.storage_path,
        )
        clip_row: dict[str, Any] | None = None
        if project_id and user_id:
            clip_row = repo.upsert_rendered_clip(
                clip_id=target.clip_id,
                project_id=project_id,
                user_id=user_id,
                job_id=job_id,
                candidate_id=target.candidate_id,
                title=moment.title,
                start_time=moment.start,
                end_time=moment.end,
                output_format=aspect,
                resolution=_resolution(aspect),
                caption_language=language_hint,
                caption_preset=caption_preset,
                quality=quality,
                storage_path=str(meta["path"]),
                duration=max(0.0, moment.end - moment.start),
                reframe_warning=bool(plan.used_center_fallback),
            )
            if confirm_quota and clip_row and clip_row.get("id"):
                repo.confirm_clip_success(user_id, str(clip_row["id"]), job_id)

        entry = {
            **moment.to_dict(),
            **meta,
            "reframe": plan.to_dict(),
        }
        if clip_row and clip_row.get("id"):
            entry["clip_id"] = clip_row["id"]
        clips_out.append(entry)
        pct = 65 + (i + 1) / len(targets) * 30
        repo.update_progress(
            job_id,
            progress_stage=ProgressStage.RENDERING_CLIPS,
            progress_pct=pct,
            partial_result={"clips": clips_out},
        )
    return clips_out


def process_job(job: dict[str, Any]) -> None:
    settings = get_settings()
    repo = JobRepository(settings=settings)
    job_id = str(job["id"])
    payload = _job_payload(job)
    mode = str(payload.get("mode") or "full_pipeline")

    if mode == "re_render":
        _process_re_render(job, repo, settings, payload)
        return
    if mode == "render_selected":
        _process_render_selected(job, repo, settings, payload)
        return
    _process_full_pipeline(job, repo, settings, payload)


def _process_full_pipeline(
    job: dict[str, Any],
    repo: JobRepository,
    settings,
    payload: dict[str, Any],
) -> None:
    job_id = str(job["id"])
    source_url = payload.get("source_url") or job.get("source_url")
    if not source_url:
        repo.mark_failed(job, "Missing source_url in job payload")
        return

    try:
        validate_public_http_url(source_url)
    except ValueError as exc:
        repo.mark_failed(job, str(exc))
        return

    project_id = _project_id(job, payload)
    user_id = _user_id(job, payload)
    clip_count = int(payload.get("clip_count", job.get("requested_clip_count", 3)))
    max_clip_duration = float(payload.get("max_clip_duration", 60.0))
    aspect = str(payload.get("aspect_ratio", "9:16"))
    caption_preset = str(payload.get("caption_preset", "classic_white"))
    language_hint = str(payload.get("language", "en"))
    quality = str(payload.get("quality", "balanced"))
    cleanup = bool(payload.get("cleanup_temp", True))

    current_stage = job.get("progress_stage") or ProgressStage.FETCHING_TRANSCRIPT.value
    work_dir = settings.resolved_temp_dir() / job_id

    def check_cancel() -> bool:
        if repo.is_cancelled(job_id):
            logger.info("Job %s cancelled", job_id)
            return True
        return False

    try:
        ensure_bucket_exists(settings)

        segments = _load_or_build_transcript(
            repo,
            job_id=job_id,
            project_id=project_id,
            source_url=source_url,
            work_dir=work_dir,
            current_stage=current_stage,
            check_cancel=check_cancel,
            settings=settings,
        )
        if not segments:
            return

        repo.update_progress(
            job_id,
            progress_stage=ProgressStage.ANALYZING_MOMENTS,
            progress_pct=25,
            partial_result={"transcript_segment_count": len(segments)},
        )

        if check_cancel():
            return

        existing_result = (repo.get_job(job_id) or {}).get("result") or {}
        moments_raw = existing_result.get("moments")
        analyzed_fresh = False
        if moments_raw and isinstance(moments_raw, list):
            candidates = [_moment_from_dict(m) for m in moments_raw]
        else:
            candidates = analyze_moments(
                segments,
                clip_count=clip_count,
                max_clip_duration=max_clip_duration,
                settings=settings,
            )
            analyzed_fresh = True

        if project_id:
            selected_rows: list[dict[str, Any]] = []
            if analyzed_fresh:
                candidate_rows = _sync_moment_candidates(
                    repo,
                    project_id=project_id,
                    candidates=candidates,
                    clip_count=clip_count,
                    job_id=job_id,
                )
                selected_rows = [r for r in candidate_rows if r.get("selected")][:clip_count]
            else:
                selected_rows = repo.fetch_selected_clip_candidates(
                    project_id, limit=clip_count
                )
                if not selected_rows:
                    candidate_rows = _sync_moment_candidates(
                        repo,
                        project_id=project_id,
                        candidates=candidates,
                        clip_count=clip_count,
                        job_id=job_id,
                    )
                    selected_rows = [r for r in candidate_rows if r.get("selected")][
                        :clip_count
                    ]
            targets = _targets_from_candidate_rows(selected_rows)
        else:
            selected = sorted(candidates, key=lambda c: c.score, reverse=True)[:clip_count]
            targets = [RenderTarget(moment=m) for m in selected]

        if not targets:
            repo.mark_failed(job, "No clip candidates found")
            return

        if check_cancel():
            return

        clips_out = _render_and_upload_clips(
            repo,
            job=job,
            job_id=job_id,
            user_id=user_id,
            project_id=project_id,
            source_url=source_url,
            segments=segments,
            targets=targets,
            aspect=aspect,
            caption_preset=caption_preset,
            language_hint=language_hint,
            quality=quality,
            settings=settings,
            check_cancel=check_cancel,
            confirm_quota=True,
        )
        if check_cancel() or not clips_out:
            return

        repo.mark_ready(
            job,
            {
                "clips": clips_out,
                "source_url": source_url,
                "aspect_ratio": aspect,
                "caption_preset": caption_preset,
            },
        )
        logger.info("Job %s ready (%d clips)", job_id, len(clips_out))

        if cleanup:
            _cleanup_job_temp(job_id)

    except Exception as exc:
        logger.exception("Job %s failed", job_id)
        repo.mark_failed(job, str(exc))


def _process_render_selected(
    job: dict[str, Any],
    repo: JobRepository,
    settings,
    payload: dict[str, Any],
) -> None:
    job_id = str(job["id"])
    source_url = payload.get("source_url") or job.get("source_url")
    if not source_url:
        repo.mark_failed(job, "Missing source_url in job payload")
        return

    try:
        validate_public_http_url(source_url)
    except ValueError as exc:
        repo.mark_failed(job, str(exc))
        return

    project_id = _project_id(job, payload)
    user_id = _user_id(job, payload)
    if not project_id:
        repo.mark_failed(job, "render_selected requires project_id")
        return

    candidate_ids = [str(x) for x in (payload.get("candidate_ids") or [])]
    aspect = str(payload.get("aspect_ratio", "9:16"))
    caption_preset = str(payload.get("caption_preset", "classic_white"))
    language_hint = str(payload.get("language", "en"))
    quality = str(payload.get("quality", "balanced"))
    cleanup = bool(payload.get("cleanup_temp", True))
    work_dir = settings.resolved_temp_dir() / job_id

    def check_cancel() -> bool:
        return repo.is_cancelled(job_id)

    try:
        ensure_bucket_exists(settings)
        rows = repo.fetch_clip_candidates_by_ids(project_id, candidate_ids)
        if not rows:
            repo.mark_failed(job, "No matching clip candidates")
            return
        targets = _targets_from_candidate_rows(rows)

        segments = load_cached_transcript(work_dir)
        if not segments:
            segments = repo.fetch_transcript_segments(project_id)
        if not segments:
            segments = ensure_transcript(job_id=job_id, source_url=source_url, settings=settings)
            _persist_transcript(
                repo,
                project_id=project_id,
                source_url=source_url,
                segments=segments,
                settings=settings,
            )

        clips_out = _render_and_upload_clips(
            repo,
            job=job,
            job_id=job_id,
            user_id=user_id,
            project_id=project_id,
            source_url=source_url,
            segments=segments,
            targets=targets,
            aspect=aspect,
            caption_preset=caption_preset,
            language_hint=language_hint,
            quality=quality,
            settings=settings,
            check_cancel=check_cancel,
            confirm_quota=True,
        )
        if check_cancel() or not clips_out:
            return

        repo.mark_ready(
            job,
            {
                "clips": clips_out,
                "source_url": source_url,
                "aspect_ratio": aspect,
                "caption_preset": caption_preset,
                "mode": "render_selected",
            },
        )
        if cleanup:
            _cleanup_job_temp(job_id)
    except Exception as exc:
        logger.exception("Job %s failed", job_id)
        repo.mark_failed(job, str(exc))


def _process_re_render(
    job: dict[str, Any],
    repo: JobRepository,
    settings,
    payload: dict[str, Any],
) -> None:
    job_id = str(job["id"])
    clip_id = str(payload.get("clip_id") or "")
    source_url = payload.get("source_url") or job.get("source_url")
    if not clip_id:
        repo.mark_failed(job, "re_render requires clip_id")
        return
    if not source_url:
        repo.mark_failed(job, "Missing source_url in job payload")
        return

    try:
        validate_public_http_url(source_url)
    except ValueError as exc:
        repo.mark_failed(job, str(exc))
        return

    project_id = _project_id(job, payload)
    user_id = _user_id(job, payload)
    aspect = str(payload.get("aspect_ratio", "9:16"))
    caption_preset = str(payload.get("caption_preset", "classic_white"))
    language_hint = str(payload.get("language", "en"))
    quality = str(payload.get("quality", "balanced"))
    cleanup = bool(payload.get("cleanup_temp", True))
    work_dir = settings.resolved_temp_dir() / job_id

    clip_row = repo.get_clip(clip_id)
    if not clip_row:
        repo.mark_failed(job, f"Clip not found: {clip_id}")
        return

    start = float(payload.get("start_time", clip_row.get("start_time", 0)))
    end = float(payload.get("end_time", clip_row.get("end_time", start + 30)))
    moment = MomentCandidate(
        start=start,
        end=end,
        title=str(clip_row.get("title", "Clip")),
        hook="",
        score=0.0,
        explanation="re_render",
        id=clip_id,
    )
    target = RenderTarget(
        moment=moment,
        candidate_id=str(clip_row["candidate_id"]) if clip_row.get("candidate_id") else None,
        clip_id=clip_id,
        storage_path=str(clip_row["storage_path"]) if clip_row.get("storage_path") else None,
    )

    def check_cancel() -> bool:
        return repo.is_cancelled(job_id)

    try:
        ensure_bucket_exists(settings)
        segments = load_cached_transcript(work_dir)
        if not segments and project_id:
            segments = repo.fetch_transcript_segments(project_id)
        if not segments:
            segments = ensure_transcript(job_id=job_id, source_url=source_url, settings=settings)

        clips_out = _render_and_upload_clips(
            repo,
            job=job,
            job_id=job_id,
            user_id=user_id,
            project_id=project_id,
            source_url=source_url,
            segments=segments,
            targets=[target],
            aspect=aspect,
            caption_preset=caption_preset,
            language_hint=language_hint,
            quality=quality,
            settings=settings,
            check_cancel=check_cancel,
            confirm_quota=False,
        )
        if check_cancel() or not clips_out:
            return

        repo.mark_ready(
            job,
            {
                "clips": clips_out,
                "source_url": source_url,
                "mode": "re_render",
                "clip_id": clip_id,
            },
        )
        if cleanup:
            _cleanup_job_temp(job_id)
    except Exception as exc:
        logger.exception("Job %s re_render failed", job_id)
        repo.mark_failed(job, str(exc))


def main() -> int:
    configure_logging()
    settings = get_settings()
    queue = WorkerQueue(process_job, settings=settings)

    def _handle_sig(signum, _frame) -> None:
        logger.info("Signal %s received, stopping…", signum)
        queue.stop()

    signal.signal(signal.SIGINT, _handle_sig)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_sig)

    try:
        queue.run_forever()
    except KeyboardInterrupt:
        queue.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
