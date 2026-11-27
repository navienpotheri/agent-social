/**
 * Research and Commons, the research board (docs/institutions/research-commons.md; register row DK31; spec-delta S290). Pure functions and constants: the submission price, the built-in deterministic checkers the
 * Auditor runs, the board view, and the Research office's pass. The log's rules are in research-rules.ts. The checkers here are small deterministic functions, not a sandbox: the sandboxed runner with hidden variants is
 * a separate row (DK190). Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import { createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { institutionDid, type Split } from "./economy.ts";
import type { CatalogueItem, ShopsIo } from "./shops.ts";

export const RESEARCH_DID = institutionDid("research");
export const SUBMIT_SERVICE = "research.submit";
export const MAX_SUBMISSIONS_PER_PROBLEM = 3;
export const MIN_DEADLINE_MS = 7 * 86_400_000;
/** Proposal: the finder 80 percent, up to two replicators 10 percent each (research-commons.md 4). */
export const DEFAULT_SPLIT = { finder: 800, replicator: 100 } as const;

const split = (): Split => ({ treasury_permille: 150, burn_permille: 50, payees: [{ account: RESEARCH_DID, permille: 800 }] });
export const RESEARCH_CATALOGUE: CatalogueItem[] = [{ service: SUBMIT_SERVICE, institution: RESEARCH_DID, price: 2, split: split(), class: "standard" }];

export interface Checker { kind: "executable" | "replication"; ref: string; runner: string }

/**
 * The deterministic checkers the Auditor runs (executable problems). `leading-zero-bits:N`: the SHA-256 of the problem id and the artifact text has at least N leading zero bits (a nonce is the finding).
 * `contains-all:a,b`: the artifact text contains every listed word. A checker never sees a secret and never runs the artifact as code.
 */
export function runChecker(ref: string, problem: string, artifact: string): { result: "pass" | "fail"; details: string } {
  const [name, arg = ""] = [ref.slice(0, ref.indexOf(":") < 0 ? ref.length : ref.indexOf(":")), ref.indexOf(":") < 0 ? "" : ref.slice(ref.indexOf(":") + 1)];
  if (name === "leading-zero-bits") {
    const bits = Number(arg);
    const h = createHash("sha256").update(problem + artifact).digest();
    let zeros = 0;
    for (const byte of h) { if (byte === 0) { zeros += 8; continue; } zeros += Math.clz32(byte) - 24; break; }
    return { result: Number.isInteger(bits) && zeros >= bits ? "pass" : "fail", details: `${zeros} leading zero bits, ${bits} needed` };
  }
  if (name === "contains-all") {
    const words = arg.split(",").filter(Boolean);
    const missing = words.filter((w) => !artifact.includes(w));
    return { result: words.length && !missing.length ? "pass" : "fail", details: missing.length ? `missing ${missing.join(", ")}` : "every required word is present" };
  }
  return { result: "fail", details: `no such checker: ${name}` };
}
export const sha256Text = (s: string): string => `sha256:${createHash("sha256").update(s).digest("hex")}`;

const isAct = (r: AspRecord) => r.type === "asp.research_act/v0.2";
const body = (r: AspRecord) => r.body as Record<string, any>;

export interface ProblemView { id: string; title: string; domain: string[]; reward: number; status: "open" | "solved" | "closed" | "scheduled"; deadline: string; submissions: number; checker: string; awarded: number }

/** The board at `at`: each problem with its state, derived from the records. */
export function board(records: AspRecord[], at: string): ProblemView[] {
  const t = Date.parse(at);
  const acts = records.filter(isAct);
  return acts.filter((r) => body(r).act === "problem").map((r) => {
    const b = body(r);
    const awards = acts.filter((x) => body(x).act === "award" && body(x).problem === r.id);
    const closed = acts.some((x) => body(x).act === "problem_close" && body(x).problem === r.id);
    const status = closed ? "closed" : awards.some((a) => body(a).role === "finder") ? "solved" : t < Date.parse(b.opens) ? "scheduled" : "open";
    return { id: r.id, title: b.title, domain: b.domain ?? [], reward: b.reward, status, deadline: b.deadline, submissions: acts.filter((x) => body(x).act === "submission" && body(x).problem === r.id).length, checker: `${b.checker.kind}:${b.checker.ref}`, awarded: awards.reduce((n, a) => n + body(a).amount, 0) };
  });
}

/** The reconciliation of the research pool (DK31): submission fees split by the price list, Treasury payments in, awards out, and the balance the records give. */
export function researchReconciliation(records: AspRecord[], poolBalance: number): { submissions: number; fees: number; pool_share: number; grants: number; awards: number; reserved: number; balanced: boolean } {
  const lists = new Map(records.filter((r) => r.type === "asp.price_list/v0.2").map((r) => [r.id, (r.body as { items: CatalogueItem[] }).items]));
  let fees = 0, pool = 0, n = 0;
  for (const p of records) {
    if (p.type !== "asp.purchase/v0.2") continue;
    const pb = p.body as { service: string; price_list: string; amount: { value: number }; institution: string };
    if (pb.institution !== RESEARCH_DID) continue;
    const item = lists.get(pb.price_list)?.find((i) => i.service === pb.service);
    if (!item) continue;
    const burn = Math.floor((pb.amount.value * item.split.burn_permille) / 1000), tr = Math.floor((pb.amount.value * item.split.treasury_permille) / 1000);
    fees += pb.amount.value; pool += pb.amount.value - burn - tr; n++;
  }
  const grants = records.filter((r) => r.type === "asp.treasury_payment/v0.2" && (r.body as { to: string }).to === RESEARCH_DID).reduce((a, r) => a + (r.body as { amount: { value: number } }).amount.value, 0);
  const acts = records.filter(isAct);
  const awards = acts.filter((r) => body(r).act === "award").reduce((a, r) => a + body(r).amount, 0);
  const done = new Set(acts.filter((r) => body(r).act === "problem_close").map((r) => body(r).problem));
  const reserved = acts.filter((r) => body(r).act === "problem" && !done.has(r.id)).reduce((a, r) => a + body(r).reward - acts.filter((x) => body(x).act === "award" && body(x).problem === r.id).reduce((m, x) => m + body(x).amount, 0), 0);
  return { submissions: n, fees, pool_share: pool, grants, awards, reserved, balanced: grants + pool - awards === poolBalance };
}

export interface ResearchRun { receipts: string[]; refused: { what: string; agent?: string; rule: string }[] }
/** The office's pass: a delivered receipt for each submission fee (the fee buys the right to submit and a check). */
export async function runResearch(io: ShopsIo, office: Signer, now: string): Promise<ResearchRun> {
  const run: ResearchRun = { receipts: [], refused: [] };
  const records = await io.recordsOfTypes(["purchase", "receipt", "research_act"]);
  const answered = new Set(records.filter((r) => r.type === "asp.receipt/v0.2").map((r) => (r.body as { purchase: string }).purchase));
  for (const s of records.filter((r) => isAct(r) && body(r).act === "submission")) {
    const p = body(s).purchase as string;
    if (answered.has(p)) continue;
    const rc = createRecord({ type: "receipt", issuer: RESEARCH_DID, subject: null, prev: p, body: { purchase: p, status: "delivered", delivered_ref: s.id }, issued_at: now }, office);
    try { await io.append(rc); run.receipts.push(rc.id); answered.add(p); } catch (e) { run.refused.push({ what: "receipt", agent: s.issuer, rule: (e as { detail?: string }).detail ?? String(e) }); }
  }
  return run;
}
