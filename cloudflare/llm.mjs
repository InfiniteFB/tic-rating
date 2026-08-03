/**
 * The OpenAI-compatible channels this deployment can speak, table-driven:
 * same wire protocol, different credentials and defaults.
 *
 * `deepseek` is the default because Pages Functions execute at the edge
 * location nearest the visitor, and OpenAI answers 403
 * `unsupported_country_region_territory` from some of those colos (LAX
 * reproduced it every time while SIN succeeded). DeepSeek answers from all
 * of them.
 */
const CHANNELS = {
  openai: {
    keyVar: "OPENAI_API_KEY",
    baseVar: "OPENAI_BASE_URL",
    modelVar: "OPENAI_MODEL",
    base: "https://api.openai.com/v1",
    model: "gpt-5.6-luna",
    effort: "low",
  },
  deepseek: {
    keyVar: "DEEPSEEK_API_KEY",
    baseVar: "DEEPSEEK_BASE_URL",
    modelVar: "DEEPSEEK_MODEL",
    base: "https://api.deepseek.com/v1",
    model: "deepseek-v4-flash",
    // v4 thinks by default; on this prompt that cost 8354 reasoning tokens
    // and 78 seconds for prose no better than the 5-second answer with
    // thinking off. The figures arrive pre-computed — nothing to deliberate.
    effort: "none",
  },
};

const DEFAULT_PROVIDER = "deepseek";
const DEFAULT_MAX_TOKENS = 4000;

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

export function provider(env) {
  return (env.LLM_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
}

function channel(env) {
  const found = CHANNELS[provider(env)];
  if (!found) {
    throw new Error(
      `unknown LLM_PROVIDER '${provider(env)}'; use one of: ` +
        Object.keys(CHANNELS).sort().join(", ")
    );
  }
  return found;
}

function model(env) {
  const found = CHANNELS[provider(env)];
  // Named before validation so an error response can still say which model
  // was asked for rather than reporting "undefined".
  return env[found?.modelVar] || found?.model || env.OPENAI_MODEL || "unknown";
}

/**
 * How much deliberation to ask for; null means send no such field.
 *
 * "none" is a real, meaningful value — it is how DeepSeek v4 is told not to
 * think — so it must go over the wire. Only "default" (or an empty setting)
 * means "send nothing and inherit the model's own choice".
 */
function reasoningEffort(env) {
  const configured = (
    env.LLM_REASONING_EFFORT ||
    env.OPENAI_REASONING_EFFORT || // the older name
    CHANNELS[provider(env)]?.effort ||
    ""
  ).trim();
  return ["", "default"].includes(configured.toLowerCase()) ? null : configured;
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
  const active = channel(env);
  const key = env[active.keyVar];
  if (!key) {
    throw new Error(`${active.keyVar} is not configured`);
  }
  const baseUrl = (env[active.baseVar] || active.base).replace(/\/+$/, "");
  const body = {
    model: model(env),
    max_completion_tokens: tokenLimit,
    messages,
  };
  const effort = reasoningEffort(env);
  if (effort) {
    body.reasoning_effort = effort;
  }

  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
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
    // 64 rather than 16: a thinking model can spend the whole budget
    // deliberating and come back empty, which reads as an outage.
    await openAiChat(
      env,
      [{ role: "user", content: "Reply with OK." }],
      64,
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
