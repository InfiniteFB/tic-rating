#!/usr/bin/env python3
"""Semi-automatic rating narration for the cached S&P 500 universe.

Two layers, deliberately split:

1. A **deterministic fact sheet** assembled here in Python. Every number is
   rendered by the same formatters the page uses (``web/js/format.js``), so a
   figure in the narration is character-for-character the figure in the card
   above it. This layer also decides *what must be said* -- the known model
   artifacts (financial-sector leverage, mega-cap optimism, a clipped alpha,
   a run that never converged) are detected from the data and handed over as
   mandatory talking points.

2. An **LLM pass** that writes only the connective prose, in the page's voice,
   over that fact sheet. It is told, in the strongest terms available, that it
   may not compute, reformat, or invent a number -- only quote the strings it
   was given.

The split is the point: the arithmetic stays where it can be audited, and the
model is left with the one job it is actually good at. ``--dry-run`` prints
layer 1 alone, which is a legible (if terse) briefing note on its own and the
fallback whenever the endpoint is down.

The LLM call goes through ``app.llm._chat``, so ``LLM_PROVIDER`` switches this
script between the OpenAI and Anthropic-compatible channels along with the rest
of the app.

    python narrate.py AAPL KO GS              # narrate three names
    python narrate.py --sample                # a spread across the rating scale
    python narrate.py BA --dry-run            # fact sheet only, no LLM call
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "web" / "data"
OUT = ROOT / "narration"

DASH = "—"

# A spread across the scale, not six flavours of AAA: a mega-cap, a defensive
# staple, a troubled industrial, two banks the model reads as distressed, and a
# genuinely leveraged issuer.
SAMPLE = ["AAPL", "KO", "BA", "GS", "F", "NCLH"]


# ── the page's formatters, ported verbatim from web/js/format.js ──────────

def _isnum(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v


def money_k(v: Any) -> str:
    """Thousands-denominated money, as moneyK() renders it."""
    if not _isnum(v):
        return DASH
    a = abs(v) * 1e3
    sign = "−" if v < 0 else ""
    for div, suffix in ((1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")):
        if a >= div:
            return f"{sign}${a / div:.2f}{suffix}"
    return f"{sign}${a:.0f}"


def usd(v: Any) -> str:
    return f"${v:.2f}" if _isnum(v) else DASH


def pct(v: Any) -> str:
    if not _isnum(v):
        return DASH
    if v == 0:
        return "0"
    p = v * 100
    a = abs(p)
    if a < 1e-3:
        return f"{p:.2e}%"
    if a < 1:
        return f"{p:.4f}%"
    if a < 10:
        return f"{p:.3f}%"
    return f"{p:.2f}%"


def num(v: Any, digits: int = 2) -> str:
    return f"{v:,.{digits}f}" if _isnum(v) else DASH


SCALE = ["AAA", "AAA-", "AA+", "AA", "AA-", "A+", "A", "A-",
         "BBB+", "BBB", "BBB-", "BB+", "BB", "BB-", "B+", "B", "B-",
         "CCC+", "CCC", "CCC-", "CC+", "CC", "CC-", "C+", "C", "C-", "D"]
IG_EDGE = SCALE.index("BBB-")


def rank(letter: str | None) -> int:
    """Position on the fine scale; an unknown or missing letter sorts last."""
    return SCALE.index(letter) if letter in SCALE else len(SCALE)


def is_ig(letter: str | None) -> bool:
    return rank(letter) <= IG_EDGE


def outlook_word(sign: Any) -> str:
    s = str(sign or "").strip()
    return {"+": "positive", "-": "negative"}.get(s, "stable")


# ── layer 1: the deterministic fact sheet ─────────────────────────────────

def _close_at(series: dict, iso: str | None) -> dict | None:
    """Close and day-move at (or just before) the snapshot date."""
    bars = (series or {}).get("ohlc") or {}
    dates = bars.get("dates") or []
    if not dates or not iso:
        return None
    i = len(dates) - 1
    while i >= 0 and dates[i] > iso:
        i -= 1
    if i < 0:
        return None
    close = bars["c"][i]
    prev = bars["c"][i - 1] if i > 0 else None
    move = (close - prev) / prev if prev else None
    return {"date": dates[i], "close": close, "move": move}


def _flags(row: dict, cur: dict) -> list[str]:
    """Known artifacts this name trips, as mandatory talking points.

    Detected from the data rather than left to the model's judgment -- an LLM
    asked to 'mention limitations if relevant' will decide they are never
    relevant.
    """
    out: list[str] = []
    sector = row.get("sector") or ""
    letter = cur.get("spRating")
    cap = (cur.get("marketCap") or 0) * 1e3

    if sector == "Financials":
        out.append(
            "SECTOR ARTIFACT (must be addressed): this is a Financials name. A "
            "bank's balance sheet is leveraged by design -- deposits and "
            "funding are liabilities the structural model reads as debt "
            "against the default point -- so the model systematically rates "
            "banks far below their agency ratings. The letter here is a "
            "statement about balance-sheet structure, not about this bank's "
            "standing with its regulator or the agencies."
        )
    if cap >= 5e11 and rank(letter) <= rank("AA"):
        out.append(
            "OPTIMISM BIAS (must be addressed): market capitalisation is over "
            "$500B and the letter is at the very top of the scale. Equity of "
            "this size sits so far above the default point that DD is pushed "
            "very high and PD collapses toward zero mechanically -- the model "
            "will rate a mega-cap near AAA almost regardless of qualitative "
            "credit concerns."
        )
    if not is_ig(letter):
        out.append(
            "SPECULATIVE GRADE: the letter is below the investment-grade edge "
            "(BBB-). Say plainly what drove it -- leverage, asset volatility, "
            "or both -- reading it off the figures given."
        )
    if _isnum(cur.get("alpha")) and cur["alpha"] < 1:
        out.append(
            f"ALPHA CLIPPED: alpha is {num(cur['alpha'], 6)}, below 1. The "
            "point-in-time to through-the-cycle mapping is being scaled back "
            "here rather than passed through untouched."
        )
    if cur.get("converged") is False:
        out.append(
            "DID NOT CONVERGE: the EM calibration failed to settle. Treat "
            "every figure downstream of the asset calibration as provisional."
        )
    if _isnum(cur.get("mu")) and abs(cur["mu"]) > 100:
        out.append(
            f"EXTREME MU: mu is {num(cur['mu'], 2)}, orders of magnitude above "
            "the usual single-digit range, which means the calibration landed "
            "somewhere degenerate. Flag it as a diagnostic wart."
        )
    return out


def fact_sheet(row: dict, series: dict) -> dict[str, Any]:
    """Assemble every pre-rendered figure the narration is allowed to use."""
    snaps = row.get("snaps") or []
    cur = snaps[0] if snaps else None
    prior = snaps[1] if len(snaps) > 1 else None
    if not cur:
        return {"ticker": row.get("ticker"), "unrateable": row.get("unrateable_reason")}

    wedge = cur["asset"] - cur["marketCap"]
    coverage = cur["asset"] / wedge if wedge else float("nan")
    bar = _close_at(series, cur.get("date"))
    rates = series.get("rate") or []
    rate = rates[-1] if rates else None

    facts = {
        "ticker": row.get("ticker"),
        "name": row.get("legalName") or row.get("name"),
        "sector": row.get("sector") or DASH,
        "date": cur.get("date"),
        "window": row.get("window"),
        "letter": cur.get("spRating"),
        "grade": "investment grade" if is_ig(cur.get("spRating")) else "speculative grade",
        "outlook": outlook_word(cur.get("outlook")),
        "close": usd(bar["close"]) if bar else DASH,
        "close_date": bar["date"] if bar else DASH,
        "day_move": (
            DASH if not bar or bar["move"] is None
            else f"{'+' if bar['move'] > 0 else '−'}{abs(bar['move'] * 100):.2f}%"
        ),
        "asset": money_k(cur.get("asset")),
        "market_cap": money_k(cur.get("marketCap")),
        "wedge": money_k(wedge),
        "coverage": f"{num(coverage, 2)}×",
        "asset_vol": pct(cur.get("assetVol")),
        "stock_vol": pct(cur.get("stockVol")),
        "asset_ret": pct(cur.get("assetRet")),
        "rate": pct(rate),
        "dd": num(cur.get("dd"), 3),
        "edf": pct(cur.get("edf")),
        "ccm": num(cur.get("ccm"), 6),
        "rs": num(cur.get("rs"), 4),
        "fp_pd": pct(cur.get("fpPd")),
        "alpha": num(cur.get("alpha"), 6),
        "sp_ccm": num(cur.get("spCcm"), 6),
        "sp_pd": pct(cur.get("spPd")),
        "rs_sp": num(cur.get("rsSp"), 4),
        "flags": _flags(row, cur),
    }

    if prior:
        facts["prior"] = {
            "date": prior.get("date"),
            "letter": prior.get("spRating"),
            "dd": num(prior.get("dd"), 3),
            "sp_pd": pct(prior.get("spPd")),
            "market_cap": money_k(prior.get("marketCap")),
            "asset_vol": pct(prior.get("assetVol")),
            "direction": (
                "unchanged" if prior.get("spRating") == cur.get("spRating")
                else "upgraded" if rank(cur.get("spRating")) < rank(prior.get("spRating"))
                else "downgraded"
            ),
        }
    return facts


def render_sheet(f: dict[str, Any]) -> str:
    """The fact sheet as text -- the LLM's input, and the --dry-run output."""
    if f.get("unrateable"):
        return f"{f['ticker']}: not rateable — {f['unrateable']}"

    lines = [
        f"TICKER: {f['ticker']}   NAME: {f['name']}   SECTOR: {f['sector']}",
        f"RATING DATE: {f['date']}   CALIBRATION WINDOW: {f['window']} trading days",
        "",
        "THE MARK",
        f"  letter (fine S&P scale)   {f['letter']}   [{f['grade']}]",
        f"  outlook                   {f['outlook']}",
        f"  through-the-cycle PD      SP_PD {f['sp_pd']}",
        "",
        "THE FIGURES A READER CHECKS FIRST",
        f"  close ({f['close_date']})       {f['close']}   ({f['day_move']} on the day)",
        f"  equity / market cap       {f['market_cap']}",
        f"  risk-free 1y (FRED DGS1)  {f['rate']}",
        f"  distance-to-default (DD)  {f['dd']} standard deviations",
        f"  RS_SP (Table 8 is read with this, not RS)   {f['rs_sp']}",
        "",
        "THE BALANCE SHEET AS THE MODEL SEES IT",
        f"  calibrated asset value    {f['asset']}",
        f"  equity                    {f['market_cap']}",
        f"  implied debt wedge        {f['wedge']}",
        f"  asset coverage            {f['coverage']}",
        "",
        "THE CALIBRATION",
        f"  asset volatility          {f['asset_vol']}   (equity volatility observed: {f['stock_vol']})",
        f"  asset return              {f['asset_ret']}",
        f"  point-in-time EDF         {f['edf']}",
        "",
        "THE CONVERSION CHAIN (point-in-time → through-the-cycle)",
        f"  CCM {f['ccm']} → RS {f['rs']} → FP_PD {f['fp_pd']} → Alpha {f['alpha']} "
        f"→ SP_CCM {f['sp_ccm']} → SP_PD {f['sp_pd']} → {f['letter']}",
    ]

    if p := f.get("prior"):
        lines += [
            "",
            f"AGAINST THE PRIOR CALIBRATION ({p['date']})",
            f"  letter                    {p['letter']} → {f['letter']}  [{p['direction']}]",
            f"  DD                        {p['dd']} → {f['dd']}",
            f"  SP_PD                     {p['sp_pd']} → {f['sp_pd']}",
            f"  equity                    {p['market_cap']} → {f['market_cap']}",
            f"  asset volatility          {p['asset_vol']} → {f['asset_vol']}",
        ]

    if f["flags"]:
        lines += ["", "MANDATORY TALKING POINTS"]
        lines += [f"  - {flag}" for flag in f["flags"]]

    return "\n".join(lines)


# ── layer 2: the LLM pass ─────────────────────────────────────────────────

SYSTEM = """\
You write the standing prose for a KMV/Merton structural credit dashboard --
the paragraphs that sit under a rating letter and explain how the model
arrived at it.

THE ONE INVIOLABLE RULE: every number you write must be copied verbatim from
the fact sheet you are given. Do not compute, round, re-scale, convert, or
approximate anything. If a figure is not on the sheet, the sentence that
needed it does not get written. You have no data beyond the sheet -- no
earnings, no news, no agency rating, no history you half-remember about the
company.

VOICE. Follow the page's own register:
- Plain, exact, understated. British-inflected financial prose.
- Em-dashes for the aside that earns its place; short sentences elsewhere.
- Name the mechanism, not the mood. "Equity sits far enough above the default
  point that DD reaches 13.25" -- never "the company is in great shape".
- No filler adjectives: no robust, solid, strong, healthy, impressive,
  significant, notable. No hedging throat-clearing: no "it is worth noting
  that", "it is important to remember".
- Never address the reader, never recommend an action, never call this a buy,
  a sell, or an investment view. The letter is a model output.
- Do not use headings, bullets, or bold inside a section's prose. Plain
  paragraphs only.

WHAT THE MODEL IS. Equity is a call option on assets, struck at the default
point. Asset value and asset volatility are reverse-engineered from observed
equity and equity volatility by an EM iteration; DD is the number of asset
standard deviations to the barrier; the first-passage PD is converted to a
through-the-cycle S&P letter through the CCM/RS/Alpha chain. RS = 100·TiC is
a diagnostic scale whose absolute level does not reconcile with the course's
worked examples -- RS_SP is the score Table 8 is actually read with. Say so
if you mention RS at all.

Every MANDATORY TALKING POINT on the sheet must be addressed somewhere in
your output, in your own prose, without copying its wording.

OUTPUT. Exactly four sections, these literal headings, nothing before or
after:

### THE MARK
Two or three sentences. The letter, what grade it is, the outlook, the date,
and the single figure that most drives it.

### THE BALANCE SHEET
Three or four sentences on calibrated assets against equity, the implied debt
wedge, asset coverage, and what the volatility calibration produced -- asset
volatility against the observed equity volatility -- ending on the DD clearance.

### THE CHAIN
Three or four sentences walking the point-in-time result through to the
letter: EDF and first-passage PD, then CCM, RS/RS_SP, Alpha, SP_CCM, SP_PD,
and the notch it lands on.

### THE CAVEAT
Three or four sentences. Every mandatory talking point, plus the standing
limitation of this model class: it sees only market prices and a balance-sheet
default point, so it is blind to anything qualitative, and it is calibrated on
one window that ends on the rating date.
"""

SECTIONS = ["THE MARK", "THE BALANCE SHEET", "THE CHAIN", "THE CAVEAT"]


def build_prompt(sheet_text: str) -> tuple[str, str]:
    return SYSTEM, (
        "Write the four sections for this name, from this fact sheet alone.\n\n"
        f"{sheet_text}\n"
    )


def split_sections(text: str, keys: list[str] = SECTIONS) -> dict[str, str]:
    """Slice ``### HEADING`` sections out of the response, tolerantly."""
    hits = []
    for key in keys:
        m = re.search(rf"###\s*{re.escape(key)}\s*", text or "", re.IGNORECASE)
        if m:
            hits.append((m.start(), m.end(), key))
    hits.sort()
    out = {k: "" for k in keys}
    for i, (_, end, key) in enumerate(hits):
        stop = hits[i + 1][0] if i + 1 < len(hits) else len(text)
        out[key] = text[end:stop].strip()
    return out


def narrate(row: dict, series: dict, *, dry_run: bool = False) -> dict[str, Any]:
    facts = fact_sheet(row, series)
    sheet = render_sheet(facts)
    result: dict[str, Any] = {
        "ticker": facts.get("ticker"),
        "name": facts.get("name"),
        "date": facts.get("date"),
        "letter": facts.get("letter"),
        "fact_sheet": sheet,
        "sections": {},
        "model": None,
        "error": None,
    }
    if dry_run or facts.get("unrateable"):
        return result

    from app.env import load_dotenv  # deferred: --dry-run needs neither .env nor the SDKs

    load_dotenv()
    from app import llm

    system, user = build_prompt(sheet)
    result["model"] = llm._model()
    try:
        t0 = time.time()
        text = llm._chat(system, user)
        result["sections"] = split_sections(text)
        result["seconds"] = round(time.time() - t0, 1)
        if not any(result["sections"].values()):
            result["error"] = "no recognisable sections in the response"
            result["raw"] = text
    except Exception as exc:  # noqa: BLE001 - narration must never crash a batch
        result["error"] = f"{type(exc).__name__}: {exc}"
    return result


# ── driver ────────────────────────────────────────────────────────────────

def load_universe() -> dict[str, dict]:
    rows = json.loads((DATA / "index.json").read_text())
    return {r["ticker"]: r for r in rows}


def load_series(ticker: str) -> dict:
    path = DATA / "series" / f"{ticker}.json"
    return json.loads(path.read_text()) if path.is_file() else {}


def as_markdown(r: dict) -> str:
    head = f"## {r['ticker']} — {r['name']}\n\n**{r['letter']}** · {r['date']}"
    if r.get("model"):
        head += f" · narrated by `{r['model']}`"
    body = "\n\n".join(
        f"**{k.title()}**\n\n{v}" for k, v in (r.get("sections") or {}).items() if v
    )
    if r.get("error"):
        body = f"_narration failed: {r['error']}_"
    return f"{head}\n\n{body}\n\n<details><summary>fact sheet</summary>\n\n```\n{r['fact_sheet']}\n```\n</details>\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("tickers", nargs="*", help="symbols to narrate")
    ap.add_argument("--sample", action="store_true",
                    help=f"narrate a spread across the scale: {' '.join(SAMPLE)}")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the fact sheet only; no LLM call")
    ap.add_argument("--out", type=Path, default=OUT, help=f"output directory (default {OUT.name}/)")
    args = ap.parse_args(argv)

    tickers = [t.upper() for t in (args.tickers or (SAMPLE if args.sample else []))]
    if not tickers:
        ap.error("give one or more tickers, or --sample")

    universe = load_universe()
    missing = [t for t in tickers if t not in universe]
    if missing:
        print(f"not in the cached universe: {', '.join(missing)}", file=sys.stderr)
        tickers = [t for t in tickers if t in universe]

    results = []
    for ticker in tickers:
        r = narrate(universe[ticker], load_series(ticker), dry_run=args.dry_run)
        results.append(r)
        if args.dry_run:
            print(r["fact_sheet"], "\n")
            continue
        status = r["error"] or f"{r.get('seconds')}s · {r['model']}"
        print(f"{ticker:6} {r['letter']:5} {status}", file=sys.stderr)

    if args.dry_run:
        return 0

    args.out.mkdir(parents=True, exist_ok=True)
    for r in results:
        (args.out / f"{r['ticker']}.json").write_text(
            json.dumps(r, indent=2, ensure_ascii=False))
    (args.out / "README.md").write_text(
        "# Narrated ratings\n\n"
        "Generated by `narrate.py`: the figures are assembled deterministically "
        "from `web/data/`, the prose around them is written by the configured "
        "LLM channel. Regenerate with `python narrate.py --sample`.\n\n"
        + "\n".join(as_markdown(r) for r in results))
    print(f"\n→ {args.out}/ ({len(results)} names)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
