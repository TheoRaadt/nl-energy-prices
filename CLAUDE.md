# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Automated daily collection of Dutch energy market prices (NL day-ahead electricity via ENTSO-E, TTF gas front-month futures via Yahoo Finance), stored in two SQLite databases and published as a static dashboard on GitHub Pages at `docs/`.

## Commands

```bash
pip install -r requirements.txt   # yfinance (requests is not pinned but required by entsoe_prices.py)

# Electricity (requires ENTSOE_API_KEY — email transparency@entsoe.eu for a token)
export ENTSOE_API_KEY="your-token-here"
python entsoe_prices.py --date 2026-08-08 --store
python entsoe_prices.py --tomorrow --store      # what the scheduled workflow runs
python entsoe_prices.py --json                  # print without storing

# Gas (no API key needed)
python ttf_prices.py --days 5 --store
python ttf_prices.py --date 2026-08-07
python ttf_prices.py --json

# Regenerate the dashboard's JSON from both .db files (run after any --store)
python export_data.py

# Preview docs/ locally — it fetches data/*.json, which fails under file://
cd docs && python3 -m http.server 8765
```

There are no tests, linter, or build step in this repo.

## Architecture

**Two independent, same-shaped pipelines**, each: fetch → upsert into its own SQLite db → export to `docs/data/*.json` → dashboard reads the JSON.

- `entsoe_prices.py` → `entsoe_prices.db` (table `entsoe_prices`, PK `(date, hour)`) — hourly EUR/MWh prices. ENTSO-E's XML namespace changes across schema versions, so tags are matched by local name (`_local()`), not full namespaced name.
- `ttf_prices.py` → `ttf_prices.db` (table `ttf_prices`, PK `date`) — daily OHLCV for ticker `TTF=F`. This is a delayed front-month futures quote, **not** an official day-ahead gas index (no free one exists) — don't treat it as equivalent in kind to the ENTSO-E series.
- `export_data.py` reads both `.db` files and writes flat, pre-aggregated `docs/data/entsoe.json` / `docs/data/ttf.json` (points + a `summary` block with latest/min/max/change already computed — the dashboard does not recompute stats from raw points).
- `docs/` is a static, dependency-free site (`index.html` + `app.js` + `style.css`, no build step) served by GitHub Pages from `main:/docs`. It only ever reads the two JSON files — never touches SQLite directly.

**GitHub Actions is the only writer in normal operation** (`.github/workflows/entsoe-prices.yml` at 13:30 UTC, `ttf-prices.yml` at 20:00 UTC). Each workflow: fetches → stores → runs `export_data.py` → commits the `.db` file(s) *and* `docs/data/*.json` together → pushes directly to `main` as `github-actions[bot]`. When changing either fetch script or `export_data.py`, keep this in mind:
- The `.db` files and `docs/data/*.json` must stay in sync in the same commit, since the dashboard has no other way to get updated data — if you edit fetch/export logic, regenerate and commit both.
- Both workflows `git add` and commit *both* JSON files even though each only regenerates its own db, since `export_data.py` rewrites both files every run.

Timezone handling: fetch scripts operate in `Europe/Amsterdam` for date semantics (ENTSO-E "day-ahead" days are Amsterdam-local days) but store/compare timestamps in UTC internally — see `AMSTERDAM`/`UTC` constants in `entsoe_prices.py`.
