"""HTTP API tests using FastAPI TestClient with a temp DB and deterministic market source."""

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from tests.conftest import StubMarketSource


@pytest.fixture
def static_dir(tmp_path):
    d = tmp_path / "static"
    (d / "_next").mkdir(parents=True)
    (d / "index.html").write_text("<html>INDEX</html>")
    (d / "about.html").write_text("<html>ABOUT</html>")
    (d / "_next" / "app.js").write_text("console.log(1)")
    return d


@pytest.fixture
def client(temp_db, static_dir, monkeypatch):
    monkeypatch.setenv("STATIC_DIR", str(static_dir))
    monkeypatch.setattr(main_module, "create_market_data_source", StubMarketSource)
    app = main_module.create_app()
    with TestClient(app) as c:
        yield c


# --------------------------------------------------------------------------- health / startup


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_startup_wires_state(client):
    source = client.app.state.market_source
    assert source.started
    assert len(source.get_tickers()) == 10
    # an initial snapshot is recorded on startup
    assert len(client.get("/api/portfolio/history").json()) == 1


def test_stream_route_registered(client):
    paths = {getattr(r, "path", None) for r in client.app.routes}
    assert "/api/stream/prices" in paths


# --------------------------------------------------------------------------- portfolio


def test_get_portfolio_initial(client):
    r = client.get("/api/portfolio")
    assert r.status_code == 200
    body = r.json()
    assert body["cash_balance"] == 10000.0
    assert body["total_value"] == 10000.0
    assert body["positions_value"] == 0.0
    assert body["unrealized_pnl"] == 0.0
    assert body["positions"] == []


def test_trade_buy_and_sell(client):
    r = client.post("/api/portfolio/trade", json={"ticker": "aapl", "quantity": 10, "side": "buy"})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"trade", "portfolio"}
    assert set(body["trade"]) == {"id", "ticker", "side", "quantity", "price", "executed_at"}
    assert body["trade"]["ticker"] == "AAPL"
    assert body["portfolio"]["cash_balance"] == pytest.approx(8100.0)
    assert body["portfolio"]["positions"][0]["ticker"] == "AAPL"

    r = client.post("/api/portfolio/trade", json={"ticker": "AAPL", "quantity": 10, "side": "sell"})
    assert r.status_code == 200
    assert r.json()["portfolio"]["positions"] == []
    assert r.json()["portfolio"]["cash_balance"] == pytest.approx(10000.0)


def test_trade_insufficient_cash_400(client):
    r = client.post("/api/portfolio/trade", json={"ticker": "NVDA", "quantity": 100, "side": "buy"})
    assert r.status_code == 400
    assert "Insufficient cash" in r.json()["detail"]


def test_trade_oversell_400(client):
    r = client.post("/api/portfolio/trade", json={"ticker": "AAPL", "quantity": 1, "side": "sell"})
    assert r.status_code == 400
    assert "Insufficient shares" in r.json()["detail"]


@pytest.mark.parametrize(
    "payload",
    [
        {"ticker": "AAPL", "quantity": 1, "side": "hold"},
        {"ticker": "AAPL", "quantity": 0, "side": "buy"},
        {"ticker": "AAPL", "quantity": -5, "side": "buy"},
        {"ticker": "AAPL", "side": "buy"},
        {"ticker": "AAPL", "quantity": "lots", "side": "buy"},
        {"ticker": "ZZZZ", "quantity": 1, "side": "buy"},
    ],
)
def test_trade_validation_400_with_string_detail(client, payload):
    r = client.post("/api/portfolio/trade", json=payload)
    assert r.status_code == 400
    assert isinstance(r.json()["detail"], str)


def test_history_after_trade(client):
    client.post("/api/portfolio/trade", json={"ticker": "AAPL", "quantity": 1, "side": "buy"})
    r = client.get("/api/portfolio/history")
    assert r.status_code == 200
    hist = r.json()
    assert len(hist) == 2
    assert set(hist[0]) == {"total_value", "recorded_at"}
    assert hist[0]["recorded_at"] <= hist[1]["recorded_at"]


# --------------------------------------------------------------------------- watchlist


def test_get_watchlist(client):
    r = client.get("/api/watchlist")
    assert r.status_code == 200
    wl = r.json()
    assert len(wl) == 10
    assert wl[0]["ticker"] == "AAPL"
    assert wl[0]["price"] == 190.0
    assert set(wl[0]) == {"ticker", "price", "previous_price", "change", "change_percent", "direction"}


def test_add_watchlist_201(client):
    r = client.post("/api/watchlist", json={"ticker": "pypl"})
    assert r.status_code == 201
    assert r.json() == {"ticker": "PYPL", "price": 100.0}
    assert "PYPL" in client.app.state.market_source.get_tickers()
    assert "PYPL" in [w["ticker"] for w in client.get("/api/watchlist").json()]


def test_add_duplicate_409(client):
    r = client.post("/api/watchlist", json={"ticker": "AAPL"})
    assert r.status_code == 409
    assert "already" in r.json()["detail"]


@pytest.mark.parametrize("bad", ["AAPL1", "", "WAYTOOLONGTICKER", "A B"])
def test_add_invalid_400(client, bad):
    r = client.post("/api/watchlist", json={"ticker": bad})
    assert r.status_code == 400


def test_add_missing_body_400(client):
    r = client.post("/api/watchlist", json={})
    assert r.status_code == 400
    assert isinstance(r.json()["detail"], str)


def test_delete_watchlist(client):
    r = client.delete("/api/watchlist/msft")
    assert r.status_code == 200
    assert r.json() == {"ticker": "MSFT"}
    assert "MSFT" not in client.app.state.market_source.get_tickers()
    assert "MSFT" not in [w["ticker"] for w in client.get("/api/watchlist").json()]


def test_delete_absent_404(client):
    r = client.delete("/api/watchlist/ZZZZ")
    assert r.status_code == 404
    assert "detail" in r.json()


# --------------------------------------------------------------------------- static / SPA


def test_static_index(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "INDEX" in r.text


def test_static_html_page(client):
    assert "ABOUT" in client.get("/about").text


def test_static_asset(client):
    r = client.get("/_next/app.js")
    assert r.status_code == 200
    assert "console.log" in r.text


def test_spa_fallback(client):
    r = client.get("/some/client/route")
    assert r.status_code == 200
    assert "INDEX" in r.text


def test_missing_asset_404(client):
    assert client.get("/_next/missing.js").status_code == 404


def test_unknown_api_path_404_json(client):
    r = client.get("/api/does-not-exist")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")


def test_path_traversal_blocked(client):
    r = client.get("/..%2f..%2fsecret.txt")
    assert "secret" not in r.text or r.status_code == 404


def test_no_static_dir(temp_db, tmp_path, monkeypatch):
    monkeypatch.setenv("STATIC_DIR", str(tmp_path / "nope"))
    monkeypatch.setattr(main_module, "create_market_data_source", StubMarketSource)
    with TestClient(main_module.create_app()) as c:
        assert c.get("/").status_code == 404
        assert c.get("/api/health").status_code == 200
