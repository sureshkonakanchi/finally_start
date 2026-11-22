# FinAlly — Team Contract

PLAN.md is the product spec. This file is the **binding contract between engineers**: ownership, module
interfaces, and API response shapes. If you need to change a contract, update this file AND notify the
lead (orchestrator) in your final report — never silently diverge.

> Note: `backend/app/` was intentionally deleted. The market data subsystem must be rebuilt.
> `planning/MARKET_DATA_SUMMARY.md` and `planning/archive/` describe the previous design — reuse it.

## 1. Ownership (only edit files you own)

| Role | Owns |
|---|---|
| Backend Engineer | `backend/app/main.py`, `backend/app/config.py`, `backend/app/market/**`, `backend/app/api/**` (except `chat.py`), `backend/app/services/portfolio.py`, `backend/app/static.py`, `backend/tests/market/**`, `backend/tests/api/**`, `backend/tests/services/**`, `backend/tests/conftest.py` |
| Database Engineer | `backend/app/db/**` (schema.sql, connection, seed, repositories), `backend/tests/db/**` |
| LLM Engineer | `backend/app/llm/**`, `backend/app/api/chat.py`, `backend/tests/llm/**` |
| Frontend Engineer | `frontend/**` |
| Integration Tester | `test/**`, `planning/ISSUES.md` |
| DevOps Engineer | `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`, `db/.gitkeep`, `scripts/**`, `deploy/**`, `azure-pipelines.yml`, `.azure-pipelines/**`, `.github/workflows/ci.yml`, root `.gitignore` additions |

`backend/pyproject.toml` / `uv.lock`: shared. Use `uv add <pkg>` (from `backend/`) only — never hand-edit,
and re-run `uv lock` if it conflicts. Backend Engineer has final say.

## 2. Backend module interfaces (Python, package `app`)

### `app.db` (Database Engineer)
- DB path from env `FINALLY_DB_PATH`, default `<repo_root>/db/finally.db` (in container: `/app/db/finally.db`).
- Stdlib `sqlite3` only (no ORM). Lazy init: `init_db(path=None)` creates tables from `app/db/schema.sql` and
  seeds default user ($10,000) + 10 default tickers if empty. Idempotent.
- `get_connection()` → `sqlite3.Connection` (row_factory = sqlite3.Row, WAL mode, `check_same_thread=False`).
- Repositories (plain functions, `user_id="default"` keyword everywhere), returning dicts / dataclasses:
  - `get_cash(user_id) -> float`, `set_cash(user_id, amount)`
  - `list_watchlist(user_id) -> list[str]`, `add_watchlist(user_id, ticker) -> bool` (False if exists),
    `remove_watchlist(user_id, ticker) -> bool` (False if absent)
  - `list_positions(user_id) -> list[dict{ticker, quantity, avg_cost, updated_at}]`, `get_position(user_id, ticker)`,
    `upsert_position(user_id, ticker, quantity, avg_cost)`, `delete_position(user_id, ticker)`
  - `insert_trade(user_id, ticker, side, quantity, price) -> dict`, `list_trades(user_id, limit=100)`
  - `insert_snapshot(user_id, total_value)`, `list_snapshots(user_id, limit=1000) -> list[dict{total_value, recorded_at}]`
  - `insert_chat_message(user_id, role, content, actions: dict|None)`, `list_chat_messages(user_id, limit=20)` (oldest→newest)
  - `transaction()` context manager for atomic multi-step writes (used by trade execution).
- Tests use a temp DB via `FINALLY_DB_PATH` / `init_db(tmp_path)`.

### `app.market` (Backend Engineer)
- `PriceCache`, `PriceUpdate`, `MarketDataSource`, `create_market_data_source(cache)`, `create_stream_router(cache)`
  exactly as described in `backend/CLAUDE.md` / `planning/MARKET_DATA_SUMMARY.md`.

### `app.services.portfolio` (Backend Engineer)
- `execute_trade(ticker, side, quantity, price_cache, user_id="default") -> dict` — validates
  (quantity > 0, ticker has a price, enough cash / shares), updates cash, position (weighted avg cost; delete row at 0),
  inserts trade, records snapshot. Raises `TradeError(message)` on validation failure.
- `get_portfolio(price_cache, user_id="default") -> dict` (shape in §3).
- `add_to_watchlist / remove_from_watchlist` that also call `market_source.add_ticker/remove_ticker`.
- **The LLM engineer calls these functions** — do not duplicate trade logic in `app.llm`.

### `app.llm` (LLM Engineer)
- Follow `.claude/skills/cerebras/SKILL.md` (LiteLLM → OpenRouter, `openrouter/openai/gpt-oss-120b`,
  `extra_body={"provider": {"order": ["cerebras"]}}`, Pydantic structured output).
- `LLM_MOCK=true` → deterministic mock (must be keyword-driven so E2E can trigger a trade, e.g. message containing
  "buy" → buys 1 share of AAPL; "add <TICKER>" → watchlist add; otherwise a fixed friendly message).
- `app/api/chat.py` exposes `router` (APIRouter) with `POST /api/chat`. Needs app state: `request.app.state.price_cache`
  and `request.app.state.market_source`.

### `app.main` (Backend Engineer)
- `app = FastAPI()`; lifespan: `init_db()`, create `PriceCache` + market source, start with watchlist tickers,
  start 30 s snapshot task; store on `app.state.price_cache`, `app.state.market_source`.
- Includes routers: market stream, portfolio, watchlist, health, and `app.api.chat.router`.
- Serves static frontend from env `STATIC_DIR` (default `backend/static`, container `/app/static`) at `/`, with
  SPA fallback to `index.html`; `/api/*` always wins.
- Run: `uv run uvicorn app.main:app --host 0.0.0.0 --port 8000` (from `backend/`).

## 3. HTTP API contract (all JSON, same origin)

Errors: non-2xx with `{"detail": "<human readable message>"}`. Tickers upper-cased server-side.

- `GET /api/health` → `{"status": "ok"}`
- `GET /api/stream/prices` → SSE, each `data:` line is JSON object keyed by ticker:
  `{"AAPL": {"ticker","price","previous_price","timestamp","change","change_percent","direction"}, ...}`
- `GET /api/watchlist` → `[{"ticker","price","previous_price","change","change_percent","direction"}]` (price may be null)
- `POST /api/watchlist` `{"ticker"}` → 201 `{"ticker", "price"}`; 409 if already present; 400 if invalid (must match `^[A-Z.]{1,10}$`)
- `DELETE /api/watchlist/{ticker}` → 200 `{"ticker"}`; 404 if absent
- `GET /api/portfolio` → `{"cash_balance", "total_value", "positions_value", "unrealized_pnl",
  "positions": [{"ticker","quantity","avg_cost","current_price","market_value","unrealized_pnl","unrealized_pnl_percent","weight"}]}`
- `POST /api/portfolio/trade` `{"ticker","quantity","side":"buy"|"sell"}` → 200
  `{"trade": {"id","ticker","side","quantity","price","executed_at"}, "portfolio": <GET /api/portfolio shape>}`; 400 on validation failure
- `GET /api/portfolio/history` → `[{"total_value","recorded_at"}]` (oldest→newest)
- `POST /api/chat` `{"message"}` → `{"message": str, "trades": [{"ticker","side","quantity","price"?, "status": "executed"|"failed", "error"?}],
  "watchlist_changes": [{"ticker","action":"add"|"remove","status","error"?}]}`
- `GET /api/chat/history` → `[{"role","content","actions","created_at"}]`

## 4. Frontend testability contract (Frontend ↔ Integration Tester)

Use these `data-testid`s: `header-total-value`, `header-cash`, `connection-status` (with `data-status="connected|reconnecting|disconnected"`),
`watchlist`, `watchlist-row-<TICKER>`, `price-<TICKER>`, `watchlist-add-input`, `watchlist-add-button`, `watchlist-remove-<TICKER>`,
`main-chart`, `heatmap`, `pnl-chart`, `positions-table`, `position-row-<TICKER>`, `trade-ticker-input`, `trade-quantity-input`,
`trade-buy-button`, `trade-sell-button`, `trade-error`, `chat-panel`, `chat-input`, `chat-send-button`, `chat-message` (each message),
`chat-loading`, `chat-action` (each inline trade/watchlist confirmation).

Frontend: Next.js (App Router) + TypeScript + Tailwind, `output: 'export'`, build output `frontend/out/`.
Dev: `next dev` on 3000 with rewrites/proxy of `/api/*` → `http://localhost:8000`. Unit tests: Vitest + React Testing Library (`npm test`).

## 5. Testing & CI

- Every engineer writes unit tests for their own code and leaves them **green** before finishing.
  Backend: `cd backend && uv run --extra dev pytest` + `uv run --extra dev ruff check app tests`. Frontend: `npm test`, `npm run lint`, `npm run build`.
- E2E: `test/` Playwright (TypeScript), base URL from `BASE_URL` (default `http://localhost:8000`), `LLM_MOCK=true`.
  `test/docker-compose.test.yml` runs app + Playwright container. JUnit + HTML reports to `test/playwright-report/`, `test/results/`.
- Integration Tester logs defects in `planning/ISSUES.md` as `ISSUE-NNN | owner role | severity | status | repro | expected/actual`.
- CI/CD: Azure DevOps `azure-pipelines.yml` — stages: Unit tests (backend+frontend) → Build image → E2E (Playwright against
  built image, publish JUnit) → Push to Azure Container Registry → Deploy to Azure Container Instances (main only).
  Secrets via variable groups / service connections, never committed.

## 6. Git hygiene

Do NOT commit, push, or create branches — the lead handles git. Never write secrets into files; `.env` is gitignored.
