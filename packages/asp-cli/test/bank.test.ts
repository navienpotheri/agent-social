/**
 * `asp bank` on a real log (register row DK19; spec-delta S280): a newcomer with no balance gets a credit line from its sponsor's guarantee, posts its bond, the job is accepted and settled, the line repays
 * and the Bank's reserve is whole again; a line without the sponsor's guarantee is refused with the way forward; a statement matches the ledger. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BANK_DID } from "@agent-social/asp-log";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const PRINCIPAL = "did:web:example.com:users:bk-principal";
const SPONSOR = "did:web:example.com:users:bk-sponsor";
const OTHER = "did:web:example.com:users:bk-other";
const AGENT = "did:web:example.com:agents:bk-newcomer";
let clockMs = Date.parse("2026-11-12T00:00:00Z");
const tick = (s = 60) => { clockMs += s * 1000; };

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
const reserveOf = async (f: Fixture) => Number(/reserve: (\d+) credits/.exec((await ok(f, ["bank", "show"])).out)![1]);

test("a newcomer with no balance bonds on a credit line through the command line; the line repays at settlement and the reserve is whole again", async () => {
  const f = makeFixture();
  setClock(() => new Date(clockMs));
  try {
    for (const d of [PRINCIPAL, SPONSOR, OTHER, BANK_DID]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR, "--purpose", "A first job"]);
    await ok(f, ["credits", "grant", "--to", SPONSOR, "--amount", "50"]);
    await ok(f, ["credits", "grant", "--to", PRINCIPAL, "--amount", "150"]);
    await ok(f, ["credits", "grant", "--to", BANK_DID, "--amount", "100"]); // the beta's reserve; on the hosted service a Treasury budget payment funds it
    assert.equal(await reserveOf(f), 100);
    const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", PRINCIPAL, "--purpose", "Solve a task", "--budget", "100", "--deadline", "2027-01-01T00:00:00Z"])).out)![1];
    const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", AGENT, "--intent", intent, "--price", "100", "--plan", "go", "--eta", "2026-12-01T00:00:00Z"])).out)![1];
    const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", PRINCIPAL, "--bank", BANK_DID, "--intent", intent, "--offer", offer])).out)![1];

    // Without a bond or a line the newcomer cannot post a bond; a line needs the sponsor as guarantor.
    const bondArgs = ["market", "bond", "--contract", contract, "--backer", AGENT, "--amount", "20", "--escrow-payer", PRINCIPAL, "--escrow-amount", "100"];
    assert.notEqual((await asp(f, bondArgs)).code, 0, "no balance, no line: refused");
    tick();
    const wrong = await asp(f, ["bank", "line", "--contract", contract, "--agent", AGENT, "--guarantor", OTHER]);
    assert.notEqual(wrong.code, 0);
    assert.match(wrong.err, /sponsor's guarantee|line_no_guarantor|the agent's sponsor/);
    const line = await ok(f, ["bank", "line", "--contract", contract, "--agent", AGENT, "--guarantor", SPONSOR, "--amount", "20"]);
    assert.match(line.out, /no fee/);
    await ok(f, bondArgs);
    assert.equal(await reserveOf(f), 80, "the Bank's reserve funds the bond");
    assert.match((await ok(f, ["bank", "show", "--agent", AGENT])).out, /guarantor did:web:example.com:users:bk-sponsor/);

    await ok(f, ["market", "mandate", "--contract", contract, "--principal", PRINCIPAL, "--performer", AGENT, "--scopes", "repo.read"]);
    await ok(f, ["market", "deliver", "--contract", contract, "--by", AGENT, "--summary", "done"]);
    await ok(f, ["market", "accept", "--contract", contract, "--by", PRINCIPAL]);
    await ok(f, ["market", "settle", "--contract", contract, "--bank", BANK_DID, "--basis", "accepted", "--principal", PRINCIPAL, "--escrow-released", "100", "--bond-returned", "20", "--bond-slashed", "0"]);
    assert.equal(await reserveOf(f), 100, "repaid at settlement: the reserve is whole again");
    const st = await ok(f, ["bank", "statement", "--holder", AGENT]);
    assert.match(st.out, new RegExp(`${AGENT} holds 100 credits and owes the Bank 0`), "the agent kept its pay");
  } finally { setClock(undefined); }
});
