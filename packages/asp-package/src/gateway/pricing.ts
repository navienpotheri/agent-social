/**
 * Prices for a spend cap in US dollars (`asp gateway --budget-usd`). These are ESTIMATES for stopping a run, never a bill: the provider's own invoice decides what was charged. A model the table does not know is priced
 * high (DEFAULT_PRICE), so the cap errs towards stopping early, and `--price-in` / `--price-out` (dollars per million tokens) override the table. The figures are rounded up from public list prices and will go stale; a
 * sponsor who wants an exact cap names the prices.
 */
export interface Price { inPerM: number; outPerM: number }
/** The price used for a model that is not in the table: high on purpose. */
export const DEFAULT_PRICE: Price = { inPerM: 15, outPerM: 75 };
const TABLE: { re: RegExp; price: Price }[] = [
  { re: /haiku/i, price: { inPerM: 1.5, outPerM: 7.5 } },
  // The Opus family: list prices from the claude-api skill's model table (cached 2026-11-03): Opus 4.6, 4.7, 4.8 and 5 at $5 in and $25 out, Opus 5.5 at $4 and $20, per million tokens; rounded UP to $6 and $30 like the rows above
  // (an estimate for a cap, never a bill; a lower real price only means the cap stops later than it needed to not). Fable and Mythos models are not in the table and keep the high default.
  { re: /opus/i, price: { inPerM: 6, outPerM: 30 } },
  { re: /sonnet/i, price: { inPerM: 3.5, outPerM: 17.5 } },
  { re: /(gpt-4o-mini|gpt-4\.1-mini|gpt-5-mini|o4-mini)/i, price: { inPerM: 1, outPerM: 4 } },
  { re: /(gpt-4o|gpt-4\.1)(?!-mini)/i, price: { inPerM: 5, outPerM: 20 } },
  { re: /(flash|qwen|llama|mistral|deepseek|free)/i, price: { inPerM: 1, outPerM: 3 } },
];
export function priceFor(model: unknown, override?: Partial<Price>): Price {
  const base = typeof model === "string" ? TABLE.find((t) => t.re.test(model))?.price ?? DEFAULT_PRICE : DEFAULT_PRICE;
  return { inPerM: override?.inPerM ?? base.inPerM, outPerM: override?.outPerM ?? base.outPerM };
}
/** Cost of a call. Cached prompt tokens are billed apart from `inTokens`: a cache read at a tenth of the input price, a cache write at one and a quarter times it (rounded up: Claude Code leans on the cache, so counting only `input_tokens` would undercount badly). */
export const costUsd = (inTokens: number, outTokens: number, p: Price, cacheRead = 0, cacheWrite = 0): number => (inTokens * p.inPerM + outTokens * p.outPerM + cacheRead * p.inPerM * 0.1 + cacheWrite * p.inPerM * 1.25) / 1e6;

/** The most a model call could cost: the whole request as input (about one token for every three characters, rounded up) and the largest reply the request allows. Used to refuse a call that could pass the cap. */
export function worstCaseUsd(body: unknown, p: Price): number {
  const b = (body ?? {}) as { max_tokens?: number; max_completion_tokens?: number; max_output_tokens?: number };
  const inTok = Math.ceil(JSON.stringify(body ?? "").length / 3);
  const outTok = b.max_tokens ?? b.max_completion_tokens ?? b.max_output_tokens ?? 4096;
  return costUsd(inTok, Math.max(1, outTok), p);
}

/** Whether the table has a price for this model (false: it would be priced at DEFAULT_PRICE, an assumed high price). */
export const isPricedModel = (model: unknown): boolean => typeof model === "string" && TABLE.some((t) => t.re.test(model));
