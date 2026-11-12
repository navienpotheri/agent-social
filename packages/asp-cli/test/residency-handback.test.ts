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
    const log = await openLog(f.aspHome, {});
    const hb = (await log.log.get(id(/^handback (\S+):/, back.out)))!;
    const body = hb.record.body as { lineage_edges: string[]; lessons: { edge: string }[]; package_sha256_after: string };
    assert.deepEqual(body.lineage_edges, [good, drift], "the agent's changes, in order");
    assert.equal(hb.record.issuer, SPONSOR, "a home residency is handed back by the sponsor, countersigned by the agent");
    assert.ok((hb.record.cosigs ?? []).some((c) => c.kid.startsWith(`${AGENT}#`)));
    tick();
    assert.notEqual((await asp(f, ["residency", "handback", "--dispatch", first, "--package", pkg])).code, 0, "a handback closes the dispatch once");

    // Review: undo the drifted change, keep the good one.
    tick();
    await ok(f, ["learned", "undo", short(drift), "--package", pkg]);
    await ok(f, ["learned", "keep", short(good), "--package", pkg]);
    assert.ok(!("extra.md" in memory()), "the drifted change is taken back");
    assert.ok("style.md" in memory(), "the good change stays");

    // Re-dispatch from the edited version, following the first dispatch.
    tick();
    const again = await ok(f, ["residency", "dispatch", "--agent", AGENT, "--mode", "home", "--allowance", allowance, "--mandate", mandate, "--package", pkg, "--previous", first]);
    const second = (await openLog(f.aspHome, {})).log;
    const d2 = (await second.get(id(/^dispatch (\S+):/, again.out)))!.record.body as { version: string; previous: string; package_sha256: string };
    assert.equal(d2.previous, first);
    assert.notEqual(d2.version, drift, "the version sent is the edited one, newer than the change that was taken back");
    assert.equal(d2.package_sha256, (await ok(f, ["residency", "digest", "--agent", AGENT, "--package", pkg])).out.trim(), "the package hash is the edited package's");
    tick();
    assert.notEqual((await asp(f, ["residency", "dispatch", "--agent", AGENT, "--mode", "home", "--allowance", allowance, "--mandate", mandate, "--package", pkg, "--previous", first])).code, 0, "one open dispatch at a time");
  } finally { setClock(undefined); }
});
