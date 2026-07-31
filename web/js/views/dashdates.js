/* ═══════════════════════════════════════════════════════════════════════
   views/dashdates.js — the dashboard's pair of dates.

   One calendar for the whole page. It is taken from the longest history in
   the list, so the sliders span everything the list can show; names whose own
   history starts later simply drop out of a figure at that date rather than
   being drawn at the wrong one.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc } from "../format.js";
import { seriesOf } from "../store.js";

const BACK = [
  { label: "1M", days: 21 },
  { label: "3M", days: 63 },
  { label: "6M", days: 125 },
  { label: "1Y", days: 250 },
  { label: "Start", days: Infinity },
];

export function mountDashDates(mount, { onChange }) {
  mount.className = "dpair";
  mount.innerHTML = `
    <div class="dpair__row">
      <span class="dctl__lead">Rating as of</span>
      <output class="dctl__date" id="dp-later" aria-live="polite">—</output>
      <div class="dctl__presets" id="dp-later-presets" role="group" aria-label="Rating date"></div>
    </div>
    <input class="dctl__slider" id="dp-later-slider" type="range" min="0" max="0" step="1"
           aria-label="Rating date" />
    <div class="dpair__row">
      <span class="dctl__lead">Compared with</span>
      <output class="dctl__date" id="dp-earlier" aria-live="polite">—</output>
      <div class="dctl__presets" id="dp-earlier-presets" role="group" aria-label="Comparison date"></div>
    </div>
    <input class="dctl__slider" id="dp-earlier-slider" type="range" min="0" max="0" step="1"
           aria-label="Comparison date" />
    <div class="dctl__scale"><span id="dp-from"></span><span id="dp-to"></span></div>`;

  const el = (id) => mount.querySelector(`#${id}`);
  const laterSlider = el("dp-later-slider");
  const earlierSlider = el("dp-earlier-slider");

  let calendar = [];
  let later = -1;
  let earlier = -1;
  let signature = "";

  for (const [presets, isLater] of [[el("dp-later-presets"), true], [el("dp-earlier-presets"), false]]) {
    presets.innerHTML = BACK.map(
      (b) => `<button type="button" class="dctl__preset" data-back="${b.days}">${b.label}</button>`
    ).join("");
    presets.addEventListener("click", (event) => {
      const button = event.target.closest("[data-back]");
      if (!button || !calendar.length) return;
      const back = Number(button.dataset.back);
      const anchor = isLater ? calendar.length - 1 : later;
      const target = Number.isFinite(back) ? Math.max(0, anchor - back) : 0;
      if (isLater) setLater(target);
      else setEarlier(target);
    });
  }

  laterSlider.addEventListener("input", () => setLater(Number(laterSlider.value)));
  earlierSlider.addEventListener("input", () => setEarlier(Number(earlierSlider.value)));

  function setLater(i) {
    later = Math.max(1, Math.min(calendar.length - 1, i));
    if (earlier >= later) earlier = Math.max(0, later - 1);
    paint();
    onChange();
  }

  function setEarlier(i) {
    earlier = Math.max(0, Math.min(later - 1, i));
    paint();
    onChange();
  }

  function paint() {
    if (!calendar.length) return;
    laterSlider.max = String(calendar.length - 1);
    laterSlider.value = String(later);
    earlierSlider.max = String(Math.max(0, later - 1));
    earlierSlider.value = String(earlier);
    el("dp-later").textContent = calendar[later] ?? "—";
    el("dp-earlier").textContent = calendar[earlier] ?? "—";
    el("dp-from").textContent = esc(calendar[0] ?? "");
    el("dp-to").textContent = esc(calendar[calendar.length - 1] ?? "");

    for (const [presets, isLater] of [[el("dp-later-presets"), true], [el("dp-earlier-presets"), false]]) {
      const anchor = isLater ? calendar.length - 1 : later;
      const chosen = isLater ? later : earlier;
      for (const button of presets.querySelectorAll("[data-back]")) {
        const back = Number(button.dataset.back);
        const target = Number.isFinite(back) ? Math.max(0, anchor - back) : 0;
        button.disabled = isLater ? false : later < 1;
        button.setAttribute("aria-pressed", String(target === chosen));
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
      const longest = all.filter(Boolean).reduce(
        (best, s) => ((s?.dates?.length ?? 0) > (best?.dates?.length ?? 0) ? s : best),
        null
      );
      calendar = longest?.dates ?? [];
      if (!calendar.length) return;
      later = calendar.length - 1;
      earlier = Math.max(0, calendar.length - 1 - 125);
      paint();
    },
    selection() {
      return { later: calendar[later] ?? null, earlier: calendar[earlier] ?? null };
    },
  };
}
