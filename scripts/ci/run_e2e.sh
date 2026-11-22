#!/usr/bin/env bash
# Run the Playwright E2E suite (test/) against an already-built FinAlly image.
# Used by Azure DevOps and GitHub Actions; also works locally (Linux/macOS/Git Bash):
#   docker build -t finally:local . && scripts/ci/run_e2e.sh finally:local
#
# - Starts the app container with LLM_MOCK=true and a fresh tmpfs DB on a private docker network
#   (same setup as test/docker-compose.test.yml).
# - Runs tests inside the official Playwright image matching test/'s @playwright/test version
#   (browsers never enter the production image).
# - Reports (configured in test/playwright.config.ts): test/results/junit.xml, test/playwright-report/.
#   App log: test/results/app.log.
# - Exits non-zero if any test fails.
set -euo pipefail

IMAGE="${1:-${FINALLY_IMAGE:-finally:latest}}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_DIR="$ROOT_DIR/test"
RUN_ID="${RUN_ID:-$$}"
NETWORK="finally-e2e-$RUN_ID"
APP="finally-e2e-app-$RUN_ID"

# Git Bash on Windows: stop MSYS rewriting container paths; give Docker a Windows host path.
export MSYS_NO_PATHCONV=1
MOUNT_DIR="$(cd "$TEST_DIR" && (pwd -W 2>/dev/null || pwd))"

[[ -f "$TEST_DIR/package.json" ]] || { echo "test/package.json not found - no E2E suite to run" >&2; exit 1; }

# Resolve the exact Playwright version (lockfile first, then package.json).
PW_VERSION="${PLAYWRIGHT_VERSION:-}"
if [[ -z "$PW_VERSION" ]]; then
  PW_VERSION="$(cd "$TEST_DIR" && node -e '
    let v = "";
    try { v = require("./package-lock.json").packages["node_modules/@playwright/test"].version; } catch (e) {}
    if (!v) { const p = require("./package.json"); v = (p.devDependencies || {})["@playwright/test"] || (p.dependencies || {})["@playwright/test"] || ""; }
    process.stdout.write(v.replace(/^[^0-9]*/, ""));
  ' 2>/dev/null || true)"
fi
[[ -n "$PW_VERSION" ]] || { echo "Could not determine @playwright/test version from test/" >&2; exit 1; }
PW_IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
echo "App image:        $IMAGE"
echo "Playwright image: $PW_IMAGE"

mkdir -p "$TEST_DIR/results" "$TEST_DIR/playwright-report"

cleanup() {
  docker logs "$APP" > "$TEST_DIR/results/app.log" 2>&1 || true
  docker rm -f "$APP" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$NETWORK" >/dev/null

# tmpfs => fresh, seeded database on every run.
docker run -d --name "$APP" --network "$NETWORK" --network-alias app \
  --tmpfs /app/db:mode=1777 \
  -e LLM_MOCK=true -e MASSIVE_API_KEY= -e OPENROUTER_API_KEY=e2e-dummy \
  -e FINALLY_DB_PATH=/app/db/finally.db \
  "$IMAGE" >/dev/null

HEALTH_PY="import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3).status == 200 else 1)"
echo -n "Waiting for app health"
healthy=0
for _ in $(seq 1 60); do
  if docker exec "$APP" python -c "$HEALTH_PY" >/dev/null 2>&1; then
    healthy=1; echo " ok"; break
  fi
  echo -n "."; sleep 2
done
if [[ "$healthy" -ne 1 ]]; then
  echo; echo "App did not become healthy" >&2
  docker logs "$APP" >&2 || true
  exit 1
fi

# node_modules lives in an anonymous volume so a host (e.g. Windows) node_modules never leaks in.
# The container runs as root; reports are chowned back to the invoking user afterwards.
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"
PW_CMD='if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi || exit 1
npx playwright test; rc=$?
chown -R "$HOST_UID:$HOST_GID" results playwright-report 2>/dev/null || true
exit $rc'

set +e
docker run --rm --network "$NETWORK" --ipc=host \
  -v "$MOUNT_DIR:/work" -v /work/node_modules -w /work \
  -e CI=true \
  -e BASE_URL=http://app:8000 \
  -e E2E_FRESH_DB=true \
  -e HOST_UID="$HOST_UID" -e HOST_GID="$HOST_GID" \
  "$PW_IMAGE" \
  bash -c "$PW_CMD"
status=$?
set -e

echo "Playwright exit code: $status"
exit "$status"
