import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";

async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

async function setup() {
  const f = makeFixture();
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", ALICE])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", BANK])).code, 0);
  return f;
}

/** intent -> offer -> contract -> bond -> mandate for `performer`, who backs its own job. */
async function bonded(f: Fixture, performer: string, price: number, bond: number) {
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", String(price)]);
  await asp(f, ["credits", "grant", "--to", performer, "--amount", String(bond)]);
  const intentId = /^intent (\S+)/.exec((await asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", String(price), "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offerId = /^offer (\S+)/.exec((await asp(f, ["market", "offer", "--by", performer, "--intent", intentId, "--price", String(price), "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contractId = /^contract (\S+):/.exec((await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intentId, "--offer", offerId])).out)![1];
  assert.equal((await asp(f, ["market", "bond", "--contract", contractId, "--backer", performer, "--amount", String(bond), "--escrow-payer", ALICE, "--escrow-amount", String(price)])).code, 0);
  await asp(f, ["market", "mandate", "--contract", contractId, "--principal", ALICE, "--performer", performer]);
  return contractId;
}

const slash = (f: Fixture, contractId: string, amount: number) =>
  asp(f, ["market", "settle", "--contract", contractId, "--bank", BANK, "--basis", "revoked", "--escrow-released", "0", "--bond-returned", "0", "--bond-slashed", String(amount), "--pro-rata", "0"]);

test("identity copy makes independently liable copies: own DID, own passport, same sponsor, own ledger account", async () => {
  const f = await setup();
  const res = await asp(f, ["identity", "copy", CODER, "--count", "3"]);
  assert.equal(res.code, 0, res.err);
  const copies = res.out.split("\n");
  assert.equal(copies.length, 3);
  assert.equal(new Set(copies).size, 3);
  for (const c of copies) {
    assert.match(c, /^did:key:z/);
    const show = JSON.parse((await asp(f, ["identity", "show", c])).out);
    assert.equal(show.sponsor, ALICE);
    assert.equal(show.body.tier, 1);
    assert.match(show.body.purpose, /independent copy of did:web:example.com:agents:coder/);
  }
  await asp(f, ["credits", "grant", "--to", copies[0], "--amount", "100"]);
  assert.match((await asp(f, ["credits", "balance", copies[0]])).out, /: 100 credits/);
  assert.match((await asp(f, ["credits", "balance", copies[1]])).out, /: 0 credits/, "a sibling's account is separate");
  assert.match((await asp(f, ["credits", "balance", CODER])).out, /: 0 credits/, "and so is the original's");
});

test("one copy's slash does not touch its siblings or the original", async () => {
  const f = await setup();
  const [a, b] = (await asp(f, ["identity", "copy", CODER, "--count", "2"])).out.split("\n");
  const contractId = await bonded(f, a, 1000, 200);
  assert.equal((await slash(f, contractId, 200)).code, 0);
  const rep = async (d: string) => JSON.parse((await asp(f, ["identity", "show", d])).out).reputation;
  assert.deepEqual(await rep(a), { tier: 0, slashCount: 1, strikes: 0 }, "the slashed copy is demoted");
  assert.deepEqual(await rep(b), { tier: 1, slashCount: 0, strikes: 0 }, "its sibling is untouched");
  assert.deepEqual(await rep(CODER), { tier: 1, slashCount: 0, strikes: 0 }, "so is the original");
});

test("a demoted agent cannot launder its record through copies", async () => {
  const f = await setup();
  const contractId = await bonded(f, CODER, 1000, 200);
  assert.equal((await slash(f, contractId, 200)).code, 0);
  const res = await asp(f, ["identity", "copy", CODER]);
  assert.equal(res.code, 1);
  assert.match(res.err, /tier 0/);
});

test("orchestrate --isolate runs every node as its own copy, and the node grants come from the copies", async () => {
  const f = await setup();
  const pkg = join(f.root, "fleet.aspkg");
  assert.equal((await asp(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg])).code, 0);
  const fake = {
    GITHUB_TOKEN: "t", API_BASE: "x", ASP_CLAUDE_BIN: process.execPath,
    ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude-fleet.mjs", import.meta.url)),
  };
  const res = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project, "--isolate",
    "--task", "fix the flaky refund test", "--task", "add retry to the webhook handler"], fake);
  assert.equal(res.code, 0, res.err);
  assert.equal([...res.err.matchAll(/runs as its own copy (did:key:\S+)/g)].length, 2);
  const records = readFileSync(join(f.aspHome, "log.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l).record);
  const nodes = records.filter((r) => r.type === "asp.node/v0.2");
  assert.equal(nodes.length, 2);
  assert.ok(nodes.every((n) => n.issuer.startsWith("did:key:") && n.issuer !== CODER && n.body.node.startsWith(`${n.issuer}#node-`)));
  assert.notEqual(nodes[0].issuer, nodes[1].issuer, "each node is a different liable identity");
});
