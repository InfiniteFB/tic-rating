/* ═══════════════════════════════════════════════════════════════════════
   main.js — bootstrap and wiring. The only module that knows the DOM ids
   and the section order; every view is handed its own mount points.

   Flow: load the index → route from the URL hash (or fall back to a default
   name) → each store change repaints the views that depend on it. Selecting
   a ticker repaints everything; the series arriving later repaints only the
   two views that need it.
   ═══════════════════════════════════════════════════════════════════════ */

import { load, select, state, subscribe } from "./store.js";
import { mountSearch } from "./views/search.js";
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

  // masthead facts, straight from the payload rather than hard-coded
  const generated = state.summary?.generated_for ?? {};
  $("m-snapshots").textContent = `${generated.prior ?? "—"} → ${generated.current ?? "—"}`;
  $("m-coverage").textContent = `${state.summary?.rated ?? state.index.length} rated / ${state.index.length}`;
  $("m-window").textContent = generated.window ? `${generated.window} trading days` : "—";

  const quote = mountQuote($("s-quote"));
  const register = mountRegister($("s-index"), { onPick: goto });
  mountSearch($("s-search"), { onPick: goto });
  renderFullTable($("app-full"));

  subscribe((s, reason) => {
    if (reason === "selected") {
      document.title = `${s.selected.ticker} — ${s.selected.snaps ? s.selected.snaps[0].spRating : "not rateable"} · TiC Rating`;
      $("subject").textContent = `${s.selected.ticker} · ${s.selected.name}`;
      $("results").hidden = false;

      renderVerdict($("verdict"), s.selected);
      renderChain($("chain"), s.selected);
      renderEntries($("t-snap"), $("t-calib"), s.selected);
      renderReading($("read-head"), $("read-body"), s.selected);
      register.paint();
    }
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
