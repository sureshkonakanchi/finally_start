# syntax=docker/dockerfile:1
# FinAlly — single-container build: Next.js static export served by FastAPI on port 8000.

ARG NODE_VERSION=20
ARG PYTHON_VERSION=3.12
ARG UV_VERSION=0.13.9

# ---------------------------------------------------------------------------
# Stage 1: build the static frontend (frontend/out)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS frontend-build
WORKDIR /build/frontend
ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=true

# Install dependencies first for better layer caching.
COPY frontend/package.json frontend/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; \
    else npm install --no-audit --no-fund; fi

COPY frontend/ ./
RUN npm run build && test -f out/index.html

# ---------------------------------------------------------------------------
# Stage 2: uv binary (pinned)
# ---------------------------------------------------------------------------
FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

# ---------------------------------------------------------------------------
# Stage 3: Python runtime
# ---------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim AS runtime

COPY --from=uv /uv /uvx /usr/local/bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/backend/.venv

WORKDIR /app/backend

# Dependencies only (cached unless pyproject/uv.lock change).
COPY backend/pyproject.toml backend/uv.lock backend/README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# Application code + install the project itself.
COPY backend/ ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# Static frontend.
COPY --from=frontend-build /build/frontend/out /app/static

# Non-root user; /app/db is the volume mount point (a fresh named volume inherits this ownership).
RUN groupadd --system --gid 10001 finally \
    && useradd --system --uid 10001 --gid finally --home-dir /app --shell /usr/sbin/nologin finally \
    && mkdir -p /app/db \
    && chown -R finally:finally /app/db

ENV PATH="/app/backend/.venv/bin:${PATH}" \
    STATIC_DIR=/app/static \
    FINALLY_DB_PATH=/app/db/finally.db \
    LLM_MOCK=false

USER finally
EXPOSE 8000
VOLUME ["/app/db"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
