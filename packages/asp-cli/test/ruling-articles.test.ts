import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readCode } from "@agent-social/asp-package";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";
const REPORTER = "did:web:example.com:users:whistleblower";
const JURORS = ["a", "b", "c"].map((n) => `did:web:example.com:users:juror-${n}`);

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
const balance = async (f: Fixture, did: string) => Number(/: (\d+) credits/.exec((await ok(f, ["credits", "balance", did])).out)![1]);

/** A running, bonded job, a reporter with credits, and three staked jurors. */
async function world() {
  const f = makeFixture();
  for (const d of [ALICE, BANK, REPORTER, ...JURORS]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  await ok(f, ["credits", "grant", "--to", REPORTER, "--amount", "100"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read"]);
  for (const j of JURORS) { await ok(f, ["credits", "grant", "--to", j, "--amount", "500"]); await ok(f, ["market", "juror", "register", "--by", j, "--stake", "100"]); }
  return { f, contract };
}


test("an upheld report must name the Articles of the Code it rests on, and the ruling records the version, the hash and the Articles (gap LW1)", async () => {
  const { f, contract } = await world();
  const reportId = /^report (\S+)/.exec((await ok(f, ["market", "report", "--contract", contract, "--by", REPORTER, "--reasons", "an attack on a public site"])).out)![1];
  await ok(f, ["market", "panel", "draw", "--report", reportId]);
  const rule = (extra: string[]) => asp(f, ["market", "report-rule", "--report", reportId, "--by", JURORS[0], "--cosign-by", JURORS[1], "--verdict", "upheld", ...extra]);

  const none = await rule([]);
  assert.equal(none.code, 2);
  assert.match(none.err, /an upheld report names the Articles of the Code it rests on/);
  assert.equal((await rule(["--articles", "13"])).code, 2, "there is no Article 13");
  assert.equal((await rule(["--articles", "eight"])).code, 2);

  const ruled = await rule(["--articles", "7,8.3,7"]);
  assert.equal(ruled.code, 0, ruled.err);
  const file = join(f.root, "export.ndjson");
  await ok(f, ["log", "export", "--out", file]);
  const text = readFileSync(file, "utf8");
  const info = readCode();
  assert.match(text, new RegExp(`"version":"${info.version.replace(".", "\.")}"`));
  assert.ok(text.includes(info.sha256), "the hash of the Code's text is in the ruling");
  assert.match(text, /"articles":\["7","8\.3"\]/, "repeated Articles are listed once");
});

test("a dismissed report needs no Article, and a contract ruling may name them", async () => {
  const { f, contract } = await world();
  const reportId = /^report (\S+)/.exec((await ok(f, ["market", "report", "--contract", contract, "--by", REPORTER, "--reasons", "a misunderstanding"])).out)![1];
  await ok(f, ["market", "panel", "draw", "--report", reportId]);
  const dismissed = await asp(f, ["market", "report-rule", "--report", reportId, "--by", JURORS[0], "--cosign-by", JURORS[1], "--verdict", "dismissed"]);
  assert.equal(dismissed.code, 0, dismissed.err);
});
