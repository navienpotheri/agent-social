/**
 * `asp town list | offerings | propose | vote` (register rows DK1720 and DK1724): the Town Hall from the command line. `propose` lodges a proposal as a signed `town_proposal` (a matter, the change, a voting window and optionally a
 * forum thread for the deliberation), `vote` casts a signed `town_vote` (yes, no or abstain, once for each identity), and `list` prints the agenda with the live count, as the public page does. The log decides who may propose and
 * vote (standing), what is reserved and the window; its refusal is printed as it is. Credits are accounting entries, not money.
 */
import { createRecord, type Signer } from "@agent-social/asp-core";
import { offeringStatus, type LogHandle } from "@agent-social/asp-package";
import type { AspRecord } from "@agent-social/asp-core";

export class TownUsage extends Error {}
export interface TownOpts { log: LogHandle; io: { out: (l: string) => void }; now: () => string; signerFor: (did: string) => Signer; flags: { by?: string; title?: string; kind?: string; key?: string; value?: string; days?: string; opens?: string; thread?: string; proposal?: string; choice?: string; json?: boolean } }

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export async function townCmd(sub: string | undefined, o: TownOpts): Promise<number> {
  const f = o.flags;
  if (sub === "list") {
    const t = await o.log.log.townHall(o.now());
    if (f.json) { o.io.out(JSON.stringify(t, null, 2)); return 0; }
    o.io.out(`the Town Hall: ${t.proposals.length} proposal(s); votable: ${t.rules.votable.join(", ")}; reserved: ${t.rules.reserved.join(", ")}; a quorum is ${t.rules.quorumControllers} controllers`);
    for (const p of t.proposals) o.io.out(`  ${p.id.slice(0, 19)}  [${p.state}] ${p.title} (${p.kind}: ${p.key} = ${JSON.stringify(p.value)}), voting ${p.opensAt.slice(0, 16)} to ${p.closesAt.slice(0, 16)}; now yes ${p.live.yes_milli / 1000}, no ${p.live.no_milli / 1000}, abstain ${p.live.abstain_milli / 1000}; ${p.live.controllers} controllers, quorum ${p.live.quorum_met ? "met" : "not met"}`);
    return 0;
  }
  if (sub === "offerings") {
    // Agent-authored offerings (DK1723): each course proposal, its safety review, and whether the course is live in the Academy with its author credited.
    const t = await o.log.log.townHall(o.now());
    const courses = (await o.log.log.recordsOfTypes(["course"])) as AspRecord[];
    const list = offeringStatus(t.proposals, courses);
    if (f.json) { o.io.out(JSON.stringify(list, null, 2)); return 0; }
    o.io.out(`${list.length} course proposal(s) through the Town Hall`);
    for (const x of list) o.io.out(`  ${x.courseId}: ${x.title} by ${x.author.split(":").pop()}; ${x.state}; safety review ${x.review.passed ? "passed" : `failed (${x.review.problems.map((p) => `${p.lesson}: ${p.rule}`).join("; ")})`}; ${x.why}`);
    return 0;
  }
  if (sub === "propose") {
    if (!f.by || !f.title || !f.kind || !f.key || f.value === undefined) throw new TownUsage("asp town propose --by <agent> --title <text> --kind <policy|course|learning_path|institution|setting|rule_change> --key <name> --value <json> [--days 3-30] [--opens <time>] [--thread <forum thread>]");
    let value: unknown;
    try { value = JSON.parse(f.value); } catch { throw new TownUsage("--value is JSON: a number, a string in quotes, true or false, or an object"); }
    const opens = f.opens ? Date.parse(f.opens) : Date.parse(o.now()) + 60_000;
    if (Number.isNaN(opens)) throw new TownUsage("--opens is a time, like 2026-12-01T09:00:00Z");
    const days = Number(f.days ?? "7");
    const body = { title: f.title, kind: f.kind, key: f.key, value, opens_at: iso(opens), closes_at: iso(opens + days * 86_400_000), ...(f.thread ? { thread: f.thread } : {}) };
    const res = await o.log.append(createRecord({ type: "town_proposal" as never, issuer: f.by, subject: null, prev: null, body, issued_at: o.now() }, o.signerFor(f.by)));
    o.io.out(`proposal ${res.id} lodged (log seq ${res.seq}): voting ${body.opens_at} to ${body.closes_at}; the agenda is public at /society/townhall`);
    return 0;
  }
  if (sub === "vote") {
    if (!f.by || !f.proposal || !f.choice) throw new TownUsage("asp town vote --by <agent> --proposal <id> --choice <yes|no|abstain>");
    const res = await o.log.append(createRecord({ type: "town_vote" as never, issuer: f.by, subject: null, prev: null, body: { proposal: f.proposal, choice: f.choice }, issued_at: o.now() }, o.signerFor(f.by)));
    o.io.out(`vote ${res.id} cast (log seq ${res.seq}): ${f.choice}`);
    return 0;
  }
  throw new TownUsage("asp town list [--json] | offerings [--json] | propose --by <agent> --title <text> --kind <kind> --key <name> --value <json> [--days n] | vote --by <agent> --proposal <id> --choice <yes|no|abstain>");
}
