/**
 * Register row DK1345 (the cost steps of the journey): the sponsor view can carry an ESTIMATED dollar cost beside each Action and for the whole journey, from the tokens each Action reports, the model its metrics name and a
 * price table the caller supplies (`asp journey --sponsor-view --usd` passes the gateway's table). An estimate, never a bill; a model that is not in the table is priced high and counted as assumed; the public view
 * never carries it; without the flag nothing changes. Synthetic records, fake keys, mock credits.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { journeyOf, withUsdEstimate } from "../../asp-log/src/index.ts";
import { DEFAULT_PRICE, isPricedModel, priceFor } from "../../asp-package/src/gateway/pricing.ts";
import { journeyCommand, renderJourneyText } from "../src/journey-cmd.ts";

const AGENT = "did:web:example.com:agents:usd-agent", SPONSOR = "did:web:example.com:users:usd-sponsor";
type Rec = { seq: number; id: string; record: { type: string; issuer: string; subject?: string | null; issued_at: string; body: Record<string, unknown> } };
function log(actions: { tin: number; tout: number; model?: string }[]): Rec[] {
  const out: Rec[] = [];
  let seq = 0;
  const push = (type: string, issuer: string, at: string, body: Record<string, unknown>, subject: string | null = null) => { seq++; out.push({ seq, id: `sha256:${String(seq).padStart(64, "0")}`, record: { type: `asp.${type}/v0.2`, issuer, subject, issued_at: at, body } }); };
  push("passport", SPONSOR, "2026-11-01T00:00:00Z", { did: AGENT, kind: "agent", sponsor: SPONSOR, tier: 1, shape: {}, keys: [] }, AGENT);
  for (const a of actions) push("action", AGENT, "2026-11-19T10:00:00Z", { contract: "x", scopes_used: ["repo.read"], assurance: "gateway_observed", summary: "SECRET run text", metrics: { tokens_in: a.tin, tokens_out: a.tout, ...(a.model ? { models: [{ name: a.model }] } : {}) } });
  return out;
}
const NOW = "2026-11-20T12:00:00Z";
const pricer = (model: string | undefined) => { const p = priceFor(model); return { ...p, known: isPricedModel(model) }; };
const ACTIONS = [{ tin: 1_000_000, tout: 1_000_000, model: "claude-haiku-5-5" }, { tin: 1_000_000, tout: 0, model: "some-new-model" }, { tin: 100, tout: 100 }];

test("a step carries the model its metrics name (sponsor view only) and the estimate prices each step and the whole journey; an unknown model is priced high and counted as assumed", () => {
  const j = journeyOf({ stored: log(ACTIONS) as never, now: NOW }, "usd-agent", "sponsor")!;
  const acts = j.steps.filter((s) => s.tokens);
  assert.deepEqual(acts.map((s) => s.tokens!.model), ["claude-haiku-5-5", "some-new-model", undefined]);
  const e = withUsdEstimate(j, pricer);
  const steps = e.steps.filter((s) => s.usd_estimate);
  assert.equal(steps[0].usd_estimate!.usd, 9, "1M in at $1.5 and 1M out at $7.5");
  assert.equal(steps[0].usd_estimate!.assumed_price, false);
  assert.equal(steps[1].usd_estimate!.usd, DEFAULT_PRICE.inPerM, "1M in at the default price");
  assert.equal(steps[1].usd_estimate!.assumed_price, true);
  assert.equal(steps[2].usd_estimate!.assumed_price, true, "no model named: assumed");
  const u = e.cost!.usd!;
  assert.equal(u.actionsPriced, 3);
  assert.equal(u.actionsAssumed, 2);
  assert.ok(Math.abs(u.estimate - (9 + DEFAULT_PRICE.inPerM + (100 * DEFAULT_PRICE.inPerM + 100 * DEFAULT_PRICE.outPerM) / 1e6)) < 1e-3);
  assert.match(u.note, /never a bill/);
});

test("without the estimate nothing changes, and the public view has neither a model nor a dollar figure", () => {
  const j = journeyOf({ stored: log(ACTIONS) as never, now: NOW }, "usd-agent", "sponsor")!;
  assert.equal(j.cost!.usd, undefined);
  assert.ok(j.steps.every((s) => s.usd_estimate === undefined));
  const pub = journeyOf({ stored: log(ACTIONS) as never, now: NOW }, "usd-agent", "public")!;
  assert.equal(withUsdEstimate(pub, pricer), pub, "the public view is returned as it is");
  assert.ok(!/usd_estimate|"model"|haiku/.test(JSON.stringify(pub)));
});

test("asp journey --sponsor-view --usd prints the estimate, and --usd without the sponsor view is refused", async () => {
  const lines: string[] = [];
  const io = { out: (l: string) => lines.push(l), err: () => undefined, env: {}, cwd: "." } as never;
  const stored = async () => log(ACTIONS) as never;
  assert.equal(await journeyCommand("usd-agent", { "sponsor-view": true, usd: true } as never, io, stored, undefined, pricer), 0);
  assert.match(lines.join("\n"), /estimated cost: \$\d+\.\d{4} over 3 Action\(s\), 2 of them at an assumed \(high\) price/);
  lines.length = 0;
  assert.equal(await journeyCommand("usd-agent", { "sponsor-view": true } as never, io, stored, undefined, pricer), 0);
  assert.ok(!/estimated cost/.test(lines.join("\n")), "no flag, no estimate");
  await assert.rejects(() => journeyCommand("usd-agent", { usd: true } as never, io, stored, undefined, pricer), /--usd is part of the sponsor view/);
  void renderJourneyText;
});
