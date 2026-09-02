
#!/usr/bin/env python3
"""Fetch NL day-ahead electricity prices from the ENTSO-E Transparency Platform.

ENTSO-E returns prices in EUR/MWh with full decimal precision (unlike
EnergyZero, which rounds to consumer-facing EUR/kWh). Divide by 1000 to
get EUR/kWh if you want to compare against log_prices.py's prices.db.

Requires a security token, issued by ENTSO-E via email request to
transparency@entsoe.eu (see https://transparency.entsoe.eu -> "Restful API"
in account settings once you're registered and approved).

Usage:
    export ENTSOE_API_KEY="your-token-here"
    python entsoe_prices.py --date 2026-08-05
    python entsoe_prices.py --date 2026-08-05 --json
"""

import argparse
import os
import sqlite3
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

import requests

API_URL = "https://web-api.tp.entsoe.eu/api"
NL_EIC = "10YNL----------L"  # Netherlands bidding zone
AMSTERDAM = ZoneInfo("Europe/Amsterdam")
UTC = ZoneInfo("UTC")
DB_PATH = Path(__file__).resolve().parent / "entsoe_prices.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS entsoe_prices (
    date TEXT NOT NULL,
    hour INTEGER NOT NULL,
    timestamp_utc TEXT NOT NULL,
    price_eur_per_mwh REAL NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (date, hour)
);
"""


# ENTSO-E's XML uses a namespace that changes with schema version;
# wildcard-match the local tag name instead of hardcoding it.
def _local(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _get_with_retry(
    url: str,
    params: dict,
    timeout: int = 30,
    retries: int = 3,
    backoff: int = 5,
) -> requests.Response:
    """GET with a longer timeout and retry-with-backoff on read timeouts.

    ENTSO-E occasionally takes >20s to respond around publication time;
    a single slow response shouldn't fail the whole workflow run.
    """
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            return requests.get(url, params=params, timeout=timeout)
        except requests.exceptions.ReadTimeout as exc:
            last_exc = exc
            if attempt == retries:
                raise
            wait = backoff * attempt
            print(
                f"Read timeout (attempt {attempt}/{retries}), retrying in {wait}s...",
                file=sys.stderr,
            )
            time.sleep(wait)
    # Unreachable, but keeps type-checkers happy.
    raise last_exc  # type: ignore[misc]


def fetch_day_ahead_prices(target_date: date, api_key: str) -> list[dict]:
    """Return hourly day-ahead prices (EUR/MWh) for the NL zone on target_date.

    Each item: {"hour": int, "timestamp_utc": str, "price_eur_per_mwh": float}
    """
    # ENTSO-E periods are UTC and half-open [start, end); request a full
    # local day by converting Amsterdam midnight-to-midnight into UTC.
    start_local = datetime.combine(target_date, datetime.min.time(), tzinfo=AMSTERDAM)
    end_local = start_local + timedelta(days=1)
    period_start = start_local.astimezone(UTC).strftime("%Y%m%d%H%M")
    period_end = end_local.astimezone(UTC).strftime("%Y%m%d%H%M")

    params = {
        "securityToken": api_key,
        "documentType": "A44",       # Price Document (day-ahead prices)
        "in_Domain": NL_EIC,
        "out_Domain": NL_EIC,
        "periodStart": period_start,
        "periodEnd": period_end,
    }

    response = _get_with_retry(API_URL, params, timeout=30, retries=3, backoff=5)

    if response.status_code != 200:
        # ENTSO-E returns an Acknowledgement_MarketDocument with a Reason
        # code/text on errors (bad token, no data yet, rate limit, etc.)
        raise RuntimeError(
            f"ENTSO-E API error {response.status_code}: {response.text[:500]}"
        )

    root = ET.fromstring(response.content)

    results = []
    for timeseries in root:
        if _local(timeseries.tag) != "TimeSeries":
            continue
        for period in timeseries:
            if _local(period.tag) != "Period":
                continue

            period_start_el = None
            resolution = None
            for child in period:
                tag = _local(child.tag)
                if tag == "timeInterval":
                    for sub in child:
                        if _local(sub.tag) == "start":
                            period_start_el = sub.text
                elif tag == "resolution":
                    resolution = child.text

            if period_start_el is None:
                continue
            period_start_dt = datetime.strptime(
                period_start_el, "%Y-%m-%dT%H:%MZ"
            ).replace(tzinfo=UTC)

            # Resolution is typically PT60M (hourly) or PT15M (15-min, newer).
            step_minutes = 60 if resolution == "PT60M" else 15

            for child in period:
                if _local(child.tag) != "Point":
                    continue
                position = None
                price = None
                for sub in child:
                    tag = _local(sub.tag)
                    if tag == "position":
                        position = int(sub.text)
                    elif tag == "price.amount":
                        price = float(sub.text)
                if position is None or price is None:
                    continue

                ts_utc = period_start_dt + timedelta(minutes=(position - 1) * step_minutes)
                ts_local = ts_utc.astimezone(AMSTERDAM)
                results.append({
                    "hour": ts_local.hour,
                    "timestamp_utc": ts_utc.isoformat(),
                    "price_eur_per_mwh": price,
                })

    results.sort(key=lambda r: r["timestamp_utc"])
    return results


def store_prices(prices: list[dict], target_date: date) -> int:
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(SCHEMA)
        fetched_at = datetime.now(tz=AMSTERDAM).isoformat()
        rows = [
            (
                target_date.isoformat(),
                p["hour"],
                p["timestamp_utc"],
                p["price_eur_per_mwh"],
                fetched_at,
            )
            for p in prices
        ]
        conn.executemany(
            """
            INSERT INTO entsoe_prices (date, hour, timestamp_utc, price_eur_per_mwh, fetched_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(date, hour) DO UPDATE SET
                price_eur_per_mwh = excluded.price_eur_per_mwh,
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
    parser = argparse.ArgumentParser(description="Fetch NL day-ahead prices from ENTSO-E.")
    parser.add_argument("--date", type=str, default=None, help="Target date YYYY-MM-DD (default: today, Europe/Amsterdam).")
    parser.add_argument("--tomorrow", action="store_true", help="Fetch tomorrow's prices instead of today's.")
    parser.add_argument("--json", action="store_true", help="Print raw JSON instead of a table.")
    parser.add_argument("--store", action="store_true", help="Store results in entsoe_prices.db (SQLite).")
    parser.add_argument("--api-key", type=str, default=None, help="ENTSO-E security token (default: ENTSOE_API_KEY env var).")
    args = parser.parse_args()

    api_key = args.api_key or os.environ.get("ENTSOE_API_KEY")
    if not api_key:
        print("No API key. Set ENTSOE_API_KEY or pass --api-key.", file=sys.stderr)
        sys.exit(1)

    today = datetime.now(tz=AMSTERDAM).date()
    if args.date:
        target_date = date.fromisoformat(args.date)
    elif args.tomorrow:
        target_date = today + timedelta(days=1)
    else:
        target_date = today

    try:
        prices = fetch_day_ahead_prices(target_date, api_key)
    except requests.RequestException as exc:
        print(f"Request failed: {exc}", file=sys.stderr)
        sys.exit(1)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)

    if not prices:
        print(f"No prices returned for {target_date} (not yet published, or wrong domain/token).", file=sys.stderr)
        sys.exit(1)

    if args.json:
        import json
        print(json.dumps(prices, indent=2))
    else:
        print(f"NL day-ahead prices for {target_date} (EUR/MWh):")
        for p in prices:
            eur_per_kwh = p["price_eur_per_mwh"] / 1000
            print(f"  {p['hour']:02d}:00  {p['price_eur_per_mwh']:8.2f} EUR/MWh  ({eur_per_kwh:.5f} EUR/kWh)")

    if args.store:
        count = store_prices(prices, target_date)
        print(f"Stored {count} hourly prices for {target_date} in {DB_PATH}")


if __name__ == "__main__":
    main()

