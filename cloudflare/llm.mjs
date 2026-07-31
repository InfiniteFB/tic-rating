const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";
const DEFAULT_MAX_TOKENS = 4000;
const DEFAULT_REASONING_EFFORT = "low";

const SYSTEM_PROMPT = `You are a credit-risk methodology explainer for a
KMV/Merton structural credit model dashboard. The model treats equity as a
call option on firm assets and reverse-engineers asset value and volatility
from market and balance-sheet observations.

Explain distance-to-default, point-in-time EDF, first-passage PD, TiC,
RiskScore, CCM, mu, and the through-the-cycle S&P-style result using only the
figures supplied by the caller. Always state that raw TiC's absolute scale is
known not to reconcile cleanly with worked examples in the source course
materials and that RiskScore (100 * TiC) is the practical comparison scale.
Also flag the structural optimism bias for large, low-volatility,
high-market-cap issuers. Write precise, concise English and never invent a
number.`;

function get(object, ...keys) {
  let current = object;
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

function format(value) {
  if (value === null || value === undefined) return "N/A";
  return String(value);
}

function model(env) {
  return env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
}

function maxTokens(env) {
  const parsed = Number.parseInt(env.LLM_MAX_TOKENS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_TOKENS;
}

export function buildPrompt(payload = {}) {
  const ticker = payload.ticker || "UNKNOWN";
  const result = payload.result || {};
  const metrics = get(payload, "intermediate", "metrics") || {};

  const user = `Ticker: ${ticker}
S&P-style through-the-cycle rating letter (sp_letter): ${format(result.sp_letter)}
S&P TTC probability of default (sp_ttc_pd): ${format(result.sp_ttc_pd)}
Credit outlook (credit_outlook): ${format(result.credit_outlook)}

Model intermediate metrics:
- Distance-to-default (DD): ${format(metrics.dd)}
- Point-in-time probability of default / EDF (pit_pd): ${format(metrics.pit_pd)}
- First-passage probability of default (pd_fh): ${format(metrics.pd_fh)}
- TiC (time-invariant coefficient): ${format(metrics.tic)}
- RiskScore (100 * TiC): ${format(metrics.risk_score)}
- CCM: ${format(metrics.ccm)}
- mu: ${format(metrics.mu)}

Write exactly two sections with these literal headings:

### CALIBER EXPLANATION
Explain each supplied metric and its value for ${ticker}. State the TiC scale
caveat and why RiskScore is the practical comparison scale.

### RESULT ANALYSIS
Interpret the rating and outlook, then discuss the structural model's
optimism bias for large-market-cap, low-volatility issuers.

Inside each section, write plain paragraphs without Markdown bullets or bold
markers.`;

  return { system: SYSTEM_PROMPT, user };
}

export function splitSections(text = "") {
  const caliberPattern = /###\s*CALIBER EXPLANATION\s*/i;
  const resultPattern = /###\s*RESULT ANALYSIS\s*/i;
  const caliberMatch = caliberPattern.exec(text);
  const resultMatch = resultPattern.exec(text);

  if (caliberMatch && resultMatch) {
    if (caliberMatch.index < resultMatch.index) {
      return {
        caliber_explanation: text
          .slice(caliberMatch.index + caliberMatch[0].length, resultMatch.index)
          .trim(),
        result_analysis: text
          .slice(resultMatch.index + resultMatch[0].length)
          .trim(),
      };
    }
    return {
      caliber_explanation: text
        .slice(caliberMatch.index + caliberMatch[0].length)
        .trim(),
      result_analysis: text
        .slice(resultMatch.index + resultMatch[0].length, caliberMatch.index)
        .trim(),
    };
  }
  if (caliberMatch) {
    return {
      caliber_explanation: text
        .slice(caliberMatch.index + caliberMatch[0].length)
        .trim(),
      result_analysis: "",
    };
  }
  if (resultMatch) {
    return {
      caliber_explanation: "",
      result_analysis: text
        .slice(resultMatch.index + resultMatch[0].length)
        .trim(),
    };
  }
  return { caliber_explanation: "", result_analysis: text.trim() };
}

async function openAiChat(env, messages, tokenLimit, fetchImpl) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const baseUrl = (env.OPENAI_BASE_URL || "https://api.openai.com/v1")
    .replace(/\/+$/, "");
  const body = {
    model: model(env),
    max_completion_tokens: tokenLimit,
    messages,
  };
  const effort = (
    env.OPENAI_REASONING_EFFORT || DEFAULT_REASONING_EFFORT
  ).trim();
  if (effort && !["default", "none"].includes(effort.toLowerCase())) {
    body.reasoning_effort = effort;
  }

  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`OpenAI HTTP ${response.status}: ${detail}`);
  }
  const data = await response.json();
  const choice = data?.choices?.[0];
  const text = choice?.message?.content || "";
  if (!text && choice?.finish_reason === "length") {
    throw new Error(
      `${model(env)} exhausted its ${tokenLimit}-token completion budget`
    );
  }
  return text;
}

export async function explain(payload, env, fetchImpl = fetch) {
  const selectedModel = model(env);
  try {
    if ((env.LLM_PROVIDER || "openai").toLowerCase() !== "openai") {
      throw new Error("Cloudflare deployment currently supports LLM_PROVIDER=openai");
    }
    const prompt = buildPrompt(payload);
    const text = await openAiChat(
      env,
      [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      maxTokens(env),
      fetchImpl
    );
    return {
      ...splitSections(text),
      model: selectedModel,
      error: null,
    };
  } catch (error) {
    return {
      caliber_explanation: "",
      result_analysis: "",
      model: selectedModel,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function health(env, fetchImpl = fetch) {
  try {
    if ((env.LLM_PROVIDER || "openai").toLowerCase() !== "openai") {
      throw new Error("Cloudflare deployment currently supports LLM_PROVIDER=openai");
    }
    await openAiChat(
      env,
      [{ role: "user", content: "Reply with OK." }],
      16,
      fetchImpl
    );
    return { reachable: true, detail: "ok" };
  } catch (error) {
    return {
      reachable: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
