import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const CODER2 = "did:web:example.com:agents:coder-2";
const BANK = "did:web:example.com:bank";

function io(f: Fixture) {
  const out: string[] = [];
  const err: string[] = [];
  const i: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  return { i, out, err, text: () => out.join("\n"), errText: () => err.join("\n") };
}

async function asp(f: Fixture, args: string[]) {
  const r = io(f);
  const code = await main(args, r.i);
  return { code, out: r.text(), err: r.errText() };
}

async function setup() {
  const f = makeFixture();
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", ALICE])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", BANK])).code, 0);
  return f;
}

async function slashCoder(f: Fixture) {
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await asp(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = await asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"]);
  const intentId = /^intent (\S+)/.exec(intent.out)![1];
  const offer = await asp(f, ["market", "offer", "--by", CODER, "--intent", intentId, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"]);
  const offerId = /^offer (\S+)/.exec(offer.out)![1];
  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intentId, "--offer", offerId]);
  const contractId = /^contract (\S+):/.exec(contract.out)![1];
  await asp(f, ["market", "bond", "--contract", contractId, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await asp(f, ["market", "mandate", "--contract", contractId, "--principal", ALICE, "--performer", CODER]);
  return asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "revoked",
    "--escrow-released", "0", "--bond-returned", "0", "--bond-slashed", "200", "--pro-rata", "0"]);
}

test("a slash writes a self-signed lineage penalty for the backer, when its key is available locally", async () => {
  const f = await setup();
  const settle = await slashCoder(f);
  assert.equal(settle.code, 0, settle.err);
  assert.match(settle.out, /penalty recorded: lineage/);
  assert.match(settle.out, new RegExp(CODER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("asp pack renders a slashed agent's penalties into memory/PENALTIES.md", async () => {
  const f = await setup();
  await slashCoder(f);
  const pkg = join(f.root, "coder.aspkg");
  const pack = await asp(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--claude-home", f.home, "--out", pkg]);
  assert.equal(pack.code, 0, pack.err);
  const penaltiesFile = join(pkg, "memory", "PENALTIES.md");
  assert.ok(existsSync(penaltiesFile), "memory/PENALTIES.md should exist in the package");
  const content = readFileSync(penaltiesFile, "utf8");
  assert.match(content, /Penalized: bond slashed 200 credits/);
});

test("a never-slashed agent's package has no PENALTIES.md", async () => {
  const f = await setup();
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", CODER2, "--sponsor", ALICE, "--purpose", "Fix the flaky test"])).code, 0);
  const pkg = join(f.root, "coder2.aspkg");
  const pack = await asp(f, ["pack", "--runtime", "claude-code", "--agent", CODER2, "--project", f.project, "--claude-home", f.home, "--out", pkg]);
  assert.equal(pack.code, 0, pack.err);
  assert.ok(!existsSync(join(pkg, "memory", "PENALTIES.md")), "a clean agent gets no penalties file");
});

test("asp verify still passes a package whose memory includes a PENALTIES.md", async () => {
  const f = await setup();
  await slashCoder(f);
  const pkg = join(f.root, "coder.aspkg");
  await asp(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--claude-home", f.home, "--out", pkg]);
  const verify = await asp(f, ["verify", pkg]);
  assert.equal(verify.code, 0, verify.err);
});
