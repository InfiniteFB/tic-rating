export function payloadFor(row, cur) {
  if (!row?.ticker || !cur) return null;
  const riskScore = cur.rs;
  return {
    ticker: row.ticker,
    result: {
      sp_letter: cur.spRating,
      sp_ttc_pd: cur.spPd,
      credit_outlook: cur.outlook,
    },
    intermediate: {
      metrics: {
        dd: cur.dd,
        pit_pd: cur.edf,
        pd_fh: cur.fpPd,
        tic: Number.isFinite(riskScore) ? riskScore / 100 : null,
        risk_score: riskScore,
        ccm: cur.ccm,
        mu: cur.mu,
      },
    },
  };
}

function renderPlainText(mount, text) {
  mount.replaceChildren();
  const chunks = String(text || "")
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  for (const chunk of chunks) {
    const paragraph = document.createElement("p");
    paragraph.textContent = chunk;
    mount.append(paragraph);
  }
}

export function mountAiReading({
  button,
  status,
  output,
  caliber,
  result,
  model,
}) {
  let current = null;
  let contextKey = "";
  let requestToken = 0;
  const cache = new Map();

  async function generate() {
    if (!current) return;
    const mine = ++requestToken;
    button.disabled = true;
    button.textContent = "Reading the model…";
    status.textContent = "Calling the server-side model. The figures remain the dashboard’s own.";
    status.dataset.state = "loading";
    output.hidden = true;

    try {
      let body = cache.get(contextKey);
      if (!body) {
        const response = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(current),
        });
        body = await response.json();
        if (!response.ok) {
          throw new Error(body.error || `HTTP ${response.status}`);
        }
        if (body.error) throw new Error(body.error);
        cache.set(contextKey, body);
      }
      if (mine !== requestToken) return;

      renderPlainText(caliber, body.caliber_explanation);
      renderPlainText(result, body.result_analysis);
      model.textContent = body.model || "configured model";
      status.textContent = "Live analysis complete. Regenerate after changing the rating date.";
      status.dataset.state = "ready";
      output.hidden = false;
      button.textContent = "Regenerate analysis";
    } catch (error) {
      if (mine !== requestToken) return;
      status.textContent = `AI analysis unavailable: ${error.message}`;
      status.dataset.state = "error";
      button.textContent = "Try again";
    } finally {
      if (mine === requestToken) button.disabled = false;
    }
  }

  button.addEventListener("click", generate);

  return {
    update(row, cur) {
      const next = payloadFor(row, cur);
      const nextKey = next ? `${row.ticker}:${cur.date ?? "latest"}` : "";
      if (nextKey && nextKey === contextKey) {
        current = next;
        return;
      }
      requestToken += 1;
      current = next;
      contextKey = nextKey;
      button.disabled = !current;
      button.textContent = "Generate live analysis";
      status.textContent = current
        ? `Ready for ${row.ticker} at ${cur.date ?? "the selected date"}.`
        : "Choose a rated company first.";
      status.dataset.state = current ? "idle" : "disabled";
      output.hidden = true;
      caliber.replaceChildren();
      result.replaceChildren();
      model.textContent = "";
    },
  };
}
