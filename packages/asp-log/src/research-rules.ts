/**
 * The log's rules for the research board (research-commons.md 3 and 5; register row DK31; spec-delta S290): a problem (the Research office; its reward reserved from the pool), a submission (an agent: its own paid
 * fee, a signed Action of its own as evidence), a finding check (the problem's designated runner, or an independent replicator), an award (the office; the log pays the pool to the awardee) and the closing of an unsolved problem.
 * State lives in markers written inside the append, so a refused record leaves none. Nothing here reads or writes a reputation row.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import { MAX_SUBMISSIONS_PER_PROBLEM, MIN_DEADLINE_MS, RESEARCH_DID, SUBMIT_SERVICE, type Checker } from "./research.ts";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);

export interface ResearchEnv {
  operator?: string;
  reputation(rd: LogTx, did: string): Promise<{ tier: number } | null>;
  debit(tx: LogTx, did: string, amount: number): Promise<void>;
  credit(tx: LogTx, did: string, amount: number): Promise<void>;
}

interface ProblemState { checker: Checker; reward: number; split: { finder: number; replicator: number }; min_tier: number; opens: string; deadline: string; max_awards: number; reserved: number; paid: number; status: "open" | "closed"; submissions: string[]; finder?: string }
const getJson = async <T>(tx: Pick<LogTx, "getMarker">, key: string): Promise<T | undefined> => { const raw = await tx.getMarker(key); return raw ? (JSON.parse(raw) as T) : undefined; };
const putJson = (tx: LogTx, key: string, v: unknown) => tx.putMarker(key, JSON.stringify(v));
const sponsorOf = async (tx: LogTx, did: string): Promise<string> => (await tx.getPassport(did))?.sponsor ?? did;
const ADD = async (tx: LogTx, delta: number) => tx.putMarker("research_reserved", String(Number((await tx.getMarker("research_reserved")) ?? 0) + delta));

interface SubState { problem: string; author: string; sha: string; checks: { id: string; kind: string; result: string; signer: string }[] }

export async function projectResearchAct(tx: LogTx, r: AspRecord, env: ResearchEnv): Promise<void> {
  const b = r.body as Record<string, any>;
  if (r.prev !== null) throw rule("research_act_not_chained", "a research act starts its own chain (prev is null)");
  const t = Date.parse(r.issued_at);
  const fromOffice = () => { if (r.issuer !== RESEARCH_DID) throw rule("research_act_wrong_issuer", `${r.issuer} is not the Research office (${RESEARCH_DID}): only it signs a ${b.act}`); };
  const loadProblem = async (id: string): Promise<ProblemState> => { const p = await getJson<ProblemState>(tx, `rproblem:${id}`); if (!p) throw rule("problem_unknown", `${id} is not a research problem in this log`); return p; };

  if (b.act === "problem") {
    fromOffice();
    if (Date.parse(b.deadline) < t + MIN_DEADLINE_MS) throw rule("problem_deadline_too_soon", "a problem stays open at least 7 days");
    if (!(Date.parse(b.opens) >= t && Date.parse(b.opens) < Date.parse(b.deadline))) throw rule("problem_bad_times", "a problem opens now or later and before its deadline");
    const c = b.checker as Checker;
    if (c.kind === "executable" && !/^(leading-zero-bits|contains-all):/.test(c.ref)) throw rule("problem_unknown_checker", `${c.ref} is not a checker the Auditor runs`);
    if (b.split.finder + 2 * b.split.replicator > 1000) throw rule("problem_split_invalid", "the finder's and two replicators' shares add up to at most 1000 permille");
    const reserved = Number((await tx.getMarker("research_reserved")) ?? 0);
    const balance = (await tx.getAccount(RESEARCH_DID))?.balance ?? 0;
    if (b.reward > balance - reserved) throw rule("pool_underfunded", `the reward is ${b.reward} and the research pool holds ${balance} with ${reserved} already reserved: a reward is never above the pool`);
    await ADD(tx, b.reward);
    await putJson(tx, `rproblem:${r.id}`, { checker: c, reward: b.reward, split: b.split, min_tier: b.min_tier ?? 1, opens: b.opens, deadline: b.deadline, max_awards: b.max_awards ?? 3, reserved: b.reward, paid: 0, status: "open", submissions: [] } satisfies ProblemState);
    return;
  }

  if (b.act === "problem_close") {
    fromOffice();
    const p = await loadProblem(b.problem);
    if (p.status === "closed") throw rule("problem_closed", "the problem is already closed");
    if (t < Date.parse(p.deadline) && !p.finder) throw rule("problem_not_expired", `an unsolved problem closes at its deadline (${p.deadline})`);
    await ADD(tx, -(p.reserved - p.paid));
    await putJson(tx, `rproblem:${b.problem}`, { ...p, status: "closed" });
    return;
  }

  if (b.act === "submission") {
    const agent = r.issuer;
    const p = await loadProblem(b.problem);
    if (p.status !== "open") throw rule("problem_closed", "the problem is closed");
    if (t < Date.parse(p.opens)) throw rule("problem_not_open", `the problem opens at ${p.opens}`);
    if (t >= Date.parse(p.deadline)) throw rule("problem_expired", `the deadline was ${p.deadline}`);
    if (!(await tx.getPassport(agent))) throw rule("submission_no_passport", `${agent} has no passport in this log`);
    const rep = await env.reputation(tx, agent);
    if ((rep?.tier ?? 0) < p.min_tier) throw rule("submission_min_tier", `this problem needs tier ${p.min_tier}; ${agent} is tier ${rep?.tier ?? 0}`);
    const mine = Number((await tx.getMarker(`rsub_count:${b.problem}|${agent}`)) ?? 0);
    if (mine >= MAX_SUBMISSIONS_PER_PROBLEM) throw rule("submission_cap", `at most ${MAX_SUBMISSIONS_PER_PROBLEM} submissions an agent for one problem`);
    if (await tx.getMarker(`rfinding:${b.problem}|${b.finding_sha256}`)) throw rule("duplicate_finding", "an identical finding was submitted before: the first one is the finder's");
    const fee = await tx.getRecord(b.purchase);
    const fb = fee?.record.body as { service?: string; institution?: string } | undefined;
    if (!fee || fee.record.type !== "asp.purchase/v0.2" || fee.record.issuer !== agent || fb?.service !== SUBMIT_SERVICE || fb?.institution !== RESEARCH_DID) throw rule("submission_fee_missing", `a submission is paid with the agent's own purchase of ${SUBMIT_SERVICE}`);
    if (await tx.getMarker(`rsub_fee:${b.purchase}`)) throw rule("submission_fee_used", "this purchase already paid for a submission");
    for (const id of b.evidence as string[]) {
      const a = await tx.getRecord(id);
      const ab = a?.record.body as { assurance?: string } | undefined;
      if (!a || a.record.type !== "asp.action/v0.2" || a.record.issuer !== agent) throw rule("evidence_not_yours", `${id} is not a signed Action of the submitter: evidence is the submitter's own run log`);
      if (!["gateway_observed", "gateway_enforced", "hook_enforced", "sandbox_enforced"].includes(ab?.assurance ?? "")) throw rule("evidence_too_weak", `the Action ${id} is ${ab?.assurance ?? "unmarked"}: evidence is gateway-observed or stronger`);
    }
    await putJson(tx, `rsub:${r.id}`, { problem: b.problem, author: agent, sha: b.finding_sha256, checks: [] } satisfies SubState);
    await tx.putMarker(`rsub_count:${b.problem}|${agent}`, String(mine + 1));
    await tx.putMarker(`rfinding:${b.problem}|${b.finding_sha256}`, r.id);
    await tx.putMarker(`rsub_fee:${b.purchase}`, r.id);
    await putJson(tx, `rproblem:${b.problem}`, { ...p, submissions: [...p.submissions, r.id] });
    return;
  }

  if (b.act === "finding_check") {
    const s = await getJson<SubState>(tx, `rsub:${b.submission}`);
    if (!s) throw rule("submission_unknown", `${b.submission} is not a submission in this log`);
    const p = await loadProblem(s.problem);
    if (b.kind !== p.checker.kind) throw rule("check_wrong_kind", `the problem is checked by ${p.checker.kind}, not ${b.kind}`);
    if (b.kind === "executable") {
      if (r.issuer !== p.checker.runner) throw rule("check_wrong_runner", `${r.issuer} is not the problem's designated runner (${p.checker.runner})`);
    } else {
      if ((await sponsorOf(tx, r.issuer)) === (await sponsorOf(tx, s.author)) || r.issuer === s.author) throw rule("replicator_not_independent", "a replicator's sponsor is neither the submitter's nor the submitter");
      if (s.checks.some((c) => c.signer === r.issuer)) throw rule("replicator_twice", "a replicator signs one check of a submission");
      if (s.checks.filter((c) => c.kind === "replication").length >= 2) throw rule("replications_full", "at most 2 replications count");
    }
    s.checks.push({ id: r.id, kind: b.kind, result: b.result, signer: r.issuer });
    await putJson(tx, `rsub:${b.submission}`, s);
    return;
  }

  if (b.act === "award") {
    fromOffice();
    const s = await getJson<SubState>(tx, `rsub:${b.submission}`);
    if (!s || s.problem !== b.problem) throw rule("award_submission_mismatch", "the submission is not for this problem");
    const p = await loadProblem(b.problem);
    if (p.status !== "open" && p.status !== undefined && p.status === "closed") throw rule("problem_closed", "the problem is closed");
    const passing = s.checks.filter((c) => c.result === "pass");
    const needed = p.checker.kind === "executable" ? 1 : 2;
    const cited = new Set<string>(b.checks);
    if (passing.filter((c) => cited.has(c.id)).length < needed) throw rule("award_checks_missing", `${p.checker.kind === "executable" ? "a passing check by the runner" : "two independent passing replications"} must be cited and on record`);
    if (b.role === "finder") {
      if (b.awardee !== s.author) throw rule("award_not_the_author", "the finder award goes to the submission's author");
      if (p.finder) throw rule("finder_exists", "one finder award per problem");
      // The finder is the first accepted submission by log order: no earlier submission with a passing check.
      for (const id of p.submissions) { if (id === b.submission) break; const e = await getJson<SubState>(tx, `rsub:${id}`); if (e?.checks.some((c) => c.result === "pass") && e.author !== s.author) throw rule("not_first_finder", `the earlier submission ${id} already has a passing check: the first accepted submission is the finder`); }
      if (b.amount !== Math.floor((p.reward * p.split.finder) / 1000)) throw rule("award_not_by_split", `the finder's share is ${Math.floor((p.reward * p.split.finder) / 1000)}`);
    } else {
      if (!p.finder) throw rule("replicator_before_finder", "a replicator is paid after the finder");
      if (!passing.some((c) => c.kind === "replication" && c.signer === b.awardee && cited.has(c.id))) throw rule("award_not_a_replicator", "a replicator award goes to an agent whose passing replication is cited");
      if (await tx.getMarker(`raward:${b.submission}|${b.awardee}`)) throw rule("award_exists", "this replicator is already paid");
      if (b.amount !== Math.floor((p.reward * p.split.replicator) / 1000)) throw rule("award_not_by_split", `a replicator's share is ${Math.floor((p.reward * p.split.replicator) / 1000)}`);
    }
    if (env.operator && (await sponsorOf(tx, b.awardee)) === env.operator) throw rule("award_operator_agent", "an agent of the operator is never awarded");
    if (p.paid + b.amount > p.reward) throw rule("award_exceeds_pool", `the awards would add up to ${p.paid + b.amount} and the problem's reward is ${p.reward}`);
    await env.debit(tx, RESEARCH_DID, b.amount);
    await env.credit(tx, b.awardee, b.amount);
    await tx.putMarker(`raward:${b.submission}|${b.awardee}`, r.id);
    await putJson(tx, `rproblem:${b.problem}`, { ...p, paid: p.paid + b.amount, ...(b.role === "finder" ? { finder: b.submission } : {}) });
    await ADD(tx, -b.amount);
  }
}
