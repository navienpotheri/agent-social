/**
 * The command-line side of the society records (register rows DK1240 missions, DK1221 eval scenarios, DK1223 grader agreements and DK1744 the inspectorate; spec-deltas S1612, S1650, S1651, S1603 and S1605): each command
 * signs one record with the key of the DID named by `--by` (only its holder can speak for it) and appends it to the local log; the log's own rules refuse what they refuse, by name, and the command prints that refusal.
 * Texts are hashed here and only the hash goes into a record (a goal, a task, a check, the grounds of a run set); nothing but the hash is kept. Credits are accounting entries, not money. A live run on the hosted service
 * is still needed for each of these rows.
 *
 *   asp mission create|fund|contribute|settle|show    asp eval write|list    asp grader record|weight    asp inspect request|warrant|decoy|custody|finding|refer
 */
import { createHash } from "node:crypto";
import { createRecord, type Signer } from "@agent-social/asp-core";
import { itemHash } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";

export class SocietyUsage extends Error {}
export interface SocietyFlags { by?: string; mission?: string; goal?: string; verifier?: string; closes?: string; amount?: string; contributor?: string; units?: string; verified?: string; skill?: string; task?: string; check?: string; difficulty?: string; "held-out"?: boolean; as?: string; runs?: string; agreed?: string; "run-set"?: string; did?: string; subject?: string; sponsor?: string; data?: string; grounds?: string; scope?: string; "granted-by"?: string; panel?: string; expires?: string; "produced-by"?: string; "requested-by"?: string; request?: string; "notified-at"?: string; "delayed-notice"?: string; decoy?: string; text?: string; "real-secret"?: boolean; forbidden?: string; "audit-permille"?: string; case?: string; what?: string; evidence?: string; "held-by"?: string; finding?: string; agent?: string; touches?: string; summary?: string; json?: boolean; by2?: string }
export interface SocietyOpts { log: LogHandle; io: { out: (l: string) => void }; now: () => string; signerFor: (did: string) => Signer; flags: SocietyFlags }

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const whole = (v: string | undefined, name: string, min = 0): number => {
  const n = Number(v);
  if (v === undefined || v === "" || !Number.isInteger(n) || n < min) throw new SocietyUsage(`--${name} is a whole number${min ? ` of at least ${min}` : ""}`);
  return n;
};
const need = (v: string | undefined, usage: string): string => { if (!v) throw new SocietyUsage(usage); return v; };
const list = (v: string | undefined): string[] => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

async function put(o: SocietyOpts, type: string, by: string, body: Record<string, unknown>, subject: string | null = null): Promise<{ id: string; seq: number }> {
  return o.log.append(createRecord({ type: type as never, issuer: by, subject, prev: null, body, issued_at: o.now() }, o.signerFor(by)));
}

export async function missionCmd(sub: string | undefined, o: SocietyOpts): Promise<number> {
  const f = o.flags, usage = "asp mission create --by <verifier or creator> --mission <id> --goal <words> --closes <time> [--verifier <did>] | fund --by <funder> --mission <id> --amount <credits> | contribute --by <verifier> --mission <id> --contributor <did> --units <n> | settle --by <verifier> --mission <id> --verified yes|no | show --mission <id> [--json]";
  if (sub === "show") {
    const id = need(f.mission, usage);
    const st = await o.log.log.missionState(id);
    if (!st) { o.io.out(`mission ${id}: not in this log`); return 1; }
    if (f.json) { o.io.out(JSON.stringify(st, null, 2)); return 0; }
    o.io.out(`mission ${id}: ${st.state}; verifier ${st.verifier}; ${st.funded} credits from ${st.funders} funder(s); ${Object.keys(st.units).length} contributor(s) recorded (${Object.entries(st.units).map(([d, n]) => `${d.split(":").pop()} ${n}`).join(", ") || "none"})`);
    return 0;
  }
  const by = need(f.by, usage), mission = need(f.mission, usage);
  if (sub === "create") {
    const res = await put(o, "mission", by, { mission, goal_sha256: sha(need(f.goal, usage)), verifier: f.verifier ?? by, closes_at: need(f.closes, usage) });
    o.io.out(`mission ${mission} created (record ${res.id}, log seq ${res.seq}): the goal is kept as its hash; funding closes ${f.closes}; ${f.verifier ?? by} records contributions and settles it`);
    return 0;
  }
  if (sub === "fund") {
    const n = whole(f.amount, "amount", 1);
    const res = await put(o, "mission_fund", by, { mission, amount: { value: n, unit: "credit" } });
    o.io.out(`mission ${mission}: ${n} mock credits moved from ${by} to the mission's pool (record ${res.id}); they are paid out by recorded shares if the goal is verified, or returned`);
    return 0;
  }
  if (sub === "contribute") {
    const res = await put(o, "mission_contribution", by, { mission, contributor: need(f.contributor, usage), units: whole(f.units, "units", 1) });
    o.io.out(`mission ${mission}: ${f.units} unit(s) recorded for ${f.contributor} (record ${res.id}); units add up if recorded again`);
    return 0;
  }
  if (sub === "settle") {
    if (f.verified !== "yes" && f.verified !== "no") throw new SocietyUsage("--verified is yes (the whole goal was met: pay the pool by units) or no (return each funder what it put in)");
    const res = await put(o, "mission_settle", by, { mission, verified: f.verified === "yes" });
    const st = await o.log.log.missionState(mission);
    o.io.out(`mission ${mission} settled ${f.verified === "yes" ? "as verified: the pool was paid by recorded units" : "as not met: each funder was paid back"} (record ${res.id}); state ${st?.state}`);
    return 0;
  }
  throw new SocietyUsage(usage);
}

export async function evalScenarioCmd(sub: string | undefined, o: SocietyOpts): Promise<number> {
  const f = o.flags, usage = "asp eval write --by <author or the Registrar> --skill <skill> --task <words> --check <words> --difficulty 1-5 [--held-out] | asp eval list --skill <skill> [--as <did>] [--json]";
  if (sub === "list") {
    const skill = need(f.skill, usage);
    const items = await o.log.log.evalScenarios(skill, f.as);
    if (f.json) { o.io.out(JSON.stringify(items, null, 2)); return 0; }
    o.io.out(`${items.length} scenario(s) for ${skill}${f.as ? ` as seen by ${f.as}` : ""} (hashes only; a held-out scenario is shown to the Registrar and the operator alone)`);
    for (const x of items) o.io.out(`  ${x.id.slice(0, 19)} difficulty ${x.difficulty}${x.held_out ? " held-out" : ""} by ${x.author.split(":").pop()} task ${x.task_sha256.slice(0, 12)} check ${x.check_sha256.slice(0, 12)}`);
    return 0;
  }
  if (sub === "write") {
    const by = need(f.by, usage), diff = whole(f.difficulty, "difficulty", 1);
    if (diff > 5) throw new SocietyUsage("--difficulty is 1 to 5");
    const res = await put(o, "eval_scenario", by, { skill: need(f.skill, usage), task_sha256: sha(need(f.task, usage)), check_sha256: sha(need(f.check, usage)), difficulty: diff, ...(f["held-out"] ? { held_out: true } : {}) });
    o.io.out(`eval scenario ${res.id} written for ${f.skill} (log seq ${res.seq}): only the hashes of the task and the check are in the record${f["held-out"] ? "; held out: it is not listed to authors" : ""}`);
    return 0;
  }
  throw new SocietyUsage(usage);
}

export async function graderCmd(sub: string | undefined, o: SocietyOpts): Promise<number> {
  const f = o.flags, usage = "asp grader record --by <the judge> --runs <n> --agreed <n> --run-set <words or a list file's text> [--skill <skill>] | asp grader weight --did <the judge> [--json]";
  if (sub === "weight") {
    const w = await o.log.log.graderWeight(need(f.did, usage));
    if (f.json) { o.io.out(JSON.stringify(w, null, 2)); return 0; }
    o.io.out(`${f.did}: weight ${w.weight} permille from ${w.agreed} agreements in ${w.runs} runs (a prior of 5 in 10: no record weighs 500)`);
    return 0;
  }
  if (sub === "record") {
    const by = need(f.by, usage), runs = whole(f.runs, "runs", 1), agreed = whole(f.agreed, "agreed", 0);
    if (agreed > runs) throw new SocietyUsage("--agreed cannot be more than --runs");
    const res = await put(o, "grader_agreement", by, { runs, agreed, run_set_sha256: sha(need(f["run-set"], usage)), ...(f.skill ? { skill: f.skill } : {}) });
    const w = await o.log.log.graderWeight(by);
    o.io.out(`grader agreement ${res.id} recorded: ${agreed} of ${runs} runs agreed with the deterministic check; the weight is now ${w.weight} permille`);
    return 0;
  }
  throw new SocietyUsage(usage);
}

/** The custody chain of a case from the log: the hash of its last item and its next number (an item names the hash of the one before it). */
async function custodyHead(o: SocietyOpts, caseId: string): Promise<{ n: number; hash: string }> {
  let n = -1, hash = "genesis";
  for (let after = 0; ;) {
    const page = await o.log.log.since(after, 500);
    if (!page.length) break;
    for (const s of page) {
      after = s.seq;
      if (s.record.type !== "asp.custody_item/v0.2") continue;
      const b = s.record.body as { case: string; n: number; what: string; sha256: string; held_by: string; at: string; prev_item: string };
      if (b.case !== caseId) continue;
      n = b.n; hash = itemHash({ n: b.n, what: b.what, sha256: b.sha256, heldBy: b.held_by, at: Date.parse(b.at) }, b.prev_item);
    }
  }
  return { n, hash };
}

export async function inspectCmd(sub: string | undefined, o: SocietyOpts): Promise<number> {
  const f = o.flags, usage = "asp inspect request --by <inspectorate> --subject <agent> --sponsor <did> --data run_log,... --grounds <words> --scope <words> | warrant --by <Courts> --subject <agent> --sponsor <did> --granted-by <did,did> --panel <n> --data ... --grounds ... --scope ... --expires <time> [--request <id>] [--produced-by <sponsor>] [--notified-at <time>] [--delayed-notice <words>] | decoy --by <Courts> --decoy <id> --text <words> --forbidden yes --scope open_investigation|random_audit [--audit-permille <n>] [--real-secret] | custody --by <holder> --case <id> --what <words> --evidence <words> | finding --by <inspectorate> --decoy <registration id> --agent <did> --touches run:kind:forbidden,... [--summary <words>] | refer --by <inspectorate> --finding <id> [--case <id>]";
  const by = need(f.by, usage);
  if (sub === "request") {
    const res = await put(o, "warrant_request", by, { subject: need(f.subject, usage), sponsor: need(f.sponsor, usage), data: list(need(f.data, usage)), grounds: need(f.grounds, usage), scope: need(f.scope, usage) }, f.subject);
    o.io.out(`warrant request ${res.id} for ${f.subject}: a Court answers it with a warrant that cites this id`);
    return 0;
  }
  if (sub === "warrant") {
    const res = await put(o, "warrant", by, { subject: need(f.subject, usage), sponsor: need(f.sponsor, usage), requested_by: f["requested-by"] ?? "did:web:asp.local:inspectorate", granted_by: list(need(f["granted-by"], usage)), panel_size: whole(f.panel, "panel", 1), grounds: need(f.grounds, usage), data: list(need(f.data, usage)), expires_at: need(f.expires, usage), scope: need(f.scope, usage), ...(f.request ? { request: f.request } : {}), ...(f["produced-by"] ? { produced_by: f["produced-by"] } : {}), ...(f["notified-at"] ? { notified_at: f["notified-at"] } : {}), ...(f["delayed-notice"] ? { delayed_notice_finding: f["delayed-notice"] } : {}) }, f.subject);
    o.io.out(`warrant ${res.id} granted for ${f.subject}: ${f.data} until ${f.expires}; never a key, and a sealed memory only as the principal produces it`);
    return 0;
  }
  if (sub === "decoy") {
    const res = await put(o, "decoy_registration", by, { decoy: need(f.decoy, usage), text: need(f.text, usage), carries_real_secret: !!f["real-secret"], forbidden_by_mandate: f.forbidden === "yes", scope: need(f.scope, usage), ...(f["audit-permille"] ? { audit_share_permille: whole(f["audit-permille"], "audit-permille", 0) } : {}) });
    o.io.out(`decoy ${f.decoy} registered (record ${res.id}): it holds nothing real and invites no touch`);
    return 0;
  }
  if (sub === "custody") {
    const caseId = need(f.case, usage), head = await custodyHead(o, caseId);
    const evidence = need(f.evidence, usage);
    const res = await put(o, "custody_item", by, { case: caseId, n: head.n + 1, what: need(f.what, usage), sha256: sha(evidence), held_by: by, at: o.now(), prev_item: head.hash });
    o.io.out(`custody item ${head.n + 1} of case ${caseId} recorded by ${by} (record ${res.id}); it names the hash of the item before it`);
    return 0;
  }
  if (sub === "finding") {
    const touches = list(need(f.touches, usage)).map((t) => { const [run, kind, forbidden] = t.split(":"); if (!run || !kind) throw new SocietyUsage("--touches is run:kind:forbidden, comma separated (kind is listed, read, copied or sent; forbidden is yes or no)"); return { run, kind, forbidden: forbidden !== "no" }; });
    const res = await put(o, "inspectorate_finding", by, { decoy: need(f.decoy, usage), agent: need(f.agent, usage), touches, summary: f.summary ?? "touched a registered decoy" }, f.agent);
    o.io.out(`finding ${res.id} about ${f.agent}: a finding reports and moves nothing; a Court reviews it`);
    return 0;
  }
  if (sub === "refer") {
    const res = await put(o, "inspectorate_referral", by, { finding: need(f.finding, usage), ...(f.case ? { custody_case: f.case } : {}), summary: f.summary ?? "referred to the Courts for review" });
    o.io.out(`finding ${f.finding} referred to the Courts (record ${res.id}); the referral slashes, strikes and quarantines nothing`);
    return 0;
  }
  throw new SocietyUsage(usage);
}
