import assert from "node:assert/strict";
import { test } from "node:test";

const { describeNonJson, payloadFor } = await import(
  new URL("./web/js/views/aiReading.js", import.meta.url)
);

// The bug this guards: the static dev server answers POST with a 501 HTML
// page, and parsing that first produced `Unexpected token '<'` — a message
// that named neither the server nor the fix.
test("a 501 from the static dev server names the server, not the parser", () => {
  const message = describeNonJson(501, "text/html;charset=utf-8", "<!DOCTYPE HTML>");
  assert.match(message, /static dev server/);
  assert.match(message, /wrangler pages dev/);
  assert.doesNotMatch(message, /token|JSON\.parse/i);
});

test("405 is the same wrong-server situation", () => {
  assert.match(describeNonJson(405, "text/html", "<html>"), /static dev server/);
});

test("404 points at routing, not at the dev server", () => {
  const message = describeNonJson(404, "text/html", "<!DOCTYPE html>");
  assert.match(message, /not routed|missing/);
  assert.doesNotMatch(message, /dev server/);
});

test("an HTML body on any other status is reported as HTML", () => {
  assert.match(describeNonJson(502, "text/html", "<!DOCTYPE html>"), /HTML page/);
  // sniffed from the body even when the header lies
  assert.match(describeNonJson(500, "application/json", "  <html>"), /HTML page/);
});

test("a non-HTML unparseable body is reported as unreadable", () => {
  assert.match(describeNonJson(500, "text/plain", "boom"), /unreadable/);
});

test("payloadFor scales RiskScore back to TiC and tolerates gaps", () => {
  const payload = payloadFor({ ticker: "KO" }, { rs: 84.81, dd: 12.79, spRating: "AAA-" });
  assert.equal(payload.ticker, "KO");
  assert.equal(payload.result.sp_letter, "AAA-");
  assert.ok(Math.abs(payload.intermediate.metrics.tic - 0.8481) < 1e-9);
  assert.equal(payload.intermediate.metrics.risk_score, 84.81);

  assert.equal(payloadFor(null, {}), null);
  assert.equal(payloadFor({ ticker: "KO" }, null), null);
  // a non-finite RiskScore must not become NaN downstream
  assert.equal(payloadFor({ ticker: "KO" }, { rs: Infinity }).intermediate.metrics.tic, null);
});

/* ── Markdown the model was asked not to write ───────────────────────────
   The mount renders with textContent, so an unhonoured "plain paragraphs"
   instruction reaches the reader as literal asterisks. DeepSeek v4 emits
   `- **Label**: text` on this prompt where luna did not. */

const { stripMarkdown } = await import(
  new URL("./web/js/views/aiReading.js", import.meta.url)
);

test("a bulleted, bolded line renders as plain prose", () => {
  assert.equal(
    stripMarkdown("- **Distance-to-default (DD)**: 12.7919. This means the firm's"),
    "Distance-to-default (DD): 12.7919. This means the firm's"
  );
});

test("bold, italics, code and headings are unwrapped", () => {
  assert.equal(stripMarkdown("**Important caveat**: TiC"), "Important caveat: TiC");
  assert.equal(stripMarkdown("__also bold__ here"), "also bold here");
  assert.equal(stripMarkdown("an *emphasised* word"), "an emphasised word");
  assert.equal(stripMarkdown("the `spPd` field"), "the spPd field");
  assert.equal(stripMarkdown("### THE MARK"), "THE MARK");
});

test("arithmetic and formulae survive unharmed", () => {
  // sigma^2 / ln^2(A/D) and RiskScore (100 * TiC) must not lose characters
  assert.equal(stripMarkdown("computed as sigma^2 / ln^2(A/D)"),
               "computed as sigma^2 / ln^2(A/D)");
  assert.equal(stripMarkdown("RiskScore (100 * TiC) is 0.848148"),
               "RiskScore (100 * TiC) is 0.848148");
  assert.equal(stripMarkdown("Phi(-12.7919) ≈ 0"), "Phi(-12.7919) ≈ 0");
});

test("text with no Markdown at all is returned untouched", () => {
  const plain = "Calibrated assets are $2.18T against equity of $311.35B.";
  assert.equal(stripMarkdown(plain), plain);
  assert.equal(stripMarkdown(""), "");
  assert.equal(stripMarkdown(null), "");
});
