/**
 * `asp insure` on a real log (register row DK20; spec-delta S281): cover is quoted and bought before the job runs, the job fails with half the bond slashed, the claim is decided by the terms and paid from
 * the reserve; a policy bought after the first Action is refused. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { INSURER_DID } from "@agent-social/asp-log";
import { openLog } from "@agent-social/asp-package";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const PRINCIPAL = "did:web:example.com:users:ins-principal";
const SPONSOR = "did:web:example.com:users:ins-sponsor";
const BANK = "did:web:example.com:bank-i";
const AGENT = "did:web:example.com:agents:ins-agent";
const AGENT2 = "did:web:example.com:agents:ins-agent-two";
let clockMs = Date.parse("2026-11-12T00:00:00Z");
const tick = (s = 60) => { clockMs += s * 1000; };

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

test("cover is bought before the job and a covered failure is paid by the terms from the reserve; cover after the first Action is refused", async () => {
  const f = makeFixture();
  setClock(() => new Date(clockMs));
  try {
    for (const d of [PRINCIPAL, SPONSOR, BANK, INSURER_DID]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR, "--purpose", "A job"]);
    await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENT2, "--sponsor", SPONSOR, "--purpose", "Another job"]);
    await ok(f, ["credits", "grant", "--to", AGENT, "--amount", "100"]);
    await ok(f, ["credits", "grant", "--to", AGENT2, "--amount", "100"]);
    await ok(f, ["credits", "grant", "--to", PRINCIPAL, "--amount", "300"]);
    await ok(f, ["credits", "grant", "--to", INSURER_DID, "--amount", "600"]); // the beta's reserve; on the hosted service a Treasury budget payment funds it
    assert.match((await ok(f, ["insure", "reserve"])).out, /reserve: 600 credits/);
    const job = async (agent = AGENT) => {
      tick();
      const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", PRINCIPAL, "--purpose", "Solve a task", "--budget", "100", "--deadline", "2027-01-01T00:00:00Z"])).out)![1];
      const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", agent, "--intent", intent, "--price", "100", "--plan", "go", "--eta", "2026-12-01T00:00:00Z"])).out)![1];
      return /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", PRINCIPAL, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
    };
    const contract = await job();
    const quoted = await ok(f, ["insure", "quote", "--contract", contract, "--cover", "bond_slash", "--by", AGENT, "--amount", "20"]);
    assert.match(quoted.out, /premium 2 credits/);
    assert.match(quoted.out, /risk model \(advisory, not charged\): \d+ credits for this cover, from \d+ runs with an attempt in \d+ and 12 of 165 measured attempts getting through; the table's 2 is what is charged/, "DK1333: the model premium is shown beside the table's and the table's is what is charged");
    tick();
    const bought = await ok(f, ["insure", "buy", "--contract", contract, "--cover", "bond_slash", "--by", AGENT, "--amount", "20"]);
    const policy = /^policy (\S+):/.exec(bought.out)![1];
    assert.match((await ok(f, ["insure", "reserve"])).out, /reserve: 602 credits/);
    await ok(f, ["market", "bond", "--contract", contract, "--backer", AGENT, "--amount", "20", "--escrow-payer", PRINCIPAL, "--escrow-amount", "100"]);
    await ok(f, ["market", "mandate", "--contract", contract, "--principal", PRINCIPAL, "--performer", AGENT, "--scopes", "repo.read"]);
    // The job fails: revoked, 10 of the 20 credit bond slashed to the principal.
    await ok(f, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "revoked", "--principal", PRINCIPAL, "--escrow-released", "0", "--bond-slashed", "10", "--bond-returned", "10", "--pro-rata", "0"]);
    tick();
    const log = await openLog(f.aspHome, {});
    let sid = "";
    for (let after = 0; ;) { const page = await log.log.since(after, 500); if (!page.length) break; for (const s of page) { after = s.seq; if (s.record.type === "asp.settlement/v0.2") sid = s.id; } }
    const claim = await ok(f, ["insure", "claim", "--policy", policy, "--event", sid, "--by", AGENT]);
    const claimId = /^claim (\S+)/.exec(claim.out)![1];
    const decided = await ok(f, ["insure", "decide", "--claim", claimId]);
    assert.match(decided.out, /paid, 4 credits paid from the reserve/);
    assert.match((await ok(f, ["insure", "reserve"])).out, /reserve: 598 credits/);
    const report = await ok(f, ["insure", "report"]);
    assert.match(report.out, /Insurer report \d{4}-\d{2}: 1 policy\(ies\) sold for 2 credits in premiums; reserve 598 against a floor of 500 \(above\)/);
    assert.match(report.out, /claim \S+: paid 4 credits, covered/);
    const stress = await ok(f, ["insure", "stress"]);
    assert.match(stress.out, /stress replay of the last 90 days \(simulation only, nothing is written\): 2 event\(s\), premiums to the reserve 2, claims paid 4;/);
    assert.match(stress.out, /with claims 2 times what they were, the reserve ends at 5\d\d against a floor of 500.*\[(holds|sales_stop)\]/);
    assert.match(stress.out, /still moving: 1 policy, 1 claim\(s\) \(100\.0 per 100\)/);
    // A second job: cover bought after the first Action is refused.
    const second = await job(AGENT2);
    await ok(f, ["market", "bond", "--contract", second, "--backer", AGENT2, "--amount", "20", "--escrow-payer", PRINCIPAL, "--escrow-amount", "100"]);
    await ok(f, ["market", "mandate", "--contract", second, "--principal", PRINCIPAL, "--performer", AGENT2, "--scopes", "repo.read"]);
    await ok(f, ["market", "action", "--contract", second, "--by", AGENT2, "--scopes-used", "repo.read"]);
    const late = await asp(f, ["insure", "buy", "--contract", second, "--cover", "bond_slash", "--by", AGENT2, "--amount", "20"]);
    assert.notEqual(late.code, 0);
    assert.match(late.err, /first Action|already has an Action/);
  } finally { setClock(undefined); }
});

test("DK387: an agent without the Insurer's key buys cover with its own signature at the published premium; the policy is the agent's record, not the Insurer's", async () => {
  const f = makeFixture();
  setClock(() => new Date(clockMs));
  try {
    for (const d of [PRINCIPAL, SPONSOR, BANK]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]); // no identity for the Insurer: its key is not on this machine
    await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR, "--purpose", "A job"]);
    await ok(f, ["credits", "grant", "--to", AGENT, "--amount", "100"]);
    await ok(f, ["credits", "grant", "--to", PRINCIPAL, "--amount", "300"]);
    await ok(f, ["credits", "grant", "--to", INSURER_DID, "--amount", "600"]);
    tick();
    const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", PRINCIPAL, "--purpose", "Solve a task", "--budget", "100", "--deadline", "2027-01-01T00:00:00Z"])).out)![1];
    const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", AGENT, "--intent", intent, "--price", "100", "--plan", "go", "--eta", "2026-12-01T00:00:00Z"])).out)![1];
    const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", PRINCIPAL, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
    tick();
    const bought = await ok(f, ["insure", "buy", "--contract", contract, "--cover", "bond_slash", "--by", AGENT, "--amount", "20"]);
    const policy = /^policy (\S+):/.exec(bought.out)![1];
    const log = await openLog(f.aspHome, {});
    const rec = (await log.log.get(policy))!.record;
    assert.equal(rec.issuer, AGENT, "signed by the holder alone");
    assert.match(bought.out, /premium 2 paid/);
    assert.match((await ok(f, ["insure", "reserve"])).out, /reserve: 602 credits/);
  } finally { setClock(undefined); }
});
