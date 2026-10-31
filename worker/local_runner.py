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

# Desktop product defaults before Settings is constructed.
os.environ.setdefault("OUTPUT_MODE", "local")
os.environ.setdefault("TRANSCRIPTION_PROVIDER", "groq_proxy")
os.environ.setdefault("LLM_PROVIDER", "heuristic")

from config import configure_logging, get_settings
from http_repo import HttpJobRepository
from main import process_job

logger = logging.getLogger(__name__)


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
    job = repo.claim_job(worker_id, job_id)
    if not job:
        logger.error("Failed to claim job %s", job_id)
        return 1

    logger.info("Processing job %s (type=%s)", job_id, job.get("job_type"))
    try:
        process_job(job, repo=repo, settings=settings)
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
