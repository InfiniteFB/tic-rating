/* ═══════════════════════════════════════════════════════════════════════
   views/search.js — the way in.

   An empty field is not an empty state: focusing it offers the largest
   constituents by market value, so the common names are one keystroke away
   without a permanent row of buttons taking up the page. They are computed
   from the data, so they stay true after a re-fetch.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc } from "../format.js";
import { isIG } from "../fields.js";
import { largest, search, state } from "../store.js";

export function mountSearch(root, { onPick }) {
  const input = root.querySelector("#q");
  const listbox = root.querySelector("#q-list");
  const status = root.querySelector("#q-status");

  let hits = [];
  let cursor = -1;

  /** what to offer for the current input: matches, or the common names */
  function candidates() {
    const q = input.value.trim();
    return q ? search(q, 8) : largest(8);
  }

  /* ── suggestions ──────────────────────────────────────────────────── */
  function closeList() {
    listbox.hidden = true;
    listbox.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
    cursor = -1;
  }

  function paint() {
    if (!hits.length) return closeList();
    const heading = input.value.trim()
      ? ""
      : `<li class="q-list__head" role="presentation">Largest by market value</li>`;
    listbox.innerHTML = heading + hits
      .map((row, i) => {
        const grade = row.snaps ? row.snaps[0].spRating : "n/a";
        const cls = row.snaps && !isIG(grade) ? "spec" : row.snaps ? "" : "flat";
        return `<li role="option" id="q-opt-${i}" aria-selected="${i === cursor}" data-tk="${esc(row.ticker)}">
          <span class="q-opt__tk">${esc(row.ticker)}</span>
          <span class="q-opt__name">${esc(row.name)}</span>
          <span class="q-opt__grade ${cls}">${esc(grade)}</span>
        </li>`;
      })
      .join("");
    listbox.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", cursor >= 0 ? `q-opt-${cursor}` : "");
  }

  function offer() {
    hits = candidates();
    cursor = -1;
    paint();
  }

  function commit(ticker) {
    const symbol = String(ticker ?? "").trim().toUpperCase();
    if (!symbol) return;
    if (!state.byTicker.has(symbol)) {
      status.textContent = `${symbol} is not in the cached S&P 500 index.`;
      status.hidden = false;
      return;
    }
    status.hidden = true;
    input.value = "";
    closeList();
    onPick(symbol);
  }

  input.addEventListener("input", () => {
    hits = candidates();
    cursor = input.value.trim() && hits.length ? 0 : -1;
    status.hidden = true;
    paint();
  });

  input.addEventListener("focus", offer);

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!hits.length) offer();
      if (!hits.length) return;
      event.preventDefault();
      cursor = (cursor + (event.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      paint();
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(cursor >= 0 && hits[cursor] ? hits[cursor].ticker : input.value);
    } else if (event.key === "Escape") {
      closeList();
    }
  });

  listbox.addEventListener("mousedown", (event) => {
    const option = event.target.closest("[data-tk]");
    if (option) {
      event.preventDefault();
      commit(option.dataset.tk);
    }
  });

  input.addEventListener("blur", () => setTimeout(closeList, 120));

  // "/" focuses the field from anywhere, as in a terminal
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== input) {
      event.preventDefault();
      input.focus();
    }
  });

  return { focus: () => input.focus() };
}
