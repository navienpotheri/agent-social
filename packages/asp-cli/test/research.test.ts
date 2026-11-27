/**
 * `asp research` (register row DK31; spec-delta S290): the commands over a real log (the rules are tested in packages/asp-log/test/research.test.ts). Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Signer } from "@agent-social/asp-core";
import { RESEARCH_DID, TREASURY_DID, runChecker } from "@agent-social/asp-log";
import { ResearchUsage, researchCmd } from "../src/research.ts";
import { research, shopsWorld } from "../../asp-log/test/shops-kit.ts";
import { auditor, credit, jump, mk, nowIso, owner, tick, treasury, type Party } from "../../asp-log/test/society-kit.ts";

const SHA = "sha256:" + "a".repeat(64);
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

test("the office posts a problem, an agent submits a nonce, the Auditor checks it, the office pays the finder, and the unspent part returns on close", async () => {
  const w = await shopsWorld();
  const sponsor = await w.k.person("cli-rs", 10);
  const ag = await w.k.agent("cli-rs-1", sponsor, { tier: 1, funds: 50 });
  const g = await w.agentWith("cli-rs-1", { agent: ag, spend: [{ institution: "research", cap: 20 }], running: true });
  await w.k.mint(TREASURY_DID, 100);
  const b = mk("budget", treasury, { institution: RESEARCH_DID, period: nowIso().slice(0, 7), amount: credit(100), purpose: "bounties" }, null, { cosigners: [owner] });
  await w.log.append(b);
  await w.log.append(mk("treasury_payment", treasury, { budget: b.id, to: RESEARCH_DID, amount: credit(100) }));
  const parties = new Map<string, Party>([[RESEARCH_DID, research], [auditor.did, auditor], [ag.did, ag]]);
  const json = new Map<string, unknown>();
  const text = new Map<string, string>();
  const run = async (sub: string | undefined, rest: string[], flags: Record<string, unknown> = {}) => {
    const out: string[] = [];
    tick();
    const handle = { log: w.log, append: (r: any) => w.log.append(r) } as any;
    const code = await researchCmd(sub, rest, { log: handle, io: { out: (l) => out.push(l) }, now: nowIso, signerFor: (d) => parties.get(d) as Signer, readJson: (p) => json.get(p), readText: (p) => text.get(p) ?? "", flags });
    return { code, text: out.join("\n") };
  };
  const t0 = Date.parse(nowIso());
  json.set("problem.json", { title: "Find a nonce", statement_sha256: SHA, domain: ["search"], checker: { kind: "executable", ref: "leading-zero-bits:8", runner: auditor.did }, reward: 100, split: { finder: 800, replicator: 100 }, min_tier: 1, opens: iso(t0 + 5 * 60_000), deadline: iso(t0 + 8 * 86_400_000) });
  assert.match((await run("post", [], { file: "problem.json" })).text, /problem posted/);
  const problem = (await w.log.recordsOfTypes(["research_act"]))[0].id;
  jump(6 * 60_000);
  assert.match((await run("list", [])).text, /open\s+reward\s+100 .*Find a nonce/);
  assert.match((await run("show", [problem])).text, /"title": "Find a nonce"/);
  let nonce = ""; for (let n = 0; ; n++) if (runChecker("leading-zero-bits:8", problem, `nonce-${n}`).result === "pass") { nonce = `nonce-${n}`; break; }
  text.set("finding.txt", nonce);
  const act = mk("action", ag, { contract: g.contract, scopes_used: [], summary: "run", assurance: "gateway_observed" }, null, { subject: g.contract });
  await w.log.append(act);
  const sub = await run("submit", [problem], { by: ag.did, finding: "finding.txt", "run-log": act.id, summary: "a nonce", mandate: g.mandate });
  assert.match(sub.text, /submitted/, sub.text);
  const submission = (await w.log.recordsOfTypes(["research_act"])).find((r) => (r.body as { act: string }).act === "submission")!.id;
  text.set("wrong.txt", "not the nonce");
  assert.match((await run("check", [submission], { by: auditor.did, artifact: ["wrong.txt"] })).text, /does not match/);
  const chk = await run("check", [submission], { by: auditor.did, artifact: ["finding.txt"] });
  assert.match(chk.text, /^pass: /);
  const checkId = (await w.log.recordsOfTypes(["research_act"])).find((r) => (r.body as { act: string }).act === "finding_check")!.id;
  json.set("award.json", { problem, submission, awardee: ag.did, amount: 80, role: "finder", checks: [checkId] });
  const before = await w.log.balance(ag.did);
  assert.match((await run("award", [], { file: "award.json" })).text, /pool paid/);
  assert.equal((await w.log.balance(ag.did)) - before, 80);
  assert.match((await run("run", [])).text, /receipts 1/);
  assert.match((await run("list", [])).text, /solved/);
  assert.match((await run("close", [problem])).text, /problem closed/);
  await assert.rejects(() => run("nothing", []), ResearchUsage);
  await assert.rejects(() => run("submit", [problem], {}), ResearchUsage);
});
