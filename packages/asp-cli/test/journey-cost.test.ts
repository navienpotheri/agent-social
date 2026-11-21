/**
 * The cost to the sponsor on the journey (register row DK1347): the sponsor view shows, beside each Action and in a summary, the tokens the Actions report (the gateway's own measure, not an estimate), the credits spent, the cost per
 * paid job and the agent's standing cap with how close it is; the public view carries none of it; the page and `asp journey --sponsor-view` show it, and the cap is applied on the sponsor's own machine. Synthetic records stand in for a
 * log. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { journeyOf, withBudget } from "../../asp-log/src/index.ts";
import { renderJourneyHtml } from "../../asp-package/src/journey-pages.ts";
import { journeyCommand, renderJourneyText } from "../src/journey-cmd.ts";

const AGENT = "did:web:example.com:agents:cost-agent", SPONSOR = "did:web:example.com:users:cost-sponsor", CLIENT = "did:web:example.com:users:cost-client";
type Rec = { seq: number; id: string; record: { type: string; issuer: string; subject?: string | null; issued_at: string; body: Record<string, unknown> } };
function log(actions: { at: string; tin: number; tout: number }[], jobs = 2, spent = 30): Rec[] {
  const out: Rec[] = [];
  let seq = 0;
  const push = (type: string, issuer: string, at: string, body: Record<string, unknown>, subject: string | null = null) => { seq++; const id = `sha256:${String(seq).padStart(64, "0")}`; out.push({ seq, id, record: { type: `asp.${type}/v0.2`, issuer, subject, issued_at: at, body } }); return id; };
  push("passport", SPONSOR, "2026-11-01T00:00:00Z", { did: AGENT, kind: "agent", sponsor: SPONSOR, tier: 1, shape: {}, keys: [] }, AGENT);
  for (let i = 0; i < jobs; i++) {
    const c = push("contract", CLIENT, "2026-11-02T10:00:00Z", { principal: CLIENT, performer: AGENT, price: { value: 50 } }, AGENT);
    push("settlement", "did:web:asp.local:bank", "2026-11-02T11:00:00Z", { contract: c, basis: "accepted", escrow_released: { value: 50 }, fees: { value: 1 }, bond_slashed: { value: 0 }, bond_returned: { value: 0 } }, c);
  }
  if (spent) push("purchase", AGENT, "2026-11-03T10:00:00Z", { service: "registry.name.claim", institution: "did:web:asp.local:registry", amount: { value: spent, unit: "credit" } });
  for (const a of actions) push("action", AGENT, a.at, { contract: "x", scopes_used: ["repo.read"], assurance: "gateway_observed", summary: "SECRET run text", metrics: { tokens_in: a.tin, tokens_out: a.tout, tool_calls: 1, seconds: 3 } });
  return out;
}
const NOW = "2026-11-20T12:00:00Z";
const ACTIONS = [{ at: "2026-11-05T10:00:00Z", tin: 1000, tout: 200 }, { at: "2026-11-19T10:00:00Z", tin: 500, tout: 100 }, { at: "2026-11-20T09:00:00Z", tin: 300, tout: 400 }];

test("DK1347: the sponsor view carries each Action's tokens and a summary that sums them; per paid job and per credit spent; today and this month", () => {
  const j = journeyOf({ stored: log(ACTIONS) as never, now: NOW }, "cost-agent", "sponsor")!;
  const acts = j.steps.filter((s) => s.tokens);
  assert.deepEqual(acts.map((s) => s.tokens), [{ in: 1000, out: 200 }, { in: 500, out: 100 }, { in: 300, out: 400 }]);
  const c = j.cost!;
  assert.deepEqual([c.actions, c.tokens.in, c.tokens.out, c.tokens.total], [3, 1800, 700, 2500]);
  assert.equal(acts.reduce((n, s) => n + s.tokens!.in + s.tokens!.out, 0), c.tokens.total, "a step's cost sums to the summary");
  assert.deepEqual([c.tokens.today, c.tokens.month], [700, 2500], "today is the 20th only; the month is November");
  assert.deepEqual([c.perAcceptedJob.tokens, c.perAcceptedJob.credits], [1250, 15], "2,500 tokens and 30 credits over 2 paid jobs");
  assert.deepEqual([c.credits.earned, c.credits.spent], [98, 30]);
  assert.equal(c.cap, undefined, "no cap known: none claimed");
  assert.match(c.note, /nothing is estimated/);
  // a month later the month figure restarts; no accepted job: no per-job figure
  const later = journeyOf({ stored: log(ACTIONS, 0, 0) as never, now: "2026-12-02T00:00:00Z" }, "cost-agent", "sponsor")!.cost!;
  assert.deepEqual([later.tokens.month, later.tokens.today, later.perAcceptedJob.tokens, later.perAcceptedJob.credits], [0, 0, null, null]);
});

test("DK1347: the public view has no cost at all: no summary, no tokens on a step, no word of it in the data or the page; the free text of an Action never appears", () => {
  const j = journeyOf({ stored: log(ACTIONS) as never, now: NOW }, "cost-agent", "public")!;
  assert.equal(j.cost, undefined);
  assert.ok(j.steps.every((s) => s.tokens === undefined));
  const data = JSON.stringify(j);
  assert.ok(!/"tokens":|SECRET run text|"cost":/.test(data), "no cost in the public data");
  const page = renderJourneyHtml(j);
  assert.ok(!/What it cost you|1250|2500/.test(page), "no cost on the public page");
});

test("DK1347: the cap: how close the agent is to its daily and monthly token caps, ok, warn from the warning level and reached at the cap; the sponsor's machine applies it", () => {
  const sponsor = journeyOf({ stored: log(ACTIONS) as never, now: NOW }, "cost-agent", "sponsor")!;
  const at = (b: Parameters<typeof withBudget>[1]) => withBudget(sponsor, b).cost!.cap!;
  assert.deepEqual(at({ monthlyTokens: 10_000 }), { dailyTokens: null, monthlyTokens: 10_000, warnPercent: 80, dayPercent: null, monthPercent: 25, state: "ok" });
  assert.equal(at({ monthlyTokens: 3000 }).state, "warn", "2,500 of 3,000 is 83%");
  assert.equal(at({ monthlyTokens: 3000 }).monthPercent, 83);
  assert.equal(at({ monthlyTokens: 2500 }).state, "reached", "at the cap");
  assert.equal(at({ dailyTokens: 700, monthlyTokens: 99_999 }).state, "reached", "today's 700 reaches the daily cap");
  assert.equal(at({ dailyTokens: 1000, warnPercent: 60 }).state, "warn", "700 of 1,000 with a warning level of 60");
  assert.equal(withBudget(sponsor, {}).cost!.cap, undefined, "no cap, none claimed");
  const pub = journeyOf({ stored: log(ACTIONS) as never, now: NOW }, "cost-agent", "public")!;
  assert.equal(withBudget(pub, { monthlyTokens: 1 }), pub, "a public view is never given a cost");
  const viaInput = journeyOf({ stored: log(ACTIONS) as never, now: NOW, budget: { monthlyTokens: 2600 } }, "cost-agent", "sponsor")!.cost!.cap!;
  assert.equal(viaInput.state, "warn");
});

test("DK1347: the sponsor page shows the tokens, the cost per paid job and the cap in words; an agent past its cap is told it is refused; nothing shows without a cost", () => {
  const j = withBudget(journeyOf({ stored: log(ACTIONS) as never, now: NOW }, "cost-agent", "sponsor")!, { monthlyTokens: 2500 });
  const page = renderJourneyHtml(j);
  assert.match(page, /<h2>What it cost you<\/h2>/);
  assert.match(page, /<b>2500<\/b><span>tokens in all<\/span>/);
  assert.match(page, /<b>1250<\/b><span>tokens per paid job<\/span>/);
  assert.match(page, /<b>15<\/b><span>credits spent per paid job<\/span>/);
  assert.match(page, /<b>Cap: reached\.<\/b> This month 2500 of 2500 tokens \(100%\)/);
  assert.match(page, /A run past a cap is refused by the gateway/);
  assert.match(page, /1200 tokens<\/small>/, "a step's own tokens");
  const noCap = renderJourneyHtml(journeyOf({ stored: log(ACTIONS) as never, now: NOW }, "cost-agent", "sponsor")!);
  assert.match(noCap, /No standing cap is known for this agent here/);
  assert.ok(!/What it cost you/.test(renderJourneyHtml(journeyOf({ stored: log(ACTIONS) as never, now: NOW }, "cost-agent", "public")!)));
});

test("DK1347: `asp journey --sponsor-view` prints the cost and the cap from the sponsor's own budget file; the public view prints none", async () => {
  const out: string[] = [];
  const io = { out: (l: string) => out.push(l), err: (l: string) => out.push(l), env: {} };
  const local = async () => log(ACTIONS) as never;
  await journeyCommand("cost-agent", { "sponsor-view": true }, io, local, (did) => (did === AGENT ? { monthlyTokens: 3000 } : {}));
  const text = out.join("\n");
  assert.match(text, /cost to you: \d+ tokens in all \(1800 in, 700 out\) over 3 Action\(s\)/);
  assert.match(text, /per paid job 1250 tokens and 15 credits spent/);
  assert.match(text, /cap: warn; month \d+ of 3000 tokens \(\d+%\)/);
  assert.match(text, /\[1200 tokens\]/);
  out.length = 0;
  await journeyCommand("cost-agent", {}, io, local, () => ({ monthlyTokens: 1 }));
  assert.ok(!/cost to you|cap:|tokens\]/.test(out.join("\n")), "the public view prints no cost");
  assert.ok(renderJourneyText(journeyOf({ stored: log([]) as never, now: NOW }, "cost-agent", "sponsor")!).join("\n").includes("0 tokens in all"));
});
