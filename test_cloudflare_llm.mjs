import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

test("Cloudflare LLM module exists and exposes the deployment surface", async () => {
  const modulePath = new URL("./cloudflare/llm.mjs", import.meta.url);
  assert.ok(existsSync(modulePath), "cloudflare/llm.mjs must exist");

  const module = await import(modulePath);
  assert.equal(typeof module.buildPrompt, "function");
  assert.equal(typeof module.splitSections, "function");
  assert.equal(typeof module.explain, "function");
  assert.equal(typeof module.health, "function");
});

const samplePayload = {
  ticker: "AAPL",
  result: {
    sp_letter: "AAA-",
    sp_ttc_pd: 0.0001,
    credit_outlook: "negative",
  },
  intermediate: {
    metrics: {
      dd: 13.249,
      pit_pd: 0,
      pd_fh: 0,
      tic: 0.00685,
      risk_score: 0.685,
      ccm: 0.070982,
      mu: 10.5,
    },
  },
};

test("buildPrompt carries the rated figures into the model request", async () => {
  const { buildPrompt } = await import("./cloudflare/llm.mjs");
  const prompt = buildPrompt(samplePayload);

  assert.match(prompt.system, /credit-risk methodology explainer/);
  assert.match(prompt.user, /Ticker: AAPL/);
  assert.match(prompt.user, /AAA-/);
  assert.match(prompt.user, /13\.249/);
  assert.match(prompt.user, /0\.685/);
  assert.match(prompt.user, /plain paragraphs/i);
});

test("splitSections returns the two requested narrative sections", async () => {
  const { splitSections } = await import("./cloudflare/llm.mjs");
  const sections = splitSections(
    "### CALIBER EXPLANATION\nMetrics.\n### RESULT ANALYSIS\nJudgment."
  );

  assert.deepEqual(sections, {
    caliber_explanation: "Metrics.",
    result_analysis: "Judgment.",
  });
});

test("explain calls OpenAI server-side and returns parsed narration", async () => {
  const { explain } = await import("./cloudflare/llm.mjs");
  let request;
  const fakeFetch = async (url, init) => {
    request = { url, init };
    return Response.json({
      choices: [{
        finish_reason: "stop",
        message: {
          content:
            "### CALIBER EXPLANATION\nMetrics.\n### RESULT ANALYSIS\nJudgment.",
        },
      }],
    });
  };

  const result = await explain(
    samplePayload,
    {
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "gpt-test",
      OPENAI_REASONING_EFFORT: "low",
      LLM_MAX_TOKENS: "4000",
    },
    fakeFetch
  );

  assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(request.init.headers.Authorization, "Bearer test-key");
  assert.equal(JSON.parse(request.init.body).model, "gpt-test");
  assert.deepEqual(result, {
    caliber_explanation: "Metrics.",
    result_analysis: "Judgment.",
    model: "gpt-test",
    error: null,
  });
});

test("health reports missing credentials without throwing", async () => {
  const { health } = await import("./cloudflare/llm.mjs");
  const result = await health(
    { LLM_PROVIDER: "openai", OPENAI_MODEL: "gpt-test" },
    async () => assert.fail("network must not be called without a key")
  );

  assert.equal(result.reachable, false);
  assert.match(result.detail, /OPENAI_API_KEY/);
});

test("Pages health handler returns the provider probe as JSON", async () => {
  const modulePath = new URL("./functions/api/health.js", import.meta.url);
  assert.ok(existsSync(modulePath), "functions/api/health.js must exist");
  const { handleGet } = await import(modulePath);

  const response = await handleGet(
    {
      env: {
        LLM_PROVIDER: "openai",
        LLM_FALLBACK_PROVIDER: "none",
        OPENAI_API_KEY: "test-key",
        OPENAI_MODEL: "gpt-test",
      },
    },
    async () => Response.json({
      choices: [{ finish_reason: "stop", message: { content: "OK" } }],
    })
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const body = await response.json();
  assert.equal(body.service, "tic-rating");
  assert.equal(body.llm.reachable, true);
  assert.equal(body.llm.detail, "ok");
  assert.deepEqual(body.llm.channels.map((c) => c.provider), ["openai"]);
});

test("Pages explain handler validates JSON before calling the model", async () => {
  const modulePath = new URL("./functions/api/explain.js", import.meta.url);
  assert.ok(existsSync(modulePath), "functions/api/explain.js must exist");
  const { handlePost } = await import(modulePath);

  const response = await handlePost(
    {
      request: new Request("https://example.com/api/explain", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not json",
      }),
      env: {},
    },
    async () => assert.fail("invalid input must not call the model")
  );

  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), {
    error: "Content-Type must be application/json",
  });
});

test("company-page AI payload maps the selected rating snapshot", async () => {
  const modulePath = new URL(
    "./web/js/views/aiReading.js",
    import.meta.url
  );
  assert.ok(existsSync(modulePath), "web/js/views/aiReading.js must exist");
  const { payloadFor } = await import(modulePath);

  assert.deepEqual(
    payloadFor(
      { ticker: "AAPL" },
      {
        spRating: "AAA-",
        spPd: 0.0001,
        outlook: "-",
        dd: 13.249,
        edf: 0,
        fpPd: 0,
        rs: 0.685,
        ccm: 0.070982,
        mu: 10.5,
      }
    ),
    {
      ticker: "AAPL",
      result: {
        sp_letter: "AAA-",
        sp_ttc_pd: 0.0001,
        credit_outlook: "-",
      },
      intermediate: {
        metrics: {
          dd: 13.249,
          pit_pd: 0,
          pd_fh: 0,
          tic: 0.00685,
          risk_score: 0.685,
          ccm: 0.070982,
          mu: 10.5,
        },
      },
    }
  );
});

test("Pages explain handler rejects an IP that exhausted its model quota", async () => {
  const { handlePost, REQUESTS_PER_HOUR } = await import("./functions/api/explain.js");
  const response = await handlePost(
    {
      request: new Request("https://example.com/api/explain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.10",
        },
        body: JSON.stringify(samplePayload),
      }),
      env: {
        RATE_LIMIT: {
          // read from the module so retuning the quota cannot drift the test
          get: async () => String(REQUESTS_PER_HOUR),
          put: async () => assert.fail("blocked requests must not write"),
        },
      },
    },
    async () => assert.fail("rate-limited requests must not call the model")
  );

  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    error: "AI request limit reached; try again later",
  });
});

test("AI reading keeps an in-flight request when the same snapshot repaints", async () => {
  const { mountAiReading } = await import("./web/js/views/aiReading.js");
  let clickHandler;
  const button = {
    disabled: false,
    textContent: "",
    addEventListener: (_event, handler) => {
      clickHandler = handler;
    },
  };
  const status = { textContent: "", dataset: {} };
  const output = { hidden: true };
  const caliber = { replaceChildren() {} };
  const result = { replaceChildren() {} };
  const model = { textContent: "" };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Promise(() => {});

  try {
    const mounted = mountAiReading({
      button,
      status,
      output,
      caliber,
      result,
      model,
    });
    const row = { ticker: "AAPL" };
    const cur = {
      date: "2026-07-30",
      spRating: "AAA-",
      rs: 0.685,
    };
    mounted.update(row, cur);
    void clickHandler();
    assert.equal(status.dataset.state, "loading");

    mounted.update(row, { ...cur });
    assert.equal(status.dataset.state, "loading");
    assert.equal(button.disabled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/* ── the DeepSeek channel ────────────────────────────────────────────────
   Pages Functions run at the edge nearest the visitor, and OpenAI answers
   403 unsupported_country_region_territory from some colos (LAX every time,
   SIN never). DeepSeek answers from all of them, so it is the default. */

test("deepseek is the default channel and carries its own credentials", async () => {
  const { explain } = await import("./cloudflare/llm.mjs");
  let request;
  const fakeFetch = async (url, init) => {
    request = { url, init };
    return Response.json({
      choices: [{
        finish_reason: "stop",
        message: { content: "### CALIBER EXPLANATION\nA.\n### RESULT ANALYSIS\nB." },
      }],
    });
  };

  // no LLM_PROVIDER at all — the deployment must still pick deepseek
  const result = await explain(samplePayload, { DEEPSEEK_API_KEY: "ds-key" }, fakeFetch);

  assert.equal(request.url, "https://api.deepseek.com/v1/chat/completions");
  assert.equal(request.init.headers.Authorization, "Bearer ds-key");
  assert.equal(JSON.parse(request.init.body).model, "deepseek-v4-flash");
  assert.equal(result.error, null);
  assert.equal(result.model, "deepseek-v4-flash");
});

test("reasoning_effort 'none' is sent, not swallowed", async () => {
  // The regression this guards: an earlier version treated "none" as
  // "send nothing", which silently left DeepSeek v4 thinking — 8354
  // reasoning tokens and 78 seconds instead of 5.
  const { explain } = await import("./cloudflare/llm.mjs");
  let body;
  const fakeFetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return Response.json({
      choices: [{ finish_reason: "stop", message: { content: "### RESULT ANALYSIS\nB." } }],
    });
  };

  await explain(samplePayload, { DEEPSEEK_API_KEY: "ds-key" }, fakeFetch);
  assert.equal(body.reasoning_effort, "none");

  // "default" is the sentinel that means inherit the model's own choice
  await explain(
    samplePayload,
    { DEEPSEEK_API_KEY: "ds-key", LLM_REASONING_EFFORT: "default" },
    fakeFetch
  );
  assert.equal("reasoning_effort" in body, false);
});

test("a missing DeepSeek key names DEEPSEEK_API_KEY, not the OpenAI one", async () => {
  const { health } = await import("./cloudflare/llm.mjs");
  const result = await health(
    { LLM_PROVIDER: "deepseek" },
    async () => assert.fail("network must not be called without a key")
  );
  assert.equal(result.reachable, false);
  assert.match(result.detail, /DEEPSEEK_API_KEY/);
});

test("an unknown provider degrades with a legible error", async () => {
  const { explain } = await import("./cloudflare/llm.mjs");
  const result = await explain(
    samplePayload,
    { LLM_PROVIDER: "wat", DEEPSEEK_API_KEY: "ds-key" },
    async () => assert.fail("network must not be called for an unknown provider")
  );
  assert.match(result.error, /unknown LLM_PROVIDER/);
  assert.match(result.error, /deepseek/);
});

/* ── MiniMax on standby ──────────────────────────────────────────────────
   A second vendor on a second wire protocol, so an outage, a quota wall or
   a geo block on the primary does not take the analyst down with it. */

/** A fetch that fails the DeepSeek call and answers the MiniMax one. */
function splitFetch({ onAnthropic } = {}) {
  const seen = [];
  const impl = async (url, init) => {
    seen.push({ url, init });
    if (url.includes("/v1/messages")) {
      return (onAnthropic ?? (async () => Response.json({
        content: [{ type: "text", text: "### CALIBER EXPLANATION\nA.\n### RESULT ANALYSIS\nB." }],
        stop_reason: "end_turn",
      })))();
    }
    return new Response("upstream said no", { status: 403 });
  };
  impl.seen = seen;
  return impl;
}

test("a geo-blocked primary is answered by MiniMax", async () => {
  const { explain } = await import("./cloudflare/llm.mjs");
  const fetchImpl = splitFetch();
  const result = await explain(
    samplePayload,
    { DEEPSEEK_API_KEY: "ds-key", LLM_API_KEY: "mm-key" },
    fetchImpl
  );

  assert.equal(result.error, null);
  assert.equal(result.caliber_explanation, "A.");
  // the model reported is the one that actually spoke
  assert.equal(result.model, "MiniMax-M3");

  const [primary, standby] = fetchImpl.seen;
  assert.equal(primary.url, "https://api.deepseek.com/v1/chat/completions");
  assert.equal(standby.url, "https://api.minimaxi.com/anthropic/v1/messages");
  // MiniMax authenticates on x-api-key and rejects a request with no version
  assert.equal(standby.init.headers["x-api-key"], "mm-key");
  assert.equal(standby.init.headers["anthropic-version"], "2023-06-01");
  const body = JSON.parse(standby.init.body);
  assert.equal(body.model, "MiniMax-M3");
  assert.equal(body.max_tokens, 4000);          // not max_completion_tokens
  assert.ok(body.system.includes("credit-risk"));
  assert.equal(body.messages[0].content[0].text.includes("AAPL"), true);
});

test("both channels down reports both reasons", async () => {
  const { explain } = await import("./cloudflare/llm.mjs");
  const result = await explain(
    samplePayload,
    { DEEPSEEK_API_KEY: "ds-key", LLM_API_KEY: "mm-key" },
    splitFetch({ onAnthropic: async () => new Response("minimax down", { status: 500 }) })
  );

  assert.equal(result.caliber_explanation, "");
  assert.match(result.error, /deepseek: .*403/);
  assert.match(result.error, /anthropic: .*500/);
});

test("health stays reachable while the standby answers", async () => {
  const { health } = await import("./cloudflare/llm.mjs");
  const result = await health(
    { DEEPSEEK_API_KEY: "ds-key", LLM_API_KEY: "mm-key" },
    splitFetch({ onAnthropic: async () => Response.json({
      content: [{ type: "text", text: "OK" }], stop_reason: "end_turn",
    }) })
  );

  assert.equal(result.reachable, true);
  assert.match(result.detail, /serving from anthropic/);
  assert.deepEqual(result.channels.map((c) => [c.provider, c.reachable]),
                   [["deepseek", false], ["anthropic", true]]);
});

test("the standby can be switched off", async () => {
  const { providerChain } = await import("./cloudflare/llm.mjs");
  assert.deepEqual(providerChain({}), ["deepseek", "anthropic"]);
  assert.deepEqual(providerChain({ LLM_FALLBACK_PROVIDER: "none" }), ["deepseek"]);
  // a primary that already is the standby must not be tried twice
  assert.deepEqual(providerChain({ LLM_PROVIDER: "anthropic" }), ["anthropic"]);
});
