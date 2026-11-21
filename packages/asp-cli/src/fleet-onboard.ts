/**
 * Guided fleet onboarding (DK1371, docs/enterprise-fleets.md): `asp fleet blueprints | init | import | apply | rollback | checklist`, beside `asp fleet plan | enrol | join | status` (fleet-enrol.ts).
 *   blueprints  the library of ready personas and of skill packs (fleet-blueprints.ts)
 *   init        a few answers (sponsor, fleet name, purpose, personas as blueprint:count) write a manifest
 *   import      a manifest from a CSV or TSV (a spreadsheet export) or a JSON infrastructure-as-code file
 *   apply       the plan, then: the fleet declared, each persona's Mandate template signed, the agents enrolled (resumable, the same state as `enrol`), and a receipt
 *   rollback    undoes what can be undone: closes the fleet to new members, deletes the unused invitations and the key files made here, signs a rollback receipt. The log is append-only: records already
 *               written stay, and the receipt says so.
 *   checklist   the first hour: what is done and what is next, read from the log
 * Credits are accounting entries, not money; nothing here moves any.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { b64urlEncode, createRecord, signBytes } from "@agent-social/asp-core";
import { BLUEPRINTS, SKILLS, resolvePersona } from "./fleet-blueprints.ts";
import { FleetEnrolUsage, declareFleet, enrol, fleetEnrolCmd, parseManifest, readManifest, type FleetEnrolOpts, type Manifest, type Persona } from "./fleet-enrol.ts";

const sha = (t: string) => "sha256:" + createHash("sha256").update(t).digest("hex");
type Flags = FleetEnrolOpts["flags"] & { sponsor?: string; persona?: string; format?: string; file?: string; confirm?: string; purpose?: string; "fleet-did"?: string };
export interface OnboardOpts extends Omit<FleetEnrolOpts, "flags"> { flags: Flags }

/** The manifest the answers describe: `developer:50,support:20` is fifty of the developer blueprint and twenty of support. */
export function manifestFromAnswers(a: { sponsor?: string; name?: string; purpose?: string; persona?: string; fleetDid?: string }): Manifest {
  if (!a.sponsor || !a.name || !a.purpose || !a.persona) throw new FleetEnrolUsage("asp fleet init --sponsor <organisation did> --name <fleet name> --purpose <what it is for> --persona <blueprint>:<count>[,<blueprint>:<count>...] [--out <manifest.json>]   (asp fleet blueprints lists the blueprints)");
  const personas: Persona[] = a.persona.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
    const [name, n] = x.split(":");
    const count = Number(n);
    if (!BLUEPRINTS[name]) throw new FleetEnrolUsage(`${name} is not a blueprint (${Object.keys(BLUEPRINTS).join(", ")}); a persona of your own is written in the manifest`);
    if (!Number.isInteger(count) || count < 1) throw new FleetEnrolUsage(`${x}: the count after the colon is a whole number, at least 1`);
    return { name, role: BLUEPRINTS[name].role, purpose: BLUEPRINTS[name].purpose, count, blueprint: name };
  });
  const m: Manifest = { version: 1, sponsor: a.sponsor, fleet: { name: a.name, ...(a.fleetDid ? { did: a.fleetDid } : {}), purpose: a.purpose }, personas };
  parseManifest(JSON.stringify(m));
  return m;
}

/** A manifest from a spreadsheet export or an infrastructure file. CSV and TSV columns: persona (or name), count, blueprint, role, purpose, runtime, model, token_budget, skills (separated by `;`). */
export function importManifest(text: string, format: "csv" | "tsv" | "json", a: { sponsor?: string; name?: string; purpose?: string; fleetDid?: string }): Manifest {
  if (format === "json") {
    let j: any;
    try { j = JSON.parse(text); } catch (e) { throw new FleetEnrolUsage(`the file is not JSON: ${(e as Error).message}`); }
    // an infrastructure-as-code file lists resources: one asp_fleet and any number of asp_persona
    if (Array.isArray(j?.resources)) {
      const fleet = j.resources.find((r: any) => r?.type === "asp_fleet");
      if (!fleet) throw new FleetEnrolUsage('the file has no resource of type "asp_fleet" (name, sponsor, purpose)');
      const personas = j.resources.filter((r: any) => r?.type === "asp_persona").map((r: any) => ({ name: r.name, ...(r.role ? { role: r.role } : {}), ...(r.purpose ? { purpose: r.purpose } : {}), count: r.count, ...(r.blueprint ? { blueprint: r.blueprint } : {}), ...(r.skills ? { skills: r.skills } : {}), ...(r.mandate ? { mandate: r.mandate } : {}), ...(r.token_budget ? { token_budget: r.token_budget } : {}) }));
      const m = { version: 1, sponsor: a.sponsor ?? fleet.sponsor, fleet: { name: a.name ?? fleet.name, purpose: a.purpose ?? fleet.purpose, ...(fleet.did || a.fleetDid ? { did: a.fleetDid ?? fleet.did } : {}) }, personas } as Manifest;
      parseManifest(JSON.stringify(m));
      return m;
    }
    const m = { version: 1, ...j, ...(a.sponsor ? { sponsor: a.sponsor } : {}) } as Manifest;
    parseManifest(JSON.stringify(m));
    return m;
  }
  const sep = format === "tsv" ? "\t" : ",";
  const rows = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));
  if (rows.length < 2) throw new FleetEnrolUsage("the file needs a header row and at least one persona row");
  const head = rows[0].map((h) => h.toLowerCase());
  const col = (names: string[]) => head.findIndex((h) => names.includes(h));
  const iName = col(["persona", "name"]), iCount = col(["count", "agents", "number"]);
  if (iName < 0 || iCount < 0) throw new FleetEnrolUsage(`the header row needs a persona (or name) column and a count column; it has: ${rows[0].join(", ")}`);
  const get = (r: string[], names: string[]) => { const i = col(names); return i >= 0 && r[i] ? r[i] : undefined; };
  const personas: Persona[] = rows.slice(1).map((r, n) => {
    const count = Number(r[iCount]);
    if (!Number.isInteger(count) || count < 1) throw new FleetEnrolUsage(`row ${n + 2}: count ${JSON.stringify(r[iCount])} is a whole number, at least 1`);
    const blueprint = get(r, ["blueprint"]), skills = get(r, ["skills"]), runtime = get(r, ["runtime"]), model = get(r, ["model"]), budget = get(r, ["token_budget"]);
    return { name: r[iName], count, ...(blueprint ? { blueprint } : {}), ...(get(r, ["role"]) ? { role: get(r, ["role"]) } : {}), ...(get(r, ["purpose"]) ? { purpose: get(r, ["purpose"]) } : {}), ...(skills ? { skills: skills.split(";").map((s) => s.trim()).filter(Boolean) } : {}), ...(runtime || model ? { template: { ...(runtime ? { runtime } : {}), ...(model ? { model } : {}) } } : {}), ...(budget ? { token_budget: Number(budget) } : {}) };
  });
  if (!a.sponsor || !a.name || !a.purpose) throw new FleetEnrolUsage("a spreadsheet has the personas only: add --sponsor <organisation did> --name <fleet name> --purpose <what it is for>");
  const m: Manifest = { version: 1, sponsor: a.sponsor, fleet: { name: a.name, ...(a.fleetDid ? { did: a.fleetDid } : {}), purpose: a.purpose }, personas };
  parseManifest(JSON.stringify(m));
  return m;
}

const flaggedOf = (m: Manifest) => m.personas.flatMap((p) => resolvePersona(p).flagged.map((x) => ({ persona: p.name, ...x })));

export async function fleetOnboardCmd(sub: string, o: OnboardOpts): Promise<number> {
  const f = o.flags;
  const write = (m: Manifest) => {
    const text = JSON.stringify(m, null, 2) + "\n";
    if (f.out) { mkdirSync(resolve(f.out, ".."), { recursive: true }); writeFileSync(resolve(f.out), text); o.io.out(`manifest written to ${f.out} (${m.personas.reduce((n, p) => n + p.count, 0)} agents in ${m.personas.length} persona${m.personas.length === 1 ? "" : "s"}); next: asp fleet plan --manifest ${f.out}`); } else o.io.out(text.trimEnd());
    return 0;
  };
  if (sub === "blueprints") {
    if (f.json) { o.io.out(JSON.stringify({ blueprints: BLUEPRINTS, skills: Object.fromEntries(Object.entries(SKILLS).map(([k, s]) => [k, { title: s.title, needs: s.needs }])) }, null, 2)); return 0; }
    o.io.out("blueprints (ready personas; each is a Mandate template and its skills, which you edit in the manifest):");
    for (const b of Object.values(BLUEPRINTS)) o.io.out(`  ${b.id.padEnd(11)} ${b.purpose}; scopes ${(b.mandate.scopes as string[]).join(", ")}; skills ${b.skills.join(", ")}`);
    o.io.out("skills (ready packs a persona carries; each needs Mandate scopes, and the plan flags a persona whose Mandate does not allow them):");
    for (const s of Object.values(SKILLS)) o.io.out(`  ${s.id.padEnd(16)} ${s.title}; needs ${s.needs.join(", ")}`);
    return 0;
  }
  if (sub === "init") return write(manifestFromAnswers({ sponsor: f.sponsor, name: f.name, purpose: f.purpose, persona: f.persona, fleetDid: f["fleet-did"] }));
  if (sub === "import") {
    if (!f.file) throw new FleetEnrolUsage("asp fleet import --file <file.csv|file.tsv|file.json> [--format csv|tsv|json] [--sponsor <did> --name <fleet> --purpose <text>] [--out <manifest.json>]");
    const format = (f.format ?? (/\.tsv$/i.test(f.file) ? "tsv" : /\.json$/i.test(f.file) ? "json" : "csv")) as "csv" | "tsv" | "json";
    if (!["csv", "tsv", "json"].includes(format)) throw new FleetEnrolUsage("--format is csv, tsv or json");
    return write(importManifest(readFileSync(resolve(f.file), "utf8"), format, { sponsor: f.sponsor, name: f.name, purpose: f.purpose, fleetDid: f["fleet-did"] }));
  }
  if (sub === "apply") return await apply(o);
  if (sub === "rollback") return await rollback(o);
  if (sub === "checklist") return await checklist(o);
  throw new FleetEnrolUsage("asp fleet blueprints | init | import | plan | apply | rollback | checklist | enrol | join | status");
}

async function apply(o: OnboardOpts): Promise<number> {
  const f = o.flags;
  const { manifest: m, fleetDid } = readManifest(f);
  if (!f.out) throw new FleetEnrolUsage("asp fleet apply --manifest <file> --out <dir> [--mode invite|bundle] [--days n]");
  const flags = flaggedOf(m);
  if (flags.length) throw new FleetEnrolUsage(`nothing was written: ${flags.length} skill${flags.length === 1 ? "" : "s"} need${flags.length === 1 ? "s" : ""} scopes the persona's Mandate does not allow (asp fleet plan shows them):\n  - ${flags.map((x) => `${x.persona}: ${x.skill} needs ${x.missing.join(", ")}`).join("\n  - ")}`);
  o.io.out(await declareFleet(o as unknown as FleetEnrolOpts, m, fleetDid, m.personas.reduce((n, p) => n + p.count, 0)));
  const signer = o.signerFor(m.sponsor);
  const set: { persona: string; version: number }[] = [];
  for (const p of m.personas) {
    const r = resolvePersona(p);
    if (!r.mandate) continue;
    if ((await o.log.log.templateVersion(fleetDid, p.name)) > 0) { set.push({ persona: p.name, version: await o.log.log.templateVersion(fleetDid, p.name) }); continue; }   // resumed: already signed
    await o.log.append(createRecord({ type: "mandate_template", issuer: m.sponsor, subject: fleetDid, prev: null, body: { fleet: fleetDid, persona: p.name, version: 1, mandate: r.mandate }, issued_at: o.now() }, signer));
    set.push({ persona: p.name, version: 1 });
  }
  o.io.out(`${set.length} Mandate template${set.length === 1 ? "" : "s"} in force${set.length ? `: ${set.map((s) => `${s.persona} v${s.version}`).join(", ")}` : ""}`);
  const code = await enrol(o as unknown as FleetEnrolOpts);
  mkdirSync(resolve(f.out), { recursive: true });
  writeFileSync(join(resolve(f.out), "apply.json"), JSON.stringify({ fleet: fleetDid, sponsor: m.sponsor, manifest: sha(readFileSync(resolve(f.manifest!), "utf8")), templates: set, mode: f.mode ?? "invite", at: o.now(), complete: code === 0 }, null, 2));
  return code;
}

async function rollback(o: OnboardOpts): Promise<number> {
  const f = o.flags;
  const { manifest: m, fleetDid } = readManifest(f);
  if (!f.out) throw new FleetEnrolUsage("asp fleet rollback --manifest <file> --out <dir> --confirm <fleet did>");
  if (f.confirm !== fleetDid) throw new FleetEnrolUsage(`asp fleet rollback closes ${fleetDid} to new members and deletes the unused invitations and the key files in ${f.out}; the records already in the log stay. Run it again with --confirm ${fleetDid}`);
  const out = resolve(f.out);
  const signer = o.signerFor(m.sponsor);
  const done: string[] = [];
  const d = await o.log.log.fleetDetails(fleetDid);
  if (d && !d.closed) {
    const { fleetCmd } = await import("./fleet.ts");
    await fleetCmd("close", [fleetDid], { log: o.log, io: { out: () => undefined }, now: o.now, signerFor: o.signerFor, flags: {} });
    done.push("the fleet is closed to new members");
  }
  let invitations = 0, keys = 0;
  const inv = join(out, "invitations.jsonl");
  if (existsSync(inv)) { invitations = readFileSync(inv, "utf8").split("\n").filter(Boolean).length; rmSync(inv); done.push(`${invitations} unused invitation${invitations === 1 ? "" : "s"} deleted`); }
  const dir = join(out, "agents");
  if (existsSync(dir)) { keys = readdirSync(dir).length; rmSync(dir, { recursive: true, force: true }); done.push(`${keys} key file${keys === 1 ? "" : "s"} deleted`); }
  const members = (await o.log.log.fleetDetails(fleetDid))?.members.length ?? 0;
  const body = { fleet: fleetDid, sponsor: m.sponsor, closed: true, invitations_deleted: invitations, key_files_deleted: keys, members_still_in_the_log: members, note: "the log is append-only: records already written stay; with the keys deleted and the fleet closed nothing more can join or be signed from this run", at: o.now() };
  const receipt = { ...body, kid: signer.kid, sig: b64urlEncode(signBytes(new TextEncoder().encode(JSON.stringify(body)), signer.seed)) };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "rollback.json"), JSON.stringify(receipt, null, 2));
  o.io.out(done.length ? `rolled back: ${done.join("; ")}` : "nothing to undo: the fleet was already closed and no invitations or key files were here");
  o.io.out(`${members} agent identit${members === 1 ? "y stays" : "ies stay"} in the log (it is append-only); receipt signed: ${join(out, "rollback.json")}`);
  return 0;
}

async function checklist(o: OnboardOpts): Promise<number> {
  const f = o.flags;
  const { manifest: m, fleetDid, total } = readManifest(f);
  const d = await o.log.log.fleetDetails(fleetDid);
  const out = f.out ? resolve(f.out) : undefined;
  const flagged = flaggedOf(m).length;
  const withMandate = m.personas.filter((p) => resolvePersona(p).mandate);
  let templates = 0;
  if (d) for (const p of withMandate) if ((await o.log.log.templateVersion(fleetDid, p.name)) > 0) templates++;
  const invitations = out && existsSync(join(out, "invitations.jsonl")) ? readFileSync(join(out, "invitations.jsonl"), "utf8").split("\n").filter(Boolean).length : 0;
  const members = d?.members.length ?? 0;
  const items = [
    { step: "write the manifest and read the plan", done: true, next: "asp fleet plan --manifest <file>" },
    { step: "every skill fits its persona's Mandate", done: flagged === 0, next: "asp fleet plan shows the flagged skills" },
    { step: "the fleet is declared", done: !!d, next: "asp fleet apply --manifest <file> --out <dir>" },
    { step: `a Mandate template for each of ${withMandate.length} persona${withMandate.length === 1 ? "" : "s"}`, done: !!d && templates === withMandate.length, next: "asp fleet apply (it signs them)" },
    { step: `invitations signed or agents enrolled (${Math.max(invitations, members)} of ${total})`, done: Math.max(invitations, members) >= total, next: "asp fleet apply again continues a stopped run" },
    { step: "the first agent is a member of the fleet", done: members >= 1, next: "give an agent its line of invitations.jsonl: asp fleet join --invitation <line> --service <url>" },
    { step: "every agent has joined", done: members >= total, next: "asp fleet status --manifest <file> --out <dir>" },
  ];
  if (f.json) { o.io.out(JSON.stringify({ fleet: fleetDid, items }, null, 2)); return 0; }
  o.io.out(`first hour for ${m.fleet.name}:`);
  for (const i of items) o.io.out(`  [${i.done ? "x" : " "}] ${i.step}${i.done ? "" : `   -> ${i.next}`}`);
  return 0;
}

export { fleetEnrolCmd };
