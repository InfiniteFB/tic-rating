/* ═══════════════════════════════════════════════════════════════════════
   views/watchlist.js — the dashboard's own list.

   Ten names to start with — the set the course workbook uses — but the list
   belongs to the reader: add any constituent, drop any row, and the choice
   survives a reload. Every ticker is a link, because the obvious thing to do
   with a name on a dashboard is open it.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, moneyK, num, pct } from "../format.js";
import { deltaInfo, isIG, notches, SNAP_FIELDS } from "../fields.js";
import { state } from "../store.js";

/** the workbook's ten, as the starting list */
export const DEFAULT_LIST = ["AMZN", "COST", "DELL", "INTU", "KHC", "KO", "ORCL", "PNC", "T", "WMT"];
const STORE_KEY = "tic.watchlist";

export function readList() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
    if (Array.isArray(saved) && saved.length) return saved.filter((t) => state.byTicker.has(t));
  } catch {
    /* a corrupt entry is not worth a broken dashboard */
  }
  return DEFAULT_LIST.filter((t) => state.byTicker.has(t));
}

function writeList(list) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* private browsing: the list simply does not persist */
  }
}

const field = (key) => SNAP_FIELDS.find((f) => f.key === key);

export function mountWatchlist(root, { onChange }) {
  const body = root.querySelector("#wl-body");
  const count = root.querySelector("#wl-count");
  const reset = root.querySelector("#wl-reset");
  let list = readList();

  body.addEventListener("click", (event) => {
    const drop = event.target.closest("[data-drop]");
    if (!drop) return;
    list = list.filter((t) => t !== drop.dataset.drop);
    writeList(list);
    onChange();
  });

  reset.addEventListener("click", () => {
    list = DEFAULT_LIST.filter((t) => state.byTicker.has(t));
    writeList(list);
    onChange();
  });

  return {
    get list() {
      return list;
    },
    add(ticker) {
      if (!state.byTicker.has(ticker) || list.includes(ticker)) return false;
      list = [...list, ticker];
      writeList(list);
      onChange();
      return true;
    },
    /**
     * @param rows  each { ticker, name, cur, prior } already evaluated at the
     *              two selected dates — the table never reads a frozen snapshot
     */
    paint(rows) {
      count.textContent = `${rows.length} name${rows.length === 1 ? "" : "s"}`;
      if (!rows.length) {
        body.innerHTML = `<tr><td colspan="9" class="wl__empty">
          The list is empty — search above to add a name, or reset to the default ten.</td></tr>`;
        return;
      }
      body.innerHTML = rows
        .map(({ ticker, name, cur, prior }) => {
          if (!cur) {
            return `<tr><th scope="row"><a class="wl__tk" href="./t.html#${encodeURIComponent(ticker)}">${esc(ticker)}</a></th>
              <td class="wl__name"><a href="./t.html#${encodeURIComponent(ticker)}">${esc(name)}</a></td>
              <td colspan="6" class="flat">no rating at this date</td>
              <td class="wl__drop"><button type="button" data-drop="${esc(ticker)}" aria-label="Remove ${esc(ticker)}">×</button></td></tr>`;
          }
          const move = prior ? notches(cur.spRating, prior.spRating) : 0;
          const dir = move > 0 ? "up" : move < 0 ? "down" : "flat";
          const ddD = deltaInfo(field("dd"), cur.dd, prior?.dd);
          return `<tr>
            <th scope="row"><a class="wl__tk" href="./t.html#${encodeURIComponent(ticker)}">${esc(ticker)}</a></th>
            <td class="wl__name"><a href="./t.html#${encodeURIComponent(ticker)}">${esc(name)}</a></td>
            <td class="wl__grade ${isIG(cur.spRating) ? "" : "spec"}">${esc(cur.spRating)}</td>
            <td class="flat">${esc(prior?.spRating ?? "—")}</td>
            <td class="${dir}">${move ? (move > 0 ? "▲ +" : "▼ −") + Math.abs(move) : "·"}</td>
            <td>${num(cur.dd, 2)}<span class="wl__delta ${ddD.cls}">${ddD.text}</span></td>
            <td>${pct(cur.spPd)}</td>
            <td>${moneyK(cur.marketCap)}</td>
            <td class="wl__drop"><button type="button" data-drop="${esc(ticker)}" aria-label="Remove ${esc(ticker)}">×</button></td>
          </tr>`;
        })
        .join("");
    },
  };
}
