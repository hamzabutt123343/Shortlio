from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from config import Settings, get_settings
from pipeline.stages import JobStatus, ProgressStage
from pipeline.transcript import TranscriptSegment

logger = logging.getLogger(__name__)


def _api_error_detail(resp: httpx.Response, *, limit: int = 400) -> str:
    """Readable error text for API failures (avoid dumping Next.js HTML 404 pages)."""
    text = (resp.text or "").strip()
    ctype = (resp.headers.get("content-type") or "").lower()
    if "text/html" in ctype or text[:1] == "<" or "<!DOCTYPE" in text[:32].upper():
        return (
            f"got HTML {resp.status_code} from {resp.request.url!s} "
            "(desktop API missing on the app host — redeploy web with /api/desktop routes)"
        )
    try:
        data = resp.json()
        if isinstance(data, dict):
            err = data.get("error") or data.get("message")
            if err:
                return str(err)[:limit]
    except Exception:
        pass
    return text[:limit] or f"HTTP {resp.status_code}"


class HttpJobRepository:
    """JobRepository-compatible client that talks to /api/desktop/* with a user JWT."""

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        base = self.settings.shortlio_api_url.strip().rstrip("/")
        if not base:
            raise RuntimeError("SHORTLIO_API_URL is required for HttpJobRepository")
        self.base = base

    def _headers(self) -> dict[str, str]:
        token = self.settings.read_access_token()
        if not token:
            raise RuntimeError("SHORTLIO_ACCESS_TOKEN / SHORTLIO_TOKEN_FILE missing")
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    def _post_repo(self, action: str, **payload: Any) -> Any:
        body = {"action": action, **payload}
        with httpx.Client(timeout=120.0) as client:
            resp = client.post(
                f"{self.base}/api/desktop/repo",
                headers=self._headers(),
                json=body,
            )
            if resp.status_code >= 400:
                raise RuntimeError(
                    f"desktop repo {action} failed ({resp.status_code}): {_api_error_detail(resp)}"
                )
            data = resp.json()
            return data.get("data")

    def claim_job(self, worker_id: str, job_id: str) -> dict[str, Any] | None:
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(
                f"{self.base}/api/desktop/jobs/{job_id}/claim",
                headers=self._headers(),
                json={"workerId": worker_id},
            )
            if resp.status_code >= 400:
                raise RuntimeError(
                    f"claim failed ({resp.status_code}): {_api_error_detail(resp)}"
                )
            return (resp.json() or {}).get("job")

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        return self._post_repo("get_job", jobId=job_id)

    def upsert_worker_heartbeat(
        self, worker_id: str, *, metadata: dict[str, Any] | None = None
    ) -> None:
        # Desktop engine does not write global worker_heartbeats.
        return None

    def heartbeat(self, job_id: str, worker_id: str) -> None:
        self._post_repo("heartbeat", jobId=job_id, workerId=worker_id)

    def update_progress(
        self,
        job_id: str,
        *,
        progress_stage: ProgressStage | str,
        progress_pct: float | None = None,
        partial_result: dict[str, Any] | None = None,
    ) -> None:
        stage_value = (
            progress_stage.value
            if isinstance(progress_stage, ProgressStage)
            else str(progress_stage)
        )
        if stage_value.startswith("ProgressStage."):
            stage_value = stage_value.split(".", 1)[-1].lower()
        payload: dict[str, Any] = {
            "jobId": job_id,
            "progressStage": stage_value,
        }
        if progress_pct is not None:
            payload["progressPct"] = float(progress_pct)
        if partial_result is not None:
            payload["partialResult"] = partial_result
        self._post_repo("update_progress", **payload)

    def replace_transcript_segments(
        self, project_id: str, segments: list[TranscriptSegment]
    ) -> None:
        rows = [
            {
                "start": float(seg.start),
                "end": float(seg.end),
                "text": seg.text,
                "speaker": seg.speaker,
                "language": seg.language,
            }
            for seg in segments
        ]
        self._post_repo(
            "replace_transcript_segments",
            projectId=project_id,
            segments=rows,
        )

    def fetch_transcript_segments(self, project_id: str) -> list[TranscriptSegment]:
        rows = self._post_repo("fetch_transcript_segments", projectId=project_id) or []
        return [
            TranscriptSegment(
                start=float(r["start_time"]),
                end=float(r["end_time"]),
                text=str(r["text"]),
                speaker=r.get("speaker_id"),
                language=r.get("language"),
            )
            for r in rows
        ]

    def update_project(self, project_id: str, fields: dict[str, Any]) -> None:
        if not fields:
            return
        self._post_repo("update_project", projectId=project_id, fields=fields)

    def get_project(self, project_id: str) -> dict[str, Any] | None:
        return self._post_repo("get_project", projectId=project_id)

    def replace_clip_candidates(
        self,
        project_id: str,
        candidates: list[dict[str, Any]],
        *,
        selected_count: int,
    ) -> list[dict[str, Any]]:
        data = self._post_repo(
            "replace_clip_candidates",
            projectId=project_id,
            candidates=candidates,
            selectedCount=selected_count,
        )
        return list(data or [])

    def fetch_selected_clip_candidates(
        self, project_id: str, *, limit: int = 10
    ) -> list[dict[str, Any]]:
        data = self._post_repo(
            "fetch_selected_clip_candidates",
            projectId=project_id,
            limit=limit,
        )
        return list(data or [])

    def fetch_clip_candidates_by_ids(
        self, project_id: str, candidate_ids: list[str]
    ) -> list[dict[str, Any]]:
        data = self._post_repo(
            "fetch_clip_candidates_by_ids",
            projectId=project_id,
            candidateIds=candidate_ids,
        )
        return list(data or [])

    def get_clip(self, clip_id: str) -> dict[str, Any] | None:
        return self._post_repo("get_clip", clipId=clip_id)

    def upsert_rendered_clip(
        self,
        *,
        clip_id: str | None,
        project_id: str,
        user_id: str,
        job_id: str,
        candidate_id: str | None,
        title: str,
        start_time: float,
        end_time: float,
        output_format: str,
        resolution: str,
        caption_language: str,
        caption_preset: str,
        quality: str,
        storage_path: str,
        duration: float | None,
        reframe_warning: bool,
        caption_settings: dict[str, Any] | None = None,
        burn_captions: bool | None = None,
        crop_settings: dict[str, Any] | None = None,
        viral_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        row: dict[str, Any] = {
            "project_id": project_id,
            "user_id": user_id,
            "job_id": job_id,
            "candidate_id": candidate_id,
            "title": title[:500],
            "start_time": start_time,
            "end_time": end_time,
            "output_format": output_format,
            "resolution": resolution,
            "caption_language": caption_language,
            "caption_preset": caption_preset,
            "quality": quality,
            "storage_path": storage_path,
            "duration": duration,
            "reframe_warning": reframe_warning,
            "error_message": None,
        }
        if caption_settings is not None:
            row["caption_settings"] = caption_settings
        if burn_captions is not None:
            row["burn_captions"] = bool(burn_captions)
        if crop_settings is not None:
            row["crop_settings"] = crop_settings
        if viral_metadata is not None:
            row["viral_metadata"] = viral_metadata
        data = self._post_repo(
            "upsert_rendered_clip",
            clipId=clip_id,
            row=row,
        )
        return data or {"id": clip_id, **row}

    def confirm_clip_success(
        self, user_id: str, clip_id: str, job_id: str | None = None
    ) -> None:
        self._post_repo(
            "confirm_clip_success",
            clipId=clip_id,
            jobId=job_id,
        )

    def release_clip_reservation(
        self, user_id: str, job_id: str, quantity: int
    ) -> None:
        if quantity <= 0:
            return
        self._post_repo(
            "release_clip_reservation",
            jobId=job_id,
            quantity=quantity,
        )

    def mark_failed(self, job: dict[str, Any] | str, message: str) -> None:
        job_id = job if isinstance(job, str) else str(job["id"])
        self._post_repo("mark_failed", jobId=job_id, message=message[:4000])

    def mark_ready(self, job: dict[str, Any] | str, result: dict[str, Any]) -> None:
        job_id = job if isinstance(job, str) else str(job["id"])
        self._post_repo("mark_ready", jobId=job_id, result=result)

    def is_cancelled(self, job_id: str) -> bool:
        data = self._post_repo("is_cancelled", jobId=job_id) or {}
        return bool(data.get("cancelled"))
