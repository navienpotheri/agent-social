// DK1300: `asp journey` and `asp society tail` on a local log: a settled job, then the journey of the performer in text, JSON and HTML, the sponsor view's text, the tail and --follow. Fake identities only. Credits are mock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

async function settledJob() {
  const f = makeFixture();
  for (const a of [["identity", "new", "--kind", "human", "--did", ALICE], ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"], ["identity", "new", "--kind", "human", "--did", BANK]]) assert.equal((await asp(f, a)).code, 0);
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await asp(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const id = async (args: string[], re: RegExp) => { const r = await asp(f, args); assert.equal(r.code, 0, r.err); return re.exec(r.out)![1]!; };
  const intent = await id(["market", "intent", "--by", ALICE, "--purpose", "Fix the flaky test", "--criteria", "test passes 50 times", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"], /^intent (\S+)/);
  const offer = await id(["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix the race", "--eta", "2026-11-01T00:00:00Z"], /^offer (\S+)/);
  const contract = await id(["market", "contract", "--principal", ALICE, "--performer", CODER, "--bank", BANK, "--intent", intent, "--offer", offer], /^contract (\S+):/);
  await asp(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await asp(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read"]);
  await asp(f, ["market", "deliver", "--contract", contract, "--by", CODER, "--summary", "Fixed the race, secret-detail-xyz"]);
  await asp(f, ["market", "accept", "--contract", contract, "--by", ALICE]);
  assert.equal((await asp(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "accepted", "--escrow-released", "1000", "--bond-returned", "200", "--bond-slashed", "0"])).code, 0);
  return f;
}

test("asp journey <agent>: every step in order with its institution, a summary, and what is not recorded", async () => {
  const f = await settledJob();
  const r = await asp(f, ["journey", "coder"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^coder \(.*\): journey, public view/);
  assert.match(r.out, /\[registry\].*coder was registered as an agent, sponsored by alice/);
  assert.match(r.out, /\[market\].*coder offered to do a job \(1000 credits\)/);
  assert.match(r.out, /\[market\].*coder was hired by alice \(1000 credits\)/);
  assert.match(r.out, /\[market\].*coder put up a bond \(200 credits\)/);
  assert.match(r.out, /\[market\].*coder was paid 1000 credits for a job \(settled accepted, bond of 200 returned\)/);
  assert.match(r.out, /credits \(mock\): in 0, earned 1000, paid 0, spent 0, slashed 0/);
  assert.match(r.out, /not on this page yet[\s\S]*the agent's reasoning[\s\S]*\[DK790, DK79\][\s\S]*direct messages[\s\S]*DK1346[\s\S]*token and compute cost[\s\S]*DK1347/);
  assert.ok(!r.out.includes("secret-detail-xyz") && !r.out.includes("Fix the flaky test"), "no free text in the public view");
  const lines = r.out.split("\n").filter((l) => /^ {2}\d{4}-\d\d-\d\d /.test(l));
  assert.ok(lines.length >= 7, "one line per step");
  const stamps = lines.map((l) => l.slice(2, 18));
  assert.deepEqual([...stamps].sort(), stamps, "in time order");
});

test("asp journey --sponsor-view on the local log shows the text a record carries; --json is the data; --html-file writes the page here", async () => {
  const f = await settledJob();
  const sp = await asp(f, ["journey", "coder", "--sponsor-view"]);
  assert.equal(sp.code, 0, sp.err);
  assert.match(sp.out, /sponsor view/);
  assert.ok(sp.out.includes("Fix the flaky test") && sp.out.includes("secret-detail-xyz"), "the purpose and the delivery's text are in the sponsor view");
  const js = await asp(f, ["journey", "coder", "--json"]);
  const j = JSON.parse(js.out);
  assert.equal(j.name, "coder");
  assert.equal(j.view, "public");
  assert.equal(j.summary.jobs.accepted, 1);
  assert.equal(j.summary.credits.earned, 1000);
  assert.ok(j.summary.institutions_used.includes("market") && j.summary.institutions_used.includes("registry"));
  const file = join(f.root, "coder-journey.html");
  const h = await asp(f, ["journey", "coder", "--sponsor-view", "--html-file", file]);
  assert.equal(h.code, 0, h.err);
  assert.match(h.out, /wrote .*coder-journey\.html \(sponsor view, \d+ steps\)/);
  const html = readFileSync(file, "utf8");
  assert.match(html, /<title>coder: journey<\/title>/);
  assert.ok(html.includes("secret-detail-xyz"), "the sponsor page has the text, written on this machine");
});

test("asp journey: no argument and an unknown agent are usage errors, not crashes", async () => {
  const f = await settledJob();
  const none = await asp(f, ["journey"]);
  assert.notEqual(none.code, 0);
  assert.match(none.err, /asp journey <agent name or did>/);
  const unknown = await asp(f, ["journey", "nobody-here"]);
  assert.notEqual(unknown.code, 0);
  assert.match(unknown.err, /no agent named nobody-here/);
});

test("asp society tail: the latest records as steps with the institution; --since leaves out what was seen; --json is the data; --follow runs and stops", async () => {
  const f = await settledJob();
  const t = await asp(f, ["society", "tail"]);
  assert.equal(t.code, 0, t.err);
  const lines = t.out.split("\n");
  assert.ok(lines.length >= 8);
  assert.match(lines[0]!, /^ *\d+  \d{4}-\d\d-\d\d \d\d:\d\d:\d\d  \[[a-z]+\]  /);
  assert.ok(t.out.includes("[market]") && t.out.includes("[registry]"));
  assert.match(t.out, /alice posted a job \(1000 credits\)/, "a person's acts are in the tail too");
  assert.ok(!t.out.includes("secret-detail-xyz"), "no free text in the tail");
  const last = Number(/^ *(\d+)/.exec(lines[lines.length - 1]!)![1]);
  const none = await asp(f, ["society", "tail", "--since", String(last)]);
  assert.equal(none.out.trim(), "", "nothing after the last record");
  const some = await asp(f, ["society", "tail", "--since", String(last - 2)]);
  assert.equal(some.out.trim().split("\n").length, 2);
  const js = JSON.parse((await asp(f, ["society", "tail", "--json"])).out);
  assert.equal(js.head, last);
  assert.ok(js.events.length >= 8);
  const fol = await asp(f, ["society", "tail", "--follow", "--interval", "0", "--max-polls", "2", "--since", String(last)]);
  assert.equal(fol.code, 0);
  assert.equal((await asp(f, ["journey", "coder", "--follow", "--interval", "0", "--max-polls", "1"])).code, 0);
  assert.notEqual((await asp(f, ["society", "tail", "--since", "x"])).code, 0);
});
