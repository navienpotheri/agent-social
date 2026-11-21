/**
 * `asp org ...` (DK1359, DK1373, DK1374): the organisation's side of the tenancy routes (packages/asp-package/src/org-tenancy.ts) and the audit export.
 *   asp org create --name <org>                           the tenant (ASP_LOG_TOKEN) becomes the owner
 *   asp org show --org <org>                              roles and sign-on, as the caller sees them        [--token <a person's token>]
 *   asp org sso set --org <org> --file <sso.json>         OpenID Connect: issuer, audience, jwks, roleClaim, roleMap, defaultRole, jit
 *   asp org members --org <org> | role --org <org> --member <id> --role <role> | provision-token --org <org>
 *   asp org deprovision --org <org> --member <id> [--keep-agents]
 *   asp org link-agent --org <org> --member <id> --did <agent did>
 *   asp org audit show --org <org> [--after <seq>] | export --org <org> --did <the organisation's did> --out <file|dir> [--every <seconds> [--times <n>]] | verify --file <file>
 * The export is a file of JSON lines: the organisation's audit entries (sign-ins, roles, provisioning), the signed records of the organisation and its agents from the log (fleet and Mandate changes, spend,
 * every Action), and a last line signed by the organisation's own key over the whole file; `verify` checks it from the file alone. With --every it writes a new file each time, from where the last one stopped.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { b64urlDecode, b64urlEncode, resolverFromPassports, signBytes, verifyBytes, type AspRecord, type Signer } from "@agent-social/asp-core";
import type { LogHandle } from "@agent-social/asp-package";
import { collect } from "./offboard.ts";

export class OrgUsage extends Error {}
export interface OrgCmdOpts {
  url?: string; token?: string; io: { out: (l: string) => void }; now: () => string;
  log?: () => Promise<LogHandle>;
  signerFor: (did: string) => Signer;
  flags: { name?: string; org?: string; file?: string; member?: string; role?: string; did?: string; out?: string; after?: string; every?: string; times?: string; token?: string; "keep-agents"?: boolean };
}
const sha = (t: string) => "sha256:" + createHash("sha256").update(t).digest("hex");

export async function orgCmd(sub: string | undefined, rest: string[], o: OrgCmdOpts): Promise<number> {
  const f = o.flags;
  const call = async (method: string, path: string, body?: unknown): Promise<any> => {
    const url = o.url, token = f.token ?? o.token;
    if (!url || !token) throw new OrgUsage("set ASP_LOG_URL and ASP_LOG_TOKEN to the service and your token (or give --token a person's token)");
    const res = await fetch(new URL(path.replace(/^\//, ""), url.endsWith("/") ? url : url + "/"), { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const j = await res.json().catch(() => undefined) as any;
    if (!res.ok || j?.ok === false) throw new Error(j?.error?.message ?? `the service answered ${res.status}`);
    return j;
  };
  const org = () => { if (!f.org) throw new OrgUsage("--org <organisation name>"); return `org/${encodeURIComponent(f.org)}`; };

  if (sub === "create") { if (!f.name) throw new OrgUsage("asp org create --name <organisation>"); const r = await call("POST", "org", { name: f.name }); o.io.out(`organisation ${r.organisation} created; ${r.owner} is its owner. Roles: ${r.roles.join(", ")}`); return 0; }
  if (sub === "show") { const r = await call("GET", org()); o.io.out(`${r.organisation}: owner tenant ${r.owner}${r.you ? `; you are ${r.you.id} (${r.you.role})` : ""}; members ${Object.entries(r.members).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}; sign-on ${r.sso ? `${r.sso.type} ${r.sso.issuer} (just-in-time ${r.sso.jit ? "on" : "off"}, default role ${r.sso.defaultRole})` : "not configured"}; provisioning feed ${r.scim ? "on" : "off"}`); return 0; }
  if (sub === "sso") {
    if (rest[0] !== "set" || !f.file) throw new OrgUsage("asp org sso set --org <organisation> --file <sso.json>   (issuer, audience, jwks, roleClaim, roleMap, defaultRole, jit)");
    const r = await call("PUT", `${org()}/sso`, JSON.parse(readFileSync(resolve(f.file), "utf8")));
    o.io.out(`sign-on set: ${r.sso.type} ${r.sso.issuer}, just-in-time ${r.sso.jit ? "on" : "off"}, default role ${r.sso.defaultRole}`); return 0;
  }
  if (sub === "members") { const r = await call("GET", `${org()}/members`); for (const m of r.members) o.io.out(`  ${m.id.padEnd(28)} ${m.role.padEnd(14)} ${m.active ? "active" : "deprovisioned"} via ${m.via}${m.agents.length ? `; agents ${m.agents.join(", ")}` : ""}`); return 0; }
  if (sub === "role") { if (!f.member || !f.role) throw new OrgUsage("asp org role --org <organisation> --member <id> --role owner|administrator|member|auditor"); const r = await call("PUT", `${org()}/members/${encodeURIComponent(f.member)}/role`, { role: f.role }); o.io.out(`${r.member.id} is now ${r.member.role}`); return 0; }
  if (sub === "provision-token") { const r = await call("POST", `${org()}/scim-token`, {}); o.io.out("provisioning token (shown once; the identity system's feed sends it on /org/<name>/scim/Users):"); o.io.out(r.token); return 0; }
  if (sub === "deprovision") { if (!f.member) throw new OrgUsage("asp org deprovision --org <organisation> --member <id> [--keep-agents]"); const r = await call("POST", `${org()}/members/${encodeURIComponent(f.member)}/deprovision`, { agents: !f["keep-agents"] }); o.io.out(`${r.member.id} deprovisioned: every token ended${r.agentsFrozen.length ? `; ${r.agentsFrozen.length} agent(s) frozen: ${r.agentsFrozen.join(", ")}` : "; agents left running"}`); return 0; }
  if (sub === "link-agent") { if (!f.member || !f.did) throw new OrgUsage("asp org link-agent --org <organisation> --member <id> --did <agent did>"); await call("POST", `${org()}/members/${encodeURIComponent(f.member)}/agents`, { did: f.did }); o.io.out(`${f.did} is linked to ${f.member}: a deprovision of that person freezes it`); return 0; }
  if (sub === "audit") {
    if (rest[0] === "verify") { const v = verifyExport(f.file); o.io.out(v.ok ? `audit export verified: ${v.org} entries, ${v.records} log records, signed by ${v.kid}, root ${v.root}` : `audit export NOT verified: ${v.problems.join("; ")}`); return v.ok ? 0 : 1; }
    if (rest[0] === "export") return await exportAudit(o, call, org());
    const r = await call("GET", `${org()}/audit${f.after ? `?after=${Number(f.after)}` : ""}`);
    for (const e of r.entries) o.io.out(`  ${String(e.seq).padStart(4)} ${e.at} ${e.by.padEnd(22)} ${e.action.padEnd(18)} ${e.target}${e.reason ? `  (${e.reason})` : ""}`);
    o.io.out(`${r.entries.length} entr${r.entries.length === 1 ? "y" : "ies"}; chain ${r.verify.ok ? "verifies" : `BROKEN: ${r.verify.problem}`}`); return r.verify.ok ? 0 : 1;
  }
  throw new OrgUsage("asp org create | show | sso set | members | role | provision-token | deprovision | link-agent | audit show|export|verify");
}

async function exportAudit(o: OrgCmdOpts, call: (m: string, p: string, b?: unknown) => Promise<any>, orgPath: string): Promise<number> {
  const f = o.flags;
  if (!f.did || !f.out) throw new OrgUsage("asp org audit export --org <organisation> --did <the organisation's did, whose key is on this machine> --out <file, or a folder with --every> [--every <seconds> [--times <n>]]");
  if (!o.log) throw new OrgUsage("the export reads the log: set ASP_LOG_URL and ASP_LOG_TOKEN");
  const every = f.every ? Number(f.every) : 0, times = f.times ? Number(f.times) : every ? Infinity : 1;
  if (every && (!Number.isFinite(every) || every < 1)) throw new OrgUsage("--every is a number of seconds, at least 1");
  const signer = o.signerFor(f.did);
  const dir = every ? resolve(f.out) : undefined;
  const cursorFile = dir ? join(dir, "cursor.json") : undefined;
  if (dir) mkdirSync(dir, { recursive: true });
  const cursor: { audit: number; log: number } = cursorFile && existsSync(cursorFile) ? JSON.parse(readFileSync(cursorFile, "utf8")) : { audit: 0, log: 0 };
  for (let n = 0; n < times; n++) {
    const audit = await call("GET", `${orgPath}/audit?after=${cursor.audit}`);
    const log = await o.log();
    const { records, dids } = await collect(log, f.did, cursor.log);
    const lines: string[] = [JSON.stringify({ kind: "header", version: 1, organisation: f.did, exported_at: o.now(), audit_after: cursor.audit, log_after: cursor.log, identities: dids.length })];
    for (const e of audit.entries) lines.push(JSON.stringify({ kind: "org_audit", entry: e }));
    // the passports are always in the file so that it verifies on its own; the rest are the records after the cursor
    if (cursor.log > 0) for (const r of (await collect(log, f.did, 0)).records.filter((x) => (x.record as { type?: string }).type === "asp.passport/v0.2" && x.seq <= cursor.log)) lines.push(JSON.stringify({ kind: "passport", seq: r.seq, id: r.id, record: r.record }));
    for (const r of records) lines.push(JSON.stringify({ kind: "log_record", seq: r.seq, id: r.id, record: r.record }));
    const root = sha(lines.join("\n"));
    const trailer = { kind: "signature", lines: lines.length, root, kid: signer.kid, sig: b64urlEncode(signBytes(new TextEncoder().encode(root), signer.seed)) };
    const path = dir ? join(dir, `audit-${String(cursor.audit).padStart(6, "0")}-${String(cursor.log).padStart(8, "0")}.jsonl`) : resolve(f.out);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, lines.concat(JSON.stringify(trailer)).join("\n") + "\n");
    o.io.out(`audit export: ${audit.entries.length} organisation entr${audit.entries.length === 1 ? "y" : "ies"} and ${records.length} log record${records.length === 1 ? "" : "s"} written to ${path}, signed by ${signer.kid}${audit.verify.ok ? "" : " (the organisation's audit chain is BROKEN)"}`);
    cursor.audit = audit.entries.at(-1)?.seq ?? cursor.audit;
    cursor.log = Math.max(cursor.log, ...records.map((r) => r.seq));
    if (cursorFile) writeFileSync(cursorFile, JSON.stringify(cursor));
    if (n + 1 < times) await new Promise((r) => setTimeout(r, every * 1000));
  }
  return 0;
}

/** Checks an export from the file alone: the root over its lines, and the signature against the key in the passport of the organisation that is in the file. */
export function verifyExport(file: string | undefined): { ok: boolean; org: number; records: number; kid: string; root: string; problems: string[] } {
  if (!file) throw new OrgUsage("asp org audit verify --file <export>");
  const all = readFileSync(resolve(file), "utf8").split("\n").filter(Boolean);
  const problems: string[] = [];
  const trailer = JSON.parse(all.at(-1) ?? "{}") as { kind?: string; lines?: number; root?: string; kid?: string; sig?: string };
  const body = all.slice(0, -1);
  if (trailer.kind !== "signature") problems.push("the file does not end with a signature");
  const root = sha(body.join("\n"));
  if (trailer.root !== root) problems.push("the lines were changed after they were signed");
  if (trailer.lines !== body.length) problems.push("the number of lines is not the one signed");
  const items = body.map((l) => JSON.parse(l) as { kind: string; record?: AspRecord; entry?: { seq: number; prev: string; hash: string } });
  const header = items[0] as unknown as { organisation?: string };
  const passports = items.filter((x) => x.record?.type === "asp.passport/v0.2").map((x) => x.record!);
  const pub = trailer.kid ? resolverFromPassports(passports)(trailer.kid) : undefined;
  if (!pub) problems.push(`the key ${trailer.kid ?? ""} is not in a passport in the file`);
  else if (!trailer.sig || !verifyBytes(b64urlDecode(trailer.sig), new TextEncoder().encode(trailer.root ?? ""), pub)) problems.push("the signature does not verify");
  if (trailer.kid && header.organisation && !trailer.kid.startsWith(header.organisation)) problems.push("the signer is not the organisation named in the header");
  const entries = items.filter((x) => x.kind === "org_audit").map((x) => x.entry!);
  for (let i = 1; i < entries.length; i++) if (entries[i].prev !== entries[i - 1].hash) problems.push(`audit entry ${entries[i].seq} does not follow the one before it`);
  return { ok: problems.length === 0, org: entries.length, records: items.filter((x) => x.kind === "log_record").length, kid: trailer.kid ?? "", root, problems };
}
void statSync;
