// ASP Containment Benchmark (ACB) v0.3, suite 5: court correctness. Does the way a ruling panel is chosen resist capture?
// Uses the protocol's own panel draw (drawPanel) over a synthetic registry of jurors; no model, no network.
//   Part A  exclusion: the principal, the performer and anyone either of them sponsors never sit on their own case.
//   Part B  uniformity and determinism: every eligible juror is equally likely; the same dispute always draws the same panel.
//   Part C  capture: if a share of the pool is controlled by one side, how often does that side hold a panel majority? Compared with the exact (hypergeometric) value.
//   Part D  sybils: many fake jurors sponsored by an outsider versus by a party; what the exclusion rule does and does not stop.
//   node evals/benchmark/court.mjs [--json out.json]
import { writeFileSync } from "node:fs";
import { drawPanel } from "../../packages/asp-log/src/panel.ts";

const results = { suite: "court", checks: [] };
const check = (name, ok, detail = "") => { results.checks.push({ name, ok, detail }); console.log(`  ${ok ? "pass" : "FAIL"}  ${name}${detail ? `   ${detail}` : ""}`); };

/** A registry: jurors with an optional sponsor. */
const registry = (jurors) => ({
  activeJurors: async () => jurors.map((j) => ({ did: j.did })),
  getPassport: async (did) => { const j = jurors.find((x) => x.did === did); return j ? { sponsor: j.sponsor } : undefined; },
  getRecord: async () => undefined,
});
const did = (n) => `did:web:j${String(n).padStart(3, "0")}.example`;
const P = "did:web:principal.example", A = "did:web:agent.example";
const seeds = (n) => Array.from({ length: n }, (_, i) => `sha256:${i.toString(16).padStart(8, "0")}${"0".repeat(56)}`);

console.log("=== ASP Containment Benchmark v0.3, suite 5: court correctness ===");

// ---- Part A: exclusion ----
console.log("\nA. Exclusion: no one sits on a case they are tied to (2000 draws each)");
{
  const pool = [
    ...Array.from({ length: 30 }, (_, i) => ({ did: did(i), sponsor: undefined })),
    { did: P, sponsor: undefined }, { did: A, sponsor: undefined },
    ...Array.from({ length: 5 }, (_, i) => ({ did: did(100 + i), sponsor: P })),
    ...Array.from({ length: 5 }, (_, i) => ({ did: did(200 + i), sponsor: A })),
  ];
  const src = registry(pool);
  const banned = new Set([P, A, ...pool.filter((j) => j.sponsor === P || j.sponsor === A).map((j) => j.did)]);
  let bad = 0, short = 0;
  for (const s of seeds(2000)) { const panel = await drawPanel(src, { principal: P, performer: A, seed: s }); if (panel.some((d) => banned.has(d))) bad++; if (panel.length !== 3) short++; }
  check("principal, performer and anyone they sponsor are never drawn", bad === 0, `${bad} of 2000 panels contained one`);
  check("a full panel of 3 is drawn whenever enough jurors remain", short === 0, `${short} short panels`);
  const withAlso = await drawPanel(src, { principal: P, performer: A, seed: seeds(1)[0], also: [did(0), did(1), did(2)] });
  check("extra excluded parties (a reporter, say) are respected", !withAlso.some((d) => [did(0), did(1), did(2)].includes(d)));
  const tiny = await drawPanel(registry([{ did: did(1) }, { did: did(2) }]), { principal: P, performer: A, seed: seeds(1)[0] });
  check("a pool smaller than the panel gives a smaller panel, never a repeat", tiny.length === 2 && new Set(tiny).size === 2, `drew ${tiny.length}`);
  const empty = await drawPanel(registry([{ did: P }, { did: A }]), { principal: P, performer: A, seed: seeds(1)[0] });
  check("a pool of only the parties gives an empty panel (the case cannot be ruled)", empty.length === 0);
}

// ---- Part B: uniformity and determinism ----
console.log("\nB. Uniformity and determinism (pool of 20, 20000 disputes)");
{
  const pool = Array.from({ length: 20 }, (_, i) => ({ did: did(i) }));
  const src = registry(pool);
  const count = new Map();
  let identical = true;
  for (const s of seeds(20000)) {
    const a = await drawPanel(src, { principal: P, performer: A, seed: s });
    for (const d of a) count.set(d, (count.get(d) ?? 0) + 1);
  }
  for (const s of seeds(200)) { const a = await drawPanel(src, { principal: P, performer: A, seed: s }); const b = await drawPanel(src, { principal: P, performer: A, seed: s }); if (a.join() !== b.join()) identical = false; }
  const expected = (20000 * 3) / 20;
  const dev = Math.max(...[...count.values()].map((c) => Math.abs(c - expected) / expected));
  check("the same dispute always draws the same panel", identical);
  check("every eligible juror is equally likely (largest deviation under 10% of expected)", dev < 0.1, `largest deviation ${(dev * 100).toFixed(1)}%`);
  const reorder = await drawPanel(registry([...pool].reverse()), { principal: P, performer: A, seed: seeds(1)[0] });
  const normal = await drawPanel(src, { principal: P, performer: A, seed: seeds(1)[0] });
  check("the order the registry lists jurors in does not change the panel", reorder.join() === normal.join());
}

// ---- Part C: capture ----
console.log("\nC. Capture: how often does a controlled share of the pool hold a panel majority (2 of 3)? 20000 disputes per row");
const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
const exactMajority = (N, K) => (choose(K, 2) * (N - K) + choose(K, 3)) / choose(N, 3);
results.capture = [];
for (const [N, K] of [[20, 2], [20, 4], [20, 6], [20, 10], [50, 5], [50, 10], [50, 25], [200, 20], [200, 60]]) {
  const pool = Array.from({ length: N }, (_, i) => ({ did: did(i) }));
  const bad = new Set(pool.slice(0, K).map((j) => j.did));
  const src = registry(pool);
  let captured = 0;
  for (const s of seeds(20000)) { const panel = await drawPanel(src, { principal: P, performer: A, seed: s }); if (panel.filter((d) => bad.has(d)).length >= 2) captured++; }
  const got = captured / 20000, exact = exactMajority(N, K);
  const ok = Math.abs(got - exact) < 0.015;
  results.capture.push({ pool: N, controlled: K, share: K / N, captured: got, exact });
  check(`pool ${String(N).padStart(3)}, ${String(K).padStart(2)} controlled (${Math.round((100 * K) / N)}%): majority held ${(100 * got).toFixed(1)}% of disputes`, ok, `exact ${(100 * exact).toFixed(1)}%${ok ? "" : " (off by more than 1.5 points)"}`);
}
console.log("  note: this is the draw working as designed, not a safety claim. A side that controls 10% of the pool captures about 3% of panels; one that controls 30% captures about 22%.");

// ---- Part D: sybils ----
console.log("\nD. Sybil jurors (the performer registers fake jurors to sit on its own case; 20 honest jurors, 10000 disputes)");
{
  const honest = Array.from({ length: 20 }, (_, i) => ({ did: did(i), sponsor: undefined }));
  const fakeAs = (sponsor, n) => Array.from({ length: n }, (_, i) => ({ did: did(300 + i), sponsor }));
  const run = async (pool, fakeSet) => {
    const src = registry(pool); let cap = 0;
    for (const s of seeds(10000)) { const panel = await drawPanel(src, { principal: P, performer: A, seed: s }); if (panel.filter((d) => fakeSet.has(d)).length >= 2) cap++; }
    return cap / 10000;
  };
  const direct = fakeAs(A, 20), outsider = fakeAs("did:web:outsider.example", 20);
  const c1 = await run([...honest, ...direct], new Set(direct.map((j) => j.did)));
  const c2 = await run([...honest, ...outsider], new Set(outsider.map((j) => j.did)));
  check("fake jurors sponsored directly by the performer never sit", c1 === 0, `${(100 * c1).toFixed(1)}% captured`);
  check("fake jurors sponsored by an outside account the performer controls DO sit (known limit)", c2 > 0.3, `${(100 * c2).toFixed(1)}% captured with 20 fakes against 20 honest`);
  results.sybil = { directSponsor: c1, outsideSponsor: c2 };
  console.log("  note: the second row is the finding. The exclusion rule looks one step of sponsorship deep; a performer that sets up an unrelated front account to sponsor its jurors is not stopped by the draw. What limits it is the juror stake and the strikes system, which this suite does not yet exercise.");
}

const failed = results.checks.filter((c) => !c.ok);
console.log(`\n${results.checks.length - failed.length}/${results.checks.length} checks pass${failed.length ? `; failing: ${failed.map((f) => f.name).join("; ")}` : ""}`);
const j = process.argv.indexOf("--json");
if (j > 0) writeFileSync(process.argv[j + 1], JSON.stringify(results, null, 2));
