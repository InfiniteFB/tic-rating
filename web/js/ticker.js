/* ═══════════════════════════════════════════════════════════════════════
   ticker.js — bootstrap for one company's page.

   This page answers a single question: how did this name arrive at this
   letter? So the calculation leads — chain, entries, diagnostics — and the
   comparison and appendix follow it. Anything index-wide (the register, the
   distribution, the whole grid) belongs on the dashboard, not here.
   ═══════════════════════════════════════════════════════════════════════ */

import {
  load, peerSnapshots, peers, select, setAsOf, setCompareAt, snapshots, state, subscribe,
} from "./store.js";
import { mountSearch } from "./views/search.js";
import { mountDateControl } from "./views/dates.js";
import { renderCompare } from "./views/compare.js";
import { renderVerdict, renderChain } from "./views/verdict.js";
import { mountQuote } from "./views/quote.js";
import { renderEntries } from "./views/entries.js";
import { renderDiagnostics } from "./views/diagnostics.js";
import { renderReading } from "./views/reading.js";
import { renderTickerAppendix } from "./views/appendix.js";
import { esc } from "./format.js";

const FALLBACK = "KO";
const $ = (id) => document.getElementById(id);
const fromHash = () => decodeURIComponent(location.hash.replace(/^#/, "")).trim().toUpperCase();

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

  const quote = mountQuote($("s-quote"));
  const search = mountSearch($("s-search"), { onPick: goto });
  const asOfCtl = mountDateControl($("ctl-asof"), { kind: "asof", onChange: setAsOf });
  const cmpCtl = mountDateControl($("ctl-compare"), { kind: "compare", onChange: setCompareAt });

  let peerToken = 0;

  /** everything that depends on which two days are selected */
  async function paintDated() {
    const row = state.selected;
    const [cur, prior] = snapshots();

    renderVerdict($("verdict"), row, cur, prior);
    renderChain($("chain"), row, cur);
    renderEntries($("t-snap"), $("t-calib"), row, cur, prior);
    renderCompare($("compare"), row, cur, prior);
    renderReading($("read-head"), $("read-body"), row, cur, prior);

    $("s-compare").hidden = !row?.snaps;
    asOfCtl.update(state.series, state.asOf, state.series?.dates?.length - 1,
      cur ? { date: cur.date, letter: cur.spRating } : null);
    cmpCtl.update(state.series, state.compareAt, Math.max(0, state.asOf - 1),
      prior ? { date: prior.date, letter: prior.spRating } : null);

    // draw immediately from the index, then upgrade once the peers' own series
    // land — the plates must sit at the selected dates, not at the frozen pair
    renderDiagnostics($("s-diagnostics"), row, state.series, state.seriesStatus, cur, prior, null);
    if (!row?.snaps || !cur) return;
    const token = ++peerToken;
    const cohort = await peerSnapshots(peers(row, 12), cur.date, prior?.date);
    if (token !== peerToken) return;   // a newer date won the race
    renderDiagnostics($("s-diagnostics"), row, state.series, state.seriesStatus, cur, prior, cohort);
  }

  subscribe((s, reason) => {
    if (reason === "selected") {
      const letter = s.selected.snaps ? s.selected.snaps[0].spRating : "not rateable";
      document.title = `${s.selected.ticker} — ${letter} · TiC Rating`;
      $("id-ticker").textContent = s.selected.ticker;
      $("id-name").textContent = s.selected.name;
      $("id-sector").textContent = s.selected.sector ?? "";
      search.setValue(s.selected.ticker);
      $("results").hidden = false;
    }
    paintDated();
    if (reason !== "dates") {
      quote.update(s.selected, s.series, s.seriesStatus);
      renderTickerAppendix($("s-appendix"), s.selected, s.series);
    }
  });

  const initial = fromHash();
  await goto(state.byTicker.has(initial) ? initial : FALLBACK, { replace: true });

  window.addEventListener("hashchange", () => {
    const tk = fromHash();
    if (tk && tk !== state.selected?.ticker) select(tk);
  });

  // the rail follows whichever section owns the middle of the viewport
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

async function goto(ticker, { replace = false } = {}) {
  const symbol = String(ticker).toUpperCase();
  const hash = `#${encodeURIComponent(symbol)}`;
  if (location.hash !== hash) {
    if (replace) history.replaceState(null, "", hash);
    else history.pushState(null, "", hash);
  }
  await select(symbol);
}

boot();
