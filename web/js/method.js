/* ═══════════════════════════════════════════════════════════════════════
   method.js — bootstrap for the method page.

   The page is an article; this file only has to keep it honest. Formulas
   come from the same derivations.js the company page opens, figures from
   methodCharts.js plus two builders borrowed from charts.js, and every
   number on display is the cached model output — KO as the lead example,
   one volatile name for the whipsaw section.
   ═══════════════════════════════════════════════════════════════════════ */

import { load, seriesOf, snapshotAt, state, rated } from "./store.js";
import { DERIVATIONS, TEACH } from "./derivations.js";
import { chartEM, chartPaths } from "./charts.js";
import { figBarrier, figDDStrip, figG, figMoodysB, figPIT, figPayoff, figTable8 } from "./methodCharts.js";
import { renderChain } from "./views/verdict.js";
import { TABLE8 } from "./fields.js";
import { esc } from "./format.js";

const LEAD = "KO";
/* names whose decade actually moved — first one present in the cache wins */
const VOLATILE = ["NCLH", "CCL", "AAL", "RCL", "UAL", "APA", "DVN", "TSLA"];

const $ = (id) => document.getElementById(id);

const mountFig = (id, svg) => {
  const el = $(id);
  if (!el) return;
  el.innerHTML = svg ?? `<div class="plate__empty"><b>No data.</b> This figure draws from the
    cached model output and the cache did not cover it.</div>`;
};

/* fill every .method__fx from its data-fx source, keeping the caption */
function mountFormulas() {
  for (const el of document.querySelectorAll("[data-fx]")) {
    const [kind, key] = el.dataset.fx.split(":");
    const html =
      kind === "teach" ? TEACH[key]?.() : DERIVATIONS[key]?.formula();
    if (html) el.insertAdjacentHTML("afterbegin", html);
  }
}

async function boot() {
  mountFormulas(); // formulas need no data — never blank on a fetch failure

  try {
    await load();
  } catch (error) {
    $("boot-error").hidden = false;
    $("boot-error").innerHTML = `<b>Could not load the cached index.</b> ${esc(error.message)}.
      The figures need <code>web/data</code>, which
      <code>python3 sp500_cache.py derive --data-out web/data</code> produces.
      The formulas above are complete without it.`;
    return;
  }

  // the whole-universe strip needs only the index
  mountFig("fig-moodysb", figMoodysB());
  mountFig("fig-payoff", figPayoff());
  mountFig("fig-barrier", figBarrier());
  mountFig("fig-ddstrip", figDDStrip(rated(), LEAD));

  // the lead name carries sections 03–05 and 08
  try {
    const series = await seriesOf(LEAD);
    const row = state.byTicker.get(LEAD);
    const cur = snapshotAt(series, (series.dates?.length ?? 1) - 1);
    mountFig("fig-g", figG(cur));
    mountFig("fig-em", chartEM(series));
    mountFig("fig-paths", chartPaths(series));
    mountFig("fig-table8", figTable8(cur, TABLE8));
    renderChain($("fig-chain"), row, cur);
  } catch {
    ["fig-g", "fig-em", "fig-paths", "fig-table8"].forEach((id) => mountFig(id, null));
  }

  // the whipsaw wants a name whose letter actually stepped
  for (const tk of VOLATILE) {
    if (!state.byTicker.get(tk)?.snaps) continue;
    try {
      const series = await seriesOf(tk);
      const fig = figPIT(series, tk);
      if (fig) { mountFig("fig-pit", fig); return finishRail(); }
    } catch { /* try the next candidate */ }
  }
  mountFig("fig-pit", null);
  finishRail();
}

/* the rail follows whichever section owns the middle of the viewport */
function finishRail() {
  const sections = [...document.querySelectorAll("section[id]")];
  const links = [...document.querySelectorAll(".rail__nav a[href^='#s-']")];
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const i = sections.indexOf(entry.target);
        links.forEach((a, j) => a.setAttribute("aria-current", String(j === i)));
      }
    },
    { rootMargin: "-45% 0px -45% 0px" }
  );
  sections.forEach((s) => observer.observe(s));
}

boot();
