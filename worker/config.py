from __future__ import annotations

import ipaddress
import logging
import os
import re
import shutil
import socket
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from dotenv import load_dotenv
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()

logger = logging.getLogger(__name__)

TranscriptionProvider = Literal["local_faster_whisper", "groq"]
LLMProvider = Literal["heuristic", "groq", "gemini"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        populate_by_name=True,
    )

    supabase_url: str = Field(alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(alias="SUPABASE_SERVICE_ROLE_KEY")

    worker_concurrency: int = Field(default=2, alias="WORKER_CONCURRENCY")
    worker_id: str = Field(default="", alias="WORKER_ID")
    temp_dir: str = Field(default="", alias="TEMP_DIR")

    transcription_provider: TranscriptionProvider = Field(
        default="local_faster_whisper", alias="TRANSCRIPTION_PROVIDER"
    )
    # tiny/base are best for CPU speed; use small+ only with CUDA
    whisper_model: str = Field(default="tiny", alias="WHISPER_MODEL")
    whisper_device: str = Field(default="auto", alias="WHISPER_DEVICE")
    whisper_compute_type: str = Field(default="default", alias="WHISPER_COMPUTE_TYPE")
    whisper_beam_size: int = Field(default=1, alias="WHISPER_BEAM_SIZE")
    whisper_batch_size: int = Field(default=8, alias="WHISPER_BATCH_SIZE")
    ytdlp_js_runtime: str = Field(default="node", alias="YTDLP_JS_RUNTIME")

    llm_provider: LLMProvider = Field(default="heuristic", alias="LLM_PROVIDER")
    groq_api_key: str = Field(default="", alias="GROQ_API_KEY")
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")

    segment_padding_seconds: float = Field(default=1.5, alias="SEGMENT_PADDING_SECONDS")
    max_source_duration_seconds: float = Field(
        default=7200.0, alias="MAX_SOURCE_DURATION_SECONDS"
    )

    ffmpeg_path: str = Field(default="", alias="FFMPEG_PATH")
    ffprobe_path: str = Field(default="", alias="FFPROBE_PATH")

    redis_url: str = Field(default="", alias="REDIS_URL")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    @field_validator("worker_concurrency")
    @classmethod
    def _concurrency_positive(cls, v: int) -> int:
        return max(1, min(v, 32))

    def resolved_worker_id(self) -> str:
        if self.worker_id.strip():
            return self.worker_id.strip()
        return f"{socket.gethostname()}-{os.getpid()}"

    def resolved_temp_dir(self) -> Path:
        base = self.temp_dir.strip() or os.path.join(os.getcwd(), "tmp", "shortlio-worker")
        path = Path(base)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def resolved_ffmpeg(self) -> str:
        if self.ffmpeg_path.strip():
            return self.ffmpeg_path.strip()
        found = shutil.which("ffmpeg")
        if not found:
            raise RuntimeError("ffmpeg not found; set FFMPEG_PATH or install ffmpeg")
        return found

    def resolved_ffprobe(self) -> str:
        if self.ffprobe_path.strip():
            return self.ffprobe_path.strip()
        found = shutil.which("ffprobe")
        if not found:
            raise RuntimeError("ffprobe not found; set FFPROBE_PATH or install ffmpeg")
        return found


@lru_cache
def get_settings() -> Settings:
    return Settings()


_PRIVATE_NETWORKS = (
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
)

_BLOCKED_HOSTNAMES = frozenset(
    {"localhost", "localhost.localdomain", "metadata.google.internal"}
)


def _ip_is_private(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
        return True
    for net in _PRIVATE_NETWORKS:
        if addr in net:
            return True
    return False


def validate_public_http_url(url: str) -> str:
    """Reject SSRF targets (private IPs, localhost, non-http schemes)."""
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        raise ValueError("URL must use http or https")
    if not parsed.hostname:
        raise ValueError("URL must include a hostname")
    host = parsed.hostname.lower()
    if host in _BLOCKED_HOSTNAMES or host.endswith(".local"):
        raise ValueError("URL hostname is not allowed")

    # Literal IP in URL
    try:
        ip = ipaddress.ip_address(host)
        if _ip_is_private(ip):
            raise ValueError("URL must not point to a private or local address")
        return url.strip()
    except ValueError as exc:
        if "does not appear to be an IPv4 or IPv6 address" not in str(exc):
            if "URL must not" in str(exc) or "URL must use" in str(exc):
                raise
            # not an IP literal — resolve below
            pass

    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve hostname: {host}") from exc

    for info in infos:
        sockaddr = info[4]
        if not sockaddr:
            continue
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if _ip_is_private(ip):
            raise ValueError("URL resolves to a private or local address")

    return url.strip()


_YOUTUBE_RE = re.compile(
    r"^(https?://)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)/",
    re.I,
)


def is_youtube_url(url: str) -> bool:
    return bool(_YOUTUBE_RE.match(url.strip()))


def ytdlp_base_args(settings: Settings | None = None) -> list[str]:
    """Common yt-dlp flags (JS runtime for modern YouTube extraction)."""
    settings = settings or get_settings()
    args = ["yt-dlp", "--no-playlist"]
    runtime = (settings.ytdlp_js_runtime or "").strip()
    if runtime:
        path = shutil.which(runtime)
        args.extend(["--js-runtimes", f"{runtime}:{path}" if path else runtime])
    return args


def run_subprocess(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    timeout: float | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    if not cmd:
        raise ValueError("empty command")
    logger.debug("run: %s", " ".join(cmd))
    result = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if check and result.returncode != 0:
        stderr = (result.stderr or "").strip()
        stdout = (result.stdout or "").strip()
        detail = stderr or stdout or f"exit code {result.returncode}"
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{detail}")
    return result


def configure_logging(level: str | None = None) -> None:
    settings = get_settings()
    log_level = (level or settings.log_level).upper()
    logging.basicConfig(
        level=getattr(logging, log_level, logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
