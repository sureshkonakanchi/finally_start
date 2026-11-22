# Backend — Developer Guide

FastAPI + SQLite (stdlib `sqlite3`) + in-process market data. Package: `app`. Contract: `planning/TEAM.md`.

## Setup & Run

```bash
cd backend
uv sync --extra dev
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`.env` is loaded from the repo root on import of `app.main` (python-dotenv, never overrides real env vars).

| Env var | Effect |
|---|---|
| `FINALLY_DB_PATH` | SQLite file (default `<repo>/db/finally.db`) |
| `STATIC_DIR` | Exported frontend dir (default `backend/static`) |
| `MASSIVE_API_KEY` | Non-empty → real data via Massive; else GBM simulator |
| `LLM_MOCK` | `true` → deterministic chat responses |
| `OPENROUTER_API_KEY` | LLM chat |

## Layout

```
app/
  main.py          create_app(), lifespan, router wiring, validation→400 handler
  config.py        REPO_ROOT, load_env(), get_static_dir(), SNAPSHOT_INTERVAL_SECONDS
  static.py        SPA serving (catch-all registered last; /api/* always wins)
  market/          PriceCache, PriceUpdate, MarketDataSource, simulator, Massive client, SSE
  services/portfolio.py   ALL trading/valuation/watchlist logic
  api/             health.py, portfolio.py, watchlist.py, chat.py (LLM Engineer)
  db/              repositories (Database Engineer)
  llm/             chat LLM (LLM Engineer)
```

### Startup (lifespan)
`init_db()` → market source created via `create_market_data_source(app.state.price_cache)` and started
with `tracked_tickers()` (watchlist ∪ held positions) → initial portfolio snapshot → 30 s snapshot task.
App state: `app.state.price_cache`, `app.state.market_source`.

## Services (`app.services.portfolio`)

- `execute_trade(ticker, side, quantity, price_cache, user_id="default") -> trade dict` — atomic
  (`db.transaction()`): validates ticker/side/quantity (>0, finite), price in cache, cash/shares;
  weighted-average cost on buys; position row deleted when quantity reaches 0; inserts trade + snapshot.
  Raises `TradeError` (`.message`).
- `get_portfolio(price_cache)`, `get_history()`, `record_snapshot(price_cache)`
- `get_watchlist(price_cache)`, `tracked_tickers()`
- `await add_to_watchlist(ticker, market_source, price_cache=None)` → `{ticker, price}`;
  `await remove_from_watchlist(ticker, market_source)` → `{ticker}` (keeps tracking if a position is held).
  Raise `WatchlistError` subclasses with `.status_code`: `InvalidTickerError` 400,
  `TickerExistsError` 409, `TickerNotFoundError` 404. Tickers must match `^[A-Z.]{1,10}$` after upper-casing.

Never duplicate trade logic elsewhere (the LLM chat flow calls these functions).

## Market Data (`app.market`)

```python
from app.market import PriceCache, PriceUpdate, MarketDataSource, create_market_data_source, create_stream_router
```

- `PriceUpdate` — frozen dataclass (`ticker, price, previous_price, timestamp`) + `change`, `change_percent`,
  `direction`, `to_dict()`.
- `PriceCache` — thread-safe; `update/get/get_price/get_all/remove`, `version` counter.
- `MarketDataSource` — `start(tickers)`, `add_ticker`, `remove_ticker`, `get_tickers`, `stop`.
  Implementations: `SimulatorDataSource` (GBM, Cholesky-correlated, random 2–5% events, 500 ms) and
  `MassiveDataSource` (REST poll, 15 s default).
- `create_stream_router(cache)` → `GET /api/stream/prices` SSE; each `data:` is `{TICKER: PriceUpdate.to_dict()}`,
  sent every ~500 ms when the cache version changes. A fresh router per call.

## HTTP API

See `planning/TEAM.md` §3. Errors are always `{"detail": "<string>"}`; request validation errors are
returned as 400 (not FastAPI's default 422).

## Tests

```bash
uv run --extra dev pytest -v               # all
uv run --extra dev pytest --cov=app
uv run --extra dev ruff check app tests
```

Fixtures in `tests/conftest.py`: `temp_db` (fresh SQLite via `FINALLY_DB_PATH`), `price_cache` (fixed prices),
`StubMarketSource` (deterministic source; API tests monkeypatch `app.main.create_market_data_source` with it).

## Demo

```bash
uv run market_data_demo.py   # Rich terminal dashboard of the simulator
```
