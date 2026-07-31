/* ═══════════════════════════════════════════════════════════════════════
   views/peersCompare.js — this company against one to three others.

   Columns are companies, rows are the fields a credit reader compares first.
   The subject is pinned as the first column; the rest are the reader's, added
   through a small search field and dropped with one click. Two to four
   columns — beyond four the table stops being a comparison and becomes a
   register, and the register already exists on the dashboard.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, moneyK, num, pct, usd } from "../format.js";
import { isIG, notches } from "../fields.js";
import { peers, search, seriesOf, state } from "../store.js";

const MAX_COLUMNS = 4;

/** rows of the comparison; value reads from the latest snapshot at w150 */
const ROWS = [
  { label: "SP_Rating", cls: (s) => (isIG(s.spRating) ? "cmp-grade" : "cmp-grade spec"), f: (s) => s.spRating ?? "—" },
  { label: "DD", f: (s) => num(s.dd, 3) },
  { label: "SP_PD", f: (s) => pct(s.spPd) },
  { label: "FP_PD", f: (s) => pct(s.fpPd) },
  { label: "RS_SP", f: (s) => num(s.rsSp, 4) },
  { label: "MarketCap", f: (s) => moneyK(s.marketCap) },
  { label: "Asset", f: (s) => moneyK(s.asset) },
  { label: "Price", f: (s) => usd(s.price) },
  { label: "Mu", f: (s) => num(s.mu, 2) },
  { label: "AssetVol", f: (s) => pct(s.assetVol) },
  { label: "StockVol", f: (s) => pct(s.stockVol) },
];

export function mountPeersCompare(root) {
  root.innerHTML = `
    <div class="pcmp__bar">
      <div class="pcmp__adder">
        <input class="field pcmp__q" type="text" placeholder="add a company…"
          autocomplete="off" spellcheck="false" aria-label="Add a company to compare" />
        <button class="btn pcmp__plus" type="button" aria-label="Add">＋</button>
        <ul class="q-list pcmp__list" role="listbox" hidden></ul>
      </div>
      <span class="pcmp__hint">2–4 companies · values at each name's latest rated day, 150-day window</span>
    </div>
    <div class="tscroll"><table class="entries pcmp__table"></table></div>`;

  const input = root.querySelector(".pcmp__q");
  const plus = root.querySelector(".pcmp__plus");
  const list = root.querySelector(".pcmp__list");
  const table = root.querySelector(".pcmp__table");

  let subject = null;      // the page's own ticker
  let others = [];         // reader-chosen tickers
  let cache = new Map();   // ticker → latest snapshot (w150)

  function candidates() {
    const q = input.value.trim();
    if (!q) return [];
    const taken = new Set([subject, ...others]);
    return search(q, 6).filter((r) => r.snaps && !taken.has(r.ticker));
  }

  function paintList() {
    const hits = candidates();
    list.hidden = !hits.length;
    list.innerHTML = hits
      .map((r) => `<li role="option" data-tk="${esc(r.ticker)}">
        <span class="q-opt__tk">${esc(r.ticker)}</span>
        <span class="q-opt__name">${esc(r.name)}</span>
        <span class="q-opt__grade">${esc(r.snaps[0].spRating)}</span></li>`)
      .join("");
  }

  async function add(ticker) {
    if (!ticker || others.includes(ticker) || ticker === subject) return;
    if (1 + others.length >= MAX_COLUMNS) {
      others = others.slice(1);   // the oldest guest gives way
    }
    others.push(ticker);
    input.value = "";
    list.hidden = true;
    await paint();
  }

  async function latestOf(ticker) {
    if (cache.has(ticker)) return cache.get(ticker);
    try {
      const series = await seriesOf(ticker);
      const snap = series?.latest?.[String(series.window ?? 150)] ?? null;
      cache.set(ticker, snap);
      return snap;
    } catch {
      cache.set(ticker, null);
      return null;
    }
  }

  async function paint() {
    const columns = [subject, ...others].filter(Boolean);
    const snaps = await Promise.all(columns.map(latestOf));
    const rows = state.byTicker;

    const head = `<thead><tr><th>Entry</th>${columns
      .map((tk, i) => {
        const row = rows.get(tk);
        return `<th class="pcmp__col">
          <a href="./t.html#${encodeURIComponent(tk)}">${esc(tk)}</a>
          <span class="pcmp__colname">${esc(row?.name ?? "")}</span>
          ${i === 0 ? "" : `<button class="pcmp__drop" type="button" data-drop="${esc(tk)}"
            aria-label="Remove ${esc(tk)}">×</button>`}
        </th>`;
      })
      .join("")}</tr></thead>`;

    const body = ROWS.map((r) => `<tr>
        <th scope="row">${r.label}</th>
        ${snaps.map((s) => (s
          ? `<td class="${r.cls ? r.cls(s) : ""}">${esc(String(r.f(s)))}</td>`
          : `<td class="flat">—</td>`)).join("")}
      </tr>`).join("");

    // one comparative line: best DD in the set
    const dds = snaps.map((s, i) => [columns[i], s?.dd]).filter(([, d]) => d != null);
    const bestLine = dds.length > 1
      ? `<tr><th scope="row">Notches vs ${esc(subject)}</th>${snaps.map((s, i) => {
          if (i === 0 || !s) return `<td class="flat">·</td>`;
          const n = notches(s.spRating, snaps[0]?.spRating);
          return `<td class="${n > 0 ? "up" : n < 0 ? "down" : "flat"}">${n ? (n > 0 ? "+" : "") + n : "level"}</td>`;
        }).join("")}</tr>`
      : "";

    table.innerHTML = head + `<tbody>${body}${bestLine}</tbody>`;
  }

  input.addEventListener("input", paintList);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = list.querySelector("[data-tk]");
      add(first ? first.dataset.tk : input.value.trim().toUpperCase());
    } else if (event.key === "Escape") {
      list.hidden = true;
    }
  });
  input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 120));
  plus.addEventListener("click", () => {
    const first = list.querySelector("[data-tk]");
    if (first) add(first.dataset.tk);
    else input.focus();
  });
  list.addEventListener("mousedown", (event) => {
    const option = event.target.closest("[data-tk]");
    if (option) {
      event.preventDefault();
      add(option.dataset.tk);
    }
  });
  table.addEventListener("click", (event) => {
    const drop = event.target.closest("[data-drop]");
    if (!drop) return;
    others = others.filter((t) => t !== drop.dataset.drop);
    paint();
  });

  return {
    async setSubject(ticker) {
      if (ticker === subject) return;
      subject = ticker;
      others = others.filter((t) => t !== ticker);
      if (!others.length) {
        // seed with the nearest sector peer so the section never opens empty
        const row = state.byTicker.get(ticker);
        const near = row ? peers(row, 2).find((p) => p.ticker !== ticker) : null;
        if (near) others = [near.ticker];
      }
      await paint();
    },
  };
}
