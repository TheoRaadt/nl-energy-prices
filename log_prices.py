#!/usr/bin/env python3
"""Log hourly NL day-ahead electricity prices into a local SQLite database.

Source: EnergyZero's public pricing API (no key required), which republishes
the EPEX day-ahead auction prices for the Netherlands bidding zone.
"""

import argparse
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

API_URL = "https://api.energyzero.nl/v1/energyprices"
AMSTERDAM = ZoneInfo("Europe/Amsterdam")
UTC = ZoneInfo("UTC")
DB_PATH = Path(__file__).resolve().parent / "prices.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS prices (
    date TEXT NOT NULL,
    hour INTEGER NOT NULL,
    timestamp_utc TEXT NOT NULL,
    price_eur_per_kwh REAL NOT NULL,
    incl_btw INTEGER NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (date, hour, incl_btw)
);
"""


def fetch_prices(target_date: date, incl_btw: bool) -> list[dict]:
    start = datetime.combine(target_date, datetime.min.time(), tzinfo=AMSTERDAM)
    end = start + timedelta(days=1)
    params = {
        "fromDate": start.isoformat(),
        "tillDate": end.isoformat(),
        "interval": 4,  # hourly
        "usageType": 1,  # electricity
        "inclBtw": str(incl_btw).lower(),
    }
    response = requests.get(API_URL, params=params, timeout=15)
    response.raise_for_status()
    return response.json().get("Prices", [])


def store_prices(prices: list[dict], incl_btw: bool) -> int:
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(SCHEMA)
        fetched_at = datetime.now(tz=AMSTERDAM).isoformat()
        rows = []
        for entry in prices:
            reading = datetime.fromisoformat(entry["readingDate"].replace("Z", "+00:00"))
            reading_local = reading.astimezone(AMSTERDAM)
            # The API's range is inclusive on both ends, so the response can include
            # one extra hour belonging to the next calendar day (its local midnight).
            # Keying rows by the reading's own local date (not the requested date)
            # keeps that row separate instead of colliding with hour 0 of the target day.
            rows.append((
                reading_local.date().isoformat(),
                reading_local.hour,
                reading.astimezone(UTC).isoformat(),
                entry["price"],
                int(incl_btw),
                fetched_at,
            ))
        conn.executemany(
            """
            INSERT INTO prices (date, hour, timestamp_utc, price_eur_per_kwh, incl_btw, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(date, hour, incl_btw) DO UPDATE SET
                price_eur_per_kwh = excluded.price_eur_per_kwh,
                timestamp_utc = excluded.timestamp_utc,
                fetched_at = excluded.fetched_at
            """,
            rows,
        )
        conn.commit()
        return len(rows)
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Log NL hourly day-ahead electricity prices into SQLite.")
    parser.add_argument("--date", type=str, default=None, help="Target date YYYY-MM-DD (default: today, Europe/Amsterdam).")
    parser.add_argument("--tomorrow", action="store_true", help="Fetch tomorrow's prices instead of today's.")
    parser.add_argument("--excl-btw", action="store_true", help="Store prices excluding VAT (default includes VAT).")
    args = parser.parse_args()

    today = datetime.now(tz=AMSTERDAM).date()
    if args.date:
        target_date = date.fromisoformat(args.date)
    elif args.tomorrow:
        target_date = today + timedelta(days=1)
    else:
        target_date = today

    incl_btw = not args.excl_btw

    try:
        prices = fetch_prices(target_date, incl_btw)
    except requests.RequestException as exc:
        print(f"Failed to fetch prices for {target_date}: {exc}", file=sys.stderr)
        sys.exit(1)

    if not prices:
        print(
            f"No prices returned for {target_date} yet "
            "(day-ahead prices are usually published mid-afternoon the day before).",
            file=sys.stderr,
        )
        sys.exit(1)

    count = store_prices(prices, incl_btw)
    print(f"Stored {count} hourly prices for {target_date} in {DB_PATH}")


if __name__ == "__main__":
    main()
