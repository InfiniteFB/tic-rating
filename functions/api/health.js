import { health } from "../../cloudflare/llm.mjs";

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

export async function handleGet(context, fetchImpl = fetch) {
  return json({
    service: "tic-rating",
    llm: await health(context.env, fetchImpl),
  });
}

export const onRequestGet = (context) => handleGet(context);
