"""Application configuration: paths and .env loading."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# backend/app/config.py -> parents[1] = backend/, parents[2] = repo root
BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[2]

SNAPSHOT_INTERVAL_SECONDS = 30.0


def load_env() -> None:
    """Load `.env` from the repo root (does not override variables already set)."""
    env_file = REPO_ROOT / ".env"
    if env_file.is_file():
        load_dotenv(env_file, override=False)
        logger.info("Loaded environment from %s", env_file)


def get_static_dir() -> Path:
    """Directory holding the exported frontend. Env `STATIC_DIR`, default `backend/static`."""
    return Path(os.environ.get("STATIC_DIR") or BACKEND_DIR / "static")
