#!/usr/bin/env bash
# Stop and remove the FinAlly container (macOS / Linux). Idempotent.
# The finally-data volume is NOT removed — your portfolio persists.
set -euo pipefail

CONTAINER="finally"

if ! docker info >/dev/null 2>&1; then
  echo "Docker does not appear to be running; nothing to stop."
  exit 0
fi

if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  docker rm -f "$CONTAINER" >/dev/null
  echo "FinAlly stopped. Data volume 'finally-data' preserved."
else
  echo "FinAlly is not running."
fi
