import { explain } from "../../cloudflare/llm.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const REQUESTS_PER_HOUR = 5;

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

async function consumeQuota(context) {
  if (!context.env.RATE_LIMIT) return true;
  const ip =
    context.request.headers.get("CF-Connecting-IP") ||
    context.request.headers.get("x-forwarded-for") ||
    "unknown";
  const hour = Math.floor(Date.now() / 3_600_000);
  const key = `llm:${ip}:${hour}`;
  try {
    const count = Number.parseInt(
      (await context.env.RATE_LIMIT.get(key)) || "0",
      10
    );
    if (count >= REQUESTS_PER_HOUR) return false;
    await context.env.RATE_LIMIT.put(key, String(count + 1), {
      expirationTtl: 7_200,
    });
    return true;
  } catch (error) {
    console.warn("RATE_LIMIT unavailable; allowing request", error);
    return true;
  }
}

export async function handlePost(context, fetchImpl = fetch) {
  const contentType = context.request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ error: "Content-Type must be application/json" }, 415);
  }

  const declaredLength = Number.parseInt(
    context.request.headers.get("content-length") || "0",
    10
  );
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ error: "Request body is too large" }, 413);
  }

  let payload;
  try {
    const text = await context.request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return json({ error: "Request body is too large" }, 413);
    }
    payload = JSON.parse(text);
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json({ error: "Request body must be a JSON object" }, 422);
  }
  if (!(await consumeQuota(context))) {
    return json({ error: "AI request limit reached; try again later" }, 429);
  }
  return json(await explain(payload, context.env, fetchImpl));
}

export const onRequestPost = (context) => handlePost(context);
