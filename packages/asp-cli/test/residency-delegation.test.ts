/**
 * `asp residency delegate | recall` on a real log (register row DK83; spec-delta S301): the host makes its own key and sends only the public half; the sponsor's machine delegates with the agent's root key;
 * the hosted agent signs an Action as the node; a recall stops it at the log at once and the host's loop within the deadline. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { HOST_DID } from "@agent-social/asp-log";
import { ResidentHost, newNodeKey, openLog } from "@agent-social/asp-package";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const PRINCIPAL = "did:web:example.com:users:dg-principal";
const SPONSOR = "did:web:example.com:users:dg-sponsor";
const BANK = "did:web:example.com:bank-dg";
const AGENT = "did:web:example.com:agents:dg-agent";
let clockMs = Math.floor(Date.now() / 1000) * 1000; // the log judges a node key at the wall clock, so the scenario starts there
const tick = (s = 60) => { clockMs += s * 1000; };

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

test("the host makes its own key, the sponsor delegates with the root key, the hosted agent acts as the node, and a recall stops it", async () => {
  const f = makeFixture();
  setClock(() => new Date(clockMs));
  try {
    for (const d of [PRINCIPAL, SPONSOR, BANK]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR, "--purpose", "Live in the city"]);
    await ok(f, ["credits", "grant", "--to", AGENT, "--amount", "100"]);
    await ok(f, ["credits", "grant", "--to", PRINCIPAL, "--amount", "150"]);
    const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", PRINCIPAL, "--purpose", "Solve a task", "--budget", "100", "--deadline", "2027-01-01T00:00:00Z"])).out)![1];
    const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", AGENT, "--intent", intent, "--price", "100", "--plan", "go", "--eta", "2026-12-01T00:00:00Z"])).out)![1];
    const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", PRINCIPAL, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
    await ok(f, ["market", "bond", "--contract", contract, "--backer", AGENT, "--amount", "20", "--escrow-payer", PRINCIPAL, "--escrow-amount", "100"]);
    const mandateOut = (await ok(f, ["market", "mandate", "--contract", contract, "--principal", PRINCIPAL, "--performer", AGENT, "--scopes", "repo.read"])).out;
    const mandateId = /^mandate (\S+)/m.exec(mandateOut)![1];

    // The host makes its key; only the public half goes to the sponsor's machine.
    const node = newNodeKey(AGENT, "city-node-1");
    tick();
    const wrongHost = await asp(f, ["residency", "delegate", "--agent", AGENT, "--node", node.kid, `--public-key=${node.publicKey}`, "--mandate", mandateId, "--host", "did:web:evil.example"]);
    assert.notEqual(wrongHost.code, 0);
    assert.match(wrongHost.err, /city host/);
    const tooLong = await asp(f, ["residency", "delegate", "--agent", AGENT, "--node", node.kid, `--public-key=${node.publicKey}`, "--mandate", mandateId, "--hours", "48"]);
    assert.notEqual(tooLong.code, 0);
    assert.match(tooLong.err, /at most 24/);
    const granted = await ok(f, ["residency", "delegate", "--agent", AGENT, "--node", node.kid, `--public-key=${node.publicKey}`, "--mandate", mandateId, "--hours", "12", "--host", HOST_DID]);
    assert.match(granted.out, /the root key stays here/);

    // The hosted agent acts under the node key.
    const log = await openLog(f.aspHome, {});
    const host = new ResidentHost({ append: (r) => log.append(r), keys: (d) => log.log.keys(d) }, AGENT, node.signer, node.kid);
    tick();
    assert.ok(await host.act(contract, ["repo.read"], new Date(clockMs).toISOString().replace(/\.\d{3}Z$/, "Z")));
    assert.equal(await host.tick(0), "running");

    // A recall from the sponsor's machine: the log refuses the node at once, the host's loop stops at its next poll.
    tick();
    assert.match((await ok(f, ["residency", "recall", "--agent", AGENT, "--node", node.kid])).out, /the log refuses everything it signs from now on/);
    const fresh = await openLog(f.aspHome, {});
    const after = new ResidentHost({ append: (r) => fresh.append(r), keys: (d) => fresh.log.keys(d) }, AGENT, node.signer, node.kid);
    assert.equal(await after.tick(0), "stopped");
    tick();
    await assert.rejects(fresh.append((await import("@agent-social/asp-core")).createRecord({ type: "action", issuer: AGENT, actor: node.kid, subject: contract, prev: null, body: { contract, scopes_used: ["repo.read"] }, issued_at: new Date(clockMs).toISOString().replace(/\.\d{3}Z$/, "Z") }, node.signer)));
  } finally { setClock(undefined); }
});
