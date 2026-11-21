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
  flags: { window?: string; multiple?: string; halt?: boolean; association?: string; action?: string; node?: string; kind?: string; parent?: string; to?: string; owner?: string; credits?: string; tokens?: string; reason?: string; at?: string; file?: string; persona?: string; member?: string; contract?: string; org?: string; by?: string; did?: string; name?: string; purpose?: string; "max-members"?: string; runtime?: string; model?: string; "harness-sha"?: string; "harness-uri"?: string; skills?: string[]; "co-sponsor"?: string[]; strict?: boolean; json?: boolean };
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
    ...(d.strict ? { strict: true } : {}), ...(d.closed ? { closed: true } : {}), ...(d.association !== "full" ? { association: d.association } : {}),
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
  if (f.association) {
    const a = f.association.replace(/-/g, "_");
    if (!["full", "related_party_only", "private"].includes(a)) throw new FleetUsage("--association is full, related-party-only or private");
    b.association = a;
  }
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
    o.io.out(`  association with the society: ${d.association.replace(/_/g, "-")}${d.association === "full" ? "" : " (its agents offer only to their own sponsor, fleet or controller" + (d.association === "private" ? " and are not shown in discovery" : "") + "; standing is computed the same way for the same acts)"}`);
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
  // Template-level reputation (S1412, DK1366): `asp fleet standing --member <did> [--json]`: the member's fleet, persona, node and template, and the standing of every agent with the same template in its fleet and in the society.
  if (sub === "standing") {
    if (!f.member) throw new FleetUsage("asp fleet standing --member <did> [--json]");
    const i = await o.log.log.fleetInfoOf(f.member);
    if (!i) { o.io.out(`${f.member} is not in a fleet`); return 1; }
    if (f.json) { o.io.out(JSON.stringify(i, null, 2)); return 0; }
    const line = (s: typeof i.inFleet) => `${s.agents} agent(s), ${s.qualifyingJobs} counted job(s), ${s.slashes} slash(es), ${s.strikes} strike(s), ${s.relatedPartyRuns} related-party run(s) (labelled, not jobs)`;
    o.io.out(`${f.member}: fleet ${i.name} (${i.kind}), persona ${i.persona ?? "none"}, node ${i.node ?? "root"}, association ${i.association}`);
    o.io.out(`  template ${i.template.runtime ?? "?"} / ${i.template.model ?? "?"} (${i.template.source}, ${i.template.key})`);
    o.io.out(`  same template in this fleet: ${line(i.inFleet)}`);
    o.io.out(`  same template in the society: ${line(i.inSociety)}`);
    return 0;
  }
  // Related-party record (S1411, DK1358): `asp fleet attest --member <did> --action <Action id> [--by <sponsor>]`, `asp fleet record --member <did> [--json]`; the association is `asp fleet update <fleet> --association full|related-party-only|private`.
  if (sub === "attest") {
    if (!f.member || !f.action) throw new FleetUsage("asp fleet attest --member <did> --action <Action id> [--by <sponsor, organisation or co-sponsor did>]");
    const pass = (await o.log.log.passport(f.member)) as { sponsor?: string | null } | undefined;
    const by = f.by ?? pass?.sponsor ?? undefined;
    if (!by) throw new FleetUsage(`${f.member} has no sponsor to attest its runs`);
    const res = await o.log.append(createRecord({ type: "related_party_attestation", issuer: by, subject: f.member, prev: null, body: { agent: f.member, action: f.action }, issued_at: o.now() }, o.signerFor(by)));
    o.io.out(`run ${f.action} attested as a clean related-party run of ${f.member} (log seq ${res.seq}); it never counts as an independent job and earns no credit`);
    return 0;
  }
  if (sub === "record") {
    if (!f.member) throw new FleetUsage("asp fleet record --member <did> [--json]");
    const r = await o.log.log.relatedPartyRecord(f.member);
    if (f.json) { o.io.out(JSON.stringify(r, null, 2)); return 0; }
    o.io.out(`related-party record of ${f.member}: ${r.cleanRuns} clean attested run(s) since ${r.lastBreach ?? "the start"}, ${r.equivalentJobs} job(s) at ${r.runsPerJob} runs a job; association ${r.association}. Labelled related-party; never mixed with independent jobs; no credit reward`);
    return 0;
  }
  // The fleet breaker (S1423, DK1477): `asp fleet breaker --did <fleet> [--node <id>] [--window <seconds>] [--multiple <n>] [--halt-runs --by <organisation did>]`: what a node's members used in the window against its budget prorated, and agent-to-agent cycles; `--halt-runs` signs a run_halt for each running contract it names.
  if (sub === "breaker") {
    const fleet = f.did ?? rest[0];
    if (!fleet) throw new FleetUsage("asp fleet breaker --did <fleet did> [--node <id>] [--window <seconds>] [--multiple <n>] [--halt-runs --by <organisation did>]");
    const d = await declaration(o, fleet);
    const windowMs = f.window === undefined ? 3_600_000 : Number(f.window) * 1000, multiple = f.multiple === undefined ? 4 : Number(f.multiple);
    if (!(windowMs >= 1000) || !(multiple >= 1)) throw new FleetUsage("--window is seconds (1 or more) and --multiple is 1 or more");
    const r = await o.log.log.fleetBreaker(fleet, { ...(f.node ? { node: f.node } : {}), at: o.now(), windowMs, multiple });
    o.io.out(`node ${r.node}: in ${windowMs / 1000} s its members used ${r.used.tokens} token(s) and ${r.used.credits} credit(s); allowed at ${multiple}x its budget's pace: ${r.allowed.tokens ?? "no token budget"} token(s), ${r.allowed.credits ?? "no credit budget"} credit(s)`);
    for (const x of r.reasons) o.io.out(`  TRIPPED  ${x}`);
    for (const c of r.cycles) o.io.out(`  CYCLE    ${c.agents.join(" -> ")} -> ${c.agents[0]} (${c.contracts.length} contract(s))`);
    if (!r.reasons.length && !r.cycles.length) o.io.out("  nothing tripped: no spiral and no cycle");
    if (!f.halt) return r.reasons.length || r.cycles.length ? 1 : 0;
    const by = f.by ?? d.org;
    const targets = [...r.contracts.map((c) => ({ ...c, reason: "fleet_spend" as const, detail: r.reasons.join("; ") })), ...r.cycles.flatMap((c) => c.contracts.map((ct) => ({ contract: ct, agent: "", reason: "cycle" as const, detail: `an agent-to-agent cycle: ${c.agents.join(" -> ")} -> ${c.agents[0]}` })))];
    let n = 0;
    for (const t of targets) {
      const contract = await o.log.log.get(t.contract);
      const agent = t.agent || (contract?.record.body as { performer?: string } | undefined)?.performer;
      if (!agent || (await o.log.log.runHaltOf(t.contract))) continue;
      await o.log.append(createRecord({ type: "run_halt", issuer: by, subject: t.contract, prev: null, body: { contract: t.contract, agent, reason: t.reason, detail: t.detail, ...(t.reason === "fleet_spend" ? { node: r.node } : {}) }, issued_at: o.now() }, o.signerFor(by)));
      n++;
    }
    o.io.out(`${n} run(s) halted by a signed record; a halted run buys nothing more`);
    return 0;
  }
  // The fleet tree (S1409, DK1372): `asp fleet node set --did <fleet> --node <id> --kind <fleet|department|team|persona> --name <text> [--parent <id>] --owner <did> [--credits <n>] [--tokens <n>] [--file <mandate.json>] [--persona <p>] [--by <org>]`,
  // `asp fleet move --did <fleet> --member <did> --to <node> [--by <org, node owner or sponsor>] [--reason <text>]`, `asp fleet tree <fleet> [--month <YYYY-MM-DD>] [--json]`.
  if (sub === "node") {
    const fleet = f.did ?? rest[1];
    if (rest[0] !== "set" || !fleet || !f.node || !f.kind || !f.name) throw new FleetUsage("asp fleet node set --did <fleet did> --node <id> --kind <fleet|department|team|persona> --name <text> [--parent <id>] --owner <did> [--credits <n>] [--tokens <n>] [--file <mandate.json>] [--persona <p>] [--by <organisation did>]");
    const d = await declaration(o, fleet);
    const by = f.by ?? d.org;
    const owner = f.owner ?? d.org;
    const budget: Record<string, number> = {};
    for (const k of ["credits", "tokens"] as const) if (f[k] !== undefined) { const n = Number(f[k]); if (!Number.isInteger(n) || n < 0) throw new FleetUsage(`--${k} is a whole number, 0 or more`); budget[k] = n; }
    const tree = await o.log.log.fleetTree(fleet);
    const before = tree?.nodes.find((n) => n.node === f.node && n.version > 0);
    const version = (before?.version ?? 0) + 1;
    const body = { fleet, node: f.node, version, kind: f.kind, name: f.name, ...(f.parent ? { parent: f.parent } : {}), owner, ...(f.persona ? { persona: f.persona } : {}), ...(Object.keys(budget).length ? { budget } : {}), ...(f.file ? { mandate: JSON.parse(readFileSync(f.file, "utf8")) } : {}) };
    const res = await o.log.append(createRecord({ type: "fleet_node", issuer: by, subject: fleet, prev: null, body, issued_at: o.now() }, o.signerFor(by)));
    o.io.out(`node ${f.node} (${f.kind}${f.parent ? ` under ${f.parent}` : ""}) of ${fleet}, version ${version}, signed (log seq ${res.seq}); a child's Mandate may only narrow its parent's and a budget stays within its parent's`);
    return 0;
  }
  if (sub === "move") {
    const fleet = f.did ?? rest[0];
    if (!fleet || !f.member || !f.to) throw new FleetUsage("asp fleet move --did <fleet did> --member <did> --to <node> [--by <organisation, node owner or sponsor did>] [--reason <text>]");
    const d = await declaration(o, fleet);
    const by = f.by ?? d.org;
    const res = await o.log.append(createRecord({ type: "fleet_move", issuer: by, subject: f.member, prev: null, body: { fleet, member: f.member, to: f.to, ...(f.reason ? { reason: f.reason } : {}) }, issued_at: o.now() }, o.signerFor(by)));
    o.io.out(`${f.member} moved to node ${f.to} of ${fleet} (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "tree") {
    const fleet = rest[0] ?? f.did;
    if (!fleet) throw new FleetUsage("asp fleet tree <fleet did> [--month <YYYY-MM-DD>] [--json]");
    await declaration(o, fleet);
    const t = await o.log.log.fleetTree(fleet, f.at ? `${f.at.slice(0, 10)}T00:00:00Z` : undefined);
    if (!t) throw new FleetUsage(`${fleet} is not a declared fleet in this log`);
    if (f.json) { o.io.out(JSON.stringify(t, null, 2)); return 0; }
    o.io.out(`fleet ${fleet}: ${t.members} member(s), ${t.nodes.filter((n) => n.version > 0).length} node(s), ${t.moves} move(s); usage for ${t.month}`);
    for (const n of t.nodes) {
      const cr = n.usage.credits, tk = n.usage.tokens;
      const parts = [`${n.members} here, ${n.subtreeMembers} below and here`, cr.budget !== null ? `credits ${cr.spent}/${cr.budget}` : `credits ${cr.spent}`, tk.budget !== null ? `tokens ${tk.used}/${tk.budget}${tk.over ? " OVER" : ""}` : `tokens ${tk.used}`, n.mandate ? "Mandate set" : "Mandate inherited", ...(n.halt ? [`HALTED (${n.halt.reason}, ${n.halt.at})`] : []), ...(n.version ? [`owner ${n.owner}`] : [])];
      o.io.out(`${"  ".repeat(n.depth + 1)}${n.node} [${n.kind}] ${n.version ? n.name : "(not declared: members sit here by default)"}  ${parts.join("; ")}`);
    }
    return 0;
  }
  throw new FleetUsage("asp fleet declare|show|update|members|close|list|template|narrow|mandate|node|move|tree|attest|record|standing|breaker");
}
