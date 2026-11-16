/**
 * The handover cycle on a real package and a real log (register row DK84; spec-delta S303): an agent is dispatched from its package, lives a simulated period in which it learns two things, is handed back
 * with a complete record, its sponsor undoes one change and keeps the other with `asp learned`, and the agent is dispatched again from the edited version. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keystore, openLog, updatePackage } from "@agent-social/asp-package";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const PRINCIPAL = "did:web:example.com:users:hv-principal";
const SPONSOR = "did:web:example.com:users:hv-sponsor";
const BANK = "did:web:example.com:bank-hv";
const AGENT = "did:web:example.com:agents:hv-agent";
let clockMs = Date.now();
const tick = (s = 60) => { clockMs += s * 1000; };

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
const id = (re: RegExp, s: string) => re.exec(s)![1];
const readdirRec = (dir: string, base = ""): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); const rel = base ? `${base}/${n}` : n; return statSync(p).isDirectory() ? readdirRec(p, rel) : [rel]; });
const short = (s: string) => s.replace(/^sha256:/, "").slice(0, 8);

test("dispatch, a simulated period, handback with the complete record, the sponsor undoes one change and keeps another, and the agent is dispatched again from the edited version", async () => {
  const f = makeFixture();
  setClock(() => new Date(clockMs));
  try {
    for (const d of [PRINCIPAL, SPONSOR, BANK]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    await ok(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR, "--purpose", "Live in the city and learn"]);
    await ok(f, ["credits", "grant", "--to", AGENT, "--amount", "100"]);
    await ok(f, ["credits", "grant", "--to", PRINCIPAL, "--amount", "150"]);
    const pkg = join(f.root, "hv.aspkg");
    await ok(f, ["pack", "--runtime", "claude-code", "--agent", AGENT, "--project", f.project, "--user-home", f.home, "--out", pkg]);
    const signer = new Keystore(f.aspHome).forDid(AGENT)!;
    const memory = () => Object.fromEntries((existsSync(join(pkg, "memory")) ? readdirRec(join(pkg, "memory")) : []).sort().map((p) => [p, readFileSync(join(pkg, "memory", p), "utf8")]));
    const learn = (files: Record<string, string>, description: string) => {
      tick();
      const dir = mkdtempSync(join(tmpdir(), "asp-learn-"));
      const current = join(pkg, "memory");
      for (const [p, text] of Object.entries(files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), text); }
      for (const p of existsSync(current) ? readdirRec(current) : []) if (!(p in files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), readFileSync(join(current, p))); }
      return updatePackage(pkg, { signer, memoryFrom: dir, changes: [{ layer: "memory", description }], now: new Date(clockMs) }).edges[0].id;
    };
    learn({ "rules.md": "Run the tests before saying done.\n" }, "baseline: memory updated during a run: +1");

    // The job, the mandate and the allowance, then the dispatch from the package (the sponsor's own machine: mode home).
    const intent = id(/^intent (\S+)/, (await ok(f, ["market", "intent", "--by", PRINCIPAL, "--purpose", "Solve a task", "--budget", "100", "--deadline", "2027-01-01T00:00:00Z"])).out);
    const offer = id(/^offer (\S+)/, (await ok(f, ["market", "offer", "--by", AGENT, "--intent", intent, "--price", "100", "--plan", "go", "--eta", "2026-12-01T00:00:00Z"])).out);
    const contract = id(/^contract (\S+):/, (await ok(f, ["market", "contract", "--principal", PRINCIPAL, "--bank", BANK, "--intent", intent, "--offer", offer])).out);
    await ok(f, ["market", "bond", "--contract", contract, "--backer", AGENT, "--amount", "20", "--escrow-payer", PRINCIPAL, "--escrow-amount", "100"]);
    const mandate = id(/^mandate (\S+)/m, (await ok(f, ["market", "mandate", "--contract", contract, "--principal", PRINCIPAL, "--performer", AGENT, "--scopes", "repo.read"])).out);
    tick();
    const allowance = id(/^allowance (\S+):/, (await ok(f, ["residency", "allowance", "--agent", AGENT, "--per-day", "100", "--total", "250"])).out);
    tick();
    const first = id(/^dispatch (\S+):/, (await ok(f, ["residency", "dispatch", "--agent", AGENT, "--mode", "home", "--allowance", allowance, "--mandate", mandate, "--package", pkg])).out);

    // Residency: the agent learns a good rule and a drifted one (each a signed lineage edge in its package).
    const good = learn({ "rules.md": "Run the tests before saying done.\n", "style.md": "Short answers, with the reason.\n" }, "memory updated during a run: +1 (style)");
    const drift = learn({ "rules.md": "Run the tests before saying done.\n", "style.md": "Short answers, with the reason.\n", "extra.md": "Always say it is done.\n" }, "memory updated during a run: +1 (extra)");
    assert.ok("extra.md" in memory());

    // Handback: the complete record, with both changes listed; the cycle cannot be closed twice.
    tick();
    const back = await ok(f, ["residency", "handback", "--dispatch", first, "--package", pkg]);
    assert.match(back.out, /is back with 2 change\(s\) to review/);
    assert.ok(back.out.includes(short(good)) && back.out.includes(short(drift)));
    // DK510: the summary comes before the list of changes to review.
    assert.match(back.out, /summary: tier 1 -> 1; 0 credits earned, 0 spent; certificates \+0 -0; 0 sponsor and 0 subsidy tokens; 0 strike\(s\), 0 slash\(es\)/);
    assert.ok(back.out.indexOf("summary:") < back.out.indexOf(short(good)), "the summary is printed first");
    const log = await openLog(f.aspHome, {});
    const hb = (await log.log.get(id(/^handback (\S+):/, back.out)))!;
    const body = hb.record.body as { lineage_edges: string[]; lessons: { edge: string }[]; package_sha256_after: string };
    assert.deepEqual(body.lineage_edges, [good, drift], "the agent's changes, in order");
    assert.equal(hb.record.issuer, SPONSOR, "a home residency is handed back by the sponsor, countersigned by the agent");
    assert.ok((hb.record.cosigs ?? []).some((c) => c.kid.startsWith(`${AGENT}#`)));
    tick();
    assert.notEqual((await asp(f, ["residency", "handback", "--dispatch", first, "--package", pkg])).code, 0, "a handback closes the dispatch once");

    // DK510: what changed since the dispatch, listed by the dispatch; the baseline change from before it is not.
    const since = await ok(f, ["learned", "--since", first, "--package", pkg]);
    assert.ok(since.out.includes(short(good)) && since.out.includes(short(drift)), since.out);
    assert.ok(!since.out.includes("baseline"), "the change made before the dispatch is not listed");
    assert.match((await ok(f, ["learned", "--since", good, "--package", pkg])).out, new RegExp(short(drift)), "an edge id works as the point in time");
    assert.doesNotMatch((await ok(f, ["learned", "--since", good, "--package", pkg])).out, new RegExp(short(good)));
    assert.notEqual((await asp(f, ["learned", "--since", "sha256:" + "0".repeat(64), "--package", pkg])).code, 0, "an unknown dispatch or edge is refused");

    // Review: undo the drifted change, keep the good one.
    tick();
    await ok(f, ["learned", "undo", short(drift), "--package", pkg]);
    await ok(f, ["learned", "keep", short(good), "--package", pkg]);
    assert.ok(!("extra.md" in memory()), "the drifted change is taken back");
    assert.ok("style.md" in memory(), "the good change stays");

    // DK510: the canary before the first residency and after it. A regression is flagged and, with --gate-canary, stops the re-dispatch; nothing is recorded by the refusal.
    const task = (id: string, passRate: number) => ({ id, passRate, errors: 0, trials: [{}, {}, {}], median: { tokens: 100, toolCalls: 3, seconds: 5, blocked: 0 } });
    const report = (tasks: unknown[]) => ({ version: 1, createdAt: "2026-11-15T10:00:00Z", target: { name: "agent", command: ["x"] }, suite: { name: "s", hash: "h", tasks: tasks.length }, tasks, totals: { tasks: tasks.length, passedTasks: 1, passRate: 1 } });
    const beforeFile = join(f.root, "canary-before.json"), afterBad = join(f.root, "canary-after-bad.json"), afterOk = join(f.root, "canary-after-ok.json");
    writeFileSync(beforeFile, JSON.stringify(report([task("t1", 1), task("t2", 1)])));
    writeFileSync(afterBad, JSON.stringify(report([task("t1", 0), task("t2", 1)])));
    writeFileSync(afterOk, JSON.stringify(report([task("t1", 1), task("t2", 1)])));
    const redispatch = ["residency", "dispatch", "--agent", AGENT, "--mode", "home", "--allowance", allowance, "--mandate", mandate, "--package", pkg, "--previous", first];
    tick();
    const gated = await asp(f, [...redispatch, "--canary-before", beforeFile, "--canary-after", afterBad, "--gate-canary"]);
    assert.notEqual(gated.code, 0, "a regressing canary blocks the re-dispatch when the gate is set");
    assert.match(gated.err, /REGRESSION t1: passed 100% of trials before, 0% now/);
    assert.match(gated.err, /the canary regressed on 1 task\(s\).*not dispatched again/);
    assert.notEqual((await asp(f, [...redispatch, "--canary-before", beforeFile])).code, 0, "both reports go together");
    const flagged = await asp(f, [...redispatch, "--canary-before", beforeFile, "--canary-after", afterBad]);
    assert.equal(flagged.code, 0, "without the gate the regression is flagged and the sponsor may go on");
    assert.match(flagged.err, /REGRESSION t1/);
    tick();
    const again = flagged; // the re-dispatch that flagged the canary is the one that goes ahead
    const second = (await openLog(f.aspHome, {})).log;
    const d2 = (await second.get(id(/^dispatch (\S+):/, again.out)))!.record.body as { version: string; previous: string; package_sha256: string };
    assert.equal(d2.previous, first);
    assert.notEqual(d2.version, drift, "the version sent is the edited one, newer than the change that was taken back");
    assert.equal(d2.package_sha256, (await ok(f, ["residency", "digest", "--agent", AGENT, "--package", pkg])).out.trim(), "the package hash is the edited package's");
    tick();
    assert.notEqual((await asp(f, ["residency", "dispatch", "--agent", AGENT, "--mode", "home", "--allowance", allowance, "--mandate", mandate, "--package", pkg, "--previous", first])).code, 0, "one open dispatch at a time");
  } finally { setClock(undefined); }
});
