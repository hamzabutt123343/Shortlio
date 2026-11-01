"""
One-shot desktop job runner.

Electron spawns:
  python local_runner.py --job-id <uuid>

Uses SHORTLIO_API_URL + user JWT (no service role). Clips write to OUTPUT_DIR.
"""

from __future__ import annotations

import argparse
import logging
import os
import socket
import sys
import threading

# Desktop product defaults before Settings is constructed.
os.environ.setdefault("OUTPUT_MODE", "local")
os.environ.setdefault("TRANSCRIPTION_PROVIDER", "groq_proxy")
os.environ.setdefault("LLM_PROVIDER", "heuristic")

from config import configure_logging, get_settings
from http_repo import HttpJobRepository
from main import process_job

logger = logging.getLogger(__name__)


def _run_with_heartbeat(repo: HttpJobRepository, worker_id: str, job: dict, settings) -> None:
    """Keep job lease alive during long multi-clip FFmpeg / download stretches."""
    job_id = str(job["id"])
    stop_hb = threading.Event()

    def heartbeat_loop() -> None:
        while not stop_hb.wait(15.0):
            try:
                if repo.is_cancelled(job_id):
                    return
                repo.heartbeat(job_id, worker_id)
            except Exception:
                logger.exception("Heartbeat failed for %s", job_id)

    hb_thread = threading.Thread(target=heartbeat_loop, daemon=True, name=f"hb-{job_id[:8]}")
    hb_thread.start()
    try:
        process_job(job, repo=repo, settings=settings)
    finally:
        stop_hb.set()
        hb_thread.join(timeout=2.0)


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = argparse.ArgumentParser(description="Shortlio desktop local job runner")
    parser.add_argument("--job-id", required=True, help="Queued job UUID to claim and run")
    args = parser.parse_args(argv)

    # Rebuild settings if a previous import cached cloud defaults.
    get_settings.cache_clear()
    os.environ["OUTPUT_MODE"] = "local"
    settings = get_settings()
    if not settings.uses_http_repo():
        logger.error("SHORTLIO_API_URL is required for local_runner")
        return 2

    worker_id = settings.resolved_worker_id()
    if not worker_id.startswith("desktop:"):
        worker_id = f"desktop:{socket.gethostname()}-{worker_id}"

    repo = HttpJobRepository(settings=settings)
    job_id = args.job_id.strip()
    logger.info("Claiming job %s as %s", job_id, worker_id)
    try:
        job = repo.claim_job(worker_id, job_id)
    except Exception as exc:
        logger.exception("Failed to claim job %s", job_id)
        print(f"Claim failed: {exc}", file=sys.stderr)
        return 1
    if not job:
        logger.error("Failed to claim job %s", job_id)
        return 1

    logger.info("Processing job %s (type=%s)", job_id, job.get("job_type"))
    try:
        _run_with_heartbeat(repo, worker_id, job, settings)
    except Exception:
        logger.exception("Job %s crashed", job_id)
        try:
            repo.mark_failed(job, "Local engine crashed — see desktop logs")
        except Exception:
            logger.exception("Could not mark job failed")
        return 1
    logger.info("Job %s finished", job_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
