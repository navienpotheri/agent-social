/**
 * `asp contest file | answer | case | ruling | show` (register rows AG3 and DK1607; spec-delta S1552): the route from the command line, end to end: the agent or its sponsor FILES a contest of an adverse act (a strike, a slash,
 * a Clinic diagnosis, a quarantine or a gateway refusal), the operator ANSWERS within 48 hours, the contester takes it to the Courts (`case`), a juror of the drawn panel signs a `ruling`, and `show` prints where the contest
 * stands, its clocks and what the institution undid. Each is a signed `court_act`; the log decides whether it stands and its refusal is printed as it is. Credits are accounting entries, not money.
 */
import { createRecord, type Signer } from "@agent-social/asp-core";
import type { LogHandle } from "@agent-social/asp-package";

export class ContestUsage extends Error {}
export interface ContestOpts { log: LogHandle; io: { out: (l: string) => void }; now: () => string; signerFor: (did: string) => Signer; flags: { by?: string; subject?: string; statement?: string; contest?: string; answer?: string; reason?: string; case?: string; decision?: string; json?: boolean } }

export async function contestCmd(sub: string | undefined, o: ContestOpts): Promise<number> {
  const f = o.flags;
  const usage = "asp contest file --by <agent or sponsor> --subject <record id> --statement <why> | answer --by <operator> --contest <id> --answer upheld|withdrawn --reason <text> | case --by <contester> --contest <id> | ruling --by <juror> --case <id> --decision upheld|reversed --reason <text> | show --contest <id> [--json]";
  const act = async (by: string, body: Record<string, unknown>, say: (id: string, seq: number) => string): Promise<number> => {
    try {
      const res = await o.log.append(createRecord({ type: "court_act" as never, issuer: by, subject: null, prev: null, body, issued_at: o.now() }, o.signerFor(by)));
      o.io.out(say(res.id, res.seq));
      return 0;
    } catch (e) { o.io.out(`refused by the log: ${(e as Error).message}`); return 1; }
  };
  if (sub === "file") {
    if (!f.by || !f.subject || !f.statement) throw new ContestUsage(usage);
    return act(f.by, { act: "contest", subject: f.subject, statement: f.statement }, (id, seq) => `contest ${id} filed (log seq ${seq}): the operator answers within 48 hours (asp contest show --contest ${id.slice(0, 19)}...)`);
  }
  if (sub === "answer") {
    if (!f.by || !f.contest || !f.answer || !f.reason) throw new ContestUsage(usage);
    if (f.answer !== "upheld" && f.answer !== "withdrawn") throw new ContestUsage("--answer is upheld or withdrawn");
    return act(f.by, { act: "contest_answer", contest: f.contest, answer: f.answer, reasons: [f.reason] }, (id, seq) => `answer ${id} signed (log seq ${seq}): ${f.answer}${f.answer === "withdrawn" ? "; the institution undoes the act" : "; the contester may take it to the Courts"}`);
  }
  if (sub === "case") {
    if (!f.by || !f.contest) throw new ContestUsage(usage);
    return act(f.by, { act: "contest_case", contest: f.contest }, (id, seq) => `case ${id} lodged (log seq ${seq}): the Courts decide within 72 hours`);
  }
  if (sub === "ruling") {
    if (!f.by || !f.case || !f.decision || !f.reason) throw new ContestUsage(usage);
    if (f.decision !== "upheld" && f.decision !== "reversed") throw new ContestUsage("--decision is upheld or reversed");
    return act(f.by, { act: "contest_ruling", case: f.case, decision: f.decision, reasons: [f.reason] }, (id, seq) => `ruling ${id} signed (log seq ${seq}): ${f.decision}${f.decision === "reversed" ? "; the institution undoes the act" : ""}`);
  }
  if (sub === "show") {
    if (!f.contest) throw new ContestUsage(usage);
    const c = await o.log.log.contestOf(f.contest, o.now());
    if (!c) { o.io.out(`${f.contest} is not a contest in this log`); return 1; }
    if (f.json) { o.io.out(JSON.stringify(c, null, 2)); return 0; }
    o.io.out(`contest ${c.id.slice(0, 19)} of ${c.subject.slice(0, 19)} for ${c.agent}: ${c.state.replace("_", " ")}; opened ${c.at}; the operator answers by ${c.operatorDueAt}${c.operatorOverdue ? " (overdue)" : ""}${c.courtsDueAt ? `; the Courts by ${c.courtsDueAt}${c.courtsOverdue ? " (overdue)" : ""}` : ""}`);
    if (c.effects) o.io.out(`  undone: ${JSON.stringify(c.effects)}`);
    return 0;
  }
  throw new ContestUsage(usage);
}
