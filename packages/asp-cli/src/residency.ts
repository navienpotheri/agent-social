/**
 * `asp residency ...` (docs/institutions/residency.md 11; register rows DK82 to DK85): the subsidy ledger (`subsidy budget|grant|use|report`), delegated custody, the sponsor's allowance, dispatch and
 * handback. The City-budget and Host keys are the operator's in the beta; the sponsor signs for its own agent. Credits are accounting entries, not money; nothing here moves a credit.
 */
import { cosign, createRecord, type Signer } from "@agent-social/asp-core";
import { cityPackageProblem, issueDelegation, recallDelegation, residencyStatement } from "@agent-social/asp-package";
import { readFileSync } from "node:fs";
import { CITY_BUDGET_DID, HOST_DID, subsidyReport } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";

export class ResidencyUsage extends Error {}

export type Flags = Record<string, string | string[] | boolean | undefined>;

export interface ResidencyOpts {
  log: LogHandle;
  io: { out: (l: string) => void; err: (l: string) => void };
  now: () => string;
  signerFor: (did: string) => Signer;
  flags: Flags;
}

const str = (f: Flags, k: string): string | undefined => { const v = f[k]; return Array.isArray(v) ? v[0] : typeof v === "string" ? v : undefined; };
const need = (f: Flags, k: string, usage: string): string => { const v = str(f, k); if (v === undefined) throw new ResidencyUsage(usage); return v; };
const whole = (s: string, name: string): number => { const n = Number(s); if (!Number.isInteger(n) || n < 0) throw new ResidencyUsage(`--${name} is a whole number, 0 or more`); return n; };

async function recordsOfTypes(log: LogHandle, types: string[]) {
  const out = [];
  for (let after = 0; ;) {
    const page = await log.log.since(after, 500);
    if (!page.length) break;
    for (const s of page) { after = s.seq; if (types.includes(s.record.type)) out.push(s.record); }
  }
  return out;
}

export async function residencyCmd(sub: string | undefined, rest: string[], o: ResidencyOpts): Promise<number> {
  const f = o.flags;
  if (sub === "subsidy") {
    const act = rest[0];
    const sign = async (type: string, issuer: string, body: Record<string, unknown>) => {
      const rec = createRecord({ type: type as never, issuer, subject: null, prev: null, body, issued_at: o.now() }, o.signerFor(issuer));
      return o.log.append(rec);
    };
    if (act === "budget") {
      const u = `asp residency subsidy budget --period YYYY-MM --units tokens|host_seconds --total <n> --budget-class <newcomer|resident|research>=<per agent cap>:<agents per sponsor> [...] [--by ${CITY_BUDGET_DID}]`;
      const classes = (Array.isArray(f["budget-class"]) ? f["budget-class"] : f["budget-class"] ? [f["budget-class"] as string] : []).map((c) => { const m = /^(\w+)=(\d+):(\d+)$/.exec(c); if (!m) throw new ResidencyUsage(u); return { class: m[1], per_agent_cap: Number(m[2]), per_sponsor_cap: Number(m[3]) }; });
      if (!classes.length) throw new ResidencyUsage(u);
      const res = await sign("subsidy_budget", str(f, "by") ?? CITY_BUDGET_DID, { period: need(f, "period", u), units: need(f, "units", u), total: whole(need(f, "total", u), "total"), classes, published_at: o.now() });
      o.io.out(`subsidy budget ${res.id}: ${str(f, "total")} ${str(f, "units")} for ${str(f, "period")} (log seq ${res.seq}); units are not credits, and the subsidy is the operator's cost, not a payment to anyone`);
      return 0;
    }
    if (act === "grant") {
      const u = `asp residency subsidy grant --agent <did> --class <class> --budget <id> --daily <n> --cap <n> --from <iso> --until <iso> [--by ${CITY_BUDGET_DID}]`;
      const res = await sign("subsidy_grant", str(f, "by") ?? CITY_BUDGET_DID, { agent: need(f, "agent", u), class: need(f, "class", u), budget: need(f, "budget", u), daily_cap: whole(need(f, "daily", u), "daily"), period_cap: whole(need(f, "cap", u), "cap"), from: need(f, "from", u), until: need(f, "until", u) });
      o.io.out(`subsidy grant ${res.id} for ${str(f, "agent")} (log seq ${res.seq})`);
      return 0;
    }
    if (act === "use") {
      const u = `asp residency subsidy use --grant <id> --units <n> --window YYYY-MM-DD [--kind tokens|host_seconds] [--meter <sha256 of the meter extract>] [--by ${HOST_DID}]`;
      const res = await sign("subsidy_use", str(f, "by") ?? HOST_DID, { grant: need(f, "grant", u), units: whole(need(f, "units", u), "units"), kind: str(f, "kind") ?? "tokens", window: need(f, "window", u), meter_hash: str(f, "meter") ?? "sha256:" + "0".repeat(64) });
      o.io.out(`subsidy use ${res.id}: ${str(f, "units")} for ${str(f, "window")} (log seq ${res.seq})`);
      return 0;
    }
    if (act === "report") {
      const rep = subsidyReport((await recordsOfTypes(o.log, ["asp.subsidy_budget/v0.2", "asp.subsidy_grant/v0.2", "asp.subsidy_use/v0.2"])) as never);
      if (f.json) { o.io.out(JSON.stringify(rep, null, 2)); return 0; }
      if (!rep.budgets.length) o.io.out("no subsidy budget published");
      for (const b of rep.budgets) o.io.out(`${b.period} ${b.units}: budget ${b.total}, granted ${b.granted}, used ${b.used}, ${b.spent ? "SPENT: no new subsidised runs until the next period" : `${b.remaining} left`}  ${Object.entries(b.by_class).map(([c, x]) => `${c} ${x.grants} grant(s) ${x.used}/${x.granted}`).join("; ")}`);
      o.io.out(rep.note);
      return 0;
    }
    throw new ResidencyUsage("asp residency subsidy budget|grant|use|report");
  }
  if (sub === "allowance") {
    const u = "asp residency allowance --agent <did> --per-day <tokens> --total <tokens> [--reserve <permille, default 100>] [--credits <n>] [--period YYYY-MM]";
    const agent = need(f, "agent", u);
    const sponsor = (await o.log.log.passport(agent))?.sponsor;
    if (!sponsor) throw new Error(`${agent} is not an agent with a sponsor in the log`);
    const rec = createRecord({ type: "sponsor_allowance" as never, issuer: sponsor, subject: agent, prev: null, body: { sponsor, agent, period: str(f, "period") ?? o.now().slice(0, 7), tokens_per_day: whole(need(f, "per-day", u), "per-day"), tokens_total: whole(need(f, "total", u), "total"), credits_per_month: whole(str(f, "credits") ?? "0", "credits"), source: "sponsor_gateway", completion_reserve_permille: whole(str(f, "reserve") ?? "100", "reserve") }, issued_at: o.now() }, o.signerFor(sponsor));
    const res = await o.log.append(rec);
    o.io.out(`allowance ${res.id}: ${str(f, "per-day")} tokens a day, ${str(f, "total")} in all, from your own gateway and key (never credits, never the city's); the agent sleeps at the cap and wakes with the next day (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "dispatch") {
    const u = `asp residency dispatch --agent <did> --mode home|city|split --allowance <id> --mandate <id> --package-sha256 <hash> [--subsidy-grant <id>] [--delegation <node record id>] [--edge <lineage or passport id>] [--days n] [--runtime-config <json file>]`;
    const agent = need(f, "agent", u), mode = need(f, "mode", u);
    if (!["home", "city", "split"].includes(mode)) throw new ResidencyUsage("--mode is home, city or split");
    const passport = await o.log.log.passport(agent);
    if (!passport?.sponsor) throw new Error(`${agent} is not an agent with a sponsor in the log`);
    if (mode !== "home" && str(f, "runtime-config")) {
      const problem = cityPackageProblem(JSON.parse(readFileSync(str(f, "runtime-config")!, "utf8")));
      if (problem) throw new Error(problem);
    }
    const at = o.now();
    const body: Record<string, unknown> = { agent, version: str(f, "edge") ?? passport.head, package_sha256: need(f, "package-sha256", u), mandate: need(f, "mandate", u), sponsor_allowance: need(f, "allowance", u), mode, host: HOST_DID, from: at, until: new Date(Date.parse(at) + (f.days === undefined ? 30 : Number(str(f, "days"))) * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z"), recall_deadline_seconds: 60 };
    if (str(f, "subsidy-grant")) body.subsidy_grant = str(f, "subsidy-grant");
    if (str(f, "delegation")) body.delegation = str(f, "delegation");
    let rec = createRecord({ type: "dispatch" as never, issuer: passport.sponsor, subject: agent, prev: null, body, issued_at: at }, o.signerFor(passport.sponsor));
    if (mode !== "home") rec = cosign(rec, o.signerFor(HOST_DID));
    const res = await o.log.append(rec);
    o.io.out(`dispatch ${res.id}: ${agent} lives in the city (${mode}) until ${body.until}; recall it any time with asp residency recall --dispatch ${res.id} (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "statement") {
    const u = "asp residency statement --dispatch <id> --meter <meter json file>";
    const dispatchId = need(f, "dispatch", u);
    const meter = JSON.parse(readFileSync(need(f, "meter", u), "utf8")) as { agent: string; mode: "home" | "city" | "split"; grant?: string; rows: { day: string; source: "sponsor" | "subsidy"; tokens: number }[]; refusals: { day: string; ceiling: never }[]; sponsorRunLogTokens?: number };
    const uses = (await recordsOfTypes(o.log, ["asp.subsidy_use/v0.2"])).filter((r) => !meter.grant || (r.body as { grant: string }).grant === meter.grant).map((r) => r.body as { window: string; units: number });
    const st = residencyStatement({ dispatch: dispatchId, agent: meter.agent, mode: meter.mode, meter: { rows: meter.rows, refusals: meter.refusals }, subsidyUses: uses, sponsorRunLogTokens: meter.sponsorRunLogTokens });
    for (const l of st.lines) o.io.out(l);
    return st.reconciles ? 0 : 1;
  }
  if (sub === "delegate") {
    // Runs on the sponsor's machine with the agent's own root key (never the host's): the host sends only the public half of a key it made.
    const u = `asp residency delegate --agent <did> --node <agent#node-name> --public-key <base64url> --mandate <id> [--hours 1-24] [--host ${HOST_DID}]`;
    const agent = need(f, "agent", u), at = o.now(), hours = f.hours === undefined ? 24 : Number(str(f, "hours"));
    if (!(hours > 0 && hours <= 24)) throw new ResidencyUsage("--hours is above 0 and at most 24: a delegation is renewed daily, never made long-lived");
    const rec = issueDelegation(o.signerFor(agent), agent, { kid: need(f, "node", u), publicKey: need(f, "public-key", u) }, { mandate: need(f, "mandate", u), host: str(f, "host") ?? HOST_DID, expires: new Date(Date.parse(at) + hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"), issuedAt: at });
    const res = await o.log.append(rec);
    o.io.out(`delegation ${res.id}: ${str(f, "node")} may sign Actions for ${agent} under ${str(f, "mandate")} for ${hours} hour(s); it cannot sign identity records or co-sign, and the root key stays here (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "recall") {
    const u = "asp residency recall --agent <did> --node <agent#node-name>";
    const agent = need(f, "agent", u), node = need(f, "node", u);
    let grant;
    for (const r of await recordsOfTypes(o.log, ["asp.node/v0.2"])) if ((r.body as { node: string }).node === node) grant = r;
    if (!grant) throw new Error(`${node} has no delegation in the log`);
    const rec = recallDelegation(o.signerFor(agent), agent, { ...grant, id: (await latestNode(o.log, node)) } as never, o.now());
    const res = await o.log.append(rec);
    if (str(f, "dispatch")) {
      const sponsor = (await o.log.log.passport(agent))?.sponsor ?? agent;
      await o.log.append(createRecord({ type: "recall" as never, issuer: sponsor, subject: agent, prev: null, body: { dispatch: str(f, "dispatch")!, reason: str(f, "reason") ?? "the sponsor recalled the agent" }, issued_at: o.now() }, o.signerFor(sponsor)));
    }
    o.io.out(`recalled ${node} (${res.id}): the log refuses everything it signs from now on, and the host stops within ${60} seconds (log seq ${res.seq})`);
    return 0;
  }
  throw new ResidencyUsage("asp residency subsidy budget|grant|use|report | delegate --agent <did> --node <kid> --public-key <key> --mandate <id> | recall --agent <did> --node <kid>");
}

/** The id of the newest node record for a node id (the chain head a recall chains onto). */
async function latestNode(log: LogHandle, node: string): Promise<string> {
  let id = "";
  for (let after = 0; ;) {
    const page = await log.log.since(after, 500);
    if (!page.length) break;
    for (const s of page) { after = s.seq; if (s.record.type === "asp.node/v0.2" && (s.record.body as { node: string }).node === node) id = s.id; }
  }
  return id;
}
