/* ═══════════════════════════════════════════════════════════════════════
   views/dashdates.js — the dashboard's pair of dates, side by side.

   Both sliders run over the SAME fixed axis — the full calendar — so a
   thumb never jumps because the other thumb moved. The constraint is
   enforced on the values instead: the comparison day is always strictly
   earlier than the rating day, and dragging one across the other pushes,
   it never rescales. (The first version re-ranged the second slider's max
   on every move of the first, which made the thumb walk on its own.)
   ═══════════════════════════════════════════════════════════════════════ */

import { esc } from "../format.js";
import { seriesOf } from "../store.js";

const BACK = [
  { label: "1M", days: 21 },
  { label: "6M", days: 125 },
  { label: "1Y", days: 250 },
  { label: "5Y", days: 1250 },
  { label: "Max", days: Infinity },
];

export function mountDashDates(mount, { onChange }) {
  mount.className = "dpair";
  mount.innerHTML = ["later", "earlier"].map((kind) => `
    <div class="dpair__cell dpair__cell--${kind}">
      <div class="dpair__row">
        <span class="dctl__lead">${kind === "later" ? "Rating as of" : "Compared with"}</span>
        <output class="dctl__date" id="dp-${kind}" aria-live="polite">—</output>
      </div>
      <input class="dctl__slider" id="dp-${kind}-slider" type="range" min="0" max="0" step="1"
             aria-label="${kind === "later" ? "Rating date" : "Comparison date"}" />
      <div class="dctl__presets" id="dp-${kind}-presets" role="group"
           aria-label="${kind === "later" ? "Jump the rating date" : "Comparison distance"}"></div>
    </div>`).join("") + `
    <div class="dctl__scale dpair__scale"><span id="dp-from"></span><span id="dp-to"></span></div>`;

  const el = (id) => mount.querySelector(`#${id}`);
  const sliders = { later: el("dp-later-slider"), earlier: el("dp-earlier-slider") };

  let calendar = [];
  let picked = { later: -1, earlier: -1 };
  let signature = "";

  for (const kind of ["later", "earlier"]) {
    el(`dp-${kind}-presets`).innerHTML = BACK.map(
      (b) => `<button type="button" class="dctl__preset" data-back="${b.days}">${b.label}</button>`
    ).join("");
    el(`dp-${kind}-presets`).addEventListener("click", (event) => {
      const button = event.target.closest("[data-back]");
      if (!button || !calendar.length) return;
      const back = Number(button.dataset.back);
      const anchor = kind === "later" ? calendar.length - 1 : picked.later;
      set(kind, Number.isFinite(back) ? Math.max(0, anchor - back) : 0);
    });
    sliders[kind].addEventListener("input", () => set(kind, Number(sliders[kind].value)));
  }

  /** all constraint logic in one place: values move, bounds never do */
  function set(kind, value) {
    const last = calendar.length - 1;
    if (last < 1) return;
    if (kind === "later") {
      picked.later = Math.max(1, Math.min(last, Math.round(value)));
      if (picked.earlier >= picked.later) picked.earlier = picked.later - 1;
    } else {
      // the comparison can be dragged anywhere strictly before the rating day
      picked.earlier = Math.max(0, Math.min(picked.later - 1, Math.round(value)));
    }
    paint();
    onChange();
  }

  function paint() {
    const last = calendar.length - 1;
    for (const kind of ["later", "earlier"]) {
      sliders[kind].min = "0";
      sliders[kind].max = String(last);   // fixed axis for both — see the header note
      sliders[kind].value = String(picked[kind]);
      el(`dp-${kind}`).textContent = calendar[picked[kind]] ?? "—";
    }
    el("dp-from").textContent = esc(calendar[0] ?? "");
    el("dp-to").textContent = esc(calendar[last] ?? "");
    for (const kind of ["later", "earlier"]) {
      const anchor = kind === "later" ? last : picked.later;
      for (const button of el(`dp-${kind}-presets`).querySelectorAll("[data-back]")) {
        const back = Number(button.dataset.back);
        const target = Number.isFinite(back) ? Math.max(0, anchor - back) : 0;
        button.setAttribute("aria-pressed", String(target === picked[kind]));
      }
    }
  }

  return {
    /** rebuild the calendar when the list changes; keeps the chosen dates if it can */
    async ensureCalendar(rows) {
      const key = rows.map((r) => r.ticker).sort().join(",");
      if (key === signature && calendar.length) return;
      signature = key;
      const all = await Promise.all(rows.map((r) => seriesOf(r.ticker).catch(() => null)));
      // the weekly history is the calendar: it spans the decade, and the
      // watchlist figures are weekly anyway
      const longest = all.filter(Boolean).reduce((best, s) => {
        const dates = s?.history?.[String(s.window ?? 150)]?.dates ?? s?.dates ?? [];
        const bestDates = best?.history?.[String(best.window ?? 150)]?.dates ?? best?.dates ?? [];
        return dates.length > bestDates.length ? s : best;
      }, null);
      calendar = longest?.history?.[String(longest.window ?? 150)]?.dates ?? longest?.dates ?? [];
      if (calendar.length < 2) return;
      picked.later = calendar.length - 1;
      picked.earlier = Math.max(0, calendar.length - 1 - 25);   // ≈ six months of weeks
      paint();
    },
    selection() {
      return { later: calendar[picked.later] ?? null, earlier: calendar[picked.earlier] ?? null };
    },
  };
}
