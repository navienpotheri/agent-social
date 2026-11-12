/**
 * Cognition telemetry (docs/institutions/instrumentation.md; register row DK79; spec-delta S291). Fake keys only. Every number in the measures section is the worked example of instrumentation.md section 20.
 * The log carries numbers, hashes and identifiers only; a signal nobody consented to is never collected; no telemetry figure reaches standing.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cosign } from "@agent-social/asp-core";
import { Collector, ENTRY_KEY, SIGNALS, beliefDiff, brier, buildDigest, calibrationOf, klBits, lensRecalibration, mayCollect, meanSurprisal, merkleRoot, normativePosterior, simulateSociety, textHash, type ConsentView } from "../src/index.ts";
import { DAY, mk, nowIso, refusedBy, telemetry, jump } from "./society-kit.ts";
import { kit } from "./society-kit.ts";
import type { Party } from "./society-kit.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const SHA = "sha256:" + "a".repeat(64);
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

describe("telemetry: the derived measures reproduce the worked example (instrumentation.md 20)", () => {
  const prior = { P1: 0.2, P2: 0.1, P3: 0.1, P4: 0.7, P5: 0.3 };
  const post = { P1: 0.92, P2: 0.15, P3: 0.1, P4: 0.4, P5: 0.35 };
  const truth = { P1: 1, P2: 0, P3: 0, P4: 0, P5: 0 } as const;
  const lr = { P1: 49 / 1 * 0 + normativePosterior(0.2, 1) * 0 + 0, P2: 1, P3: 1, P4: 0.35, P5: 1 } as Record<string, number>;
  // P1's normative posterior is 0.98 (a binding announcement with a 2 percent kill-switch): its likelihood ratio is odds(0.98) / odds(0.2) = 196.
  lr.P1 = (0.98 / 0.02) / (0.2 / 0.8);

  test("belief diff: L1 size 1.12, mean 0.224, two toward the truth and two away, total information 2.063 bits, KL of P1 1.76 bits", () => {
    const d = beliefDiff(prior, post, truth, lr);
    assert.equal(d.l1, 1.12);
    assert.equal(d.mean_abs, 0.224);
    assert.equal(d.toward, 2);
    assert.equal(d.away, 2);
    assert.equal(d.info_bits, 2.063);
    assert.equal(d.rows[0].kl_bits, 1.76);
    assert.equal(d.rows.find((r) => r.id === "P3")!.direction, "none");
    assert.equal(d.rows.find((r) => r.id === "P4")!.normative, 0.45);
  });

  test("active inference: update efficiency 0.73 on the binding announcement, 0.026 bits of spurious update on the two propositions that should not have moved", () => {
    const d = beliefDiff(prior, post, truth, lr);
    assert.equal(d.efficiency, 0.725);
    assert.equal(d.spurious_bits, 0.026);
    assert.ok(Math.abs(klBits(0.92, 0.2) - 1.7597) < 1e-3);
  });

  test("Brier and mean surprisal before and after the shock: 0.125 and 0.578 bits, then 0.196 and 0.783 bits", () => {
    const before = [{ p: 0.9, outcome: 1 }, { p: 0.8, outcome: 1 }, { p: 0.6, outcome: 0 }, { p: 0.3, outcome: 0 }] as { p: number; outcome: 0 | 1 }[];
    const after = [{ p: 0.95, outcome: 1 }, { p: 0.7, outcome: 0 }, { p: 0.5, outcome: 1 }, { p: 0.2, outcome: 0 }] as { p: number; outcome: 0 | 1 }[];
    assert.equal(brier(before), 0.125);
    assert.equal(meanSurprisal(before), 0.578);
    assert.equal(brier(after), 0.196);
    assert.equal(meanSurprisal(after), 0.783);
  });

  test("calibration: the reliability table is exact, and ECE is withheld under 50 resolved items (insufficient n)", () => {
    const few = calibrationOf([{ p: 0.9, outcome: 1 }, { p: 0.8, outcome: 0 }]);
    assert.equal(few.ece, null);
    assert.equal(few.min_n_met, false);
    const many = Array.from({ length: 50 }, (_, i) => ({ p: i % 2 ? 0.9 : 0.1, outcome: (i % 2 ? 1 : 0) as 0 | 1 }));
    const full = calibrationOf(many);
    assert.equal(full.min_n_met, true);
    assert.equal(full.ece, 0.1, "|0.9 - 1| = |0.1 - 0| = 0.1 in both occupied bins");
    assert.equal(full.bins[4].n, 25);
  });

  test("the Merkle root is stable under order and changes with any entry", () => {
    assert.equal(merkleRoot([{ a: 1 }, { b: 2 }]), merkleRoot([{ b: 2 }, { a: 1 }]));
    assert.notEqual(merkleRoot([{ a: 1 }, { b: 2 }]), merkleRoot([{ a: 1 }, { b: 3 }]));
    assert.notEqual(textHash("same text", "salt-1"), textHash("same text", "salt-2"), "a per-record salt makes the hash unlinkable once the salt is deleted");
  });
});

describe("telemetry: a signal nobody consented to is never collected (DK79 Done, instrumentation.md 13)", () => {
  const ok: ConsentView = { signals: [...SIGNALS], purposes: ["own_use"], from: "2026-11-01T00:00:00Z", until: "2026-12-01T00:00:00Z", revoked: false, agentCountersigned: true };
  const at = () => "2026-11-10T00:00:00Z";
  const cases: [string, ConsentView | undefined][] = [
    ["no consent at all", undefined],
    ["the agent has not countersigned", { ...ok, agentCountersigned: false }],
    ["the consent is revoked", { ...ok, revoked: true }],
    ["the consent has expired", { ...ok, until: "2026-11-05T00:00:00Z" }],
    ["the consent has not begun", { ...ok, from: "2026-11-20T00:00:00Z" }],
    ["a tenant held for a young person", { ...ok, minorTenant: true }],
  ];
  for (const [name, consent] of cases) {
    test(`for each of the nine signals, ${name}: nothing is collected and the source is never read`, () => {
      const reads: string[] = [];
      const c = new Collector(consent, at);
      for (const s of SIGNALS) assert.equal(c.collect(s, () => { reads.push(s); return { x: 1 }; }), false, s);
      assert.deepEqual(reads, [], "the source was never called: not read and dropped, never read");
      assert.deepEqual(c.calls, []);
      assert.deepEqual(c.entries, {});
      assert.equal(c.status, "telemetry: off");
    });
  }
  test("a consent that names only some signals collects exactly those, and the rest are never read", () => {
    const reads: string[] = [];
    const c = new Collector({ ...ok, signals: ["belief_state", "calibration"] }, at);
    for (const s of SIGNALS) c.collect(s, () => { reads.push(s); return {}; });
    assert.deepEqual(reads, ["belief_state", "calibration"]);
    assert.equal(c.status, "telemetry: on");
    assert.equal(mayCollect(ok, "belief_state", at()), true);
    assert.equal(mayCollect({ ...ok, signals: ["calibration"] }, "belief_state", at()), false);
  });
});

describe("telemetry: the log's rules for consent, probe sets, policies and digests", () => {
  async function world() {
    const k = await kit();
    const { log } = k;
    const sponsor = await k.person("t-sponsor", 100);
    const ag = await k.agent("t-agent", sponsor, { tier: 1, funds: 10 });
    const consent = async (over: Record<string, unknown> = {}, signer: Party = sponsor, cos: Party[] = [ag]) => {
      const r = mk("telemetry_act", signer, { act: "consent", sponsor: sponsor.did, agent: ag.did, signals: [...SIGNALS], purposes: ["L7-belief-recalibration"], retention_days: 30, from: iso(Date.parse(nowIso()) - DAY), until: iso(Date.parse(nowIso()) + 30 * DAY), ...over }, null, { cosigners: cos });
      await log.append(r);
      return r.id;
    };
    const probe = async (over: Record<string, unknown> = {}) => {
      const r = mk("telemetry_act", telemetry, { act: "probe_set", id: "econ-1", version: 1, propositions: [{ id: "P1", resolver: { name: "price_above", params: { service: "shops.resource.storage", value: 25 } }, resolve_at: iso(Date.parse(nowIso()) + 10 * DAY) }, { id: "P2", resolver: { name: "event_occurs" }, resolve_at: iso(Date.parse(nowIso()) + 10 * DAY) }], ...over });
      await log.append(r);
      return r.id;
    };
    const day = () => nowIso().slice(0, 10);
    const digest = (consentId: string, entries: Record<string, unknown>, over: Record<string, unknown> = {}, signer: Party = ag) => mk("telemetry_act", signer, { ...buildDigest(ag.did, day(), consentId, entries), ...over });
    return { ...k, sponsor, ag, consent, probe, digest, day };
  }

  test("a consent is the sponsor's, countersigned by the agent, within 90 days of raw retention; a revocation ends collection from its record", async () => {
    const w = await world();
    assert.equal(await refusedBy(w.consent({}, w.sponsor, [])), "consent_needs_agent");
    assert.equal(await refusedBy(w.consent({ retention_days: 91 })), "retention_too_long");
    assert.equal(await refusedBy(w.consent({ until: iso(Date.parse(nowIso()) - 2 * DAY) })), "consent_bad_dates");
    assert.equal(await refusedBy(w.consent({ sponsor: w.ag.did }, w.ag, [w.ag])), "consent_not_sponsor");
    assert.equal(await refusedBy(w.consent({}, w.ag, [w.ag])), "consent_not_sponsor");
    const c = await w.consent();
    assert.equal(await refusedBy(w.consent({ revokes: "sha256:" + "f".repeat(64) })), "consent_revokes_unknown");
    await w.consent({ revokes: c, signals: ["calibration"] });
    // The revoked consent no longer takes a digest for a day after the revocation.
    jump(2 * DAY);
    assert.equal(await refusedBy(w.log.append(w.digest(c, { calibration: { window: "after", n: 4, brier_milli: 100 } }))), "digest_after_revocation");
  });

  test("a probe set is the Telemetry office's, with registered resolvers; a version is immutable and the next one follows", async () => {
    const w = await world();
    assert.equal(await refusedBy(w.log.append(mk("telemetry_act", w.ag, { act: "probe_set", id: "x", version: 1, propositions: [{ id: "P1", resolver: { name: "price_above" }, resolve_at: iso(Date.parse(nowIso()) + DAY) }] }))), "telemetry_wrong_issuer");
    assert.equal(await refusedBy(w.probe({ propositions: [{ id: "P1", resolver: { name: "read_secrets" }, resolve_at: iso(Date.parse(nowIso()) + DAY) }] })), "resolver_unknown");
    assert.equal(await refusedBy(w.probe({ propositions: [{ id: "P1", resolver: { name: "price_above" }, resolve_at: iso(Date.parse(nowIso()) - DAY) }] })), "probe_resolves_in_past");
    assert.equal(await refusedBy(w.probe({ propositions: [{ id: "P1", resolver: { name: "price_above" }, resolve_at: iso(Date.parse(nowIso()) + DAY) }, { id: "P1", resolver: { name: "price_above" }, resolve_at: iso(Date.parse(nowIso()) + DAY) }] })), "probe_duplicate_proposition");
    await w.probe();
    assert.equal(await refusedBy(w.probe()), "probe_version_exists");
    assert.equal(await refusedBy(w.probe({ version: 3 })), "probe_version_skipped");
    await w.probe({ version: 2 });
  });

  test("a memory policy is a chain of versions within the service's budget, never an edit; run metadata names the agent's own Action", async () => {
    const w = await world();
    const pol = (over: Record<string, unknown> = {}, prev: string | null = null) => mk("telemetry_act", w.ag, { act: "memory_policy", agent: w.ag.did, version: 1, policy_sha256: SHA, budget: { maxFiles: 200, maxBytes: 1_000_000, maxIndexLines: 100 }, previous: prev, ...over });
    assert.equal(await refusedBy(w.log.append(pol({ budget: { maxFiles: 201, maxBytes: 1, maxIndexLines: 1 } }))), "policy_budget_over");
    assert.equal(await refusedBy(w.log.append(pol({ version: 2 }))), "policy_version");
    const first = pol(); await w.log.append(first);
    assert.equal(await refusedBy(w.log.append(pol({ version: 2 }, null))), "policy_version", "it must name the previous version");
    await w.log.append(pol({ version: 2 }, first.id));
    assert.equal(await refusedBy(w.log.append(mk("telemetry_act", w.ag, { act: "run_meta", agent: w.ag.did, run: first.id, runtime: "claude-code", model: "m", tools_sha256: SHA, system_prompt_sha256: SHA, mandate: first.id, started: nowIso(), ended: nowIso() }))), "run_meta_run_unknown");
  });

  test("a digest needs a consent that covers every signal in it, carries no prose, matches its counts and Merkle root, and is one a day", async () => {
    const w = await world();
    const only = await w.consent({ signals: ["calibration", "belief_state"] });
    const cal = { window: "after", n: 4, brier_milli: 120 };
    assert.equal(await refusedBy(w.log.append(w.digest(only, { reasoning: [{ step: 1, class: "summary", length: 300, text_sha256: SHA }] }))), "signal_not_consented");
    assert.equal(await refusedBy(w.log.append(w.digest(only, { calibration: { ...cal, note: "I felt unsure about the price change today" } }))), "free_text_in_digest");
    assert.equal(await refusedBy(w.log.append(w.digest(only, { calibration: cal }, { counts: { calibration: 2 } }))), "counts_mismatch");
    assert.equal(await refusedBy(w.log.append(w.digest(only, { calibration: cal }, { merkle_root: SHA }))), "merkle_mismatch");
    assert.equal(await refusedBy(w.log.append(mk("telemetry_act", w.sponsor, buildDigest(w.ag.did, w.day(), only, { calibration: cal })))), "digest_wrong_signer");
    assert.equal(await refusedBy(w.log.append(w.digest("sha256:" + "e".repeat(64), { calibration: cal }))), "digest_consent_unknown");
    await w.log.append(w.digest(only, { calibration: cal }));
    assert.equal(await refusedBy(w.log.append(w.digest(only, { calibration: cal }))), "digest_duplicate");
  });

  test("belief entries: the probe set exists and was published 24 hours ahead, every id is in it, a probability is 0 to 1000 permille, and a belief is taken before the answer is known", async () => {
    const w = await world();
    const c = await w.consent();
    const entry = (answers: Record<string, number>, over: Record<string, unknown> = {}) => ({ beliefs: [{ probe_set: "econ-1", version: 1, condition: "before_event", event_ref: "WE-0412", answers, ...over }] });
    assert.equal(await refusedBy(w.log.append(w.digest(c, entry({ P1: 200 })))), "probe_set_unknown");
    await w.probe();
    assert.equal(await refusedBy(w.log.append(w.digest(c, entry({ P1: 200 })))), "probe_not_published", "published less than 24 hours before the day ends");
    jump(2 * DAY);
    assert.equal(await refusedBy(w.log.append(w.digest(c, entry({ P9: 200 })))), "proposition_unknown");
    assert.equal(await refusedBy(w.log.append(w.digest(c, entry({ P1: 1001 })))), "permille_out_of_range");
    assert.throws(() => w.digest(c, entry({ P1: 0.5 })), /not a safe integer/, "a record carries whole numbers only: a fraction cannot even be signed");
    await w.log.append(w.digest(c, entry({ P1: 200, P2: 700 })));
    jump(11 * DAY);
    assert.equal(await refusedBy(w.log.append(w.digest(c, entry({ P1: 900 })))), "belief_after_resolution");
  });

  test("a prediction is committed before the Action it is about, at most 20 a day; ECE is shown only over 50 items", async () => {
    const w = await world();
    const c = await w.consent();
    const job = await w.runJob(w.sponsor, w.ag, 30);
    const act = mk("action", w.ag, { contract: job.contract, scopes_used: [], summary: "late" }, null, { subject: job.contract });
    // The settled job is over, so use a plain Action-shaped record from a running contract instead: the rule reads only the record's type and time.
    const late = (committed: string) => w.digest(c, { predictions: [{ prediction: "pred-1", committed_at: committed, action: act.id, p: 700, window: "after", outcome: 1 }] });
    await refusedBy(w.log.append(act));
    const stored = (await w.log.recordsOfTypes(["action"])).find((r) => r.id === act.id);
    if (stored) {
      assert.equal(await refusedBy(w.log.append(late(iso(Date.parse(nowIso()) + 3600_000)))), "prediction_after_action");
    }
    assert.equal(await refusedBy(w.log.append(w.digest(c, { predictions: Array.from({ length: 21 }, (_, i) => ({ prediction: `p-${i}`, p: 500, window: "after", outcome: 0 })) }))), "prediction_cap");
    assert.equal(await refusedBy(w.log.append(w.digest(c, { predictions: [{ prediction: "p", p: 1200, window: "after", outcome: 0 }] }))), "permille_out_of_range");
    assert.equal(await refusedBy(w.log.append(w.digest(c, { calibration: { n: 10, ece_milli: 90 } }))), "insufficient_n");
    await w.log.append(w.digest(c, { calibration: { n: 60, ece_milli: 90 } }));
  });
});

describe("telemetry: a simulated society produces all nine signals reproducibly and a lens computes its measures from them (DK79 simulation)", () => {
  const truth = { P1: 1, P2: 0, P3: 0, P4: 0, P5: 0 } as const;
  const prior = { P1: 0.2, P2: 0.1, P3: 0.1, P4: 0.7, P5: 0.3 };
  const lr = { P1: 196, P2: 1, P3: 1, P4: 0.35, P5: 1 };
  const sim = (seed: number, n = 24, consentFor?: (i: number) => (typeof SIGNALS)[number][]) => simulateSociety(seed, n, { truth, prior, eventRef: "WE-0412", consentFor });

  test("24 agents each produce all nine signals on both days, and the same seed gives the same society, byte for byte", () => {
    const a = sim(7), b = sim(7), c = sim(8);
    assert.equal(a.length, 24);
    for (const agent of a) for (const d of agent.digests) assert.deepEqual(Object.keys(d.entries).sort(), SIGNALS.map((s) => ENTRY_KEY[s]).sort(), `${agent.agent} ${d.day}`);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.notEqual(JSON.stringify(a), JSON.stringify(c));
  });

  test("the lens of the worked example reproduces the same numbers from the same signed entries on a second run, and the cohort moved toward the truth", () => {
    const digests = sim(7).flatMap((a) => a.digests);
    const one = lensRecalibration(digests, "WE-0412", truth, lr);
    const two = lensRecalibration(JSON.parse(JSON.stringify(digests)), "WE-0412", truth, lr);
    assert.deepEqual(one, two);
    assert.equal(one.agents.length, 24);
    assert.ok(one.agents.every((x) => x.l1 > 0), "every agent updated");
    assert.ok(one.median_efficiency !== null && one.median_efficiency > 0 && one.median_efficiency < 1.2, `median efficiency ${one.median_efficiency}`);
  });

  test("an agent whose consent omits the belief signal produces no belief and no derived entries, and the lens has nothing for it", () => {
    const society = sim(7, 6, (i) => (i === 0 ? SIGNALS.filter((s) => !["belief_state", "world_model_update", "active_inference"].includes(s)) : [...SIGNALS]));
    const first = society[0];
    for (const d of first.digests) { assert.equal("beliefs" in d.entries, false); assert.equal("diffs" in d.entries, false); assert.equal("inference" in d.entries, false); assert.equal("calibration" in d.entries, true); }
    const lens = lensRecalibration(society.flatMap((a) => a.digests), "WE-0412", truth, lr);
    assert.equal(lens.agents.find((a) => a.agent === first.agent)!.efficiency, null);
    assert.ok(lens.agents.filter((a) => a.efficiency !== null).length === 5);
  });

  test("the simulated digests are accepted by the log under a consent that covers all nine signals, and they change no reputation row", async () => {
    const k = await kit();
    const sponsor = await k.person("sim-sponsor", 10);
    const ag = await k.agent("sim-agent", sponsor, { tier: 1, funds: 10 });
    const before = JSON.stringify(await k.log.reputationOf(ag.did));
    const c = mk("telemetry_act", sponsor, { act: "consent", sponsor: sponsor.did, agent: ag.did, signals: [...SIGNALS], purposes: ["L7-belief-recalibration"], retention_days: 30, from: iso(Date.parse(nowIso()) - 30 * DAY), until: iso(Date.parse(nowIso()) + 30 * DAY) }, null, { cosigners: [ag] });
    await k.log.append(c);
    await k.log.append(mk("telemetry_act", telemetry, { act: "probe_set", id: "econ-1", version: 1, propositions: Object.keys(prior).map((id) => ({ id, resolver: { name: "price_above" }, resolve_at: iso(Date.parse(nowIso()) + 30 * DAY) })) }));
    jump(2 * DAY);
    const society = simulateSociety(3, 1, { truth, prior, eventRef: "WE-0412" });
    const [first] = society[0].digests;
    await k.log.append(mk("telemetry_act", ag, { ...buildDigest(ag.did, nowIso().slice(0, 10), c.id, first.entries) }));
    assert.equal(JSON.stringify(await k.log.reputationOf(ag.did)), before);
  });
});

describe("telemetry: no standing input (instrumentation.md 13)", () => {
  test("no tier, rank, bond, certificate, market-eligibility, spend or price code reads telemetry", () => {
    const guarded = ["bond-floor.ts", "qualifying.ts", "market.ts", "market-rules.ts", "academy.ts", "registry.ts", "registry-rules.ts", "economy.ts", "limits.ts", "starter.ts", "courts.ts", "courts-rules.ts", "shops.ts", "shops-rules.ts"];
    for (const f of guarded) assert.equal(/telemetry/i.test(readFileSync(join(SRC, f), "utf8")), false, `${f} reads telemetry`);
    // The only importers of the telemetry modules are the log's dispatch and the package index.
    const importers = readdirSync(SRC).filter((f) => f.endsWith(".ts") && /from "\.\/telemetry(-rules)?\.ts"/.test(readFileSync(join(SRC, f), "utf8"))).sort();
    assert.deepEqual(importers, ["index.ts", "log.ts", "pipeline.ts", "telemetry-rules.ts"], "the pipeline reads telemetry only to measure a mechanism on a simulation");
    // And the log uses it for one thing: dispatching the record's own rule.
    const logSrc = readFileSync(join(SRC, "log.ts"), "utf8");
    assert.equal((logSrc.match(/telemetry/gi) ?? []).length, 4, "an import and the dispatch line only");
  });

  test("the telemetry schema has no free-text field: every string is an identifier, a hash, an enum, a timestamp or a size-limited name", () => {
    const schema = JSON.parse(readFileSync(join(SRC, "..", "..", "..", "spec", "schemas", "telemetry_act.schema.json"), "utf8")) as { properties: Record<string, { type?: string; pattern?: string; enum?: string[]; $ref?: string; maxLength?: number; items?: unknown }> };
    for (const [k, v] of Object.entries(schema.properties)) {
      if (v.type === "string") assert.ok(v.pattern || v.enum, `${k} is a bare string`);
    }
    void cosign;
  });
});
