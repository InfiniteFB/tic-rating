/* ═══════════════════════════════════════════════════════════════════════
   views/dates.js — the date control.

   The model is evaluated on every trading day in the calibration window, so
   the date is the reader's to pick rather than something the build chose.
   One control does both jobs: "as of" drives the rating, "compare with"
   drives every change column. The chosen date is the loudest thing in the
   control, because it is the thing that changes what you are looking at.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc } from "../format.js";
import { isIG } from "../fields.js";

/** presets in trading days back from the newest bar */
const BACK = [
  { label: "Today", days: 0 },
  { label: "1M", days: 21 },
  { label: "3M", days: 63 },
  { label: "6M", days: 125 },
  { label: "Start", days: Infinity },
];

/**
 * @param {HTMLElement} mount
 * @param {object} opts
 * @param {"asof"|"compare"} opts.kind  which half of the pair this is
 * @param {(index:number)=>void} opts.onChange
 */
export function mountDateControl(mount, { kind, onChange }) {
  const isAsOf = kind === "asof";
  mount.className = `dctl ${isAsOf ? "dctl--asof" : "dctl--compare"}`;
  mount.innerHTML = `
    <div class="dctl__row">
      <div class="dctl__stack">
        <span class="dctl__lead">${isAsOf ? "Rating as of" : "Compared with"}</span>
        <span><output class="dctl__date" aria-live="polite"></output>
        <span class="dctl__grade"></span></span>
      </div>
      <div class="dctl__presets" role="group" aria-label="${isAsOf ? "Jump back" : "Comparison distance"}"></div>
    </div>
    <input class="dctl__slider" type="range" min="0" max="0" step="1"
           aria-label="${isAsOf ? "Rating date" : "Comparison date"}" />
    <div class="dctl__scale"><span class="dctl__from"></span><span class="dctl__to"></span></div>`;

  const slider = mount.querySelector(".dctl__slider");
  const dateOut = mount.querySelector(".dctl__date");
  const gradeOut = mount.querySelector(".dctl__grade");
  const presets = mount.querySelector(".dctl__presets");
  const fromOut = mount.querySelector(".dctl__from");
  const toOut = mount.querySelector(".dctl__to");

  let dates = [];
  let letters = [];

  presets.innerHTML = BACK.map(
    (b) => `<button type="button" class="dctl__preset" data-back="${b.days}">${b.label}</button>`
  ).join("");

  presets.addEventListener("click", (event) => {
    const button = event.target.closest("[data-back]");
    if (!button || !dates.length) return;
    const back = Number(button.dataset.back);
    // "as of" walks back from the newest bar; the comparison walks back from
    // wherever the as-of date currently sits
    const anchor = Number(slider.max);
    onChange(Number.isFinite(back) ? Math.max(0, anchor - back) : 0);
  });

  slider.addEventListener("input", () => onChange(Number(slider.value)));

  return {
    /**
     * @param {object} series
     * @param {number} value    selected index
     * @param {number} ceiling  highest index this control may take
     */
    update(series, value, ceiling, fallback) {
      dates = series?.dates ?? [];
      letters = series?.path?.spRating ?? [];
      const usable = dates.length > 1;

      // While the series is in flight the control stays in place, showing the
      // date it already knows. Hiding it instead would make the whole section
      // jump the moment the fetch lands.
      mount.hidden = !usable && !fallback?.date;
      mount.classList.toggle("is-waiting", !usable);
      slider.disabled = !usable;
      for (const button of presets.querySelectorAll("[data-back]")) button.disabled = !usable;
      if (!usable) {
        dateOut.textContent = fallback?.date ?? "—";
        gradeOut.textContent = fallback?.letter ?? "";
        gradeOut.className = `dctl__grade${fallback?.letter && !isIG(fallback.letter) ? " spec" : ""}`;
        fromOut.textContent = "";
        toOut.textContent = "loading the daily path…";
        return;
      }

      const max = Math.max(0, Math.min(ceiling ?? dates.length - 1, dates.length - 1));
      slider.max = String(max);
      slider.min = "0";
      slider.value = String(Math.max(0, Math.min(max, value)));

      const i = Number(slider.value);
      dateOut.textContent = dates[i] ?? "—";
      const letter = letters[i];
      gradeOut.textContent = letter ?? "";
      gradeOut.className = `dctl__grade${letter && !isIG(letter) ? " spec" : ""}`;
      fromOut.textContent = esc(dates[0] ?? "");
      toOut.textContent = esc(dates[max] ?? "");

      const anchor = max;
      for (const button of presets.querySelectorAll("[data-back]")) {
        const back = Number(button.dataset.back);
        const target = Number.isFinite(back) ? Math.max(0, anchor - back) : 0;
        button.disabled = target > max;
        button.setAttribute("aria-pressed", String(target === i));
      }
    },
  };
}
