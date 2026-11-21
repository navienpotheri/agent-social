import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

// gap T22: a node grant that cites no Mandate is bounded only by the log's flat 24-hour cap, not by
// a Mandate's nodes.max_parallel or expiry. asp orchestrate --mandate <id> closes that for the one
// place a personal run creates nodes: the grant must cite a real Mandate issued to this agent, and a
// grant the Mandate refuses fails the node instead of running it unbound.

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const OTHER = "did:web:example.com:agents:other";
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
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix things"])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", OTHER, "--sponsor", ALICE, "--purpose", "A different agent"])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", BANK])).code, 0);
  return f;
}

/** intent -> offer -> contract -> bond -> mandate for `performer`; returns the Mandate's record id. */
async function mandateFor(f: Fixture, performer: string, nodeMaxParallel: number): Promise<string> {
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await asp(f, ["credits", "grant", "--to", performer, "--amount", "200"]);
  const intentId = /^intent (\S+)/.exec((await asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offerId = /^offer (\S+)/.exec((await asp(f, ["market", "offer", "--by", performer, "--intent", intentId, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contractId = /^contract (\S+):/.exec((await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intentId, "--offer", offerId])).out)![1];
  assert.equal((await asp(f, ["market", "bond", "--contract", contractId, "--backer", performer, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"])).code, 0);
  const mandate = await asp(f, ["market", "mandate", "--contract", contractId, "--principal", ALICE, "--performer", performer, "--node-max-parallel", String(nodeMaxParallel)]);
  assert.equal(mandate.code, 0, mandate.err);
  return /^mandate (\S+) /.exec(mandate.out)![1];
}

const fakeClaude = (extra: NodeJS.ProcessEnv = {}) => ({
  GITHUB_TOKEN: "t", API_BASE: "x", ASP_CLAUDE_BIN: process.execPath,
  ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude-fleet.mjs", import.meta.url)), ...extra,
});

async function packed(f: Fixture, agent = CODER) {
  const pkg = join(f.root, "fleet.aspkg");
  const res = await asp(f, ["pack", "--runtime", "claude-code", "--agent", agent, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal(res.code, 0, res.err);
  return pkg;
}

test("a node grant made under --mandate carries the Mandate, not just the flat 24-hour cap", async () => {
  const f = await setup();
  const mandateId = await mandateFor(f, CODER, 4);
  const pkg = await packed(f);
  const res = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project, "--mandate", mandateId,
    "--task", "fix the flaky refund test"], fakeClaude());
  assert.equal(res.code, 0, res.err);
  const nodes = readFileSync(join(f.aspHome, "log.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l).record).filter((r) => r.type === "asp.node/v0.2");
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].body.mandate, mandateId);
});

test("a node a cited Mandate refuses (max_parallel) fails that node instead of running it unbound", async () => {
  const f = await setup();
  const mandateId = await mandateFor(f, CODER, 1);
  const pkg = await packed(f);
  const res = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project, "--mandate", mandateId, "--max-parallel", "1",
    "--task", "task one", "--task", "task two"], fakeClaude());
  assert.equal(res.code, 0, "one node still succeeds, so the run as a whole does not fail");
  assert.match(res.err, /1\/2 node\(s\) succeeded/);
  assert.match(res.err, /FAILED {2}the Mandate refused this node's key: GUARD_FAILED: the Mandate allows 1 parallel nodes/);
});

test("--mandate naming a Mandate issued to a different agent is refused up front, before any node runs", async () => {
  const f = await setup();
  const mandateId = await mandateFor(f, OTHER, 4);
  const pkg = await packed(f);
  const res = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project, "--mandate", mandateId, "--task", "x"], fakeClaude());
  assert.equal(res.code, 2);
  assert.match(res.err, new RegExp(`issued to ${OTHER}, not ${CODER}`));
});

test("--mandate naming an unknown record is refused up front", async () => {
  const f = await setup();
  const pkg = await packed(f);
  const res = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project, "--mandate", "sha256:" + "0".repeat(64), "--task", "x"], fakeClaude());
  assert.equal(res.code, 2);
  assert.match(res.err, /is not a Mandate in this log/);
});

test("--mandate does not work with --isolate", async () => {
  const f = await setup();
  const mandateId = await mandateFor(f, CODER, 4);
  const pkg = await packed(f);
  const res = await asp(f, ["orchestrate", pkg, "--backend", "claude-code", "--project", f.project, "--mandate", mandateId, "--isolate", "--task", "x"], fakeClaude());
  assert.equal(res.code, 2);
  assert.match(res.err, /does not work with --isolate/);
});
