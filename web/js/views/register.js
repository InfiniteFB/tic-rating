/* ═══════════════════════════════════════════════════════════════════════
   views/register.js — browse the whole index: distribution strip, filter by
   sector or free text, sort any column, click through to a name.

   498 rows render in one pass and scroll inside their own container; that is
   well inside what the DOM handles, so no virtualisation and no pagination.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, num, pct } from "../format.js";
import { SCALE, isIG, migration, outlook, ratingIdx } from "../fields.js";
import { rated, state } from "../store.js";

const COLUMNS = [
  { key: "n", label: "#", sort: null, align: "left" },
  { key: "ticker", label: "Name", get: (r) => r.ticker, align: "left" },
  { key: "name", label: "Company", get: (r) => r.name, align: "left" },
  { key: "spRating", label: "SP_Rating", get: (r) => (r.snaps ? ratingIdx(r.snaps[0].spRating) : 99) },
  { key: "prior", label: "Prior", get: (r) => (r.snaps?.[1] ? ratingIdx(r.snaps[1].spRating) : 99) },
  { key: "move", label: "Move", get: (r) => migration(r).notches },
  { key: "dd", label: "DD", get: (r) => r.snaps?.[0]?.dd ?? -Infinity },
  { key: "rs", label: "RS", get: (r) => r.snaps?.[0]?.rs ?? Infinity },
  { key: "spPd", label: "SP_PD", get: (r) => r.snaps?.[0]?.spPd ?? Infinity },
  { key: "marketCap", label: "MarketCap", get: (r) => r.snaps?.[0]?.marketCap ?? -Infinity },
  { key: "outlook", label: "Outlook", get: (r) => r.snaps?.[0]?.outlook ?? "" },
];

export function mountRegister(root, { onPick }) {
  const head = root.querySelector("#reg-head");
  const body = root.querySelector("#reg-body");
  const searchInput = root.querySelector("#reg-q");
  const sectorSelect = root.querySelector("#reg-sector");
  const count = root.querySelector("#reg-count");
  const dist = root.querySelector("#dist");

  let sortKey = "marketCap";
  let asc = false;

  const sectors = [...new Set(state.index.map((r) => r.sector).filter(Boolean))].sort();
  sectorSelect.innerHTML = `<option value="">All sectors</option>`
    + sectors.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");

  head.innerHTML = COLUMNS.map(
    (c) => `<th data-key="${c.key}" ${c.sort === null ? "" : 'role="button" tabindex="0"'}>${esc(c.label)}</th>`
  ).join("");

  /* ── distribution across the 27 notches ───────────────────────────── */
  function paintDistribution(rows) {
    const counts = new Map();
    for (const r of rows) {
      if (!r.snaps) continue;
      const g = r.snaps[0].spRating;
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const max = Math.max(1, ...counts.values());
    dist.innerHTML = SCALE.map((g) => {
      const n = counts.get(g) ?? 0;
      const on = state.selected?.snaps?.[0]?.spRating === g;
      return `<div class="dist__bar ${isIG(g) ? "dist__bar--ig" : "dist__bar--spec"}"
        data-on="${on}" style="height:${Math.max(2, (n / max) * 100)}%"
        title="${esc(g)} — ${n} name${n === 1 ? "" : "s"}"></div>`;
    }).join("");
  }

  /* ── rows ─────────────────────────────────────────────────────────── */
  function visible() {
    const q = searchInput.value.trim().toUpperCase();
    const sector = sectorSelect.value;
    let rows = state.index.filter((r) => {
      if (sector && r.sector !== sector) return false;
      if (!q) return true;
      return r.ticker.toUpperCase().includes(q) || String(r.name ?? "").toUpperCase().includes(q);
    });
    const col = COLUMNS.find((c) => c.key === sortKey);
    if (col?.get) {
      rows = rows.slice().sort((a, b) => {
        const av = col.get(a);
        const bv = col.get(b);
        const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
        return asc ? cmp : -cmp;
      });
    }
    return rows;
  }

  function paint() {
    const rows = visible();
    const selected = state.selected?.ticker;

    count.innerHTML = `<b>${rows.length}</b> of ${state.index.length} · `
      + `${rated().length} rated, ${state.index.length - rated().length} not rateable`;

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${COLUMNS.length}" class="register__empty">
        <b>Nothing matches.</b> The cache covers the ${state.index.length} constituents as of
        ${esc(state.summary?.generated_for?.current ?? "the last run")}.</td></tr>`;
    } else {
      body.innerHTML = rows.map((r, i) => {
        if (!r.snaps) {
          return `<tr data-tk="${esc(r.ticker)}" class="is-unrateable" aria-selected="${r.ticker === selected}">
            <td class="register__no">${i + 1}</td>
            <td class="register__tk"><a href="./t.html#${encodeURIComponent(r.ticker)}">${esc(r.ticker)}</a></td>
            <td class="register__name"><a href="./t.html#${encodeURIComponent(r.ticker)}">${esc(r.name)}</a></td>
            <td colspan="${COLUMNS.length - 3}">${esc(r.unrateable_reason)}</td></tr>`;
        }
        const [cur, prior] = r.snaps;
        const m = migration(r);
        const look = outlook(cur.outlook);
        return `<tr data-tk="${esc(r.ticker)}" aria-selected="${r.ticker === selected}">
          <td class="register__no">${i + 1}</td>
          <td class="register__tk"><a href="./t.html#${encodeURIComponent(r.ticker)}">${esc(r.ticker)}</a></td>
          <td class="register__name"><a href="./t.html#${encodeURIComponent(r.ticker)}">${esc(r.name)}</a></td>
          <td class="register__grade ${isIG(cur.spRating) ? "" : "spec"}">${esc(cur.spRating)}</td>
          <td class="flat">${esc(prior?.spRating ?? "—")}</td>
          <td class="${m.dir}">${m.notches ? `${m.notches > 0 ? "↑ " : "↓ "}${Math.abs(m.notches)}` : "—"}</td>
          <td>${num(cur.dd, 2)}</td>
          <td>${num(cur.rs, 3)}</td>
          <td>${pct(cur.spPd)}</td>
          <td>${esc(moneyShort(cur.marketCap))}</td>
          <td class="${look.cls}">${look.sym} ${look.label}</td></tr>`;
      }).join("");
    }

    for (const th of head.querySelectorAll("th")) {
      if (th.dataset.key === sortKey) th.setAttribute("aria-sort", asc ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    }
    paintDistribution(rows);
  }

  function moneyShort(v) {
    if (typeof v !== "number") return "—";
    const a = v * 1e3;
    for (const [div, s] of [[1e12, "T"], [1e9, "B"], [1e6, "M"]]) {
      if (a >= div) return `$${(a / div).toFixed(a / div < 10 ? 2 : 0)}${s}`;
    }
    return `$${Math.round(a / 1e6)}M`;
  }

  head.addEventListener("click", (event) => {
    const th = event.target.closest("th[data-key]");
    if (!th || th.dataset.key === "n") return;
    if (sortKey === th.dataset.key) asc = !asc;
    else {
      sortKey = th.dataset.key;
      asc = ["ticker", "name", "spRating", "prior"].includes(sortKey);
    }
    paint();
  });

  body.addEventListener("click", (event) => {
    const tr = event.target.closest("tr[data-tk]");
    if (tr) onPick(tr.dataset.tk);
  });

  searchInput.addEventListener("input", paint);
  sectorSelect.addEventListener("change", paint);

  return { paint };
}
