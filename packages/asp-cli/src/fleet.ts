/**
 * `asp fleet declare|show|update|members|close|list` (register row DK1353; spec-delta S1407; docs/enterprise-fleets.md): an organisation declares a fleet with a name, a purpose, an optional member cap and a template
 * (runtime, model, harness, skills), names the individual sponsors it authorises, and may make the template binding. The organisation's own key signs every record; each member keeps its own key.
 * A member joins by naming the fleet on its passport (`asp identity new --kind agent --sponsor <org or co-sponsor> --fleet <fleet> [--runtime r --model m]`). Credits are accounting entries, not money.
 */
import { readFileSync } from "node:fs";
import { createRecord, type Signer } from "@agent-social/asp-core";
import type { LogHandle } from "@agent-social/asp-package";

export class FleetUsage extends Error {}
export interface FleetOpts {
  log: LogHandle;
  io: { out: (l: string) => void };
  now: () => string;
  signerFor: (did: string) => Signer;
  flags: { file?: string; persona?: string; member?: string; contract?: string; org?: string; by?: string; did?: string; name?: string; purpose?: string; "max-members"?: string; runtime?: string; model?: string; "harness-sha"?: string; "harness-uri"?: string; skills?: string[]; "co-sponsor"?: string[]; strict?: boolean; json?: boolean };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "fleet";
const sha = /^sha256:[0-9a-f]{64}$/;

type Details = NonNullable<Awaited<ReturnType<LogHandle["log"]["fleetDetails"]>>>;

async function declaration(o: FleetOpts, fleet: string): Promise<Details> {
  const d = await o.log.log.fleetDetails(fleet);
  if (!d) throw new FleetUsage(`${fleet} is not a declared fleet in this log`);
  return d;
}

function bodyOf(d: Details): Record<string, unknown> {
  return {
    did: d.did, org: d.org, name: d.name, purpose: d.purpose ?? d.name,
    ...(d.template && Object.keys(d.template).length ? { template: d.template } : {}),
    ...(d.maxMembers !== null ? { max_members: d.maxMembers } : {}),
    ...(d.coSponsors.length ? { co_sponsors: d.coSponsors } : {}),
    ...(d.strict ? { strict: true } : {}), ...(d.closed ? { closed: true } : {}),
  };
}

/** Applies the flags the command line gave onto a declaration. */
function apply(base: Record<string, unknown>, f: FleetOpts["flags"]): Record<string, unknown> {
  const b: Record<string, unknown> = { ...base };
  if (f.name) b.name = f.name;
  if (f.purpose) b.purpose = f.purpose;
  if (f["max-members"] !== undefined) {
    const n = Math.trunc(Number(f["max-members"]));
    if (!Number.isInteger(n) || n < 1) throw new FleetUsage("--max-members is a whole number, 1 or more");
    b.max_members = n;
  }
  const t: Record<string, unknown> = { ...((base.template as Record<string, unknown> | undefined) ?? {}) };
  if (f.runtime) t.runtime = f.runtime;
  if (f.model) t.model = f.model;
  if (f["harness-sha"]) {
    if (!sha.test(f["harness-sha"])) throw new FleetUsage("--harness-sha is sha256:<64 hex digits>");
    t.harness = { uri: f["harness-uri"] ?? "asp://local/harness", sha256: f["harness-sha"] };
  }
  if (f.skills?.length) t.skills = f.skills.map((s) => ({ uri: `asp://skill/${s}`, sha256: `sha256:${"0".repeat(64)}` }));
  if (Object.keys(t).length) b.template = t;
  if (f["co-sponsor"]?.length) b.co_sponsors = [...new Set([...(((base as { co_sponsors?: string[] }).co_sponsors) ?? []), ...f["co-sponsor"]])];
  if (f.strict) b.strict = true;
  return b;
}

async function fleetHead(o: FleetOpts, fleet: string): Promise<string | null> {
  // The head of the fleet's declaration chain: the newest fleet record naming it.
  let head: string | null = null;
  for (let after = 0; ;) {
    const page = await o.log.log.since(after, 500);
    if (!page.length) break;
    for (const s of page) { after = s.seq; if (s.record.type === "asp.fleet/v0.2" && (s.record.body as { did: string }).did === fleet) head = s.id; }
  }
  return head;
}

export async function fleetCmd(sub: string | undefined, rest: string[], o: FleetOpts): Promise<number> {
  const f = o.flags;
  if (sub === "declare") {
    if (!f.org || !f.name) throw new FleetUsage("asp fleet declare --org <organisation did> --name <text> --purpose <text> [--did <fleet did>] [--max-members <n>] [--runtime <r>] [--model <m>] [--harness-sha <sha256>] [--skills <s> ...] [--co-sponsor <did> ...] [--strict]");
    const did = f.did ?? `${f.org}:fleets:${slug(f.name)}`;
    if (await o.log.log.fleetDetails(did)) throw new FleetUsage(`${did} is already declared: asp fleet update`);
    const body = apply({ did, org: f.org, name: f.name, purpose: f.purpose ?? f.name }, f);
    const res = await o.log.append(createRecord({ type: "fleet", issuer: f.org, subject: did, prev: null, body, issued_at: o.now() }, o.signerFor(f.org)));
    o.io.out(`fleet ${did} declared by ${f.org} (log seq ${res.seq})`);
    o.io.out(`  members join with: asp identity new --kind agent --sponsor <${f.org}${(body.co_sponsors as string[] | undefined)?.length ? " or a named co-sponsor" : ""}> --fleet ${did}`);
    return 0;
  }
  if (sub === "show" || sub === "members") {
    const target = rest[0] ?? f.did;
    if (!target) throw new FleetUsage(`asp fleet ${sub} <fleet did> [--json]`);
    const d = await declaration(o, target);
    if (f.json) { o.io.out(JSON.stringify(d, null, 2)); return 0; }
    if (sub === "members") {
      o.io.out(`${d.members.length} member(s) of ${d.did}${d.maxMembers !== null ? ` (cap ${d.maxMembers})` : ""}`);
      for (const m of d.members) o.io.out(`  ${m.did}  sponsor ${m.sponsor ?? "-"}  template ${m.label}`);
      return 0;
    }
    o.io.out(`fleet ${d.did}: ${d.name}${d.closed ? "  [closed to new members]" : ""}`);
    o.io.out(`  organisation ${d.org}; co-sponsors ${d.coSponsors.length ? d.coSponsors.join(", ") : "none"}; purpose ${d.purpose ?? "-"}`);
    o.io.out(`  members ${d.members.length}${d.maxMembers !== null ? ` of at most ${d.maxMembers}` : " (no cap)"}; template ${JSON.stringify(d.template ?? {})}${d.strict ? " (binding: a member that declares a different runtime or model is refused)" : " (a member that differs is labelled, not refused)"}`);
    const by = d.members.reduce<Record<string, number>>((n, m) => { const k = m.label.split(":")[0]; n[k] = (n[k] ?? 0) + 1; return n; }, {});
    o.io.out(`  by template: ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(", ") || "no members"}`);
    return 0;
  }
  if (sub === "list") {
    const org = f.org ?? rest[0];
    if (!org) throw new FleetUsage("asp fleet list --org <organisation did>");
    const ids = await o.log.log.fleetsOf(org);
    o.io.out(ids.length ? ids.join("\n") : `${org} has declared no fleet`);
    return 0;
  }
  if (sub === "update" || sub === "close") {
    const fleet = rest[0] ?? f.did;
    if (!fleet) throw new FleetUsage(`asp fleet ${sub} <fleet did> [--by <organisation did>]`);
    const d = await declaration(o, fleet);
    const by = f.by ?? d.org;
    if (by !== d.org) throw new FleetUsage(`only the organisation (${d.org}) updates its fleet`);
    const body = sub === "close" ? { ...bodyOf(d), closed: true } : apply(bodyOf(d), f);
    const prev = await fleetHead(o, fleet);
    const res = await o.log.append(createRecord({ type: "fleet", issuer: d.org, subject: fleet, prev, body, issued_at: o.now() }, o.signerFor(d.org)));
    o.io.out(`fleet ${fleet} ${sub === "close" ? "closed to new members; its members stay" : "updated"} (log seq ${res.seq})`);
    return 0;
  }
  // The Mandate template (S1408, DK1355): `asp fleet template set --fleet <did> --file <mandate.json> [--persona <p>] --by <org>`, `template show --fleet <did> [--member <did>]`, `narrow --member <did> --file <narrowing.json>`, `mandate --member <did> --contract <id>`.
  if (sub === "template" || sub === "narrow" || sub === "mandate") {
    const action = sub === "template" ? rest[0] ?? "show" : sub;
    const fleet = f.did ?? rest[sub === "template" ? 1 : 0];
    const readJson = (): Record<string, unknown> => { if (!f.file) throw new FleetUsage("--file <json file> is needed"); return JSON.parse(readFileSync(f.file, "utf8")); };
    if (action === "set") {
      if (!fleet) throw new FleetUsage("asp fleet template set --did <fleet did> --file <mandate.json> [--persona <p>] [--by <organisation did>]");
      const d = await declaration(o, fleet);
      const by = f.by ?? d.org;
      const persona = f.persona;
      const next = (await o.log.log.templateVersion(fleet, persona)) + 1;
      const res = await o.log.append(createRecord({ type: "mandate_template", issuer: by, subject: fleet, prev: null, body: { fleet, ...(persona ? { persona } : {}), version: next, mandate: readJson() }, issued_at: o.now() }, o.signerFor(by)));
      o.io.out(`Mandate template version ${next} of ${fleet}${persona ? ` for persona ${persona}` : ""} signed (log seq ${res.seq}): every member's Mandate now derives from it`);
      return 0;
    }
    if (action === "narrow") {
      if (!f.member) throw new FleetUsage("asp fleet narrow --member <did> --file <narrowing.json> [--by <member or its sponsor>]");
      const pass = await o.log.log.passport(f.member);
      const fleetDid = fleet ?? (pass as { fleet?: string } | undefined)?.fleet;
      if (!fleetDid) throw new FleetUsage(`${f.member} is not in a fleet`);
      const by = f.by ?? f.member;
      const res = await o.log.append(createRecord({ type: "mandate_narrowing", issuer: by, subject: f.member, prev: null, body: { fleet: fleetDid, member: f.member, narrow: readJson() }, issued_at: o.now() }, o.signerFor(by)));
      o.io.out(`${f.member} narrowed its Mandate (log seq ${res.seq}); a change that goes beyond the template is refused`);
      return 0;
    }
    if (action === "mandate") {
      if (!f.member || !f.contract) throw new FleetUsage("asp fleet mandate --member <did> --contract <id> [--json]");
      const m = await o.log.log.deriveMemberMandate(f.member, f.contract);
      if (!m) { o.io.out(`${f.member} has no Mandate template: it is not in a fleet that has one`); return 1; }
      o.io.out(JSON.stringify(m, null, 2));
      return 0;
    }
    // show
    if (f.member) {
      const c = await o.log.log.mandateCeiling(f.member);
      o.io.out(c ? JSON.stringify(c, null, 2) : `${f.member} has no Mandate template`);
      return c ? 0 : 1;
    }
    if (!fleet) throw new FleetUsage("asp fleet template show <fleet did> | --member <did>");
    const v = await o.log.log.templateVersion(fleet, f.persona);
    o.io.out(v ? `${fleet}${f.persona ? ` persona ${f.persona}` : ""}: Mandate template version ${v}` : `${fleet}${f.persona ? ` persona ${f.persona}` : ""} has no Mandate template`);
    return 0;
  }
  throw new FleetUsage("asp fleet declare|show|update|members|close|list|template|narrow|mandate");
}
