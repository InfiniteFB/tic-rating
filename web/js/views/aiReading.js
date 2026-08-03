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

/**
 * Why a response that isn't JSON isn't JSON.
 *
 * `/api/explain` is a Cloudflare Pages Function. The static dev server that
 * serves `web/` has no such route and answers POST with a 501 HTML page, so
 * parsing the body first turns a plain "wrong server" into an unreadable
 * `Unexpected token '<'`. Say which situation this is instead.
 */
export function describeNonJson(status, contentType = "", body = "") {
  const looksHtml = /^\s*</.test(body) || /html/i.test(contentType);
  if (status === 501 || status === 405) {
    return "this page is being served by the static dev server, which has no " +
      "/api/explain — run `npx wrangler pages dev` or open the deployed site";
  }
  if (status === 404) {
    return "/api/explain is not routed here — the Pages Function is missing " +
      "from this deployment";
  }
  if (looksHtml) {
    return `the server answered HTTP ${status} with an HTML page, not JSON`;
  }
  return `the server answered HTTP ${status} with an unreadable body`;
}

/**
 * Undo the Markdown the model was asked not to write.
 *
 * The prompt says plain paragraphs, and some models honour that while others
 * emit `- **Label**: text` regardless. This mount renders with textContent,
 * so an unhonoured instruction shows the reader literal asterisks. Stripping
 * the markers here makes the page's own presentation the one that decides,
 * whichever model is configured.
 */
export function stripMarkdown(chunk) {
  return String(chunk || "")
    .replace(/^\s{0,3}[-*+]\s+/, "")          // a leading bullet
    .replace(/^\s{0,3}#{1,6}\s+/, "")         // a stray heading
    .replace(/\*\*(.+?)\*\*/gs, "$1")         // bold
    .replace(/__(.+?)__/gs, "$1")             // bold, the other spelling
    .replace(/(^|\s)\*(?=\S)(.+?)\*(?=\s|$)/gs, "$1$2")  // italics, not A*B
    .replace(/`([^`]+)`/g, "$1")              // inline code
    .trim();
}

function renderPlainText(mount, text) {
  mount.replaceChildren();
  const chunks = String(text || "")
    .split(/\n{2,}/)
    .map(stripMarkdown)
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
        // Read as text and parse by hand: response.json() on an HTML error
        // page throws before there is any chance to explain what happened.
        const raw = await response.text();
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error(
            describeNonJson(
              response.status,
              response.headers.get("content-type") || "",
              raw
            )
          );
        }
        if (!response.ok) {
          throw new Error(parsed.error || `HTTP ${response.status}`);
        }
        if (parsed.error) throw new Error(parsed.error);
        body = parsed;
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
