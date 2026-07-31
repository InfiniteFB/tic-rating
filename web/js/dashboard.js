/* ═══════════════════════════════════════════════════════════════════════
   dashboard.js — the front door.

   Nothing here belongs to one company. A search field, a watchlist the
   reader owns, one pair of dates that every figure obeys, four figures, and
   the whole universe underneath. Opening a name means leaving for its page.
   ═══════════════════════════════════════════════════════════════════════ */

import { load, peerSnapshots, seriesOf, state } from "./store.js";
import { mountSearch } from "./views/search.js";
import { mountWatchlist } from "./views/watchlist.js";
import { mountDashDates } from "./views/dashdates.js";
import { mountRegister } from "./views/register.js";
import { mountScatter } from "./views/scatter.js";
import { mountMultiHistory } from "./views/multiHistory.js";
import { chartDD, chartMigration } from "./charts.js";
import { esc } from "./format.js";

const $ = (id) => document.getElementById(id);
const open = (ticker) => {
  location.href = `./t.html#${encodeURIComponent(ticker)}`;
};

async function boot() {
  try {
    await load();
  } catch (error) {
    $("boot-error").hidden = false;
    $("boot-error").innerHTML = `<b>Could not load the cached data.</b> ${esc(error.message)}.
      The site is static — it needs <code>web/data/index.json</code>, which
      <code>python3 sp500_cache.py derive --data-out web/data</code> produces.`;
    return;
  }

  const generated = state.summary?.generated_for ?? {};
  $("m-window").textContent = generated.window ? `${generated.window} trading days` : "—";
  $("m-coverage").textContent =
    `${state.summary?.rated ?? state.index.length} / ${state.index.length}`;
  $("m-asof").textContent = generated.current ?? "—";

  const watchlist = mountWatchlist($("s-watchlist"), { onChange: () => repaint() });
  const dates = mountDashDates($("ctl-dates"), { onChange: () => repaint() });
  const multi = mountMultiHistory($("p-multi"));
  const scatter = mountScatter($("p-scatter"));
  const register = mountRegister($("s-universe"), { onPick: open });
  register.paint();
  mountSearch($("s-search"), {
    onPick: (ticker) => {
      watchlist.add(ticker);   // searching a name adds it, then opens it
      open(ticker);
    },
  });
  $("wl-add").addEventListener("click", () => $("q").focus());

  let token = 0;

  async function repaint() {
    const rows = watchlist.list.map((t) => state.byTicker.get(t)).filter(Boolean);
    await dates.ensureCalendar(rows);
    const { later, earlier } = dates.selection();
    $("wl-dates").innerHTML = `<b>${esc(later ?? "—")}</b> against <b>${esc(earlier ?? "—")}</b>`;

    const mine = ++token;
    const [cohort, blocks] = await Promise.all([
      peerSnapshots(rows, later, earlier),
      Promise.all(rows.map(async (r) => {
        try {
          const s = await seriesOf(r.ticker);
          return { ticker: r.ticker, block: s?.history?.[String(s.window ?? 150)] ?? null };
        } catch {
          return { ticker: r.ticker, block: null };
        }
      })),
    ]);
    if (mine !== token) return;

    const byTicker = new Map(cohort.map((c) => [c.ticker, c]));
    watchlist.paint(
      rows.map((r) => ({
        ticker: r.ticker,
        name: r.name,
        cur: byTicker.get(r.ticker)?.snaps[0] ?? null,
        prior: byTicker.get(r.ticker)?.snaps[1] ?? null,
      }))
    );

    const emptyPlate = `<div class="plate__empty"><b>Nothing to plot.</b>
      The list is empty, or no name in it resolves at both dates.</div>`;
    $("p-dd").innerHTML = chartDD(cohort, { w: 520 }) ?? emptyPlate;
    $("p-mig").innerHTML = chartMigration(cohort, { w: 520, h: 320 }) ?? emptyPlate;
    $("c-dd").innerHTML = `<b>Fig 01</b> Distance to default for the list, at <b>${esc(earlier ?? "—")}</b>
      (hollow) and <b>${esc(later ?? "—")}</b> (filled). Red means the name moved toward the barrier.
      Deep dates resolve on the weekly grid.`;
    $("c-mig").innerHTML = `<b>Fig 02</b> Where each name's letter sat on those two days.
      The dashed rule is the investment-grade boundary.`;

    const weights = new Map(rows.map((r) => [r.ticker, r.snaps?.[0]?.marketCap ?? 1]));
    multi.update(blocks, { earlier, later }, weights);
    $("c-multi").innerHTML = `<b>Fig 03</b> A decade of letters, weekly. Click a symbol to colour or grey
      its line; the dashed line is the market-value-weighted average (weights move with each week's market cap); the thin rules mark the selected pair of dates.`;

    scatter.update(state.index, new Set(watchlist.list));
    $("c-scatter").innerHTML = `<b>Fig 04</b> Market value across (log), rating down. Hover a dot for the
      name and its key figures; click to open its page. The toggle narrows the field to the watchlist.`;
  }

  await repaint();
}

boot();
