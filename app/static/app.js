/* ============================================================
   KMV Credit Rating Dashboard — front-end logic (vanilla JS)
   ============================================================ */
(function () {
  "use strict";

  // ---- state ----
  let lastPayload = null;      // last successful /api/rate response
  let lastRequest = null;      // last request body (for retry-with-override)
  let emChart = null;
  let aeChart = null;

  // ---- element refs ----
  const $ = (id) => document.getElementById(id);
  const els = {
    form: $("rate-form"),
    ticker: $("ticker"),
    days: $("days"),
    stDebt: $("st_debt_fallback"),
    horizon: $("horizon_days"),
    fallbackRate: $("fallback_rate"),
    submitBtn: $("submit-btn"),
    healthDot: $("health-dot"),
    healthLabel: $("health-label"),
    healthBanner: $("health-banner"),
    healthBannerText: $("health-banner-text"),
    healthBannerClose: $("health-banner-close"),
    errorBanner: $("error-banner"),
    errorBannerText: $("error-banner-text"),
    errorBannerClose: $("error-banner-close"),
    loading: $("loading"),
    results: $("results"),
    emptyState: $("empty-state"),
    hero: $("hero"),
    metricsSection: $("metrics-section"),
    metricsGrid: $("metrics-grid"),
    chartsSection: $("charts-section"),
    aiSection: $("ai-section"),
    aiCard: $("ai-card"),
    explainBtn: $("explain-btn"),
    intermediateSection: $("intermediate-section"),
    intermediateBody: $("intermediate-body"),
    sourceSection: $("source-section"),
    sourceBody: $("source-body"),
  };

  // ============================================================
  //  formatters — all null/undefined tolerant → "—"
  // ============================================================
  const DASH = "—";
  const isNum = (v) => typeof v === "number" && isFinite(v);

  function fmtNum(v, digits = 2) {
    if (!isNum(v)) return DASH;
    return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  // percentage from a fraction (0.00023 -> "0.0230%"), keeps small values informative
  function fmtPct(v) {
    if (!isNum(v)) return DASH;
    const p = v * 100;
    const abs = Math.abs(p);
    if (p === 0) return "0%";
    if (abs > 0 && abs < 0.001) return p.toExponential(2) + "%";
    if (abs < 1) return p.toFixed(4) + "%";
    if (abs < 10) return p.toFixed(3) + "%";
    return p.toFixed(2) + "%";
  }

  // signed percentage for outlook
  function fmtSignedPct(v) {
    if (!isNum(v)) return DASH;
    const s = fmtPct(Math.abs(v));
    if (s === DASH) return DASH;
    return (v > 0 ? "+" : v < 0 ? "−" : "") + s;
  }

  // large money → $1.23T / $45.6B / $789M / $12.3K
  function fmtMoney(v) {
    if (!isNum(v)) return DASH;
    const sign = v < 0 ? "-" : "";
    const a = Math.abs(v);
    const units = [
      [1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"],
    ];
    for (const [div, suf] of units) {
      if (a >= div) return sign + "$" + (a / div).toFixed(2) + suf;
    }
    return sign + "$" + a.toFixed(2);
  }

  function fmtDate(s) {
    if (!s) return DASH;
    return String(s).slice(0, 10);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // S&P letter → grade color bucket
  function gradeColor(letter) {
    if (!letter) return "var(--grade-neutral)";
    const L = String(letter).toUpperCase();
    if (L.startsWith("AAA") || L.startsWith("AA")) return "var(--grade-aaa)";
    if (L.startsWith("A") || L.startsWith("BBB")) return "var(--grade-a)";
    if (L.startsWith("BB") || (L.startsWith("B") && !L.startsWith("BBB"))) return "var(--grade-bb)";
    if (L.startsWith("CCC") || L.startsWith("CC") || L.startsWith("C") || L.startsWith("D")) return "var(--grade-ccc)";
    return "var(--grade-neutral)";
  }

  // ============================================================
  //  health
  // ============================================================
  async function loadHealth() {
    try {
      const r = await fetch("/api/health");
      const h = await r.json();
      const keyOk = !!h?.massive_key;
      const llmOk = !!h?.llm?.reachable;
      const messages = [];
      if (!keyOk) messages.push("Backend market-data key missing.");
      if (!llmOk) messages.push("LLM endpoint unreachable — AI explanation disabled. Rating still works.");

      if (keyOk && llmOk) {
        setHealth("ok", "operational");
      } else if (!keyOk) {
        setHealth("bad", "degraded");
      } else {
        setHealth("warn", "LLM offline");
      }
      if (messages.length) showHealthBanner(messages.join("  "));
      else hide(els.healthBanner);

      // disable explain button hint later handled at render time
      els.llmReachable = llmOk;
    } catch (e) {
      setHealth("bad", "unreachable");
      showHealthBanner("Backend health check failed — the API may be unavailable.");
    }
  }
  function setHealth(cls, label) {
    els.healthDot.className = "health-dot " + cls;
    els.healthLabel.textContent = label;
  }
  function showHealthBanner(text) {
    els.healthBannerText.textContent = text;
    show(els.healthBanner);
  }

  // ============================================================
  //  visibility helpers
  // ============================================================
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  // ============================================================
  //  rate flow
  // ============================================================
  function buildRequest(overrides) {
    const days = parseInt(els.days.value, 10);
    const horizon = parseFloat(els.horizon.value);
    const fr = parseFloat(els.fallbackRate.value);
    const req = {
      ticker: (els.ticker.value || "").trim().toUpperCase(),
      days: isFinite(days) ? days : 400,
      st_debt_fallback: els.stDebt.value || "strict",
      horizon_days: isFinite(horizon) ? horizon : 365.0,
      fallback_rate: isFinite(fr) ? fr : 0.045,
    };
    return Object.assign(req, overrides || {});
  }

  async function runRate(overrides) {
    const req = buildRequest(overrides);
    if (!req.ticker) {
      showError("Please enter a ticker symbol.");
      els.ticker.focus();
      return;
    }
    // sync select if override applied a fallback
    if (overrides && overrides.st_debt_fallback) els.stDebt.value = overrides.st_debt_fallback;

    lastRequest = req;
    hide(els.errorBanner);
    hide(els.emptyState);
    hide(els.results);
    show(els.loading);
    els.submitBtn.disabled = true;
    els.submitBtn.querySelector(".btn-label").textContent = "Rating…";

    try {
      const r = await fetch("/api/rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });

      if (r.status === 404) {
        const b = await safeJson(r);
        showError(b?.detail || `Ticker "${req.ticker}" not found.`);
        return;
      }
      if (r.status >= 500) {
        const b = await safeJson(r);
        showError(b?.error || b?.detail || `Server error (${r.status}).`);
        return;
      }
      if (!r.ok) {
        const b = await safeJson(r);
        showError(b?.detail || b?.error || `Request failed (${r.status}).`);
        return;
      }

      const payload = await r.json();
      lastPayload = payload;
      renderAll(payload);
    } catch (e) {
      showError("Network error — could not reach the backend. " + (e?.message || ""));
    } finally {
      hide(els.loading);
      els.submitBtn.disabled = false;
      els.submitBtn.querySelector(".btn-label").textContent = "Fetch & Rate";
    }
  }

  async function safeJson(r) {
    try { return await r.json(); } catch { return null; }
  }

  function showError(msg) {
    els.errorBannerText.textContent = msg;
    show(els.errorBanner);
    if (!lastPayload) show(els.emptyState);
  }

  // ============================================================
  //  render orchestration
  // ============================================================
  function renderAll(p) {
    show(els.results);
    renderRating(p);
    renderMetrics(p);
    renderCharts(p);
    renderExplainSection(p);
    renderIntermediate(p);
    renderSource(p);
    els.hero.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- hero / rating ----
  function renderRating(p) {
    const res = p?.result || {};
    const ticker = escapeHtml(p?.ticker || "");

    // unrateable
    if (res.unrateable_reason) {
      els.hero.innerHTML = renderNotice("warn", "Not rateable", ticker, res.unrateable_reason, retryButtons(res.unrateable_reason));
      wireRetryButtons();
      return;
    }
    // compute error
    if (res.compute_error) {
      els.hero.innerHTML = renderNotice("error", "Computation failed", ticker, res.compute_error,
        `<div class="notice-body" style="margin-top:4px;">Showing inputs only — see intermediate &amp; source data below.</div>`);
      return;
    }

    // rateable
    const m = p?.intermediate?.metrics || {};
    const letter = res.sp_letter || DASH;
    const color = gradeColor(res.sp_letter);
    const ttcPd = fmtPct(res.sp_ttc_pd);
    const outlook = res.credit_outlook;
    const outlookTag = outlookLabel(outlook);
    const partial = res.partial ? `<span class="tag tag-neutral">partial</span>` : "";

    els.hero.innerHTML = `
      <div class="hero-grid">
        <div class="grade-block">
          <div class="grade-letter" style="color:${color}">${escapeHtml(letter)}</div>
          <div class="grade-caption">S&amp;P scale</div>
        </div>
        <div class="hero-meta">
          <div class="hero-ticker">
            <span class="tk">${ticker}</span>
            ${outlookTag.tag}
            ${partial}
          </div>
          <div class="hero-kpis">
            <div class="kpi">
              <span class="kpi-label">Through-the-cycle PD</span>
              <span class="kpi-value">${ttcPd}</span>
            </div>
            <div class="kpi">
              <span class="kpi-label">PIT PD / EDF</span>
              <span class="kpi-value">${fmtPct(m.pit_pd)}</span>
            </div>
            <div class="kpi">
              <span class="kpi-label">Distance to default</span>
              <span class="kpi-value">${fmtNum(m.dd, 3)}</span>
            </div>
            <div class="kpi">
              <span class="kpi-label">Credit outlook</span>
              <span class="kpi-value" style="color:${outlookTag.color}">${fmtSignedPct(outlook)}</span>
            </div>
          </div>
          <div class="chain">
            <span class="chain-label">PIT&rarr;TTC conversion</span>
            ${chainNode("CCM*", fmtNum(res.ccm_star, 4))}
            <span class="chain-arrow">→</span>
            ${chainNode("α", fmtNum(res.alpha, 4))}
            <span class="chain-arrow">→</span>
            ${chainNode("RS_SP", fmtNum(res.rs_sp, 3))}
            <span class="chain-arrow">→</span>
            ${chainNode("Letter", escapeHtml(letter), color)}
          </div>
        </div>
      </div>`;
  }

  function chainNode(k, v, color) {
    const style = color ? ` style="color:${color}"` : "";
    return `<div class="chain-node"><span class="n-k">${k}</span><span class="n-v"${style}>${v}</span></div>`;
  }

  function outlookLabel(v) {
    if (!isNum(v)) return { tag: "", color: "var(--ink)" };
    if (v > 0) return { tag: `<span class="tag tag-pos">▲ positive outlook</span>`, color: "var(--success)" };
    if (v < 0) return { tag: `<span class="tag tag-neg">▼ negative outlook</span>`, color: "var(--error)" };
    return { tag: `<span class="tag tag-neutral">stable outlook</span>`, color: "var(--ink)" };
  }

  function renderNotice(kind, title, ticker, reason, extraHtml) {
    const icon = kind === "error" ? "!" : "▲";
    return `
      <div class="notice notice-${kind}">
        <div class="notice-head">
          <div class="notice-icon">${icon}</div>
          <div>
            <div class="notice-title">${escapeHtml(ticker)} — ${escapeHtml(title)}</div>
          </div>
        </div>
        <div class="notice-body"><code>${escapeHtml(reason)}</code></div>
        ${extraHtml || ""}
      </div>`;
  }

  // suggest fallback retries when debt components missing
  function retryButtons(reason) {
    const r = String(reason || "").toLowerCase();
    const mentionsDebt = r.includes("debt") || r.includes("liab");
    if (!mentionsDebt) return "";
    return `
      <div class="notice-actions">
        <button class="btn btn-ghost" data-retry="zero">Retry with fallback = zero</button>
        <button class="btn btn-ghost" data-retry="curliab">Retry with = curliab</button>
      </div>`;
  }
  function wireRetryButtons() {
    els.hero.querySelectorAll("[data-retry]").forEach((b) => {
      b.addEventListener("click", () => runRate({ st_debt_fallback: b.getAttribute("data-retry") }));
    });
  }

  // ---- metrics ----
  function renderMetrics(p) {
    const m = p?.intermediate?.metrics;
    if (!m || Object.keys(m).length === 0) { hide(els.metricsSection); return; }
    const em = p?.intermediate?.em || {};

    const cards = [
      { label: "Distance to Default (DD)", value: fmtNum(m.dd, 3) },
      { label: "PIT PD / EDF", value: fmtPct(m.pit_pd) },
      { label: "First-passage PD", value: fmtPct(m.pd_fh) },
      { label: "RiskScore", value: fmtNum(m.risk_score, 2) },
      { label: "TiC", value: fmtNum(m.tic, 4), note: "TiC scale is known to disagree with the course deck's worked example; RiskScore = 100·TiC is the practical scale.", info: true },
      { label: "CCM", value: fmtNum(m.ccm, 4) },
      { label: "μ life expectancy", value: fmtNum(m.mu, 2), unit: "yrs" },
      { label: "σ_A asset vol", value: isNum(em.sigma_a) ? fmtPct(em.sigma_a) : DASH },
      { label: "Asset value (latest)", value: fmtMoney(m.asset_latest) },
      { label: "Equity (latest)", value: fmtMoney(m.equity_latest) },
      { label: "Default point D", value: fmtMoney(m.debt_latest) },
      { label: "τ (time to horizon)", value: fmtNum(m.tau_latest, 4), unit: "yrs" },
    ];

    els.metricsGrid.innerHTML = cards.map((c) => `
      <div class="stat">
        <div class="stat-label">${escapeHtml(c.label)}${c.info ? `<span class="info-dot" title="${escapeHtml(c.note)}">i</span>` : ""}</div>
        <div class="stat-value">${c.value}${c.unit ? `<span class="unit">${c.unit}</span>` : ""}</div>
        ${c.note ? `<div class="stat-note">${escapeHtml(c.note)}</div>` : ""}
      </div>`).join("");
    show(els.metricsSection);
  }

  // ---- charts ----
  function renderCharts(p) {
    const em = p?.intermediate?.em || {};
    const sigmaHist = Array.isArray(em.sigma_history) ? em.sigma_history : [];
    const assets = Array.isArray(p?.intermediate?.assets) ? p.intermediate.assets : [];
    const dayInputs = Array.isArray(p?.intermediate?.day_inputs) ? p.intermediate.day_inputs : [];

    if (!sigmaHist.length && !assets.length) { hide(els.chartsSection); return; }
    show(els.chartsSection);

    if (emChart) { emChart.destroy(); emChart = null; }
    if (aeChart) { aeChart.destroy(); aeChart = null; }
    if (typeof Chart === "undefined") return;

    const gridColor = "rgba(90,98,112,.10)";
    const tickColor = "#8a909c";
    const baseOpts = (yFmt) => ({
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, position: "top", align: "end",
          labels: { boxWidth: 10, boxHeight: 10, font: { size: 11, family: "Inter" }, color: "#5b6270", usePointStyle: true } },
        tooltip: {
          backgroundColor: "#16181d", padding: 10, cornerRadius: 6, titleFont: { size: 11 }, bodyFont: { size: 12, family: "JetBrains Mono" },
          callbacks: yFmt ? { label: (ctx) => ` ${ctx.dataset.label}: ${yFmt(ctx.parsed.y)}` } : undefined,
        },
      },
      scales: {
        x: { grid: { color: gridColor, drawTicks: false }, ticks: { color: tickColor, font: { size: 10, family: "JetBrains Mono" }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, border: { display: false } },
        y: { grid: { color: gridColor, drawTicks: false }, ticks: { color: tickColor, font: { size: 10, family: "JetBrains Mono" }, callback: yFmt ? (v) => yFmt(v) : undefined }, border: { display: false } },
      },
    });

    // EM convergence
    if (sigmaHist.length) {
      emChart = new Chart($("chart-em"), {
        type: "line",
        data: {
          labels: sigmaHist.map((_, i) => i),
          datasets: [{
            label: "σ_A", data: sigmaHist,
            borderColor: "#4338ca", backgroundColor: "rgba(67,56,202,.08)",
            borderWidth: 2, pointRadius: sigmaHist.length <= 30 ? 2.5 : 0, pointHoverRadius: 4,
            fill: true, tension: .25,
          }],
        },
        options: baseOpts((v) => (v * 100).toFixed(2) + "%"),
      });
    } else {
      $("chart-em").parentElement.parentElement.style.display = "none";
    }

    // Asset vs Equity
    if (assets.length && dayInputs.length) {
      const labels = dayInputs.map((d) => fmtDate(d?.date));
      const equity = dayInputs.map((d) => (isNum(d?.equity) ? d.equity : null));
      aeChart = new Chart($("chart-ae"), {
        type: "line",
        data: {
          labels,
          datasets: [
            { label: "Asset value", data: assets, borderColor: "#0f766e", backgroundColor: "rgba(15,118,110,.06)", borderWidth: 2, pointRadius: 0, pointHoverRadius: 3, fill: true, tension: .3 },
            { label: "Equity", data: equity, borderColor: "#4338ca", backgroundColor: "transparent", borderWidth: 1.75, pointRadius: 0, pointHoverRadius: 3, fill: false, tension: .3, borderDash: [] },
          ],
        },
        options: baseOpts((v) => fmtMoney(v)),
      });
    } else {
      $("chart-ae").parentElement.parentElement.style.display = "none";
    }
  }

  // ---- explain section ----
  function renderExplainSection(p) {
    const res = p?.result || {};
    const rateable = res.sp_letter && !res.unrateable_reason && !res.compute_error;
    if (!rateable) { hide(els.aiSection); return; }
    show(els.aiSection);
    hide(els.aiCard);
    els.aiCard.innerHTML = "";
    els.explainBtn.disabled = false;
    els.explainBtn.textContent = "Explain this rating";
  }

  async function runExplain() {
    if (!lastPayload) return;
    els.explainBtn.disabled = true;
    els.explainBtn.textContent = "Analyzing…";
    try {
      const r = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lastPayload),
      });
      const b = await safeJson(r);
      if (!b || (!b.caliber_explanation && !b.result_analysis)) {
        renderAiUnavailable(b?.error || "no response from AI service");
        return;
      }
      if (b.error) { renderAiUnavailable(b.error); return; }

      els.aiCard.innerHTML = `
        <div class="ai-block">
          <div class="ai-block-title">Caliber explanation</div>
          <div class="ai-text">${renderRichText(b.caliber_explanation)}</div>
        </div>
        <div class="ai-block">
          <div class="ai-block-title">Result analysis</div>
          <div class="ai-text">${renderRichText(b.result_analysis)}</div>
        </div>
        ${b.model ? `<div style="font-size:11px;color:var(--faint);font-family:var(--mono);">model · ${escapeHtml(b.model)}</div>` : ""}`;
      show(els.aiCard);
      els.explainBtn.textContent = "Re-explain";
    } catch (e) {
      renderAiUnavailable(e?.message || "network error");
    } finally {
      els.explainBtn.disabled = false;
      if (els.explainBtn.textContent === "Analyzing…") els.explainBtn.textContent = "Explain this rating";
    }
  }

  function renderAiUnavailable(err) {
    els.aiCard.innerHTML = `<div class="ai-note">AI explanation unavailable: ${escapeHtml(err)}</div>`;
    show(els.aiCard);
    els.explainBtn.textContent = "Retry explanation";
  }

  // light markdown-ish → HTML: ### headings and paragraph splitting
  function renderRichText(text) {
    if (!text) return `<p style="color:var(--faint)">(empty)</p>`;
    const blocks = String(text).split(/\n\s*\n/);
    return blocks.map((blk) => {
      const t = blk.trim();
      if (!t) return "";
      const h = t.match(/^#{1,4}\s+(.*)$/);
      if (h) return `<h4>${inlineFmt(h[1])}</h4>`;
      // treat lines beginning with - or * as simple bullets joined by <br>
      const lines = t.split(/\n/).map((l) => inlineFmt(l.replace(/^\s*[-*]\s+/, "• "))).join("<br>");
      return `<p>${lines}</p>`;
    }).join("");
  }
  function inlineFmt(s) {
    // escape, then re-enable **bold**
    let e = escapeHtml(s);
    e = e.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return e;
  }

  // ---- intermediate ----
  function renderIntermediate(p) {
    const inter = p?.intermediate || {};
    const dayInputs = Array.isArray(inter.day_inputs) ? inter.day_inputs : [];
    const defPoints = Array.isArray(inter.default_points) ? inter.default_points : [];
    const em = inter.em || {};

    if (!dayInputs.length && !defPoints.length && Object.keys(em).length === 0) {
      hide(els.intermediateSection); return;
    }
    show(els.intermediateSection);

    let html = "";

    if (Object.keys(em).length) {
      html += `
        <details class="collapse">
          <summary>EM calibration summary</summary>
          <div class="collapse-body">
            <div class="em-strip">
              ${emItem("Iterations", isNum(em.iterations) ? String(em.iterations) : DASH)}
              ${emItem("Converged", em.converged === true ? "yes" : em.converged === false ? "no" : DASH)}
              ${emItem("σ_A", isNum(em.sigma_a) ? fmtPct(em.sigma_a) : DASH)}
              ${emItem("η_A", fmtNum(em.eta_a, 4))}
              ${emItem("R_A", fmtNum(em.r_a, 4))}
            </div>
          </div>
        </details>`;
    }

    if (dayInputs.length) {
      const rows = dayInputs.map((d) => `
        <tr>
          <td>${escapeHtml(fmtDate(d?.date))}</td>
          <td>${fmtMoney(d?.equity)}</td>
          <td>${fmtMoney(d?.debt)}</td>
          <td>${fmtPct(d?.rate)}</td>
          <td>${fmtNum(d?.tau, 4)}</td>
        </tr>`).join("");
      html += `
        <details class="collapse">
          <summary>Per-day model inputs <span class="count">${dayInputs.length} rows</span></summary>
          <div class="collapse-body">
            <div class="table-scroll">
              <table class="dtable">
                <thead><tr><th>Date</th><th>Equity</th><th>Debt D</th><th>Rate</th><th>τ</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        </details>`;
    }

    if (defPoints.length) {
      const rows = defPoints.map((d) => `
        <tr><td>${escapeHtml(fmtDate(d?.date))}</td><td>${fmtMoney(d?.debt)}</td></tr>`).join("");
      html += `
        <details class="collapse">
          <summary>Per-quarter default points <span class="count">${defPoints.length} quarters</span></summary>
          <div class="collapse-body">
            <div class="table-scroll">
              <table class="dtable">
                <thead><tr><th>Quarter end</th><th>Default point D</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        </details>`;
    }

    els.intermediateBody.innerHTML = html;
  }
  function emItem(k, v) {
    return `<div class="em-item"><span class="k">${escapeHtml(k)}</span><span class="v">${v}</span></div>`;
  }

  // ---- source ----
  function renderSource(p) {
    const src = p?.source || {};
    const bs = Array.isArray(src.balance_sheet) ? src.balance_sheet : [];
    const prices = Array.isArray(src.prices) ? src.prices : [];
    const rf = Array.isArray(src.risk_free_rate_1y_series) ? src.risk_free_rate_1y_series : [];
    const sofr = Array.isArray(src.sofr_series) ? src.sofr_series : [];
    const notes = src.notes || {};

    if (!bs.length && !prices.length && !rf.length && !sofr.length && !isNum(src.shares_outstanding)) {
      hide(els.sourceSection); return;
    }
    show(els.sourceSection);

    let html = "";

    // company + notes wrapper (single collapse, always first)
    const companyBits = [];
    if (isNum(src.shares_outstanding)) {
      companyBits.push(`<div class="em-item"><span class="k">Shares outstanding</span><span class="v">${src.shares_outstanding.toLocaleString("en-US")}</span></div>`);
    }
    const noteKeys = Object.keys(notes);
    if (companyBits.length || noteKeys.length) {
      html += `
        <details class="collapse">
          <summary>Company &amp; data notes</summary>
          <div class="collapse-body">
            ${companyBits.length ? `<div class="company-row">${companyBits.join("")}</div>` : ""}
            ${noteKeys.length ? `<div class="notes-list">${noteKeys.map((k) => `
              <div class="note-row"><span class="nk">${escapeHtml(k)}</span><span class="nv">${escapeHtml(notes[k])}</span></div>`).join("")}</div>` : ""}
          </div>
        </details>`;
    }

    if (bs.length) {
      const rows = bs.map((q) => `
        <tr>
          <td>${escapeHtml(fmtDate(q?.period_end))}</td>
          <td>${fmtMoney(q?.debt_current)}</td>
          <td>${fmtMoney(q?.long_term_debt_and_capital_lease_obligations)}</td>
          <td>${fmtMoney(q?.total_current_liabilities)}</td>
        </tr>`).join("");
      html += sourceTable("Balance sheet (per quarter)", bs.length + " quarters",
        `<thead><tr><th>Period end</th><th>Current debt</th><th>LT debt + leases</th><th>Total curr. liab.</th></tr></thead><tbody>${rows}</tbody>`);
    }

    if (prices.length) {
      const rows = prices.map((q) => `
        <tr>
          <td>${escapeHtml(fmtDate(q?.date))}</td>
          <td>${fmtNum(q?.dividend_adjusted_close, 2)}</td>
          <td>${fmtPct(q?.risk_free_rate_1y)}</td>
          <td>${fmtPct(q?.sofr)}</td>
        </tr>`).join("");
      html += sourceTable("Dividend-adjusted prices", prices.length + " days",
        `<thead><tr><th>Date</th><th>Adj. close</th><th>RF 1Y</th><th>SOFR</th></tr></thead><tbody>${rows}</tbody>`);
    }

    if (rf.length) {
      const rows = rf.map((q) => `<tr><td>${escapeHtml(fmtDate(q?.date))}</td><td>${fmtPct(q?.rate)}</td></tr>`).join("");
      html += sourceTable("FRED DGS1 — 1Y treasury", rf.length + " points",
        `<thead><tr><th>Date</th><th>Rate</th></tr></thead><tbody>${rows}</tbody>`);
    }
    if (sofr.length) {
      const rows = sofr.map((q) => `<tr><td>${escapeHtml(fmtDate(q?.date))}</td><td>${fmtPct(q?.rate)}</td></tr>`).join("");
      html += sourceTable("SOFR series", sofr.length + " points",
        `<thead><tr><th>Date</th><th>Rate</th></tr></thead><tbody>${rows}</tbody>`);
    }

    els.sourceBody.innerHTML = html;
  }
  function sourceTable(title, count, tableInner) {
    return `
      <details class="collapse">
        <summary>${escapeHtml(title)} <span class="count">${escapeHtml(count)}</span></summary>
        <div class="collapse-body">
          <div class="table-scroll"><table class="dtable">${tableInner}</table></div>
        </div>
      </details>`;
  }

  // ============================================================
  //  events
  // ============================================================
  els.form.addEventListener("submit", (e) => { e.preventDefault(); runRate(); });
  els.explainBtn.addEventListener("click", runExplain);
  els.healthBannerClose.addEventListener("click", () => hide(els.healthBanner));
  els.errorBannerClose.addEventListener("click", () => hide(els.errorBanner));

  // uppercase-as-you-type for ticker
  els.ticker.addEventListener("input", () => {
    const pos = els.ticker.selectionStart;
    els.ticker.value = els.ticker.value.toUpperCase();
    els.ticker.setSelectionRange(pos, pos);
  });

  // init
  loadHealth();
})();
