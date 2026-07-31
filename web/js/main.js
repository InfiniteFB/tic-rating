/* ═══════════════════════════════════════════════════════════════════════
   main.js — bootstrap and wiring. The only module that knows the DOM ids
   and the section order; every view is handed its own mount points.

   Flow: load the index → route from the URL hash (or fall back to a default
   name) → each store change repaints the views that depend on it. Selecting
   a ticker repaints everything; the series arriving later repaints only the
   two views that need it.
   ═══════════════════════════════════════════════════════════════════════ */

import { load, select, setAsOf, setCompareAt, snapshots, state, subscribe } from "./store.js";
import { mountSearch } from "./views/search.js";
import { mountDateControl } from "./views/dates.js";
import { renderCompare } from "./views/compare.js";
import { renderVerdict, renderChain } from "./views/verdict.js";
import { mountQuote } from "./views/quote.js";
import { renderEntries } from "./views/entries.js";
import { renderDiagnostics } from "./views/diagnostics.js";
import { renderReading } from "./views/reading.js";
import { mountRegister } from "./views/register.js";
import { renderAppendix, renderFullTable } from "./views/appendix.js";
import { esc } from "./format.js";

const DEFAULT_TICKER = "KO";
const $ = (id) => document.getElementById(id);

const tickerFromHash = () => decodeURIComponent(location.hash.replace(/^#/, "")).trim().toUpperCase();

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
  const register = mountRegister($("s-index"), { onPick: goto });
  mountSearch($("s-search"), { onPick: goto });
  renderFullTable($("app-full"));

  const asOfCtl = mountDateControl($("ctl-asof"), { kind: "asof", onChange: setAsOf });
  const cmpCtl = mountDateControl($("ctl-compare"), { kind: "compare", onChange: setCompareAt });

  /** everything that depends on which two days are selected */
  function paintDated() {
    const [cur, prior] = snapshots();
    renderVerdict($("verdict"), state.selected, cur, prior);
    renderChain($("chain"), state.selected, cur);
    renderEntries($("t-snap"), $("t-calib"), state.selected, cur, prior);
    renderCompare($("compare"), state.selected, cur, prior);
    renderReading($("read-head"), $("read-body"), state.selected, cur, prior);

    $("s-compare").hidden = !state.selected?.snaps;
    // while the daily path is still loading the controls hold their place,
    // showing the dates the index already carries
    asOfCtl.update(state.series, state.asOf, state.series?.dates?.length - 1,
      cur ? { date: cur.date, letter: cur.spRating } : null);
    cmpCtl.update(state.series, state.compareAt, Math.max(0, state.asOf - 1),
      prior ? { date: prior.date, letter: prior.spRating } : null);
  }

  subscribe((s, reason) => {
    if (reason === "selected") {
      document.title = `${s.selected.ticker} — ${s.selected.snaps ? s.selected.snaps[0].spRating : "not rateable"} · TiC Rating`;
      $("subject").textContent = `${s.selected.ticker} · ${s.selected.name}`;
      $("results").hidden = false;
      register.paint();
    }
    if (reason === "dates") {
      paintDated();
      return;   // the price and diagnostics views do not depend on the date pair
    }
    paintDated();
    // the series arrives after the index views are already on screen
    quote.update(s.selected, s.series, s.seriesStatus);
    renderDiagnostics($("s-diagnostics"), s.selected, s.series, s.seriesStatus);
    renderAppendix($("s-appendix"), s.selected, s.series);
  });

  const initial = tickerFromHash();
  await goto(state.byTicker.has(initial) ? initial : DEFAULT_TICKER, { replace: true });

  window.addEventListener("hashchange", () => {
    const tk = tickerFromHash();
    if (tk && tk !== state.selected?.ticker) select(tk);
  });

  // rail follows whichever section owns the middle of the viewport
  const sections = [...document.querySelectorAll("section[id]")];
  const links = [...document.querySelectorAll(".rail__nav a")];
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
