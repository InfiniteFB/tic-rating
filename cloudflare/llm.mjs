/**
 * The channels this deployment can speak, table-driven. `transport` picks the
 * wire protocol; everything else is credentials and defaults.
 *
 * `deepseek` is the default because Pages Functions execute at the edge
 * location nearest the visitor, and OpenAI answers 403
 * `unsupported_country_region_territory` from some of those colos (LAX
 * reproduced it every time while SIN succeeded). DeepSeek answers from all
 * of them.
 *
 * `anthropic` (MiniMax) is the standby: a second vendor on a second wire
 * protocol, so an outage, a quota wall or a geo block on the primary does
 * not take the analyst down with it.
 */
const CHANNELS = {
  openai: {
    transport: "openai",
    keyVar: "OPENAI_API_KEY",
    baseVar: "OPENAI_BASE_URL",
    modelVar: "OPENAI_MODEL",
    base: "https://api.openai.com/v1",
    model: "gpt-5.6-luna",
    effort: "low",
  },
  deepseek: {
    transport: "openai",
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
  anthropic: {
    transport: "anthropic",
    keyVar: "LLM_API_KEY",
    baseVar: "LLM_BASE_URL",
    modelVar: "LLM_MODEL",
    base: "https://api.minimaxi.com/anthropic",
    model: "MiniMax-M3",
  },
};

const DEFAULT_PROVIDER = "deepseek";
const DEFAULT_FALLBACK_PROVIDER = "anthropic";
const DEFAULT_MAX_TOKENS = 4000;
const ANTHROPIC_VERSION = "2023-06-01";

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

/** The standby channel; null when the deployment is configured without one. */
export function fallbackProvider(env) {
  const configured = (
    env.LLM_FALLBACK_PROVIDER ?? DEFAULT_FALLBACK_PROVIDER
  ).trim().toLowerCase();
  return ["", "none", "off"].includes(configured) ? null : configured;
}

/** Primary first, then the standby — deduped, so they can safely coincide. */
export function providerChain(env) {
  const chain = [provider(env), fallbackProvider(env)].filter(Boolean);
  return chain.filter((name, i) => chain.indexOf(name) === i);
}

function channel(env, name = provider(env)) {
  const found = CHANNELS[name];
  if (!found) {
    throw new Error(
      `unknown LLM_PROVIDER '${name}'; use one of: ` +
        Object.keys(CHANNELS).sort().join(", ")
    );
  }
  return found;
}

function model(env, name = provider(env)) {
  const found = CHANNELS[name];
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
function reasoningEffort(env, name = provider(env)) {
  const configured = (
    env.LLM_REASONING_EFFORT ||
    env.OPENAI_REASONING_EFFORT || // the older name
    CHANNELS[name]?.effort ||
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

/** Credentials and endpoint for a channel, or a clear error naming what is missing. */
function credentials(env, name) {
  const active = channel(env, name);
  const key = env[active.keyVar];
  if (!key) {
    throw new Error(`${active.keyVar} is not configured`);
  }
  return {
    active,
    key,
    baseUrl: (env[active.baseVar] || active.base).replace(/\/+$/, ""),
  };
}

async function anthropicChat(env, name, prompt, tokenLimit, fetchImpl) {
  const { key, baseUrl } = credentials(env, name);
  const body = {
    model: model(env, name),
    max_tokens: tokenLimit,
    messages: [
      { role: "user", content: [{ type: "text", text: prompt.user }] },
    ],
  };
  if (prompt.system) body.system = prompt.system;

  const response = await fetchImpl(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      // MiniMax's compatibility endpoint authenticates on x-api-key, not a
      // bearer token, and rejects the request without a version header.
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Anthropic HTTP ${response.status}: ${detail}`);
  }
  const data = await response.json();
  const text = (Array.isArray(data?.content) ? data.content : [])
    .filter((block) => block?.type === "text")
    .map((block) => block.text || "")
    .join("");
  if (!text && data?.stop_reason === "max_tokens") {
    throw new Error(
      `${model(env, name)} exhausted its ${tokenLimit}-token completion budget`
    );
  }
  return text;
}

async function openAiChat(env, name, prompt, tokenLimit, fetchImpl) {
  const { key, baseUrl } = credentials(env, name);
  const messages = [];
  if (prompt.system) messages.push({ role: "system", content: prompt.system });
  messages.push({ role: "user", content: prompt.user });

  const body = {
    model: model(env, name),
    max_completion_tokens: tokenLimit,
    messages,
  };
  const effort = reasoningEffort(env, name);
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
      `${model(env, name)} exhausted its ${tokenLimit}-token completion budget`
    );
  }
  return text;
}

/** Send one prompt down one channel, on whichever wire protocol it speaks. */
function chat(env, name, prompt, tokenLimit, fetchImpl) {
  const transport = channel(env, name).transport;
  if (transport === "anthropic") {
    return anthropicChat(env, name, prompt, tokenLimit, fetchImpl);
  }
  return openAiChat(env, name, prompt, tokenLimit, fetchImpl);
}

const message = (error) =>
  error instanceof Error ? error.message : String(error);

/**
 * Walk the provider chain until one answers.
 *
 * Returns the text and the channel that produced it, so a caller can report
 * the model that actually spoke rather than the one that was asked first.
 * If every channel fails, the thrown error names each attempt — a bare "the
 * primary failed" hides the reason the standby did too.
 */
async function chatWithFallback(env, prompt, tokenLimit, fetchImpl) {
  const chain = providerChain(env);
  const failures = [];
  for (const name of chain) {
    try {
      const text = await chat(env, name, prompt, tokenLimit, fetchImpl);
      return { text, name, model: model(env, name), fellBack: name !== chain[0] };
    } catch (error) {
      failures.push(`${name}: ${message(error)}`);
    }
  }
  throw new Error(failures.join(" | "));
}

export async function explain(payload, env, fetchImpl = fetch) {
  try {
    const prompt = buildPrompt(payload);
    const answer = await chatWithFallback(env, prompt, maxTokens(env), fetchImpl);
    return {
      ...splitSections(answer.text),
      model: answer.model,
      error: null,
    };
  } catch (error) {
    return {
      caliber_explanation: "",
      result_analysis: "",
      model: model(env),
      error: message(error),
    };
  }
}

export async function health(env, fetchImpl = fetch) {
  // 64 rather than 16: a thinking model can spend the whole budget
  // deliberating and come back empty, which reads as an outage.
  const prompt = { user: "Reply with OK." };
  const probes = [];
  for (const name of providerChain(env)) {
    try {
      await chat(env, name, prompt, 64, fetchImpl);
      probes.push({ provider: name, model: model(env, name), reachable: true });
    } catch (error) {
      probes.push({
        provider: name,
        model: model(env, name),
        reachable: false,
        detail: message(error),
      });
    }
  }
  const live = probes.find((probe) => probe.reachable);
  return {
    // "reachable" stays true while any channel can answer -- that is what the
    // page's analyst button actually depends on.
    reachable: Boolean(live),
    detail: live
      ? live.provider === probes[0].provider
        ? "ok"
        : `primary down, serving from ${live.provider}`
      : probes.map((p) => `${p.provider}: ${p.detail}`).join(" | "),
    channels: probes,
  };
}
