/* ═══════════════════════════════════════════════════════════════════════
   dashboard.js — the front door.

   Not a company page: nothing here belongs to one name. A search field, a
   watchlist the reader owns, one pair of dates that every figure on the page
   obeys, and the whole index underneath. Selecting a name means leaving for
   its own page, so this file never loads a company's detail views.
   ═══════════════════════════════════════════════════════════════════════ */

import { indexOfDate, load, peerSnapshots, state, subscribe } from "./store.js";
import { mountSearch } from "./views/search.js";
import { mountWatchlist } from "./views/watchlist.js";
import { mountDashDates } from "./views/dashdates.js";
import { mountRegister } from "./views/register.js";
import { chartDD, chartMigration } from "./charts.js";
import { esc } from "./format.js";
import { isIG, SCALE, ratingIdx } from "./fields.js";

const $ = (id) => document.getElementById(id);
const open = (ticker) => {
  location.href = `./t.html#${encodeURIComponent(ticker)}`;
};

async function boot() {
  try {
    await load();
  } catch (error) {
    $("boot-error").hidden = false;
    $("boot-error").innerHTML = `<b>Could not load the cached index.</b> ${esc(error.message)}.
      The site is static — it needs <code>web/data/index.json</code>, which
      <code>python3 sp500_cache.py derive --data-out web/data</code> produces.`;
    return;
  }

  const generated = state.summary?.generated_for ?? {};
  $("m-window").textContent = generated.window ? `${generated.window} trading days` : "—";
  $("m-coverage").textContent =
    `${state.summary?.rated ?? state.index.length} of ${state.index.length} rated`;

  const watchlist = mountWatchlist($("s-watchlist"), { onChange: () => repaint() });
  const dates = mountDashDates($("ctl-dates"), { onChange: () => repaint() });
  const register = mountRegister($("s-index"), { onPick: open });
  register.paint();   // the dashboard has no selection to trigger it
  mountSearch($("s-search"), {
    onPick: (ticker) => {
      // from the dashboard, searching a name adds it to the list and opens it
      watchlist.add(ticker);
      open(ticker);
    },
  });
  $("wl-add").addEventListener("click", () => $("q").focus());

  let token = 0;

  async function repaint() {
    const rows = watchlist.list.map((t) => state.byTicker.get(t)).filter(Boolean);
    // dates come from the longest history in the list, so the slider spans
    // everything the watchlist can actually show
    await dates.ensureCalendar(rows);
    const { later, earlier } = dates.selection();
    $("wl-dates").innerHTML =
      `<b>${esc(later ?? "—")}</b> against <b>${esc(earlier ?? "—")}</b>`;

    const mine = ++token;
    const cohort = await peerSnapshots(rows, later, earlier);
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

    $("p-dd").innerHTML = chartDD(cohort, { w: 520 }) ?? emptyPlate();
    $("p-mig").innerHTML = chartMigration(cohort, { w: 520, h: 320 }) ?? emptyPlate();
    $("c-dd").innerHTML = `<b>Fig 01</b> Distance to default for the list, at <b>${esc(earlier ?? "—")}</b>
      (hollow) and <b>${esc(later ?? "—")}</b> (filled). Red means the name moved toward the barrier.`;
    $("c-mig").innerHTML = `<b>Fig 02</b> Where each name's letter sat on those two days.
      The dashed rule is the investment-grade boundary.`;
    paintDistribution(cohort);
  }

  function emptyPlate() {
    return `<div class="plate__empty"><b>Nothing to plot.</b>
      The list is empty, or no name in it resolves at both dates.</div>`;
  }

  /** the list's own spread across the notch scale, not the whole index's */
  function paintDistribution(cohort) {
    const counts = new Map();
    for (const c of cohort) {
      const letter = c.snaps[0]?.spRating;
      if (letter) counts.set(letter, (counts.get(letter) ?? 0) + 1);
    }
    const present = SCALE.filter((g) => counts.has(g));
    const max = Math.max(1, ...counts.values());
    $("wl-dist").innerHTML = present.length
      ? present
          .map((g) => `<div class="dist__bar dist__bar--${isIG(g) ? "ig" : "spec"}"
                 style="height:${Math.max(8, Math.round((counts.get(g) / max) * 100))}%"
                 title="${esc(g)}: ${counts.get(g)}"></div>`)
          .join("")
        + `<div class="dist__axis" style="width:100%">
             <span>${esc(present[0])}</span><span>${esc(present[present.length - 1])}</span></div>`
      : "";
  }

  subscribe(() => {});   // the dashboard holds no selection of its own
  await repaint();
}

boot();
