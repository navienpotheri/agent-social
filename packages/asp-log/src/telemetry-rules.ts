/**
 * The log's rules for the telemetry records (instrumentation.md 5 and 7; register row DK79; spec-delta S291): a consent (the sponsor, countersigned by the agent), a probe set (the Telemetry office), a memory
 * policy, run metadata and the daily digest. The log carries numbers, hashes and identifiers only: a digest with a free-text string is refused. A signal without a consent that covers it is refused
 * (`signal_not_consented`). State lives in markers written inside the append. Nothing here reads or writes a reputation row.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import { ENTRY_KEY, MAX_RETENTION_DAYS, MIN_CALIBRATION_N, PROBE_NOTICE_MS, RESOLVERS, SIGNALS, merkleRoot, type Signal } from "./telemetry.ts";
import type { LogTx } from "./store.ts";

export const TELEMETRY_DID = "did:web:asp.local:telemetry";
const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
const getJson = async <T>(tx: Pick<LogTx, "getMarker">, key: string): Promise<T | undefined> => { const raw = await tx.getMarker(key); return raw ? (JSON.parse(raw) as T) : undefined; };
const SERVICE_MEMORY_LIMITS = { maxFiles: 200, maxBytes: 1_048_576, maxIndexLines: 200 };
/** A string in a digest is an identifier, an enum word or a hash, never prose. */
const IDENTIFIER = /^(sha256:[0-9a-f]{64}|[A-Za-z0-9_.:@+-]{1,64}|\d{4}-\d{2}-\d{2}(T[0-9:.]+Z)?)$/;

async function cosignedBy(tx: LogTx, r: AspRecord, did: string): Promise<boolean> {
  for (const c of r.cosigs ?? []) if ((await tx.getKey(c.kid))?.did === did) return true;
  return false;
}
const strings = (v: unknown, path = ""): { path: string; s: string }[] => typeof v === "string" ? [{ path, s: v }] : Array.isArray(v) ? v.flatMap((x, i) => strings(x, `${path}[${i}]`)) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => strings(x, `${path}.${k}`)) : [];

interface ConsentState { sponsor: string; agent: string; signals: string[]; purposes: string[]; from: string; until: string; revoked_at?: string }
interface ProbeState { version: number; issued_at: string; props: Record<string, string> }

export async function projectTelemetryAct(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as Record<string, any>;
  if (r.prev !== null) throw rule("telemetry_act_not_chained", "a telemetry act starts its own chain (prev is null)");
  const now = r.issued_at;

  if (b.act === "consent") {
    const passport = await tx.getPassport(b.agent);
    if (!passport?.sponsor || passport.sponsor !== b.sponsor) throw rule("consent_not_sponsor", `${b.sponsor} is not the sponsor in ${b.agent}'s passport`);
    if (r.issuer !== b.sponsor) throw rule("consent_not_sponsor", "the sponsor signs the consent");
    if (!(await cosignedBy(tx, r, b.agent))) throw rule("consent_needs_agent", "the agent countersigns the consent: it is told what is collected");
    if (b.retention_days > MAX_RETENTION_DAYS) throw rule("retention_too_long", `raw content is kept at most ${MAX_RETENTION_DAYS} days`);
    if (!(Date.parse(b.until) > Date.parse(b.from))) throw rule("consent_bad_dates", "a consent ends after it starts");
    if (!b.signals.length || !b.purposes.length) throw rule("consent_empty", "a consent names the signals and the purposes");
    if (b.revokes) {
      const old = await getJson<ConsentState>(tx, `tconsent:${b.revokes}`);
      if (!old || old.agent !== b.agent || old.sponsor !== b.sponsor) throw rule("consent_revokes_unknown", `${b.revokes} is not a consent of this sponsor for this agent`);
      await tx.putMarker(`tconsent:${b.revokes}`, JSON.stringify({ ...old, revoked_at: now }));
    }
    await tx.putMarker(`tconsent_ids:${b.agent}`, JSON.stringify([...(await getJson<string[]>(tx, `tconsent_ids:${b.agent}`) ?? []), r.id]));
    await tx.putMarker(`tconsent:${r.id}`, JSON.stringify({ sponsor: b.sponsor, agent: b.agent, signals: b.signals, purposes: b.purposes, from: b.from, until: b.until } satisfies ConsentState));
    return;
  }

  if (b.act === "probe_set") {
    if (r.issuer !== TELEMETRY_DID) throw rule("telemetry_wrong_issuer", `${r.issuer} is not the Telemetry office (${TELEMETRY_DID}): only it publishes a probe set`);
    const ids = b.propositions.map((p: { id: string }) => p.id);
    if (new Set(ids).size !== ids.length) throw rule("probe_duplicate_proposition", "a proposition id is used once");
    for (const p of b.propositions) {
      if (!(RESOLVERS as readonly string[]).includes(p.resolver.name)) throw rule("resolver_unknown", `${p.resolver.name} is not a registered resolver (${RESOLVERS.join(", ")})`);
      if (Date.parse(p.resolve_at) <= Date.parse(now)) throw rule("probe_resolves_in_past", "a proposition resolves after the probe set is published");
    }
    const last = Number((await tx.getMarker(`tprobe_last:${b.id}`)) ?? 0);
    if (b.version <= last) throw rule("probe_version_exists", `${b.id} already has version ${last}: a version is immutable`);
    if (b.version !== last + 1) throw rule("probe_version_skipped", `the next version of ${b.id} is ${last + 1}`);
    await tx.putMarker(`tprobe_last:${b.id}`, String(b.version));
    await tx.putMarker(`tprobe:${b.id}|${b.version}`, JSON.stringify({ version: b.version, issued_at: now, props: Object.fromEntries(b.propositions.map((p: { id: string; resolve_at: string }) => [p.id, p.resolve_at])) } satisfies ProbeState));
    return;
  }

  if (b.act === "memory_policy") {
    if (r.issuer !== b.agent) throw rule("policy_not_agents", "the agent signs its own memory policy");
    if (!(await tx.getPassport(b.agent))) throw rule("policy_no_passport", `${b.agent} has no passport`);
    for (const k of Object.keys(SERVICE_MEMORY_LIMITS) as (keyof typeof SERVICE_MEMORY_LIMITS)[]) if (b.budget[k] > SERVICE_MEMORY_LIMITS[k]) throw rule("policy_budget_over", `${k} is at most ${SERVICE_MEMORY_LIMITS[k]}`);
    const last = await getJson<{ id: string; version: number }>(tx, `tpolicy:${b.agent}`);
    if (b.version !== (last?.version ?? 0) + 1 || (b.previous ?? null) !== (last?.id ?? null)) throw rule("policy_version", `the next version is ${(last?.version ?? 0) + 1}, naming ${last?.id ?? "no earlier policy"}: a change is a new version, never an edit`);
    await tx.putMarker(`tpolicy:${b.agent}`, JSON.stringify({ id: r.id, version: b.version }));
    return;
  }

  if (b.act === "run_meta") {
    if (r.issuer !== b.agent) throw rule("run_meta_not_agents", "the agent signs its own run metadata");
    const run = await tx.getRecord(b.run);
    if (!run || run.record.type !== "asp.action/v0.2" || run.record.issuer !== b.agent) throw rule("run_meta_run_unknown", "the run is a signed Action of the agent");
    return;
  }

  // digest
  if (r.issuer !== b.agent && r.issuer !== TELEMETRY_DID) throw rule("digest_wrong_signer", "the agent (or its node) signs a digest; the Telemetry office signs derived entries");
  const consent = await getJson<ConsentState>(tx, `tconsent:${b.consent}`);
  if (!consent || consent.agent !== b.agent) throw rule("digest_consent_unknown", `${b.consent} is not a consent for ${b.agent}`);
  const dayStart = Date.parse(`${b.day}T00:00:00Z`), dayEnd = dayStart + 86_400_000;
  if (dayEnd <= Date.parse(consent.from) || dayStart >= Date.parse(consent.until)) throw rule("digest_outside_consent", "the day is outside the consent's dates");
  if (consent.revoked_at && dayStart >= Date.parse(consent.revoked_at)) throw rule("digest_after_revocation", "a revoked consent stops collection from its record onward");
  if (dayStart > Date.parse(now)) throw rule("digest_future", "a digest is for a day that has begun");
  if (await tx.getMarker(`tdigest:${b.agent}|${b.day}`)) throw rule("digest_duplicate", `${b.agent} already has a digest for ${b.day}`);
  const keyToSignal = Object.fromEntries(SIGNALS.map((s) => [ENTRY_KEY[s], s])) as Record<string, Signal>;
  for (const k of Object.keys(b.entries)) {
    const sig = keyToSignal[k];
    if (!sig) throw rule("digest_unknown_entry", `${k} is not one of the nine signals' entries`);
    if (!consent.signals.includes(sig)) throw rule("signal_not_consented", `the consent does not cover ${sig}: a signal nobody agreed to is never collected`);
    const n = Array.isArray(b.entries[k]) ? b.entries[k].length : 1;
    if ((b.counts[sig] ?? 0) !== n) throw rule("counts_mismatch", `counts says ${b.counts[sig] ?? 0} ${sig} entries and the digest holds ${n}`);
  }
  for (const sig of Object.keys(b.counts)) if (!(ENTRY_KEY[sig as Signal] in b.entries)) throw rule("counts_mismatch", `counts names ${sig} and the digest has no such entries`);
  for (const { path, s } of strings(b.entries)) if (!IDENTIFIER.test(s)) throw rule("free_text_in_digest", `entries${path} is prose: the log carries numbers, hashes and identifiers only (text stays on the sponsor's machine)`);
  const flat = Object.keys(b.entries).sort().flatMap((k) => (Array.isArray(b.entries[k]) ? b.entries[k] : [b.entries[k]]));
  if (merkleRoot(flat) !== b.merkle_root) throw rule("merkle_mismatch", "merkle_root is not the root of the day's entries");

  for (const belief of (b.entries.beliefs ?? []) as { probe_set: string; version: number; answers: Record<string, number> }[]) {
    const ps = await getJson<ProbeState>(tx, `tprobe:${belief.probe_set}|${belief.version}`);
    if (!ps) throw rule("probe_set_unknown", `${belief.probe_set} version ${belief.version} is not published`);
    if (Date.parse(ps.issued_at) + PROBE_NOTICE_MS > dayEnd) throw rule("probe_not_published", "a probe set is published at least 24 hours before its first use");
    for (const [id, p] of Object.entries(belief.answers)) {
      const resolveAt = ps.props[id];
      if (!resolveAt) throw rule("proposition_unknown", `${id} is not in the probe set`);
      if (!Number.isInteger(p) || p < 0 || p > 1000) throw rule("permille_out_of_range", `${id}: a probability is a whole number of permille from 0 to 1000`);
      if (Date.parse(resolveAt) <= dayStart) throw rule("belief_after_resolution", `${id} resolved at ${resolveAt}: a belief is taken before the answer is known`);
    }
  }
  const preds = (b.entries.predictions ?? []) as { committed_at?: string; action?: string; p: number }[];
  if (preds.length > 20) throw rule("prediction_cap", "at most 20 predictions a day");
  for (const p of preds) {
    if (!Number.isInteger(p.p) || p.p < 0 || p.p > 1000) throw rule("permille_out_of_range", "a prediction is a whole number of permille");
    if (p.action) {
      const a = await tx.getRecord(p.action);
      if (!a || a.record.type !== "asp.action/v0.2") throw rule("prediction_action_unknown", `${p.action} is not an Action in this log`);
      if (!p.committed_at || Date.parse(p.committed_at) >= Date.parse(a.record.issued_at)) throw rule("prediction_after_action", "a prediction is committed before the Action it is about");
    }
  }
  for (const cal of ([] as { n?: number; ece_milli?: number }[]).concat(b.entries.calibration ?? [])) if (cal.ece_milli !== undefined && (cal.n ?? 0) < MIN_CALIBRATION_N) throw rule("insufficient_n", `ECE and the trend are shown only over ${MIN_CALIBRATION_N} resolved items`);
  await tx.putMarker(`tdigest:${b.agent}|${b.day}`, r.id);
}

/**
 * The Mandate's `telemetry` field (instrumentation.md 7, register row DK195, S342): a Mandate may list a signal only if the agent has a live consent (sponsor-signed, agent-countersigned, in date, not revoked)
 * that names it and the purposes. A Mandate with no `telemetry` field says nothing is collected: the gateway reads no signal for it.
 */
export async function checkMandateTelemetry(tx: LogTx, r: AspRecord): Promise<void> {
  const t = (r.body as { telemetry?: { signals: string[]; purposes: string[]; retention_days: number } }).telemetry;
  if (!t) return;
  if (t.retention_days > MAX_RETENTION_DAYS) throw rule("retention_too_long", `raw content is kept at most ${MAX_RETENTION_DAYS} days`);
  const ids = (await getJson<string[]>(tx, `tconsent_ids:${r.subject}`)) ?? [];
  const live: ConsentState[] = [];
  for (const id of ids) {
    const c = await getJson<ConsentState>(tx, `tconsent:${id}`);
    if (c && !c.revoked_at && Date.parse(c.from) <= Date.parse(r.issued_at) && Date.parse(r.issued_at) < Date.parse(c.until)) live.push(c);
  }
  for (const s of t.signals) if (!live.some((c) => c.signals.includes(s))) throw rule("telemetry_signal_not_consented", `the signal ${s} is not in a live consent for ${r.subject}: the sponsor signs it and the agent countersigns it first (asp telemetry consent)`);
  for (const p of t.purposes) if (!live.some((c) => c.purposes.includes(p))) throw rule("telemetry_purpose_not_consented", `the purpose ${p} is not in a live consent for ${r.subject}`);
}
