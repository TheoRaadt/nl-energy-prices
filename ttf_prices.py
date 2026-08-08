#!/usr/bin/env python3
"""
Fetch Dutch TTF Natural Gas front-month futures prices (ticker TTF=F) from
Yahoo Finance and optionally store them in a local SQLite database.

IMPORTANT — read before relying on this data:
TTF has no free, officially published "day-ahead auction" price like
ENTSO-E provides for electricity, and no "hourly" price exists for gas at
all (TTF Day-Ahead is a single price per gas day, not 24 hourly prices).
What this script pulls is Yahoo Finance's delayed daily quote for the TTF
*front-month calendar future* (ticker TTF=F, ICE/NYMEX) — a close proxy
for near-term gas prices, but not the literal ICE Endex Day-Ahead index.
For that you need a paid feed (ICE Endex, Refinitiv, Bloomberg, or a
commercial API such as oilpriceapi.com / commodities-api.com).

Usage:
    python ttf_prices.py --days 30 --store
    python ttf_prices.py --date 2026-08-07
    python ttf_prices.py --days 7 --json
"""

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone

try:
    import yfinance as yf
except ImportError:
    sys.exit("Missing dependency. Install with: pip install yfinance")

TICKER = "TTF=F"
DB_FILE = "ttf_prices.db"


def fetch_prices(days: int) -> list[dict]:
    """Fetch the last `days` of daily TTF=F OHLCV data from Yahoo Finance."""
    hist = yf.Ticker(TICKER).history(period=f"{days}d", interval="1d")
    if hist.empty:
        sys.exit(f"No data returned for {TICKER} (market closed, or Yahoo rate-limited)")

    records = []
    for ts, row in hist.iterrows():
        records.append(
            {
                "date": ts.strftime("%Y-%m-%d"),
                "open": round(float(row["Open"]), 4),
                "high": round(float(row["High"]), 4),
                "low": round(float(row["Low"]), 4),
                "close": round(float(row["Close"]), 4),
                "volume": int(row["Volume"]) if row["Volume"] == row["Volume"] else None,
            }
        )
    return records


def fetch_single_date(date: str) -> dict | None:
    """Fetch OHLCV for a single date by pulling a small window around it."""
    hist = yf.Ticker(TICKER).history(start=date, period="5d", interval="1d")
    if hist.empty:
        return None
    hist = hist[hist.index.strftime("%Y-%m-%d") == date]
    if hist.empty:
        return None
    row = hist.iloc[0]
    return {
        "date": date,
        "open": round(float(row["Open"]), 4),
        "high": round(float(row["High"]), 4),
        "low": round(float(row["Low"]), 4),
        "close": round(float(row["Close"]), 4),
        "volume": int(row["Volume"]) if row["Volume"] == row["Volume"] else None,
    }


def store_prices(records: list[dict]) -> None:
    """Upsert records into SQLite — safe to re-run for the same date."""
    conn = sqlite3.connect(DB_FILE)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ttf_prices (
            date        TEXT PRIMARY KEY,
            open        REAL,
            high        REAL,
            low         REAL,
            close       REAL,
            volume      INTEGER,
            ticker      TEXT NOT NULL DEFAULT 'TTF=F',
            fetched_at  TEXT NOT NULL
        )
        """
    )
    now = datetime.now(timezone.utc).isoformat()
    for r in records:
        conn.execute(
            """
            INSERT INTO ttf_prices (date, open, high, low, close, volume, ticker, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, 'TTF=F', ?)
            ON CONFLICT(date) DO UPDATE SET
                open=excluded.open,
                high=excluded.high,
                low=excluded.low,
                close=excluded.close,
                volume=excluded.volume,
                fetched_at=excluded.fetched_at
            """,
            (r["date"], r["open"], r["high"], r["low"], r["close"], r["volume"], now),
        )
    conn.commit()
    conn.close()


def main():
    parser = argparse.ArgumentParser(description="Fetch TTF=F gas prices from Yahoo Finance")
    parser.add_argument("--days", type=int, default=30, help="Number of trailing days to fetch (default: 30)")
    parser.add_argument("--date", type=str, help="Fetch a single date (YYYY-MM-DD) instead of a range")
    parser.add_argument("--store", action="store_true", help="Store results in SQLite (ttf_prices.db)")
    parser.add_argument("--json", action="store_true", help="Print results as JSON instead of a table")
    args = parser.parse_args()

    if args.date:
        record = fetch_single_date(args.date)
        if record is None:
            sys.exit(f"No price data for {args.date} (weekend, holiday, or not yet available)")
        records = [record]
    else:
        records = fetch_prices(args.days)

    if args.store:
        store_prices(records)

    if args.json:
        print(json.dumps(records, indent=2))
    else:
        print(f"{'Date':<12}{'Open':>10}{'High':>10}{'Low':>10}{'Close':>10}{'Volume':>12}")
        for r in records:
            vol = r["volume"] if r["volume"] is not None else "-"
            print(f"{r['date']:<12}{r['open']:>10}{r['high']:>10}{r['low']:>10}{r['close']:>10}{vol:>12}")

    if args.store:
        print(f"\nStored {len(records)} record(s) in {DB_FILE}")


if __name__ == "__main__":
    main()
