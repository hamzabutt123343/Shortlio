from __future__ import annotations

import logging
import random
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Callable

from config import Settings, get_settings
from db import JobRepository

logger = logging.getLogger(__name__)

try:
    import redis
except ImportError:  # pragma: no cover
    redis = None  # type: ignore


class WorkerQueue:
    """Poll Supabase for jobs and dispatch with bounded concurrency."""

    def __init__(
        self,
        process_fn: Callable[[dict], None],
        *,
        settings: Settings | None = None,
        repo: JobRepository | None = None,
    ):
        self.settings = settings or get_settings()
        self.worker_id = self.settings.resolved_worker_id()
        self.repo = repo or JobRepository(settings=self.settings)
        self.process_fn = process_fn
        self._stop = threading.Event()
        self._executor = ThreadPoolExecutor(max_workers=self.settings.worker_concurrency)
        self._active: set[str] = set()
        self._lock = threading.Lock()
        self._redis = self._connect_redis()

    def _connect_redis(self):
        if not self.settings.redis_url.strip() or redis is None:
            return None
        try:
            client = redis.from_url(self.settings.redis_url, decode_responses=True)
            client.ping()
            logger.info("Redis connected for optional coordination")
            return client
        except Exception as exc:
            logger.warning("Redis unavailable, continuing without it: %s", exc)
            return None

    def stop(self) -> None:
        self._stop.set()

    def _backoff_seconds(self, empty_polls: int) -> float:
        base = min(30.0, 0.5 * (2 ** min(empty_polls, 6)))
        return base + random.uniform(0, 0.25)

    def _can_accept(self) -> bool:
        with self._lock:
            return len(self._active) < self.settings.worker_concurrency

    def _on_done(self, job_id: str, fut: Future) -> None:
        with self._lock:
            self._active.discard(job_id)
        try:
            fut.result()
        except Exception:
            logger.exception("Job %s raised in worker thread", job_id)

    def _dispatch(self, job: dict) -> None:
        job_id = str(job["id"])
        with self._lock:
            if job_id in self._active:
                return
            if len(self._active) >= self.settings.worker_concurrency:
                return
            self._active.add(job_id)

        fut = self._executor.submit(self._run_with_heartbeat, job)
        fut.add_done_callback(lambda f: self._on_done(job_id, f))

    def _run_with_heartbeat(self, job: dict) -> None:
        job_id = str(job["id"])
        stop_hb = threading.Event()

        def heartbeat_loop() -> None:
            while not stop_hb.wait(20.0):
                try:
                    if self.repo.is_cancelled(job_id):
                        return
                    self.repo.heartbeat(job_id, self.worker_id)
                except Exception:
                    logger.exception("Heartbeat failed for %s", job_id)

        hb_thread = threading.Thread(target=heartbeat_loop, daemon=True)
        hb_thread.start()
        try:
            self.process_fn(job)
        finally:
            stop_hb.set()
            hb_thread.join(timeout=2.0)

    def _poll_worker_heartbeat(self) -> None:
        try:
            self.repo.upsert_worker_heartbeat(
                self.worker_id,
                metadata={
                    "concurrency": self.settings.worker_concurrency,
                    "active_jobs": len(self._active),
                },
            )
        except Exception:
            logger.exception("Worker heartbeat upsert failed")

    def run_forever(self) -> None:
        empty_polls = 0
        logger.info(
            "Worker %s started (concurrency=%s)",
            self.worker_id,
            self.settings.worker_concurrency,
        )
        while not self._stop.is_set():
            if not self._can_accept():
                time.sleep(0.25)
                continue

            self._poll_worker_heartbeat()

            if self._redis:
                try:
                    if not self._redis.set(
                        f"shortlio:worker:{self.worker_id}:alive",
                        "1",
                        ex=60,
                    ):
                        pass
                except Exception:
                    logger.debug("Redis heartbeat skipped")

            try:
                job = self.repo.claim_job(self.worker_id)
            except Exception:
                logger.exception("claim_next_job failed")
                time.sleep(self._backoff_seconds(empty_polls))
                empty_polls += 1
                continue

            if not job:
                empty_polls += 1
                time.sleep(self._backoff_seconds(empty_polls))
                continue

            empty_polls = 0
            self._dispatch(job)

        logger.info("Shutting down worker queue…")
        self._executor.shutdown(wait=True, cancel_futures=False)
