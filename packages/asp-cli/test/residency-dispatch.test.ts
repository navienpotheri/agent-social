/**
 * `asp residency allowance | dispatch | statement | recall --dispatch` on a real log (register row DK82; spec-delta S302): a city-hosted dispatch under an allowance and a subsidy grant, refused when the package
 * names a provider key, one open dispatch per agent, a statement that reconciles to the meter and the subsidy ledger, and a recall that ends the residency. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CITY_BUDGET_DID, HOST_DID } from "@agent-social/asp-log";
import { ResidentMeter, newNodeKey } from "@agent-social/asp-package";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const PRINCIPAL = "did:web:example.com:users:dd-principal";
const SPONSOR = "did:web:example.com:users:dd-sponsor";
const BANK = "did:web:example.com:bank-dd";
const AGENT = "did:web:example.com:agents:dd-agent";
let clockMs = Math.floor(Date.now() / 1000) * 1000;
const tick = (s = 60) => { clockMs += s * 1000; };

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
const id = (re: RegExp, s: string) => re.exec(s)![1];

test("dispatch a city-hosted agent under an allowance and a subsidy, refuse a package that names a key, reconcile the statement, recall", async () => {
  const f = makeFixture();
  setClock(() => new Date(clockMs));
  try {
    for (const d of [PRINCIPAL, SPONSOR, BANK, CITY_BUDGET_DID, HOST_DID]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR, "--purpose", "Live in the city"]);
    await ok(f, ["credits", "grant", "--to", AGENT, "--amount", "100"]);
    await ok(f, ["credits", "grant", "--to", PRINCIPAL, "--amount", "150"]);
    const intent = id(/^intent (\S+)/, (await ok(f, ["market", "intent", "--by", PRINCIPAL, "--purpose", "Solve a task", "--budget", "100", "--deadline", "2027-01-01T00:00:00Z"])).out);
    const offer = id(/^offer (\S+)/, (await ok(f, ["market", "offer", "--by", AGENT, "--intent", intent, "--price", "100", "--plan", "go", "--eta", "2026-12-01T00:00:00Z"])).out);
    const contract = id(/^contract (\S+):/, (await ok(f, ["market", "contract", "--principal", PRINCIPAL, "--bank", BANK, "--intent", intent, "--offer", offer])).out);
    await ok(f, ["market", "bond", "--contract", contract, "--backer", AGENT, "--amount", "20", "--escrow-payer", PRINCIPAL, "--escrow-amount", "100"]);
    const mandate = id(/^mandate (\S+)/m, (await ok(f, ["market", "mandate", "--contract", contract, "--principal", PRINCIPAL, "--performer", AGENT, "--scopes", "repo.read"])).out);

    // The subsidy: next month's budget, a grant for the agent.
    const next = new Date(clockMs + 40 * 86_400_000);
    const period = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
    const first = `${period}-01T00:00:00Z`, last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1)).toISOString().replace(/\.\d{3}Z$/, "Z");
    const budget = id(/^subsidy budget (\S+):/, (await ok(f, ["residency", "subsidy", "budget", "--period", period, "--units", "tokens", "--total", "1000", "--budget-class", "newcomer=400:3"])).out);
    tick();
    const grant = id(/^subsidy grant (\S+)/, (await ok(f, ["residency", "subsidy", "grant", "--agent", AGENT, "--class", "newcomer", "--budget", budget, "--daily", "150", "--cap", "300", "--from", first, "--until", last])).out);
    tick();
    const node = newNodeKey(AGENT, "dd-node");
    const delegation = id(/^delegation (\S+):/, (await ok(f, ["residency", "delegate", "--agent", AGENT, "--node", node.kid, `--public-key=${node.publicKey}`, "--mandate", mandate, "--hours", "12"])).out);
    tick();
    const allowance = id(/^allowance (\S+):/, (await ok(f, ["residency", "allowance", "--agent", AGENT, "--per-day", "100", "--total", "250", "--period", period])).out);
    assert.notEqual((await asp(f, ["residency", "allowance", "--agent", AGENT, "--per-day", "500001", "--total", "9000000"])).code, 0, "over the tier's daily ceiling");

    // A package that names a provider key cannot be dispatched to the city host.
    const dir = mkdtempSync(join(tmpdir(), "asp-res-"));
    const keyed = join(dir, "runtime-keyed.json"), clean = join(dir, "runtime-clean.json");
    writeFileSync(keyed, JSON.stringify({ model: "open-weight", env: { ANTHROPIC_API_KEY: "sk-ant-fake-not-a-real-key-123456" } }));
    writeFileSync(clean, JSON.stringify({ model: "open-weight", env: {} }));
    const base = ["residency", "dispatch", "--agent", AGENT, "--mode", "city", "--allowance", allowance, "--mandate", mandate, "--subsidy-grant", grant, "--delegation", delegation, "--package-sha256", "sha256:" + "4".repeat(64)];
    tick();
    const refused = await asp(f, [...base, "--runtime-config", keyed]);
    assert.notEqual(refused.code, 0);
    assert.match(refused.err, /never holds a sponsor's credential.*--mode home.*--mode split/);
    assert.ok(!refused.err.includes("sk-ant-fake"), "the key itself is never echoed");
    const dispatched = await ok(f, [...base, "--runtime-config", clean]);
    const dispatch = id(/^dispatch (\S+):/, dispatched.out);
    tick();
    assert.match((await asp(f, [...base])).err, /already has a dispatch|one at a time/);

    // The statement reconciles the meter to the subsidy ledger, once the host has signed the day's use.
    const meter = new ResidentMeter({ mode: "city", allowancePerDay: 0, allowanceTotal: 0, reservePermille: 100, subsidyPerDay: 150, subsidyPerPeriod: 300 });
    const day = `${period}-02`;
    assert.equal(meter.charge(day, 100, { turn: "routine" }).ok, true);
    const stopped = meter.charge(day, 100, { turn: "routine" });
    assert.equal(stopped.ok, false);
    tick();
    await ok(f, ["residency", "subsidy", "use", "--grant", grant, "--units", "100", "--window", day]);
    const file = join(dir, "meter.json");
    writeFileSync(file, JSON.stringify({ agent: AGENT, mode: "city", grant, rows: meter.rows, refusals: meter.refusals }));
    const st = await ok(f, ["residency", "statement", "--dispatch", dispatch, "--meter", file]);
    assert.match(st.out, /Reconciles/);
    assert.match(st.out, /0 tokens on your allowance, 100 tokens on the city's subsidy/);
    writeFileSync(file, JSON.stringify({ agent: AGENT, mode: "city", grant, rows: [{ day, source: "subsidy", tokens: 99 }], refusals: [] }));
    const bad = await asp(f, ["residency", "statement", "--dispatch", dispatch, "--meter", file]);
    assert.equal(bad.code, 1);
    assert.match(bad.out, /DOES NOT RECONCILE/);

    // Recall: the delegation is revoked and the dispatch is recalled.
    tick();
    assert.match((await ok(f, ["residency", "recall", "--agent", AGENT, "--node", node.kid, "--dispatch", dispatch, "--reason", "evolve it"])).out, /recalled/);
    tick();
    assert.match((await asp(f, ["residency", "recall", "--agent", AGENT, "--node", node.kid, "--dispatch", dispatch])).err, /.+/, "a second recall is refused");
  } finally { setClock(undefined); }
});
