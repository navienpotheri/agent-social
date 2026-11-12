/**
 * `asp research list|show|post|submit|check|award|close|run` (docs/institutions/research-commons.md; register row DK31): the research board. The Research office is the operator's in the beta (its key signs post, award,
 * close and run); the Auditor's key signs the checks of an executable problem. A finding is paid only against a passing check, and the submitter never runs the check that decides. Credits are accounting entries, not money.
 */
import { createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { RESEARCH_DID, SUBMIT_SERVICE, researchBoard, runChecker, runResearch, sha256Text } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";
import { SpendUsage, spendCmd } from "./spend.ts";

export class ResearchUsage extends Error {}

export interface ResearchOpts {
  log: LogHandle;
  io: { out: (l: string) => void };
  now: () => string;
  signerFor: (did: string) => Signer;
  readJson: (path: string) => unknown;
  readText: (path: string) => string;
  flags: { by?: string; mandate?: string; json?: boolean; file?: string; finding?: string; "run-log"?: string; summary?: string; nonce?: string; artifact?: string[] };
}

const USAGE = "asp research list [--json] | show <problem> | post --file <problem.json> | submit <problem> --by <agent> --finding <file> --run-log <action id> --summary <text> [--mandate <id>] | check <submission> --by <runner did> [--artifact <file>] | award --file <award.json> | close <problem> | run";

export async function researchCmd(sub: string | undefined, rest: string[], o: ResearchOpts): Promise<number> {
  const f = o.flags, out = o.io.out;
  const need = (v: string | undefined, what: string): string => { if (!v) throw new ResearchUsage(`${what} is needed: ${USAGE}`); return v; };
  const acts = async () => (await o.log.log.recordsOfTypes(["research_act"])) as AspRecord[];
  const sign = (by: string, body: Record<string, unknown>) => createRecord({ type: "research_act", issuer: by, subject: null, prev: null, body, issued_at: o.now() }, o.signerFor(by));

  if (sub === "list") {
    const b = researchBoard(await acts(), o.now());
    if (f.json) { out(JSON.stringify(b, null, 2)); return 0; }
    if (!b.length) { out("the research board has no problems"); return 0; }
    for (const p of b) out(`  ${p.id}  ${p.status.padEnd(9)} reward ${String(p.reward).padStart(4)}  by ${p.deadline}  ${p.checker}  ${p.title}  (${p.submissions} submission(s))`);
    return 0;
  }
  if (sub === "show") {
    const id = need(rest[0], "a problem id");
    const r = (await acts()).find((x) => x.id === id && (x.body as { act: string }).act === "problem");
    if (!r) { out(`${id} is not a research problem`); return 1; }
    out(JSON.stringify({ id, ...(r.body as object), status: researchBoard(await acts(), o.now()).find((p) => p.id === id)?.status }, null, 2));
    return 0;
  }
  if (sub === "post") {
    const res = await o.log.append(sign(RESEARCH_DID, { act: "problem", ...(o.readJson(need(f.file, "--file <json>")) as object) }));
    out(`problem posted (record ${res.id}, log seq ${res.seq}); its reward is reserved from the pool`);
    return 0;
  }
  if (sub === "submit") {
    const by = need(f.by, "--by <agent>"), problem = need(rest[0], "a problem id");
    const text = o.readText(need(f.finding, "--finding <file>"));
    const lines: string[] = [];
    try { const code = await spendCmd("buy", [SUBMIT_SERVICE], { log: o.log, io: { out: (l) => lines.push(l) }, now: o.now, signerFor: o.signerFor, flags: { by, mandate: f.mandate, nonce: f.nonce } }); if (code) { out(lines.join("\n")); return code; } } catch (e) { if (e instanceof SpendUsage) throw new ResearchUsage(e.message); throw e; }
    const purchase = /purchase (sha256:[0-9a-f]{64})/.exec(lines.join("\n"))?.[1] ?? "";
    const res = await o.log.append(sign(by, { act: "submission", problem, purchase, finding_sha256: sha256Text(text), summary: need(f.summary, "--summary <text>"), evidence: [need(f["run-log"], "--run-log <Action id>")] }));
    out(`submitted (record ${res.id}, log seq ${res.seq}); the Auditor checks it, and the reward is paid only if the check passes`);
    return 0;
  }
  if (sub === "check") {
    const by = need(f.by, "--by <runner did>"), id = need(rest[0], "a submission id");
    const all = await acts();
    const s = all.find((x) => x.id === id && (x.body as { act: string }).act === "submission");
    if (!s) { out(`${id} is not a submission`); return 1; }
    const problem = all.find((x) => x.id === (s.body as { problem: string }).problem)!;
    const checker = (problem.body as { checker: { kind: string; ref: string } }).checker;
    if (checker.kind !== "executable") throw new ResearchUsage("a replication problem is checked by an independent agent signing a finding_check by hand");
    const artifact = f.artifact?.[0] ? o.readText(f.artifact[0]) : "";
    if (sha256Text(artifact) !== (s.body as { finding_sha256: string }).finding_sha256) { out("the artifact does not match the submitted finding's hash"); return 1; }
    const v = runChecker(checker.ref, problem.id, artifact);
    const res = await o.log.append(sign(by, { act: "finding_check", submission: id, kind: "executable", result: v.result, details_sha256: sha256Text(v.details), variant: "none", reasons: [v.details] }));
    out(`${v.result}: ${v.details} (record ${res.id})`);
    return 0;
  }
  if (sub === "award") {
    const res = await o.log.append(sign(RESEARCH_DID, { act: "award", ...(o.readJson(need(f.file, "--file <json>")) as object) }));
    out(`award signed, the pool paid (record ${res.id}, log seq ${res.seq})`);
    return 0;
  }
  if (sub === "close") {
    const res = await o.log.append(sign(RESEARCH_DID, { act: "problem_close", problem: need(rest[0], "a problem id") }));
    out(`problem closed (record ${res.id}); the unspent reservation is back in the pool`);
    return 0;
  }
  if (sub === "run") {
    const run = await runResearch({ append: (r) => o.log.append(r), recordsOfTypes: (t) => o.log.log.recordsOfTypes(t) as Promise<AspRecord[]>, priceLists: () => o.log.log.priceLists() as Promise<AspRecord[]>, balance: (d) => o.log.log.balance(d) as Promise<number> }, o.signerFor(RESEARCH_DID), o.now());
    out(`receipts ${run.receipts.length}`);
    for (const r of run.refused) out(`  refused   ${r.what}${r.agent ? ` for ${r.agent}` : ""}: ${r.rule}`);
    return 0;
  }
  throw new ResearchUsage(USAGE);
}
