from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from supabase import Client, create_client

from config import Settings, get_settings
from pipeline.stages import JobStatus, ProgressStage
from pipeline.transcript import TranscriptSegment

logger = logging.getLogger(__name__)

_INSERT_CHUNK = 200


def get_supabase(settings: Settings | None = None) -> Client:
    s = settings or get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_missing_viral_metadata_column(exc: BaseException) -> bool:
    """True when PostgREST/Postgres reports clips.viral_metadata is absent."""
    text = str(exc).lower()
    if "viral_metadata" not in text:
        return False
    return (
        "pgrst204" in text
        or "42703" in text
        or "does not exist" in text
        or "schema cache" in text
        or "could not find" in text
    )


class JobRepository:
    def __init__(self, client: Client | None = None, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.client = client or get_supabase(self.settings)

    def claim_job(self, worker_id: str) -> dict[str, Any] | None:
        resp = self.client.rpc(
            "claim_next_job", {"p_worker_id": worker_id}
        ).execute()
        data = resp.data
        if not data:
            return None
        if isinstance(data, list):
            return data[0] if data else None
        return data

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        resp = (
            self.client.table("jobs")
            .select("*")
            .eq("id", job_id)
            .limit(1)
            .execute()
        )
        data = resp.data
        if isinstance(data, list):
            return data[0] if data else None
        return data

    def upsert_worker_heartbeat(
        self, worker_id: str, *, metadata: dict[str, Any] | None = None
    ) -> None:
        row: dict[str, Any] = {
            "worker_id": worker_id,
            "last_seen_at": _now_iso(),
        }
        if metadata is not None:
            row["metadata"] = metadata
        self.client.table("worker_heartbeats").upsert(
            row, on_conflict="worker_id"
        ).execute()

    def heartbeat(self, job_id: str, worker_id: str) -> None:
        self.client.table("jobs").update(
            {"heartbeat_at": _now_iso(), "worker_id": worker_id}
        ).eq("id", job_id).execute()

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
        # Python 3.11+ str(Enum) can return "ProgressStage.NAME"; always store the value.
        if stage_value.startswith("ProgressStage."):
            stage_value = stage_value.split(".", 1)[-1].lower()
        payload: dict[str, Any] = {
            "progress_stage": stage_value,
            "updated_at": _now_iso(),
        }
        if progress_pct is not None:
            payload["progress_pct"] = max(0.0, min(100.0, float(progress_pct)))
        if partial_result is not None:
            existing = self.get_job(job_id) or {}
            result = dict(existing.get("result") or {})
            result.update(partial_result)
            payload["result"] = result
        self.client.table("jobs").update(payload).eq("id", job_id).execute()

    def replace_transcript_segments(
        self, project_id: str, segments: list[TranscriptSegment]
    ) -> None:
        self.client.table("transcript_segments").delete().eq(
            "project_id", project_id
        ).execute()
        if not segments:
            return
        rows = [
            {
                "project_id": project_id,
                "start_time": float(seg.start),
                "end_time": float(seg.end),
                "text": seg.text,
                "speaker_id": seg.speaker,
                "language": seg.language,
            }
            for seg in segments
        ]
        for i in range(0, len(rows), _INSERT_CHUNK):
            self.client.table("transcript_segments").insert(
                rows[i : i + _INSERT_CHUNK]
            ).execute()

    def fetch_transcript_segments(self, project_id: str) -> list[TranscriptSegment]:
        resp = (
            self.client.table("transcript_segments")
            .select("start_time,end_time,text,speaker_id,language")
            .eq("project_id", project_id)
            .order("start_time")
            .execute()
        )
        rows = resp.data or []
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
        payload = dict(fields)
        payload["updated_at"] = _now_iso()
        self.client.table("projects").update(payload).eq("id", project_id).execute()

    def get_project(self, project_id: str) -> dict[str, Any] | None:
        resp = (
            self.client.table("projects")
            .select("id,source_title,source_metadata,source_url")
            .eq("id", project_id)
            .limit(1)
            .execute()
        )
        data = resp.data
        if isinstance(data, list) and data:
            return data[0]
        return None

    def replace_clip_candidates(
        self,
        project_id: str,
        candidates: list[dict[str, Any]],
        *,
        selected_count: int,
    ) -> list[dict[str, Any]]:
        """Replace candidates for a project.

        Preserves analyzer order: the first `selected_count` entries are marked
        selected (variety-aware picks). Explicit `selected` flags on candidates
        win when present.
        """
        self.client.table("clip_candidates").delete().eq(
            "project_id", project_id
        ).execute()
        if not candidates:
            return []
        rows: list[dict[str, Any]] = []
        for i, c in enumerate(candidates):
            start = float(c["start"])
            end = float(c["end"])
            if "selected" in c:
                is_selected = bool(c.get("selected"))
            else:
                is_selected = i < selected_count
            rows.append(
                {
                    "project_id": project_id,
                    "start_time": start,
                    "end_time": end,
                    "title": str(c.get("title", "Clip"))[:500],
                    "hook": c.get("hook"),
                    "score": float(c.get("score", 0)),
                    "explanation": c.get("explanation"),
                    "confidence": c.get("confidence"),
                    "recommended_duration": c.get("recommended_duration")
                    or max(0.0, end - start),
                    "selected": is_selected,
                }
            )
        inserted: list[dict[str, Any]] = []
        for i in range(0, len(rows), _INSERT_CHUNK):
            resp = (
                self.client.table("clip_candidates")
                .insert(rows[i : i + _INSERT_CHUNK])
                .execute()
            )
            inserted.extend(resp.data or [])
        return inserted

    def fetch_selected_clip_candidates(
        self, project_id: str, *, limit: int = 10
    ) -> list[dict[str, Any]]:
        resp = (
            self.client.table("clip_candidates")
            .select("*")
            .eq("project_id", project_id)
            .eq("selected", True)
            .order("score", desc=True)
            .limit(limit)
            .execute()
        )
        return list(resp.data or [])

    def fetch_clip_candidates_by_ids(
        self, project_id: str, candidate_ids: list[str]
    ) -> list[dict[str, Any]]:
        if not candidate_ids:
            return []
        resp = (
            self.client.table("clip_candidates")
            .select("*")
            .eq("project_id", project_id)
            .in_("id", candidate_ids)
            .execute()
        )
        by_id = {str(r["id"]): r for r in (resp.data or [])}
        return [by_id[cid] for cid in candidate_ids if cid in by_id]

    def fetch_prior_clip_ranges(
        self,
        *,
        user_id: str,
        source_url: str,
        exclude_project_id: str | None = None,
        limit: int = 80,
    ) -> list[tuple[float, float]]:
        """Prior selected timestamps for this source URL (variety across re-runs)."""
        if not user_id or not source_url:
            return []
        ranges: list[tuple[float, float]] = []
        seen: set[tuple[int, int]] = set()

        def _add(start: float, end: float) -> None:
            if end <= start:
                return
            key = (int(start * 10), int(end * 10))
            if key in seen:
                return
            seen.add(key)
            ranges.append((float(start), float(end)))

        # Rendered clips from prior projects with the same URL.
        try:
            q = (
                self.client.table("clips")
                .select("start_time,end_time,project_id,projects!inner(source_url,user_id)")
                .eq("user_id", user_id)
                .eq("projects.source_url", source_url)
                .order("created_at", desc=True)
                .limit(limit)
            )
            resp = q.execute()
            for row in resp.data or []:
                if exclude_project_id and str(row.get("project_id")) == str(
                    exclude_project_id
                ):
                    continue
                _add(float(row["start_time"]), float(row["end_time"]))
        except Exception as exc:
            logger.warning("fetch_prior_clip_ranges clips query failed: %s", exc)

        # Selected AI candidates that may not have finished rendering yet.
        try:
            q = (
                self.client.table("clip_candidates")
                .select(
                    "start_time,end_time,project_id,projects!inner(source_url,user_id)"
                )
                .eq("selected", True)
                .eq("projects.source_url", source_url)
                .eq("projects.user_id", user_id)
                .order("created_at", desc=True)
                .limit(limit)
            )
            resp = q.execute()
            for row in resp.data or []:
                if exclude_project_id and str(row.get("project_id")) == str(
                    exclude_project_id
                ):
                    continue
                _add(float(row["start_time"]), float(row["end_time"]))
        except Exception as exc:
            logger.warning(
                "fetch_prior_clip_ranges candidates query failed: %s", exc
            )

        return ranges[:limit]

    def get_clip(self, clip_id: str) -> dict[str, Any] | None:
        resp = (
            self.client.table("clips")
            .select("*")
            .eq("id", clip_id)
            .limit(1)
            .execute()
        )
        data = resp.data
        if isinstance(data, list):
            return data[0] if data else None
        return data

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
        now = _now_iso()
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
            "render_status": "ready",
            "duration": duration,
            "reframe_warning": reframe_warning,
            "error_message": None,
            "updated_at": now,
        }
        if caption_settings is not None:
            row["caption_settings"] = caption_settings
        if burn_captions is not None:
            row["burn_captions"] = bool(burn_captions)
        if crop_settings is not None:
            row["crop_settings"] = crop_settings
        if viral_metadata is not None:
            row["viral_metadata"] = viral_metadata
        try:
            return self._write_rendered_clip(clip_id, row)
        except Exception as exc:
            if viral_metadata is None or not _is_missing_viral_metadata_column(exc):
                raise
            logger.warning(
                "clips.viral_metadata missing — saving clip without metadata. "
                "Run supabase/migrations/20260320000001_viral_metadata.sql"
            )
            row.pop("viral_metadata", None)
            return self._write_rendered_clip(clip_id, row)

    def _write_rendered_clip(
        self, clip_id: str | None, row: dict[str, Any]
    ) -> dict[str, Any]:
        if clip_id:
            self.client.table("clips").update(row).eq("id", clip_id).execute()
            out = self.get_clip(clip_id)
            return out or {"id": clip_id, **row}
        row["render_status"] = "ready"
        resp = self.client.table("clips").insert(row).execute()
        data = resp.data
        if isinstance(data, list) and data:
            return data[0]
        return row

    def confirm_clip_success(
        self, user_id: str, clip_id: str, job_id: str | None = None
    ) -> None:
        self.client.rpc(
            "confirm_clip_success",
            {
                "p_user_id": user_id,
                "p_clip_id": clip_id,
                "p_job_id": job_id,
            },
        ).execute()

    def release_clip_reservation(
        self, user_id: str, job_id: str, quantity: int
    ) -> None:
        if quantity <= 0:
            return
        self.client.rpc(
            "release_clip_reservation",
            {
                "p_user_id": user_id,
                "p_job_id": job_id,
                "p_quantity": quantity,
            },
        ).execute()

    def _job_context(self, job: dict[str, Any] | str) -> tuple[dict[str, Any], str]:
        if isinstance(job, str):
            full = self.get_job(job) or {"id": job}
        else:
            full = dict(job)
            if not full.get("user_id") or full.get("requested_clip_count") is None:
                fetched = self.get_job(str(full["id"]))
                if fetched:
                    full = {**fetched, **full}
        return full, str(full["id"])

    def mark_failed(self, job: dict[str, Any] | str, message: str) -> None:
        full, job_id = self._job_context(job)
        self.client.table("jobs").update(
            {
                "status": JobStatus.FAILED.value,
                "progress_stage": ProgressStage.FAILED.value,
                "error_message": message[:4000],
                "completed_at": _now_iso(),
                "updated_at": _now_iso(),
            }
        ).eq("id", job_id).execute()

        project_id = full.get("project_id")
        user_id = full.get("user_id")
        quantity = int(full.get("requested_clip_count") or 0)
        payload_raw = full.get("payload") or {}
        if isinstance(payload_raw, str):
            try:
                payload_raw = json.loads(payload_raw)
            except json.JSONDecodeError:
                payload_raw = {}
        if payload_raw.get("mode") == "re_render" or full.get("job_type") == "re_render":
            quantity = 0
        is_re_render = (
            payload_raw.get("mode") == "re_render"
            or full.get("job_type") == "re_render"
        )
        if project_id and not is_re_render:
            try:
                self.update_project(
                    str(project_id),
                    {"status": "failed", "error_message": message[:4000]},
                )
            except Exception:
                logger.exception("Failed to update project %s", project_id)
        if user_id and quantity > 0:
            try:
                self.release_clip_reservation(str(user_id), job_id, quantity)
            except Exception:
                logger.exception("release_clip_reservation failed for job %s", job_id)

    def mark_ready(self, job: dict[str, Any] | str, result: dict[str, Any]) -> None:
        full, job_id = self._job_context(job)
        self.client.table("jobs").update(
            {
                "status": JobStatus.READY.value,
                "progress_stage": ProgressStage.READY.value,
                "progress_pct": 100.0,
                "result": result,
                "error_message": None,
                "completed_at": _now_iso(),
                "updated_at": _now_iso(),
            }
        ).eq("id", job_id).execute()

        project_id = full.get("project_id")
        if project_id:
            try:
                self.update_project(str(project_id), {"status": "ready", "error_message": None})
            except Exception:
                logger.exception("Failed to mark project %s ready", project_id)

        # Clear in-flight reservation; successful clips remain via clip_success events.
        payload_raw = full.get("payload") or {}
        if isinstance(payload_raw, str):
            try:
                payload_raw = json.loads(payload_raw)
            except json.JSONDecodeError:
                payload_raw = {}
        is_re_render = (
            payload_raw.get("mode") == "re_render"
            or full.get("job_type") == "re_render"
        )
        user_id = full.get("user_id")
        quantity = int(full.get("requested_clip_count") or 0)
        if user_id and quantity > 0 and not is_re_render:
            try:
                self.release_clip_reservation(str(user_id), job_id, quantity)
            except Exception:
                logger.exception("release_clip_reservation failed for ready job %s", job_id)

    def is_cancelled(self, job_id: str) -> bool:
        job = self.get_job(job_id)
        if not job:
            return True
        status = job.get("status")
        stage = job.get("progress_stage")
        return status == JobStatus.CANCELLED.value or stage == ProgressStage.CANCELLED.value
