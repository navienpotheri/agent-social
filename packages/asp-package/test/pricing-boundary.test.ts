// The price table and the cost arithmetic of the dollar cap (mutation review, 2026-11-22): every family has its own price and the look-alikes do not borrow it (gpt-4o-mini is not gpt-4o), an unknown model is priced high,
// an override replaces one side only, cached prompt tokens are costed at a tenth (read) and one and a quarter (write) of the input price, and the worst case counts the whole request and the largest reply.
import { test } from "node:test";
import assert from "node:assert/strict";
import { costUsd, DEFAULT_PRICE, isPricedModel, priceFor, worstCaseUsd } from "../src/gateway/pricing.ts";

test("each family has its own price, the mini models are not priced as the big ones, and the match ignores case", () => {
  assert.deepEqual(priceFor("claude-haiku-5-5"), { inPerM: 1.5, outPerM: 7.5 });
  assert.deepEqual(priceFor("CLAUDE-HAIKU-5-5"), { inPerM: 1.5, outPerM: 7.5 });
  assert.deepEqual(priceFor("CLAUDE-SONNET-5-5"), { inPerM: 3.5, outPerM: 17.5 });
  for (const m of ["gpt-4o-mini", "gpt-4.1-mini", "gpt-5-mini", "o4-mini"]) assert.deepEqual(priceFor(m), { inPerM: 1, outPerM: 4 }, m);
  for (const m of ["gpt-4o", "gpt-4o-2024-08-06", "gpt-4.1"]) assert.deepEqual(priceFor(m), { inPerM: 5, outPerM: 20 }, m);
  for (const m of ["gemini-flash", "qwen3-coder", "llama-3.1-70b", "mistral-large", "deepseek-chat", "some-free-model"]) assert.deepEqual(priceFor(m), { inPerM: 1, outPerM: 3 }, m);
});

test("a model not in the table, or no model, is priced at the high default and is not counted as priced", () => {
  for (const m of ["claude-opus-5-5", "gpt-7", "", undefined, null, 42]) assert.deepEqual(priceFor(m), DEFAULT_PRICE, String(m));
  assert.deepEqual(DEFAULT_PRICE, { inPerM: 15, outPerM: 75 });
  assert.equal(isPricedModel("claude-haiku-5-5"), true);
  assert.equal(isPricedModel("claude-opus-5-5"), false);
  assert.equal(isPricedModel(undefined), false);
  assert.equal(isPricedModel(7), false);
});

test("an override replaces the side it names and keeps the other; zero is an override", () => {
  assert.deepEqual(priceFor("claude-haiku-5-5", { inPerM: 2 }), { inPerM: 2, outPerM: 7.5 });
  assert.deepEqual(priceFor("claude-haiku-5-5", { outPerM: 9 }), { inPerM: 1.5, outPerM: 9 });
  assert.deepEqual(priceFor("unknown", { inPerM: 0, outPerM: 0 }), { inPerM: 0, outPerM: 0 });
});

test("the cost is exact: input and output apiece, a cache read at a tenth of the input price, a cache write at one and a quarter times it", () => {
  const p = { inPerM: 1_000_000, outPerM: 2_000_000 };
  assert.equal(costUsd(1, 0, p), 1);
  assert.equal(costUsd(0, 1, p), 2);
  assert.equal(costUsd(0, 0, p, 10), 1, "ten cache-read tokens at a tenth of $1");
  assert.equal(costUsd(0, 0, p, 0, 4), 5, "four cache-write tokens at 1.25 x $1");
  assert.equal(costUsd(1, 1, p, 10, 4), 1 + 2 + 1 + 5);
});

test("the worst case is the whole request (one token a three characters, rounded up) plus the largest reply, which is 4096 when the request names none and never less than 1", () => {
  const p = { inPerM: 1_000_000, outPerM: 0 };
  const body = { model: "m", messages: [] };
  const chars = JSON.stringify(body).length;
  assert.equal(worstCaseUsd(body, p), Math.ceil(chars / 3), "input only, rounded up");
  const q = { inPerM: 0, outPerM: 1_000_000 };
  assert.equal(worstCaseUsd(body, q), 4096, "no max_tokens: 4096");
  assert.equal(worstCaseUsd({ ...body, max_tokens: 100 }, q), 100);
  assert.equal(worstCaseUsd({ ...body, max_completion_tokens: 200 }, q), 200);
  assert.equal(worstCaseUsd({ ...body, max_output_tokens: 300 }, q), 300);
  assert.equal(worstCaseUsd({ ...body, max_tokens: 0 }, q), 1, "never less than one token");
  assert.equal(worstCaseUsd({ ...body, max_tokens: 100, max_completion_tokens: 200 }, q), 100, "max_tokens wins");
  assert.equal(worstCaseUsd(undefined, q), 4096, "an unreadable body is still priced");
  // 3 characters is one token, 4 is two
  assert.equal(worstCaseUsd("abc", p), Math.ceil(JSON.stringify("abc").length / 3));
});
