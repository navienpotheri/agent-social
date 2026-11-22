/**
 * `asp fleet plan | enrol | join | status` (register row DK1354; spec-delta S1459; docs/enterprise-fleets.md): bringing a whole fleet of agents into the society without a command line for each.
 *
 *   A manifest (JSON) names the sponsor (the organisation), the fleet, and the personas: a name, a role, a purpose, a count, optionally a template (runtime, model, skills) and the name of a Mandate template (DK1355).
 *   `plan` checks it and says what would be created, writing nothing.
 *   `enrol` declares the fleet in the log and then brings the agents in, in one of two ways:
 *     --mode invite (the default): keys are generated WHERE THE AGENTS RUN. The sponsor signs one invitation for each agent slot, offline, into a file; each agent makes its own key, issues its own passport naming the
 *       fleet and carrying its invitation, and joins by itself (`asp fleet join`, or the front-door tool `society_fleet_join`, or `POST /fleet/join`). The sponsor's machine never holds an agent's key.
 *     --mode bundle: the sponsor's machine makes each agent's identity, key and passport itself (up to 10,000 in one run), writes each agent's key into its own file under --out for delivery to where the agent runs,
 *       and keeps none of them in its own keystore. For an enterprise that provisions its agents from one place.
 *   Both are resumable: a stopped run continues where it was, and running it again creates nothing twice. One signed summary (counts, the manifest's hash and a root over every agent's did) is written at the end; it holds no key.
 * Fleets of copies (one persona with a count) and fleets of different personas are the same manifest. Credits are accounting entries, not money; nothing here moves any.
 */
import { BLUEPRINTS, SKILLS, resolvePersona } from "./fleet-blueprints.ts";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { b64urlEncode, createRecord, didKeyFromPublicKey, publicKeyFromSeed, randomSeed, signBytes, signerFromSeed, type Signer } from "@agent-social/asp-core";
import { makeInvitation, STARTER_PER_DID, STARTER_UPFRONT, type FleetInvitation } from "@agent-social/asp-log";
import { readTextFile, type LogHandle } from "@agent-social/asp-package";

export class FleetEnrolUsage extends Error {}

export interface Persona {
  name: string; role?: string; purpose?: string; count: number; template?: { runtime?: string; model?: string }; mandate_template?: string;
  /** A ready persona from the blueprint library (DK1371): its Mandate template and skills apply unless the persona gives its own `mandate`. */
  blueprint?: string;
  /** The persona's own Mandate template, in place of the blueprint's. */
  mandate?: Record<string, unknown>;
  /** Skill packs from the skill library, beside the blueprint's. */
  skills?: string[];
  /** Tokens a month for each agent of the persona, when the enterprise sets one (the plan sums them). */
  token_budget?: number;
}
export interface Manifest { version: 1; sponsor: string; fleet: { name: string; did?: string; purpose: string }; personas: Persona[]; invitation_days?: number }

const LABEL = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const MAX_FLEET = 100_000;

/** Reads and checks a manifest; every problem found is said at once, in words. */
export function parseManifest(text: string): { manifest: Manifest; fleetDid: string; total: number } {
  let j: any;
  try { j = JSON.parse(text); } catch (e) { throw new FleetEnrolUsage(`the manifest is not JSON: ${(e as Error).message}`); }
  const problems: string[] = [];
  if (j?.version !== 1) problems.push('"version" is 1');
  if (typeof j?.sponsor !== "string" || !/^did:[a-z]+:\S+$/.test(j.sponsor)) problems.push('"sponsor" is the organisation\'s did');
  if (!j?.fleet || typeof j.fleet.name !== "string" || !j.fleet.name.trim()) problems.push('"fleet.name" is a name');
  if (!j?.fleet || typeof j.fleet.purpose !== "string" || !j.fleet.purpose.trim()) problems.push('"fleet.purpose" says what the fleet is for');
  if (!Array.isArray(j?.personas) || !j.personas.length) problems.push('"personas" lists at least one persona');
  const seen = new Set<string>();
  let total = 0;
  for (const [i, p] of (Array.isArray(j?.personas) ? j.personas : []).entries()) {
    const at = `personas[${i}]`;
    if (typeof p?.name !== "string" || !LABEL.test(p.name)) problems.push(`${at}.name is a short label: lower-case letters, digits and hyphens, starting with a letter (developer, support, ceo)`);
    else if (seen.has(p.name)) problems.push(`${at}.name ${p.name} is used twice`); else seen.add(p.name);
    if (!Number.isInteger(p?.count) || p.count < 1) problems.push(`${at}.count is a whole number, at least 1`); else total += p.count;
    if (p?.blueprint !== undefined && !BLUEPRINTS[p.blueprint]) problems.push(`${at}.blueprint ${JSON.stringify(p.blueprint)} is not in the library (${Object.keys(BLUEPRINTS).join(", ")})`);
    if (p?.skills !== undefined && (!Array.isArray(p.skills) || p.skills.some((x: unknown) => typeof x !== "string" || !SKILLS[x as string]))) problems.push(`${at}.skills names skills from the library (${Object.keys(SKILLS).join(", ")})`);
    if (p?.mandate !== undefined && (typeof p.mandate !== "object" || p.mandate === null || !Array.isArray((p.mandate as { scopes?: unknown }).scopes))) problems.push(`${at}.mandate is a Mandate template with scopes`);
    if (p?.token_budget !== undefined && (!Number.isInteger(p.token_budget) || p.token_budget < 1)) problems.push(`${at}.token_budget is a whole number of tokens a month, at least 1`);
    if (p?.purpose !== undefined && (typeof p.purpose !== "string" || !p.purpose.trim() || p.purpose.length > 300)) problems.push(`${at}.purpose is 1 to 300 characters`);
  }
  if (total > MAX_FLEET) problems.push(`a fleet is at most ${MAX_FLEET} agents (the manifest asks for ${total})`);
  if (j?.invitation_days !== undefined && (!Number.isInteger(j.invitation_days) || j.invitation_days < 1 || j.invitation_days > 365)) problems.push('"invitation_days" is 1 to 365');
  let fleetDid = j?.fleet?.did as string | undefined;
  if (!fleetDid && typeof j?.sponsor === "string") {
    const m = /^did:web:([^:]+)/.exec(j.sponsor);
    if (!m) problems.push('"fleet.did" is needed when the sponsor is not a did:web (a did of its own for the fleet)');
    else fleetDid = `did:web:${m[1]}:fleets:${String(j?.fleet?.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  }
  if (problems.length) throw new FleetEnrolUsage(`the manifest has ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n  - ${problems.join("\n  - ")}`);
  return { manifest: j as Manifest, fleetDid: fleetDid!, total };
}

const sha = (t: string) => "sha256:" + createHash("sha256").update(t).digest("hex");
const slug = (p: string, i: number) => `${p}-${String(i + 1).padStart(5, "0")}`;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export interface FleetEnrolOpts {
  home: string;
  log: LogHandle;
  io: { out: (l: string) => void; err: (l: string) => void };
  now: () => string;
  signerFor: (did: string) => Signer & { publicKey: Uint8Array };
  flags: { manifest?: string; out?: string; mode?: string; resume?: boolean; json?: boolean; "stop-after"?: string; invitation?: string; service?: string; name?: string; "accept-terms"?: boolean; days?: string };
  fetch?: typeof fetch;
}

export const readManifest = (f: FleetEnrolOpts["flags"]) => {
  if (!f.manifest) throw new FleetEnrolUsage("asp fleet plan|enrol --manifest <file>");
  return parseManifest(readTextFile(resolve(f.manifest)));
};

interface Slot { persona: string; index: number }
function* slots(m: Manifest): Generator<Slot> { for (const p of m.personas) for (let i = 0; i < p.count; i++) yield { persona: p.name, index: i }; }

export async function fleetEnrolCmd(sub: string | undefined, o: FleetEnrolOpts): Promise<number> {
  const f = o.flags;
  if (sub === "plan") {
    const { manifest, fleetDid, total } = readManifest(f);
    const rows = manifest.personas.map((p) => ({ persona: p.name, role: p.role ?? p.name, count: p.count, mandate_template: p.mandate_template ?? null }));
    const perHundred = 0.9; // seconds for a hundred passports on a local log, measured on the run logged in docs/live-run-checklist.md
    if (f.json) { o.io.out(JSON.stringify({ fleet: fleetDid, sponsor: manifest.sponsor, total, personas: rows.map((r, i) => ({ ...r, skills: resolvePersona(manifest.personas[i]).skills, scopes: resolvePersona(manifest.personas[i]).scopes })), records: total + 1, starter_credits_up_front: total * STARTER_UPFRONT, starter_credits_in_all: total * STARTER_PER_DID, token_budget_a_month: manifest.personas.reduce((n, p) => n + (p.token_budget ?? 0) * p.count, 0), flagged: manifest.personas.flatMap((p) => resolvePersona(p).flagged.map((x) => ({ persona: p.name, ...x }))), estimate_seconds: Math.round(total * perHundred / 100) }, null, 2)); return 0; }
    o.io.out(`fleet ${manifest.fleet.name} (${fleetDid}), sponsored by ${manifest.sponsor}: ${total} agent${total === 1 ? "" : "s"} in ${rows.length} persona${rows.length === 1 ? "" : "s"}`);
    for (const [i, r] of rows.entries()) {
      const rp = resolvePersona(manifest.personas[i]);
      o.io.out(`  ${r.persona.padEnd(20)} ${String(r.count).padStart(7)}  ${rp.mandate ? `Mandate: ${rp.scopes.join(", ") || "no scopes"}${manifest.personas[i].blueprint ? ` (blueprint ${manifest.personas[i].blueprint})` : ""}` : r.mandate_template ? `Mandate template ${r.mandate_template}` : "no Mandate template yet"}${rp.skills.length ? `; skills: ${rp.skills.join(", ")}` : ""}`);
      for (const x of rp.flagged) o.io.out(`    FLAG  skill ${x.skill} needs ${x.missing.join(", ")}, which this persona's Mandate does not allow: add the scope or drop the skill before apply`);
    }
    const credits = total * STARTER_UPFRONT;
    const tokens = manifest.personas.reduce((n, p) => n + (p.token_budget ?? 0) * p.count, 0);
    o.io.out(`cost: starter credits up front ${credits} (${total} x ${STARTER_UPFRONT}), up to ${total * STARTER_PER_DID} after each agent's own first accepted job; tokens a month ${tokens ? `${tokens} set in this manifest` : "no budget set (token_budget on a persona sets one)"}. Credits are accounting entries, not money.`);
    o.io.out(`would write ${total + 1} records to the log (the fleet declaration and one passport each) in about ${Math.max(1, Math.round(total * perHundred / 100))} seconds on a local log; nothing was written`);
    o.io.out("then: asp fleet enrol --manifest <file> --out <dir>   (--mode invite, the default, keeps every key with its agent; --mode bundle makes the identities and keys here)");
    return 0;
  }
  if (sub === "enrol") return await enrol(o);
  if (sub === "join") return await joinFleet(o);
  if (sub === "status") return await status(o);
  throw new FleetEnrolUsage("asp fleet plan | enrol | join | status");
}

export async function declareFleet(o: FleetEnrolOpts, m: Manifest, fleetDid: string, total: number): Promise<string> {
  const existing = await o.log.log.fleet(fleetDid);
  if (existing) {
    if (existing.org !== m.sponsor) throw new Error(`fleet ${fleetDid} already belongs to ${existing.org}, not ${m.sponsor}`);
    return `fleet ${fleetDid} is already declared`;
  }
  const signer = o.signerFor(m.sponsor);
  const first = m.personas[0];
  const rec = createRecord({ type: "fleet" as never, issuer: m.sponsor, subject: fleetDid, prev: null, body: { did: fleetDid, org: m.sponsor, name: m.fleet.name, purpose: m.fleet.purpose, max_members: total, ...(m.personas.length === 1 && first.template ? { template: first.template } : {}) }, issued_at: o.now() }, signer);
  const res = await o.log.append(rec);
  return `fleet ${fleetDid} declared (${res.id}, log seq ${res.seq}): ${total} members at most`;
}

export async function enrol(o: FleetEnrolOpts): Promise<number> {
  const f = o.flags;
  const { manifest: m, fleetDid, total } = readManifest(f);
  if (!f.out) throw new FleetEnrolUsage("asp fleet enrol --manifest <file> --out <dir> [--mode invite|bundle] [--days n]");
  const mode = f.mode ?? "invite";
  if (mode !== "invite" && mode !== "bundle") throw new FleetEnrolUsage("--mode is invite or bundle");
  const out = resolve(f.out);
  mkdirSync(out, { recursive: true });
  const manifestHash = sha(readTextFile(resolve(f.manifest!)));
  const stateFile = join(out, "fleet-state.json");
  const state: { manifest: string; mode: string; fleet: string } | undefined = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : undefined;
  if (state && (state.manifest !== manifestHash || state.mode !== mode)) throw new FleetEnrolUsage(`${out} holds a run of another manifest or mode (${state.mode}); use a new --out, or the same manifest and mode to resume`);
  writeFileSync(stateFile, JSON.stringify({ manifest: manifestHash, mode, fleet: fleetDid }, null, 2));
  o.io.out(await declareFleet(o, m, fleetDid, total));
  const signer = o.signerFor(m.sponsor);
  const stopAfter = f["stop-after"] === undefined ? Infinity : Number(f["stop-after"]);
  const t0 = Date.now();

  if (mode === "invite") {
    const days = f.days ? Number(f.days) : m.invitation_days ?? 30;
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new FleetEnrolUsage("--days is 1 to 365");
    const file = join(out, "invitations.jsonl");
    const have = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).length : 0;
    const expires = iso(Date.parse(o.now()) + days * 86_400_000);
    let n = 0, made = 0;
    for (const s of slots(m)) {
      if (n++ < have) continue;
      if (made >= stopAfter) break;
      const inv = makeInvitation(signer, { fleet: fleetDid, persona: s.persona, expires });
      appendFileSync(file, JSON.stringify(inv) + "\n");
      made++;
    }
    const all = have + made;
    o.io.out(`${made} invitation${made === 1 ? "" : "s"} signed${have ? ` (${have} from an earlier run)` : ""}, ${all} of ${total}, valid until ${expires}; written to ${file}`);
    if (all < total) { o.io.out(`stopped at ${all} of ${total}: run the same command again to continue`); return 3; }
    const summary = signSummary(m, fleetDid, signer, { mode, total, invitations: all, dids: [], at: o.now() });
    writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2));
    o.io.out(`summary signed: ${join(out, "summary.json")}`);
    o.io.out(`Give each agent ONE line of invitations.jsonl (it is the agent's own, single-use). The agent joins by itself: asp fleet join --invitation <its line> --service <url>, or the front-door tool society_fleet_join, or POST /fleet/join. No agent key was made or kept here.`);
    return 0;
  }

  // bundle: the sponsor's machine makes each identity, key and passport; keys go into per-agent files, not the sponsor's keystore
  const dir = join(out, "agents");
  mkdirSync(dir, { recursive: true });
  const membersFile = join(out, "members.jsonl");
  const done = new Map<string, string>();
  if (existsSync(membersFile)) for (const l of readFileSync(membersFile, "utf8").split("\n")) { try { const x = JSON.parse(l); done.set(`${x.persona}/${x.index}`, x.did); } catch { /* a half-written last line */ } }
  let created = 0, skipped = 0, n = 0;
  const personas = new Map(m.personas.map((p) => [p.name, p]));
  for (const s of slots(m)) {
    n++;
    const key = `${s.persona}/${s.index}`;
    if (done.has(key)) { skipped++; continue; }
    if (created >= stopAfter) break;
    const file = join(dir, `${slug(s.persona, s.index)}.key.json`);
    let seed: Uint8Array, did: string;
    if (existsSync(file)) { const b = JSON.parse(readFileSync(file, "utf8")); seed = Buffer.from(b.seed, "base64url"); did = b.did; }          // a key made before a stop: reuse it
    else { seed = randomSeed(); did = didKeyFromPublicKey(publicKeyFromSeed(seed)); writeFileSync(file, JSON.stringify({ did, kid: `${did}#key-1`, seed: b64urlEncode(seed), persona: s.persona, skills: resolvePersona(m.personas.find((x) => x.name === s.persona)!).skills, fleet: fleetDid, sponsor: m.sponsor, note: "This file is the agent's own key. Deliver it to where the agent runs and keep no other copy." }, null, 2), { mode: 0o600 }); try { chmodSync(file, 0o600); } catch { /* not on every system */ } }
    if (!(await o.log.log.passport(did))) {
      const p = personas.get(s.persona)!;
      const body = { did, kind: "agent" as const, keys: [{ id: `${did}#key-1`, type: "Ed25519" as const, public_key: b64urlEncode(publicKeyFromSeed(seed)) }], sponsor: m.sponsor, mentor: m.sponsor, tier: 1, shape: { memory: "files + experience index", keeps_learning: true, modalities: ["text", "code"] }, purpose: p.purpose ?? `${p.role ?? p.name} of ${m.fleet.name}`, fleet: fleetDid, persona: s.persona };
      await o.log.append(createRecord({ type: "passport", issuer: m.sponsor, subject: did, prev: null, body, issued_at: o.now() }, signer));
    }
    appendFileSync(membersFile, JSON.stringify({ persona: s.persona, index: s.index, did }) + "\n");
    done.set(key, did); created++;
    if (created % 500 === 0) o.io.out(`  ${done.size} of ${total} enrolled (${Math.round(created / ((Date.now() - t0) / 1000))} a second)`);
  }
  o.io.out(`${created} agent${created === 1 ? "" : "s"} enrolled${skipped ? ` (${skipped} from an earlier run)` : ""}, ${done.size} of ${total}, in ${Math.round((Date.now() - t0) / 1000)} seconds; keys are in ${dir}, one file for each agent`);
  if (done.size < total) { o.io.out(`stopped at ${done.size} of ${total}: run the same command again to continue`); return 3; }
  const summary = signSummary(m, fleetDid, signer, { mode, total, invitations: 0, dids: [...done.values()], at: o.now() });
  writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2));
  o.io.out(`summary signed: ${join(out, "summary.json")} (counts, the manifest's hash, a root over every agent's did; no key)`);
  return 0;
}

function signSummary(m: Manifest, fleetDid: string, signer: Signer, o: { mode: string; total: number; invitations: number; dids: string[]; at: string }) {
  const counts = Object.fromEntries(m.personas.map((p) => [p.name, p.count]));
  const root = o.dids.length ? sha([...o.dids].sort().join("\n")) : null;
  const body = { fleet: fleetDid, sponsor: m.sponsor, mode: o.mode, total: o.total, personas: counts, invitations: o.invitations, agents: o.dids.length, members_root: root, manifest: sha(JSON.stringify(m)), at: o.at };
  return { ...body, kid: signer.kid, sig: b64urlEncode(signBytes(new TextEncoder().encode(JSON.stringify(body)), signer.seed)) };
}

/** The agent's side: makes its own key, issues its own passport with the invitation, posts it. The key never leaves this machine. */
async function joinFleet(o: FleetEnrolOpts): Promise<number> {
  const f = o.flags;
  if (!f.invitation || !f.service) throw new FleetEnrolUsage("asp fleet join --invitation <the agent's line from invitations.jsonl, or a file holding it> --service <url> [--name <handle>] --accept-terms");
  let inv: FleetInvitation;
  try { const t = f.invitation.trim(); inv = JSON.parse(t.startsWith("{") ? t : readFileSync(resolve(t), "utf8").split("\n").filter(Boolean)[0]); } catch (e) { throw new FleetEnrolUsage(`the invitation is not readable: ${(e as Error).message}`); }
  if (!inv?.fleet || !inv.nonce || !inv.sig || !inv.kid) throw new FleetEnrolUsage("the invitation is incomplete: it has a fleet, a nonce, an expiry, a kid and a signature");
  if (!f["accept-terms"]) throw new FleetEnrolUsage("joining accepts the service's terms: add --accept-terms after reading them at <service>/terms");
  const base = f.service.replace(/\/$/, "");
  const doFetch = o.fetch ?? fetch;
  const info = (await (await doFetch(`${base}/signup`)).json()) as { termsVersion?: string };
  const seed = randomSeed();
  const did = didKeyFromPublicKey(publicKeyFromSeed(seed));
  const kid = `${did}#key-1`;
  const signer = signerFromSeed(kid, seed);
  const sponsor = inv.kid.split("#")[0];
  const body = { did, kind: "agent" as const, keys: [{ id: kid, type: "Ed25519" as const, public_key: b64urlEncode(publicKeyFromSeed(seed)) }], sponsor, mentor: sponsor, tier: 1, shape: { memory: "files + experience index", keeps_learning: true, modalities: ["text", "code"] }, fleet: inv.fleet, ...(inv.persona ? { persona: inv.persona } : {}), invitation: inv };
  const passport = createRecord({ type: "passport", issuer: did, subject: did, prev: null, body, issued_at: o.now() }, signer);
  const r = await doFetch(`${base}/fleet/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passport, accept_terms: true, terms_version: info.termsVersion, ...(f.name ? { name: f.name } : {}) }) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; tenant?: string; token?: string; error?: { code: string; message: string } };
  if (!j.ok) throw new Error(`the service refused the join (${r.status} ${j.error?.code ?? ""}): ${j.error?.message ?? "no reason given"}`);
  // The key is kept in this machine's keystore, under the agent's own did; the token is shown once.
  const keystoreFile = join(o.home, "fleet-joined", `${did.slice(-12)}.json`);
  mkdirSync(join(o.home, "fleet-joined"), { recursive: true });
  writeFileSync(keystoreFile, JSON.stringify({ did, kid, seed: b64urlEncode(seed), fleet: inv.fleet, persona: inv.persona ?? null, tenant: j.tenant, service: base }, null, 2), { mode: 0o600 });
  o.io.out(`joined ${inv.fleet} as ${did}${inv.persona ? ` (${inv.persona})` : ""}, sponsored by ${sponsor}`);
  o.io.out(`  tenant ${j.tenant}`);
  o.io.out(`  token  ${j.token}   (shown once: keep it; ASP_LOG_URL=${base} ASP_LOG_TOKEN=<token> lets this agent act)`);
  o.io.out(`  key    kept in ${keystoreFile} (it never left this machine)`);
  return 0;
}

async function status(o: FleetEnrolOpts): Promise<number> {
  const f = o.flags;
  const { manifest: m, fleetDid, total } = readManifest(f);
  const fleet = await o.log.log.fleet(fleetDid);
  const out = f.out ? resolve(f.out) : undefined;
  const invitations = out && existsSync(join(out, "invitations.jsonl")) ? readFileSync(join(out, "invitations.jsonl"), "utf8").split("\n").filter(Boolean).length : 0;
  const members = fleet?.members?.length ?? 0;
  const bundled = out && existsSync(join(out, "members.jsonl")) ? readFileSync(join(out, "members.jsonl"), "utf8").split("\n").filter(Boolean).length : 0;
  const row = { fleet: fleetDid, declared: !!fleet, wanted: total, in_the_log: members, invitations_signed: invitations, bundled: bundled, key_files: out && existsSync(join(out, "agents")) ? readdirSync(join(out, "agents")).length : 0 };
  if (f.json) { o.io.out(JSON.stringify(row, null, 2)); return 0; }
  o.io.out(`${m.fleet.name}: ${row.declared ? "declared" : "not declared yet"}; ${members} of ${total} agents are in the log${invitations ? `; ${invitations} invitations signed` : ""}${bundled ? `; ${bundled} enrolled from here` : ""}`);
  return 0;
}
