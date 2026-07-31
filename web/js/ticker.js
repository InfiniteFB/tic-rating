/* ═══════════════════════════════════════════════════════════════════════
   ticker.js — bootstrap for one company's page.

   One question: how did this name arrive at this letter? The calculation
   leads — rating, a decade of history, the workings — and the comparison
   and appendix follow. Anything about more than one name lives on the
   dashboard, except the explicit side-by-side the reader builds here.
   ═══════════════════════════════════════════════════════════════════════ */

import { load, select, setAsOf, snapshotAt, snapshots, state, subscribe } from "./store.js";
import { mountSearch } from "./views/search.js";
import { mountDateControl } from "./views/dates.js";
import { mountHistory } from "./views/history.js";
import { mountPeersCompare } from "./views/peersCompare.js";
import { renderVerdict, renderChain } from "./views/verdict.js";
import { mountQuote } from "./views/quote.js";
import { renderEntries } from "./views/entries.js";
import { renderDiagnostics } from "./views/diagnostics.js";
import { renderReading } from "./views/reading.js";
import { mountAiReading } from "./views/aiReading.js";
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
  $("m-window").textContent = generated.detail_days
    ? `${generated.detail_days} trading days`
    : "—";

  const quote = mountQuote($("s-quote"));
  const search = mountSearch($("s-search"), { onPick: goto });
  const compare = mountPeersCompare($("compare"));
  const asOfCtl = mountDateControl($("ctl-asof"), { kind: "asof", onChange: setAsOf });
  const aiReading = mountAiReading({
    button: $("ai-generate"),
    status: $("ai-status"),
    output: $("ai-output"),
    caliber: $("ai-caliber"),
    result: $("ai-result"),
    model: $("ai-model"),
  });

  // the methodology knob lives inside the history section and repaints only
  // that chart — the verdict above always reads the default (150-day) build,
  // so moving the knob never silently rewrites the headline figures
  const history = mountHistory($("history"), {});

  function paintDated() {
    const row = state.selected;
    const [cur, prior] = snapshots();

    renderVerdict($("verdict"), row, cur, prior, state.series);
    renderChain($("chain"), row, cur);
    renderEntries($("t-snap"), $("t-calib"), row, cur, prior);
    renderReading($("read-head"), $("read-body"), row, cur, prior);
    aiReading.update(row, cur);
    renderDiagnostics($("s-diagnostics"), row, state.series, state.seriesStatus, cur, prior);

    asOfCtl.update(state.series, state.asOf, state.series?.dates?.length - 1,
      cur ? { date: cur.date, letter: cur.spRating } : null);
    $("ctl-asof").hidden = !row?.snaps;
  }

  subscribe((s, reason) => {
    if (reason === "selected") {
      const letter = s.selected.snaps ? s.selected.snaps[0].spRating : "not rateable";
      document.title = `${s.selected.ticker} — ${letter} · TiC Rating`;
      $("id-ticker").textContent = s.selected.ticker;
      $("id-name").textContent = s.selected.legalName ?? s.selected.name;
      $("id-sector").textContent = s.selected.sector ?? "";
      search.setValue(s.selected.ticker);
      $("results").hidden = false;
      compare.setSubject(s.selected.ticker);
    }
    if (reason !== "dates") {
      history.update(s.series);
      quote.update(s.selected, s.series, s.seriesStatus);
      renderTickerAppendix($("s-appendix"), s.selected, s.series);
      $("s-history").hidden = !s.series?.history;
    }
    paintDated();
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
    if (replace) window.history.replaceState(null, "", hash);
    else window.history.pushState(null, "", hash);
  }
  await select(symbol);
}

boot();
