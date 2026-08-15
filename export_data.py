#!/usr/bin/env python3
"""Export entsoe_prices.db and ttf_prices.db into docs/data/*.json for the
GitHub Pages dashboard (docs/index.html).

Run after each price fetch, before committing:
    python export_data.py
"""

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from statistics import mean
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "docs" / "data"
AMSTERDAM = ZoneInfo("Europe/Amsterdam")


def export_entsoe() -> None:
    db_path = ROOT / "entsoe_prices.db"
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT date, hour, timestamp_utc, price_eur_per_mwh "
        "FROM entsoe_prices ORDER BY date, hour"
    ).fetchall()
    conn.close()

    points = [
        {"date": d, "hour": h, "timestamp_utc": ts, "price": round(p, 2)}
        for d, h, ts, p in rows
    ]

    by_date: dict[str, list[float]] = {}
    for p in points:
        by_date.setdefault(p["date"], []).append(p["price"])
    days = sorted(by_date)

    latest = points[-1] if points else None
    prev_day_avg = mean(by_date[days[-2]]) if len(days) >= 2 else None
    today_avg = mean(by_date[days[-1]]) if days else None

    summary = {
        "latest_price": latest["price"] if latest else None,
        "latest_hour": latest["hour"] if latest else None,
        "latest_date": latest["date"] if latest else None,
        "today_avg": round(today_avg, 2) if today_avg is not None else None,
        "prev_day_avg": round(prev_day_avg, 2) if prev_day_avg is not None else None,
        "day_count": len(days),
        "all_time_min": round(min(p["price"] for p in points), 2) if points else None,
        "all_time_max": round(max(p["price"] for p in points), 2) if points else None,
    }

    generated_at = datetime.now(tz=AMSTERDAM).isoformat()
    (OUT_DIR / "entsoe.json").write_text(
        json.dumps(
            {"generated_at": generated_at, "summary": summary, "points": points},
            indent=None,
            separators=(",", ":"),
        )
    )


def export_ttf() -> None:
    db_path = ROOT / "ttf_prices.db"
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT date, open, high, low, close, volume "
        "FROM ttf_prices ORDER BY date"
    ).fetchall()
    conn.close()

    points = [
        {
            "date": d,
            "open": o,
            "high": h,
            "low": l,
            "close": c,
            "volume": v,
        }
        for d, o, h, l, c, v in rows
    ]

    latest = points[-1] if points else None
    prev = points[-2] if len(points) >= 2 else None
    change = None
    change_pct = None
    if latest and prev and prev["close"]:
        change = round(latest["close"] - prev["close"], 4)
        change_pct = round(change / prev["close"] * 100, 2)

    summary = {
        "latest_close": latest["close"] if latest else None,
        "latest_date": latest["date"] if latest else None,
        "change": change,
        "change_pct": change_pct,
        "period_min": round(min(p["low"] for p in points), 4) if points else None,
        "period_max": round(max(p["high"] for p in points), 4) if points else None,
    }

    generated_at = datetime.now(tz=AMSTERDAM).isoformat()
    (OUT_DIR / "ttf.json").write_text(
        json.dumps(
            {"generated_at": generated_at, "summary": summary, "points": points},
            indent=None,
            separators=(",", ":"),
        )
    )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    export_entsoe()
    export_ttf()
    print(f"Exported JSON data into {OUT_DIR}")


if __name__ == "__main__":
    main()
