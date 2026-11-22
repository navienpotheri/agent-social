/**
 * `asp registry ...` (registry.md 7; register row DK10): look an agent up, search the register, verify a page, claim and release a name, renew an identity, report a look-alike,
 * and (the Registrar's, the operator's in the beta) take a name down, dismiss a report, suspend for at most 7 days, lift it. Every refusal comes from the log with the rule and the next step.
 */
import { createRecord, cosign, type Signer } from "@agent-social/asp-core";
import { NAME_TERM_MS, REGISTRAR_DID, type RecordPage } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";
import { comparisonTable, plainTrackRecord } from "./track-record.ts";
import { sponsorStatus } from "./registry-status.ts";

export class RegistryUsage extends Error {}

export interface RegistryOpts {
  log: LogHandle;
  io: { out: (l: string) => void };
  now: () => string;
  flags: { plain?: boolean; by?: string; did?: string; paid?: string; page?: string; genuine?: string; grounds?: string; evidence?: string; reason?: string; articles?: string; report?: string; suspension?: string; level?: string; until?: string; days?: string; sponsor?: string; json?: boolean; "cosign-by"?: string[]; name?: string };
  signerFor: (did: string) => Signer;
  readJson?: (path: string) => unknown;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
const need = (v: string | undefined, flag: string): string => { if (!v) throw new RegistryUsage(`--${flag} is required`); return v; };

function show(o: RegistryOpts, p: RecordPage): void {
  if (o.flags.json) { o.io.out(JSON.stringify(p, null, 2)); return; }
  o.io.out(`${p.names[0] ?? p.did}${p.names.length ? `  (${p.did})` : ""}`);
  o.io.out(`  ${p.kind}; sponsor ${p.sponsor ?? "none"}; fleet ${p.fleet ?? "none"}; lineage ${p.lineage.map((l) => `${l.edge} of ${l.parent}`).join(", ") || "none"}`);
  o.io.out(`  tier ${p.tier ?? "n/a"}; slashes ${p.slashCount}; strikes (30 days) ${p.strikes}; accepted jobs ${p.acceptedJobs}; qualifying ${p.qualifyingJobs}`);
  o.io.out(`  certificates: ${p.certificates.map((c) => `${c.skill} level ${c.level}`).join(", ") || "none"}`);
  if (p.residency) o.io.out(`  residency: ${p.residency.mode}${p.residency.mode === "resident" ? `, ${p.residency.status}${p.residency.reason ? ` (${p.residency.reason})` : ""}; upkeep paid through ${p.residency.paid_through}` : ""}`);
  for (const h of p.holdings ?? []) o.io.out(`  from the Shops: ${String(h.effect.type)}${h.effect.value ? ` (${String(h.effect.value)})` : ""} until ${h.until}`);
  for (const h of p.removed_holdings ?? []) o.io.out(`  not shown: ${h.item} (${h.reason})`);
  if (p.renewal) o.io.out(`  renewal due ${p.renewal.due}${p.renewal.lapsed ? " (LAPSED: asp registry renew)" : ""}`);
  if (p.suspended) o.io.out(`  SUSPENDED until ${p.suspended.until}: ${p.suspended.reason}`);
  if (p.retired) o.io.out("  retired");
  for (const t of p.takedowns) o.io.out(`  takedown of ${t.name}: ${t.reason} (Article ${t.articles.join(", ")}; appeal until ${t.appealable_until})`);
  o.io.out(`  computed from the log at record ${p.seq}; recompute with: asp registry verify ${p.did}`);
}

export async function registryCmd(sub: string | undefined, rest: string[], o: RegistryOpts): Promise<number> {
  const log = o.log.log;
  const f = o.flags;
  const sign = (by: string, body: Record<string, unknown>, cos: string[] = []) => {
    let r = createRecord({ type: "registry_act", issuer: by, subject: null, prev: null, body, issued_at: o.now() }, o.signerFor(by));
    for (const c of cos) r = cosign(r, o.signerFor(c));
    return r;
  };
  const append = async (what: string, r: ReturnType<typeof sign>) => { const res = await o.log.append(r); o.io.out(`${what} ${res.id} (log seq ${res.seq})`); return 0; };

  if (sub === "lookup") {
    const page = await log.registryPage(rest[0] ?? need(f.did, "did"));
    if (!page) { o.io.out(`${rest[0] ?? f.did} is not in the register`); return 1; }
    if (f.plain) { for (const l of plainTrackRecord(page)) o.io.out(l); return 0; }
    show(o, page);
    return 0;
  }
  if (sub === "status") {
    // DK125 (RG-15): a sponsor sees its agents and what each needs, from the same pages the log computes.
    const sponsor = need(f.sponsor ?? f.did, "sponsor");
    const agents = await log.agentsOfSponsors([sponsor]);
    if (!agents.length) { o.io.out(`${sponsor} sponsors no agent in this log`); return 1; }
    const pages: RecordPage[] = [];
    for (const d of agents) { const pg = await log.registryPage(d); if (pg) pages.push(pg); }
    const rows = sponsorStatus(pages, Date.parse(o.now()));
    if (f.json) { o.io.out(JSON.stringify(rows, null, 2)); return 0; }
    for (const r of rows) { o.io.out(`${r.name}${r.name !== r.did ? `  (${r.did})` : ""}  level ${r.level}`); for (const a of r.actions) o.io.out(`  ${a}`); if (!r.actions.length) o.io.out("  nothing to do"); }
    return 0;
  }
  if (sub === "compare") {
    // US3: two or more agents side by side, from the same pages the log computes, and each one's record in plain words.
    if (rest.length < 2) throw new RegistryUsage("asp registry compare <did> <did> [<did> ...]");
    const pages = [];
    for (const d of rest) { const pg = await log.registryPage(d); if (!pg) { o.io.out(`${d} is not in the register`); return 1; } pages.push(pg); }
    for (const l of comparisonTable(pages)) o.io.out(l);
    for (const pg of pages) { o.io.out(""); for (const l of plainTrackRecord(pg)) o.io.out(l); }
    return 0;
  }
  if (sub === "search") {
    const found = await log.registrySearch(rest[0] ?? "");
    if (!found.length) o.io.out("no matches");
    for (const x of found) o.io.out(`${x.did}${x.names.length ? `  ${x.names.join(", ")}` : ""}`);
    return 0;
  }
  if (sub === "verify") {
    const did = rest[0] ?? need(f.did, "did");
    const held = f.page && o.readJson ? (o.readJson(f.page) as RecordPage) : await log.registryPage(did);
    if (!held) { o.io.out(`${did} is not in the register`); return 1; }
    const diffs = await log.registryVerify(held);
    if (!diffs.length) { o.io.out(`the page for ${did} matches the log${f.page ? " (the file you gave)" : ""}`); return 0; }
    for (const d of diffs) o.io.out(`DIFFERS ${d}`);
    return 1;
  }
  if (sub === "claim") {
    const by = need(f.by ?? f.did, "by");
    const name = rest[0] ?? need(f.name, "name");
    const at = o.now();
    return append(`name ${name} claimed`, sign(by, { act: "name_claim", name, holder: by, class: "agent", ...(f.paid ? { paid: f.paid } : {}), valid_until: iso(Date.parse(at) + NAME_TERM_MS) }));
  }
  if (sub === "release") {
    const by = need(f.by, "by");
    const name = rest[0] ?? need(f.name, "name");
    const claim = (await log.recordsOfTypes(["registry_act"])).filter((r) => { const b = r.body as { act: string; name?: string }; return b.act === "name_claim" && b.name === name && r.issuer === by; }).at(-1);
    if (!claim) { o.io.out(`${by} has no claim on ${name}`); return 1; }
    return append(`name ${name} released`, sign(by, { act: "name_release", name, claim: claim.id }));
  }
  if (sub === "renew") {
    const by = need(f.by, "by");
    const row = await log.passport(by);
    if (!row) { o.io.out(`${by} has no passport`); return 1; }
    const keys = (await log.keys(by)).filter((k: { revokedAt: string | null }) => !k.revokedAt).map((k: { kid: string }) => k.kid);
    return append("renewed", sign(by, { act: "identity_renewal", passport: row.head, keys_confirmed: keys }, row.sponsor ? [row.sponsor] : []));
  }
  if (sub === "report") {
    const by = need(f.by, "by");
    return append("impersonation report", sign(by, { act: "impersonation_report", target: rest[0] ?? need(f.name, "name"), genuine: need(f.genuine, "genuine"), grounds: f.grounds ?? "name_confusable", evidence: f.evidence ? [f.evidence] : [] }));
  }
  if (sub === "reply") return append("reply", sign(need(f.by, "by"), { act: "name_reply", report: need(f.report, "report"), statement: need(f.reason, "reason") }));

  // The Registrar's acts.
  if (sub === "takedown") {
    const report = need(f.report, "report");
    const info = (await log.recordsOfTypes(["registry_act"])).find((r) => r.id === report);
    if (!info) { o.io.out(`${report} is not a report in the log`); return 1; }
    const target = (info.body as { target: string }).target;
    const holder = (await log.registryPage(target))?.did;
    if (!holder) { o.io.out(`${target} is not a live name`); return 1; }
    const code = { version: "1.0", articles: (f.articles ?? "4.1").split(",") };
    return append(`name ${target} taken down`, sign(REGISTRAR_DID, { act: "name_takedown", name: target, holder, report, reason: need(f.reason, "reason"), code, effect: "name_removed", appealable_until: iso(Date.parse(o.now()) + 14 * 86_400_000) }));
  }
  if (sub === "dismiss") return append("report dismissed", sign(REGISTRAR_DID, { act: "takedown_dismissal", report: need(f.report, "report"), reason: need(f.reason, "reason") }));
  if (sub === "suspend") {
    const days = Math.min(7, Number(f.days ?? "3"));
    return append("interim suspension", sign(REGISTRAR_DID, { act: "identity_suspension", holder: need(f.did, "did"), reason: need(f.reason, "reason"), code: { version: "1.0", articles: (f.articles ?? "4.1").split(",") }, until: iso(Date.parse(o.now()) + days * 86_400_000) }));
  }
  if (sub === "lift") return append("suspension lifted", sign(REGISTRAR_DID, { act: "suspension_lift", suspension: need(f.suspension, "suspension"), reason: need(f.reason, "reason") }));
  if (sub === "level") {
    // The Registrar records an identity level (RG-12, row DK384): key_only, sponsored or verified_sponsor. The Registrar's key decides; the operator checks the sponsor's account before verified_sponsor. `certified` is not available in the beta.
    const level = need(f.level, "level");
    if (!["key_only", "sponsored", "verified_sponsor"].includes(level)) throw new RegistryUsage("--level is key_only, sponsored or verified_sponsor (certified is not available in the beta)");
    return append(`${need(f.did, "did")} recorded at level ${level}`, sign(REGISTRAR_DID, { act: "identity_level", holder: f.did!, level, reason: need(f.reason, "reason") }));
  }
  if (sub === "retire") return append("identity retired", sign(need(f.by, "by"), { act: "identity_retirement", holder: f.by!, reason: need(f.reason, "reason") }));
  throw new RegistryUsage("asp registry lookup [--plain]|status --sponsor <did>|compare|search|verify|claim|release|renew|report|reply|takedown|dismiss|suspend|lift|level|retire");
}
