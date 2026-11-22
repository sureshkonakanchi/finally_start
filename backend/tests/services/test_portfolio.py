"""Tests for app.services.portfolio (trade execution, valuation, watchlist)."""

import pytest

from app import db
from app.market import PriceCache
from app.services import portfolio as svc
from tests.conftest import StubMarketSource

pytestmark = pytest.mark.usefixtures("temp_db")


# --------------------------------------------------------------------------- trading


def test_buy_deducts_cash_and_creates_position(price_cache):
    trade = svc.execute_trade("aapl", "buy", 10, price_cache)
    assert trade["ticker"] == "AAPL"
    assert trade["side"] == "buy"
    assert trade["quantity"] == 10
    assert trade["price"] == 190.0
    assert set(trade) == {"id", "ticker", "side", "quantity", "price", "executed_at"}
    assert db.get_cash() == pytest.approx(10000 - 1900)
    pos = db.get_position(ticker="AAPL")
    assert pos["quantity"] == 10
    assert pos["avg_cost"] == pytest.approx(190.0)


def test_buy_records_trade_and_snapshot(price_cache):
    svc.execute_trade("AAPL", "buy", 1, price_cache)
    assert len(db.list_trades()) == 1
    snaps = db.list_snapshots()
    assert len(snaps) == 1
    assert snaps[0]["total_value"] == pytest.approx(10000.0)


def test_weighted_average_cost(price_cache):
    svc.execute_trade("AAPL", "buy", 10, price_cache)  # 10 @ 190
    price_cache.update("AAPL", 210.0)
    svc.execute_trade("AAPL", "buy", 30, price_cache)  # 30 @ 210
    pos = db.get_position(ticker="AAPL")
    assert pos["quantity"] == 40
    assert pos["avg_cost"] == pytest.approx((10 * 190 + 30 * 210) / 40)


def test_fractional_shares(price_cache):
    svc.execute_trade("AAPL", "buy", 0.5, price_cache)
    assert db.get_position(ticker="AAPL")["quantity"] == pytest.approx(0.5)
    assert db.get_cash() == pytest.approx(10000 - 95)


def test_insufficient_cash_rejected_without_side_effects(price_cache):
    with pytest.raises(svc.TradeError, match="Insufficient cash"):
        svc.execute_trade("NVDA", "buy", 13, price_cache)  # 10,400 > 10,000
    assert db.get_cash() == 10000.0
    assert db.get_position(ticker="NVDA") is None
    assert db.list_trades() == []
    assert db.list_snapshots() == []


def test_buy_exactly_all_cash(price_cache):
    price_cache.update("AAPL", 100.0)
    svc.execute_trade("AAPL", "buy", 100, price_cache)
    assert db.get_cash() == pytest.approx(0.0)


def test_oversell_rejected(price_cache):
    svc.execute_trade("AAPL", "buy", 5, price_cache)
    with pytest.raises(svc.TradeError, match="Insufficient shares"):
        svc.execute_trade("AAPL", "sell", 6, price_cache)
    assert db.get_position(ticker="AAPL")["quantity"] == 5


def test_sell_without_position_rejected(price_cache):
    with pytest.raises(svc.TradeError, match="Insufficient shares"):
        svc.execute_trade("AAPL", "sell", 1, price_cache)


def test_partial_sell_keeps_avg_cost(price_cache):
    svc.execute_trade("AAPL", "buy", 10, price_cache)
    price_cache.update("AAPL", 200.0)
    svc.execute_trade("AAPL", "sell", 4, price_cache)
    pos = db.get_position(ticker="AAPL")
    assert pos["quantity"] == 6
    assert pos["avg_cost"] == pytest.approx(190.0)
    assert db.get_cash() == pytest.approx(10000 - 1900 + 800)


def test_sell_all_deletes_position(price_cache):
    svc.execute_trade("AAPL", "buy", 3, price_cache)
    svc.execute_trade("AAPL", "sell", 3, price_cache)
    assert db.get_position(ticker="AAPL") is None
    assert db.list_positions() == []
    assert db.get_cash() == pytest.approx(10000.0)


def test_sell_fractional_remainder_deletes_position(price_cache):
    svc.execute_trade("AAPL", "buy", 0.1, price_cache)
    svc.execute_trade("AAPL", "buy", 0.2, price_cache)
    svc.execute_trade("AAPL", "sell", 0.3, price_cache)  # float sum 0.30000000000000004
    assert db.get_position(ticker="AAPL") is None


def test_sell_at_loss(price_cache):
    svc.execute_trade("TSLA", "buy", 10, price_cache)  # 2,500
    price_cache.update("TSLA", 200.0)
    pf = svc.get_portfolio(price_cache)
    assert pf["unrealized_pnl"] == pytest.approx(-500.0)
    svc.execute_trade("TSLA", "sell", 10, price_cache)
    assert db.get_cash() == pytest.approx(10000 - 500)
    assert svc.get_portfolio(price_cache)["total_value"] == pytest.approx(9500.0)


@pytest.mark.parametrize("qty", [0, -1, float("nan"), float("inf"), "abc", None])
def test_invalid_quantity(price_cache, qty):
    with pytest.raises(svc.TradeError, match="Quantity"):
        svc.execute_trade("AAPL", "buy", qty, price_cache)


def test_invalid_side(price_cache):
    with pytest.raises(svc.TradeError, match="side"):
        svc.execute_trade("AAPL", "short", 1, price_cache)


def test_invalid_ticker(price_cache):
    with pytest.raises(svc.TradeError, match="Invalid ticker"):
        svc.execute_trade("AAPL1", "buy", 1, price_cache)


def test_unpriced_ticker_rejected(price_cache):
    with pytest.raises(svc.TradeError, match="No price"):
        svc.execute_trade("ZZZZ", "buy", 1, price_cache)


# --------------------------------------------------------------------------- valuation


def test_empty_portfolio(price_cache):
    pf = svc.get_portfolio(price_cache)
    assert pf == {
        "cash_balance": 10000.0,
        "total_value": 10000.0,
        "positions_value": 0.0,
        "unrealized_pnl": 0.0,
        "positions": [],
    }


def test_portfolio_shape_and_math(price_cache):
    svc.execute_trade("AAPL", "buy", 10, price_cache)  # 1,900
    svc.execute_trade("MSFT", "buy", 5, price_cache)  # 2,100
    price_cache.update("AAPL", 209.0)  # +10%
    pf = svc.get_portfolio(price_cache)
    assert pf["cash_balance"] == pytest.approx(6000.0)
    assert pf["positions_value"] == pytest.approx(2090 + 2100)
    assert pf["total_value"] == pytest.approx(6000 + 2090 + 2100)
    assert pf["unrealized_pnl"] == pytest.approx(190.0)
    by = {p["ticker"]: p for p in pf["positions"]}
    aapl = by["AAPL"]
    assert set(aapl) == {
        "ticker",
        "quantity",
        "avg_cost",
        "current_price",
        "market_value",
        "unrealized_pnl",
        "unrealized_pnl_percent",
        "weight",
    }
    assert aapl["current_price"] == 209.0
    assert aapl["market_value"] == pytest.approx(2090.0)
    assert aapl["unrealized_pnl"] == pytest.approx(190.0)
    assert aapl["unrealized_pnl_percent"] == pytest.approx(10.0)
    assert sum(p["weight"] for p in pf["positions"]) == pytest.approx(1.0)


def test_portfolio_falls_back_to_avg_cost_without_price(price_cache):
    svc.execute_trade("AAPL", "buy", 2, price_cache)
    pf = svc.get_portfolio(PriceCache())
    assert pf["positions"][0]["current_price"] == 190.0
    assert pf["unrealized_pnl"] == 0.0


def test_history_oldest_first(price_cache):
    svc.record_snapshot(price_cache)
    svc.execute_trade("AAPL", "buy", 1, price_cache)
    hist = svc.get_history()
    assert len(hist) == 2
    assert hist[0]["recorded_at"] <= hist[1]["recorded_at"]
    assert set(hist[0]) == {"total_value", "recorded_at"}


# --------------------------------------------------------------------------- watchlist


def test_get_watchlist_default(price_cache):
    wl = svc.get_watchlist(price_cache)
    assert [w["ticker"] for w in wl][:2] == ["AAPL", "GOOGL"]
    assert len(wl) == 10
    assert wl[0]["price"] == 190.0
    assert set(wl[0]) == {
        "ticker",
        "price",
        "previous_price",
        "change",
        "change_percent",
        "direction",
    }


def test_get_watchlist_unpriced_ticker_has_null_price():
    wl = svc.get_watchlist(PriceCache())
    assert wl[0]["price"] is None


async def test_add_to_watchlist_updates_source():
    cache = PriceCache()
    source = StubMarketSource(cache)
    result = await svc.add_to_watchlist("pypl", source, cache)
    assert result == {"ticker": "PYPL", "price": 100.0}
    assert "PYPL" in source.get_tickers()
    assert "PYPL" in db.list_watchlist()


async def test_add_duplicate_raises_409():
    with pytest.raises(svc.TickerExistsError) as exc:
        await svc.add_to_watchlist("AAPL", None)
    assert exc.value.status_code == 409


@pytest.mark.parametrize("bad", ["", "AAPL1", "TOOLONGTICKER", "A-B", "$$$"])
async def test_add_invalid_ticker_raises_400(bad):
    with pytest.raises(svc.InvalidTickerError) as exc:
        await svc.add_to_watchlist(bad, None)
    assert exc.value.status_code == 400


async def test_add_ticker_with_dot():
    result = await svc.add_to_watchlist("brk.b", None)
    assert result["ticker"] == "BRK.B"


async def test_remove_from_watchlist_updates_source():
    cache = PriceCache()
    source = StubMarketSource(cache)
    await source.start(["AAPL", "MSFT"])
    assert await svc.remove_from_watchlist("msft", source) == {"ticker": "MSFT"}
    assert "MSFT" not in db.list_watchlist()
    assert "MSFT" not in source.get_tickers()
    assert cache.get("MSFT") is None


async def test_remove_keeps_tracking_held_position(price_cache):
    source = StubMarketSource(price_cache)
    await source.start(["AAPL"])
    svc.execute_trade("AAPL", "buy", 1, price_cache)
    await svc.remove_from_watchlist("AAPL", source)
    assert "AAPL" in source.get_tickers()
    assert "AAPL" in svc.tracked_tickers()


async def test_remove_absent_raises_404():
    with pytest.raises(svc.TickerNotFoundError) as exc:
        await svc.remove_from_watchlist("ZZZZ", None)
    assert exc.value.status_code == 404
