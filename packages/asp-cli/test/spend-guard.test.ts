// DK1715: the sponsor's spend guard: defaults a person never set, clamped to the operator's maximum, alerts at 50, 80 and 100 percent exactly once each, a hard stop at the next model call named in the run log,
// and the figures on the page that tells a person what a run can cost. Stand-in provider; fake keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGateway } from "@agent-social/asp-package";
import { DEFAULT_DAY_TOKENS, DEFAULT_RUN_TOKENS, OPERATOR_MAX_DAY_TOKENS, OPERATOR_MAX_RUN_TOKENS, alertLine, ceilingsFor } from "../src/spend-guard.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("a run carries default ceilings when nothing is set, the sponsor may raise or lower them, and never above what the operator allows", () => {
  assert.deepEqual(ceilingsFor({}), { perRun: DEFAULT_RUN_TOKENS, perDay: DEFAULT_DAY_TOKENS, clamped: [] });
  assert.equal(ceilingsFor({ "token-cap": "500", "daily-tokens": "9000" }).perRun, 500, "lowered");
  assert.equal(ceilingsFor({ "token-cap": "5000000" }).perRun, 5_000_000, "raised, within the operator's maximum");
  const high = ceilingsFor({ "token-cap": String(OPERATOR_MAX_RUN_TOKENS * 5), "daily-tokens": String(OPERATOR_MAX_DAY_TOKENS * 5) });
  assert.deepEqual([high.perRun, high.perDay], [OPERATOR_MAX_RUN_TOKENS, OPERATOR_MAX_DAY_TOKENS]);
  assert.equal(high.clamped.length, 2, "each clamp is said");
  const lowered = ceilingsFor({ "token-cap": String(OPERATOR_MAX_RUN_TOKENS) }, { ASP_MAX_RUN_TOKENS: "100000" });
  assert.equal(lowered.perRun, 100_000, "the operator may lower its own maximum");
  assert.throws(() => ceilingsFor({ "token-cap": "0" }), /whole number of tokens/);
  assert.throws(() => ceilingsFor({}, { ASP_MAX_DAY_TOKENS: "abc" }), /ASP_MAX_DAY_TOKENS/);
});

test("the page that tells a person what a run can cost states the figures the code enforces", () => {
  const page = readFileSync(join(root, "docs/run-cost.md"), "utf8");
  const f = (n: number) => n.toLocaleString("en-US");
  for (const n of [DEFAULT_RUN_TOKENS, DEFAULT_DAY_TOKENS, OPERATOR_MAX_RUN_TOKENS, OPERATOR_MAX_DAY_TOKENS]) assert.ok(page.includes(f(n)), `the page says ${f(n)}`);
  assert.match(page, /50, 80 and 100 percent/);
  assert.match(page, /not money/);
});

test("the gateway tells the person at 50, 80 and 100 percent once each, and refuses the next model call at the ceiling without calling the provider; the run log names both", async () => {
  const servers: Server[] = [];
  let providerCalls = 0;
  const up = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    providerCalls++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 6, completion_tokens: 4 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] }));
  });
  await new Promise<void>((r) => up.listen(0, "127.0.0.1", r));
  servers.push(up);
  const events: { kind: string; data: any }[] = [], alerts: number[] = [], refusals: string[] = [];
  const g = createGateway({
    openaiUpstream: `http://127.0.0.1:${(up.address() as { port: number }).port}/v1`, scopes: ["repo.read"], tokenCap: 20,
    runLog: { event: (kind: string, data: any) => { events.push({ kind, data }); }, head: () => ({}) } as any,
    onBudgetAlert: (e) => alerts.push(e.percent), onCall: (e) => { if (!e.allowed) refusals.push(e.reason ?? ""); },
  });
  const port = await g.listen();
  try {
    const call = () => fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages: [] }) });
    assert.equal((await call()).status, 200);                              // 10 of 20: 50%
    assert.deepEqual(alerts, [50]);
    assert.equal((await call()).status, 200);                              // 20 of 20: 80% and 100% at once
    assert.deepEqual(alerts, [50, 80, 100], "each threshold once");
    assert.equal(providerCalls, 2);
    const stopped = await call();                                          // the next model call is refused
    assert.equal(stopped.status, 429);
    assert.match(JSON.stringify(await stopped.json()), /asp_token_budget/);
    assert.equal(providerCalls, 2, "the provider was not called");
    assert.match(refusals[0], /used 20 of its 20 tokens/);
    await call();
    assert.deepEqual(alerts, [50, 80, 100], "no alert twice");
    assert.deepEqual(events.filter((e) => e.kind === "budget_alert").map((e) => e.data.percent), [50, 80, 100]);
    assert.equal(events.filter((e) => e.kind === "budget_stop").length, 2);
    assert.match(alertLine({ percent: 80, used: 16, cap: 20 }), /80% of its token ceiling \(16 of 20\)/);
    assert.match(alertLine({ percent: 100, used: 20, cap: 20 }), /next model call is refused/);
  } finally { await g.close(); for (const s of servers) s.close(); }
});
