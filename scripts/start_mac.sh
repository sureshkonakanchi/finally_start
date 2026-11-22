#!/usr/bin/env bash
# Start FinAlly in Docker (macOS / Linux). Idempotent: safe to run repeatedly.
#
# Usage: scripts/start_mac.sh [--build] [--no-open]
#   --build    rebuild the image even if it already exists (recreates the container)
#   --no-open  do not open a browser
# Env overrides: FINALLY_PORT (default 8000), FINALLY_IMAGE (default finally:latest)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${FINALLY_IMAGE:-finally:latest}"
CONTAINER="finally"
VOLUME="finally-data"
PORT="${FINALLY_PORT:-8000}"
URL="http://localhost:${PORT}"

BUILD=0
OPEN=1
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    --no-open) OPEN=0 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker does not appear to be running. Start Docker and try again." >&2
  exit 1
fi

cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    echo "Created .env from .env.example — add your OPENROUTER_API_KEY to enable AI chat."
  else
    touch .env
  fi
fi

if [[ "$BUILD" -eq 1 ]] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Building image $IMAGE ..."
  docker build -t "$IMAGE" "$ROOT_DIR"
  BUILD=1
fi

if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  running="$(docker container inspect -f '{{.State.Running}}' "$CONTAINER")"
  if [[ "$running" == "true" && "$BUILD" -eq 0 ]]; then
    echo "FinAlly is already running at $URL"
    [[ "$OPEN" -eq 1 ]] || exit 0
  else
    docker rm -f "$CONTAINER" >/dev/null
  fi
fi

if ! docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  docker volume create "$VOLUME" >/dev/null
  docker run -d \
    --name "$CONTAINER" \
    -p "${PORT}:8000" \
    -v "${VOLUME}:/app/db" \
    --env-file .env \
    -e FINALLY_DB_PATH=/app/db/finally.db \
    --restart unless-stopped \
    "$IMAGE" >/dev/null

  printf "Waiting for FinAlly to become healthy"
  for _ in $(seq 1 60); do
    if curl -fsS "$URL/api/health" >/dev/null 2>&1; then
      echo " ok"
      break
    fi
    printf "."
    sleep 1
  done
  echo
  echo "FinAlly is running at $URL"
  echo "Logs: docker logs -f $CONTAINER   Stop: scripts/stop_mac.sh"
fi

if [[ "$OPEN" -eq 1 ]]; then
  if command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || true
  fi
fi
