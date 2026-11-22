# FinAlly E2E / Integration Tests

Playwright (TypeScript) suite covering the PLAN.md §12 E2E scenarios plus API-level contract tests
for every endpoint in `planning/TEAM.md` §3.

## Layout

```
test/
├── playwright.config.ts      # BASE_URL (default http://localhost:8000), chromium, workers=1
├── docker-compose.test.yml   # app (LLM_MOCK=true, tmpfs DB) + Playwright runner
├── helpers/api.ts            # typed API helpers (portfolio, watchlist, trades, money parsing)
├── helpers/ui.ts             # data-testid helpers (openApp, placeTrade, sendChat, ...)
└── tests/
    ├── 00-fresh-start.spec.ts    # default watchlist, $10k, streaming prices, connected dot
    ├── api/                      # @api request-fixture tests: health, SSE, watchlist, portfolio, chat, static
    └── e2e/                      # UI: watchlist, trading, portfolio viz, chat (mock), SSE resilience
```

## Assumptions

- Backend runs with `LLM_MOCK=true` (mock: a message containing "buy" buys AAPL; "add <TICKER>" adds to watchlist).
- Frontend uses the `data-testid`s from TEAM.md §4.
- There is no reset endpoint and one shared user, so tests run serially (`workers: 1`) and assert relative to
  observed state. Set `E2E_FRESH_DB=true` when the DB is freshly seeded to make the "$10,000 cash" check strict
  (the compose stack does this).

## Run locally against a running app

```bash
cd test
npm ci
npx playwright install chromium
BASE_URL=http://localhost:8000 npx playwright test          # all
npx playwright test tests/api                                # API only
npx tsc --noEmit                                             # typecheck
npx playwright show-report playwright-report
```

Start the app for local runs (fresh DB):

```bash
cd frontend && npm ci && npm run build
cd ../backend && LLM_MOCK=true STATIC_DIR=../frontend/out FINALLY_DB_PATH=/tmp/finally-e2e.db \
  uv run uvicorn app.main:app --port 8000
```

## Run in Docker (CI)

```bash
docker compose -f test/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from playwright
docker compose -f test/docker-compose.test.yml down -v
```

The Playwright image tag (`v1.65.1-noble`) must match `@playwright/test` in `package.json`.

## Reports

- HTML: `test/playwright-report/index.html`
- JUnit: `test/results/junit.xml` (publish in Azure DevOps with `PublishTestResults@2`)
- Traces, screenshots, videos on failure: `test/results/artifacts/`
