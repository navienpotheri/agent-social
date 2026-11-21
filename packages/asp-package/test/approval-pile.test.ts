// Row P29 (spec-delta S1453): when approval requests pile up unanswered, no more are asked, the person is told once in words, and an agent that keeps asking for the call is stopped, with no strike. The policy is one
// class (`ApprovalPile`) used by the gateway and by the package path's approvals server; the gateway side is tested here, the package path (hooks, `asp run`) in packages/asp-cli/test/approval-pile-run.test.ts.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalPile, createGateway, type Gateway } from "../src/index.ts";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

test("the pile counts only requests nobody answered, closes at the limit, tells the person once on the first refusal and asks for a stop at the limit of refusals", () => {
  const p = new ApprovalPile({ maxUnanswered: 2, stopAfter: 3 });
  assert.equal(p.closed, false);
  p.noteUnanswered();
  assert.equal(p.closed, false, "one silent request is not a pile");
  p.noteUnanswered();
  assert.equal(p.closed, true);
  const a = p.refuseAtOnce("shell.exec");
  assert.match(a.reason, /2 earlier approval request\(s\) in this session went unanswered, so no more are asked: continue without this call, or stop and tell the person/);
  assert.match(a.notify!, /approvals are piling up: 2 request\(s\)/);
  assert.equal(a.stop, undefined);
  const b = p.refuseAtOnce("shell.exec");
  assert.equal(b.notify, undefined, "the person is told once");
  assert.equal(b.stop, undefined);
  const c = p.refuseAtOnce("shell.exec");
  assert.match(c.stop!, /stopped, with no strike and no slash, because the person did not answer/);
  assert.equal(p.refuseAtOnce("shell.exec").stop, undefined, "the stop is asked for once");
  assert.equal(p.refusedAtOnceCount, 4);
});

test("defaults are 2 and 6 and the environment can change them; a nonsense value falls back", () => {
  assert.deepEqual([new ApprovalPile({ env: {} }).maxUnanswered, new ApprovalPile({ env: {} }).stopAfter], [2, 6]);
  const e = new ApprovalPile({ env: { ASP_MAX_UNANSWERED_APPROVALS: "4", ASP_STOP_AFTER_UNANSWERED: "9" } });
  assert.deepEqual([e.maxUnanswered, e.stopAfter], [4, 9]);
  const bad = new ApprovalPile({ env: { ASP_MAX_UNANSWERED_APPROVALS: "-1", ASP_STOP_AFTER_UNANSWERED: "abc" } });
  assert.deepEqual([bad.maxUnanswered, bad.stopAfter], [2, 6]);
});

test("only the reasons of a request that went unanswered are counted: an answer, a refusal by the person and a stop are not", () => {
  for (const r of ["no answer within 600 seconds", "the principal did not answer within 600 seconds"]) assert.equal(ApprovalPile.isUnanswered(r), true, r);
  for (const r of ["not now", "the run was stopped", undefined, "", "the principal answered refused"]) assert.equal(ApprovalPile.isUnanswered(r), false, String(r));
});

async function upstream() {
  const reply = { id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: "", tool_calls: [{ id: "call_0", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "node deploy.js" }) } }] } }] };
  const server = createServer(async (req, res) => { for await (const _ of req) void _; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(reply)); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
const post = (url: string) => fetch(`${url}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages: [] }) }).then((r) => r.json() as Promise<any>);

test("on the gateway: after two silent requests gated calls are refused at once, the person is told once, an agent that keeps asking is stopped, and none of it is a strike", async () => {
  const saved = { a: process.env.ASP_MAX_UNANSWERED_APPROVALS, b: process.env.ASP_STOP_AFTER_UNANSWERED };
  process.env.ASP_MAX_UNANSWERED_APPROVALS = "2"; process.env.ASP_STOP_AFTER_UNANSWERED = "3";
  try {
    const up = await upstream();
    const notices: string[] = [], stops: string[] = [];
    const g = createGateway({ openaiUpstream: `${up}/v1`, anthropicUpstream: up, scopes: ["repo.read", "shell.exec"], gate: { scopes: ["shell.exec"], mode: "ask", waitSeconds: 1, approvalsDir: mkdtempSync(join(tmpdir(), "gw-pile-")) }, onNotice: (m) => notices.push(m), onStop: (r) => stops.push(r) });
    const port = await g.listen(); gateways.push(g);
    const url = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 2; i++) assert.match((await post(url)).choices[0].message.content, /no answer within 1 seconds/);
    assert.deepEqual(notices, [], "the first two are waited for; the person has not been told yet");
    const t0 = Date.now();
    const third = await post(url);
    assert.ok(Date.now() - t0 < 500, "refused at once");
    assert.match(third.choices[0].message.content, /2 earlier approval request\(s\) in this session went unanswered, so no more are asked/);
    assert.equal(notices.length, 1);
    assert.match(notices[0], /approvals are piling up/);
    assert.deepEqual(stops, []);
    await post(url);
    assert.equal(notices.length, 1, "told once");
    assert.deepEqual(stops, [], "two refusals at once so far");
    await post(url);
    assert.equal(stops.length, 1, "the third refusal at once stops the session");
    assert.match(stops[0], /no strike and no slash/);
    assert.equal(g.summary().strikes, 0, "not a strike");
    assert.deepEqual(g.summary().blocked, []);
  } finally {
    for (const [k, v] of [["ASP_MAX_UNANSWERED_APPROVALS", saved.a], ["ASP_STOP_AFTER_UNANSWERED", saved.b]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("a person who does answer keeps the gateway asking: an answered request is not counted", async () => {
  const up = await upstream();
  const { readdirSync, writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "gw-pile-"));
  const notices: string[] = [];
  const g = createGateway({ openaiUpstream: `${up}/v1`, anthropicUpstream: up, scopes: ["repo.read", "shell.exec"], gate: { scopes: ["shell.exec"], mode: "ask", waitSeconds: 3, approvalsDir: dir }, onNotice: (m) => notices.push(m) });
  const port = await g.listen(); gateways.push(g);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 4; i++) {
    const pending = post(url);
    let req: string | undefined;
    for (let t = 0; t < 150 && !req; t++) { req = readdirSync(dir).find((f) => f.endsWith(".request.json")); if (!req) await new Promise((r) => setTimeout(r, 20)); }
    assert.ok(req, `request ${i} appeared`);
    writeFileSync(join(dir, req!.replace(".request.json", ".decision.json")), JSON.stringify({ approved: false, reason: "not now" }));
    assert.match((await pending).choices[0].message.content, /not given: not now/);
  }
  assert.deepEqual(notices, [], "four answered refusals are not a pile");
});
