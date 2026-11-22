"""Static frontend serving (Next.js static export) with SPA fallback.

Registered as the very last route so every `/api/*` route takes precedence.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, Response

logger = logging.getLogger(__name__)


def _resolve(static_dir: Path, path: str) -> Path | None:
    """Map a URL path to a file within static_dir, or None. Guards against traversal."""
    root = static_dir.resolve()
    candidates = []
    clean = path.strip("/")
    if clean:
        candidates += [clean, f"{clean}.html", f"{clean}/index.html"]
    # Missing assets (anything with a file extension) must 404, not fall back to HTML.
    if not Path(clean).suffix or clean.endswith(".html"):
        candidates.append("index.html")
    for c in candidates:
        try:
            target = (root / c).resolve()
        except (OSError, ValueError):
            continue
        if target.is_relative_to(root) and target.is_file():
            return target
    return None


def mount_static(app: FastAPI, static_dir: Path) -> None:
    """Serve files from static_dir at `/`, falling back to index.html for client routes."""
    if not static_dir.is_dir():
        logger.warning("Static dir %s not found; frontend will not be served", static_dir)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str) -> Response:
        if full_path == "api" or full_path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        target = _resolve(static_dir, full_path) if static_dir.is_dir() else None
        if target is None:
            return JSONResponse({"detail": "Frontend not built"}, status_code=404)
        return FileResponse(target)
