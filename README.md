# nl-energy-prices

Automated collection of Dutch energy market prices, fetched daily via GitHub Actions and stored in SQLite.

## What's in here

| Script | Source | Data | Frequency | Schedule |
|---|---|---|---|---|
| `entsoe_prices.py` | [ENTSO-E Transparency Platform](https://transparency.entsoe.eu/) | NL day-ahead electricity price (EUR/MWh) | Hourly (24 prices/day) | Daily, 13:30 UTC |
| `ttf_prices.py` | [Yahoo Finance](https://finance.yahoo.com/quote/TTF=F/) (`TTF=F`) | Dutch TTF gas front-month future (EUR/MWh) | Daily | Daily, 20:00 UTC |

Each script writes to its own SQLite database (`entsoe_prices.db`, `ttf_prices.db`), which the corresponding GitHub Actions workflow commits back into the repo automatically. A CSV export is also uploaded as a workflow artifact (30-day retention) on each run.

## Electricity — `entsoe_prices.py`

Pulls NL day-ahead auction prices (document type `A44`) from the ENTSO-E Transparency Platform REST API.

```bash
export ENTSOE_API_KEY="your-token-here"
python entsoe_prices.py --date 2026-08-08 --store
```

Requires a free ENTSO-E API key — request one via email to `transparency@entsoe.eu`, then add it as a repo secret named `ENTSOE_API_KEY` under **Settings → Secrets and variables → Actions**.

Flags: `--store`, `--tomorrow`, `--date YYYY-MM-DD`, `--json`, `--api-key`.

**Note:** ENTSO-E typically publishes tomorrow's prices around 13:00 CET. The scheduled workflow run accounts for this; manual/PR-triggered runs earlier in the day may fail with "not yet published" if run before that time.

## Gas — `ttf_prices.py`

Pulls daily OHLCV data for the TTF gas front-month future from Yahoo Finance (no API key required).

```bash
pip install yfinance
python ttf_prices.py --days 5 --store
```

Flags: `--days N` (lookback window, default 30), `--date YYYY-MM-DD` (single day), `--store`, `--json`.

**Important caveat:** unlike electricity, there is no free, officially published "day-ahead auction" price for TTF gas, and no hourly TTF price exists at all — a gas day-ahead contract is a single price per gas day, not 24 hourly prices. `TTF=F` is Yahoo's delayed (~15–20 min) quote for the **front-month calendar future**, traded on ICE Endex — a close proxy for near-term gas prices, but not the literal ICE Endex Day-Ahead index. For that, a paid feed (ICE Endex, Refinitiv, Bloomberg, or a commercial API) is required.

## Local setup

```bash
git clone https://github.com/TheoRaadt/nl-energy-prices.git
cd nl-energy-prices
pip install -r requirements.txt
```

## Automation

Both workflows live in `.github/workflows/`:

- `entsoe-prices.yml` — fetches electricity prices, commits `entsoe_prices.db`, uploads `entsoe-prices-csv` artifact
- `ttf-prices.yml` — fetches gas prices, commits `ttf_prices.db`, uploads `ttf-prices-csv` artifact

Both support `workflow_dispatch` for manual triggering from the **Actions** tab.
