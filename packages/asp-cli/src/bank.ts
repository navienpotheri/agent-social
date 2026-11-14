/**
 * `asp bank line | default | statement | show` (bank-insurer.md; register row DK19; spec-delta S280): a credit line for a newcomer's first bond, the Bank's signed default against the guarantor, a statement, and
 * what a holder owes. The Bank's key is the operator's during the beta; the borrower and the guarantor countersign the line with their own keys. Credits are accounting entries, not money.
 */
import { cosign, createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { BANK_DID, TREASURY_DID, rewardFor } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";

export class BankUsage extends Error {}

export interface BankOpts {
  log: LogHandle;
  io: { out: (l: string) => void; err: (l: string) => void };
  now: () => string;
  signerFor: (did: string) => Signer;
  flags: { deposit?: string; budget?: string; contract?: string; agent?: string; amount?: string; guarantor?: string; line?: string; holder?: string; by?: string; days?: string };
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Every credit line and default in the log, in order. */
async function bankRecords(log: LogHandle): Promise<{ id: string; type: string; body: Record<string, unknown>; at: string }[]> {
  const out: { id: string; type: string; body: Record<string, unknown>; at: string }[] = [];
  for (let after = 0; ;) {
    const page = await log.log.since(after, 500);
    if (!page.length) break;
    for (const s of page) { after = s.seq; if (s.record.type === "asp.credit_line/v0.2" || s.record.type === "asp.credit_default/v0.2") out.push({ id: s.id, type: s.record.type, body: s.record.body as Record<string, unknown>, at: s.record.issued_at }); }
  }
  return out;
}

export async function bankCmd(sub: string | undefined, o: BankOpts): Promise<number> {
  const f = o.flags;
  const by = f.by ?? BANK_DID;
  if (sub === "line") {
    if (!f.contract || !f.agent || !f.guarantor) throw new BankUsage(`asp bank line --contract <id> --agent <borrower did> --guarantor <the agent's sponsor> [--amount <credits, default the whole bond: 20>] [--days 1-14] [--by ${BANK_DID}]`);
    const amount = f.amount === undefined ? 20 : Math.trunc(Number(f.amount));
    const days = f.days === undefined ? 7 : Number(f.days);
    if (!(amount > 0)) throw new BankUsage("--amount is a whole number of credits above 0");
    if (!(days > 0 && days <= 14)) throw new BankUsage("--days is above 0 and at most 14 (an undrawn line lapses)");
    const at = o.now();
    const body = { borrower: f.agent, guarantor: f.guarantor, contract: f.contract, amount: { value: amount, unit: "credit" as const }, fee: 0, due: iso(Date.parse(at) + days * DAY) };
    let rec: AspRecord = createRecord({ type: "credit_line", issuer: by, subject: f.agent, prev: null, body, issued_at: at }, o.signerFor(by));
    rec = cosign(rec, o.signerFor(f.agent));
    rec = cosign(rec, o.signerFor(f.guarantor));
    const res = await o.log.append(rec);
    o.io.out(`credit line ${res.id}: ${amount} credits for ${f.agent}'s bond on ${f.contract}, guaranteed by ${f.guarantor}, no fee, drawn when the bond is posted, repaid from the first settlement, lapses ${body.due} (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "default") {
    if (!f.line) throw new BankUsage(`asp bank default --line <credit line id> [--by ${BANK_DID}]`);
    const all = await bankRecords(o.log);
    const line = all.find((r) => r.id === f.line && r.type === "asp.credit_line/v0.2");
    if (!line) throw new Error(`${f.line} is not a credit line in the log`);
    const mark = await o.log.log.get(f.line);
    void mark;
    const unpaid = Number(f.amount);
    if (!(unpaid > 0)) throw new BankUsage("--amount is what the settlement left unpaid (asp bank show --agent <did> prints it)");
    const rec = createRecord({ type: "credit_default", issuer: by, subject: line.body.borrower as string, prev: null, body: { line: f.line, unpaid: { value: unpaid, unit: "credit" }, against: line.body.guarantor }, issued_at: o.now() }, o.signerFor(by));
    const res = await o.log.append(rec);
    o.io.out(`default ${res.id}: ${unpaid} credits unpaid on ${f.line}, debited from ${line.body.guarantor as string} up to what it holds; any remainder blocks new lines for its agents (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "statement") {
    if (!f.holder) throw new BankUsage(`asp bank statement --holder <did> [--amount <owed to the Bank>] [--by ${BANK_DID}]`);
    const balance = await o.log.log.balance(f.holder);
    const owed = f.amount === undefined ? 0 : Number(f.amount);
    const at = o.now();
    const rec = createRecord({ type: "bank_statement", issuer: by, subject: f.holder, prev: null, body: { holder: f.holder, period: at.slice(0, 7), balance: { value: balance, unit: "credit" }, owed: { value: owed, unit: "credit" } }, issued_at: at }, o.signerFor(by));
    const res = await o.log.append(rec);
    o.io.out(`statement ${res.id}: ${f.holder} holds ${balance} credits and owes the Bank ${owed} (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "deposit") {
    // Lock credits with the Bank for 30 days (DK294): the holder signs, the Bank countersigns; the credits sit in the deposit account and return whole at term.
    if (!f.holder || !f.amount) throw new BankUsage("asp bank deposit --holder <did> --amount <credits>");
    const amount = Math.trunc(Number(f.amount));
    if (!(amount > 0)) throw new BankUsage("--amount is a whole number of credits above 0");
    const rec = cosign(createRecord({ type: "deposit_act" as never, issuer: f.holder, subject: f.holder, prev: null, body: { act: "deposit", holder: f.holder, amount: { value: amount, unit: "credit" } }, issued_at: o.now() }, o.signerFor(f.holder)), o.signerFor(BANK_DID));
    const res = await o.log.append(rec);
    o.io.out(`deposit ${res.id}: ${amount} credits locked with the Bank for 30 days (log seq ${res.seq}); a reward of 1 % a completed month is paid by the Treasury within its co-signed budget, at most 50 credits a month to you; withdraw from day 30: asp bank withdraw --deposit ${res.id}`);
    return 0;
  }
  if (sub === "withdraw") {
    if (!f.deposit) throw new BankUsage("asp bank withdraw --deposit <id>");
    const d = await o.log.log.get(f.deposit);
    if (!d || d.record.type !== "asp.deposit_act/v0.2") throw new Error(`${f.deposit} is not a deposit in the log`);
    const holder = (d.record.body as { holder: string }).holder;
    const res = await o.log.append(createRecord({ type: "deposit_act" as never, issuer: holder, subject: holder, prev: null, body: { act: "withdraw", deposit: f.deposit }, issued_at: o.now() }, o.signerFor(holder)));
    o.io.out(`withdrawn ${res.id}: the deposit returned whole (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "reward") {
    // The Treasury pays one completed month's reward on a deposit, from a co-signed Bank budget with purpose deposit_reward.
    if (!f.deposit || !f.budget) throw new BankUsage("asp bank reward --deposit <id> --budget <id> [--by did:web:asp.local:treasury]");
    const d = await o.log.log.get(f.deposit);
    if (!d || d.record.type !== "asp.deposit_act/v0.2") throw new Error(`${f.deposit} is not a deposit in the log`);
    const b = d.record.body as { holder: string; amount: { value: number } };
    const by = f.by ?? TREASURY_DID;
    const res = await o.log.append(createRecord({ type: "deposit_act" as never, issuer: by, subject: b.holder, prev: null, body: { act: "reward", deposit: f.deposit, budget: f.budget, amount: { value: rewardFor(b.amount.value), unit: "credit" } }, issued_at: o.now() }, o.signerFor(by)));
    o.io.out(`reward ${res.id}: ${rewardFor(b.amount.value)} credits from the Treasury to ${b.holder} (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "show") {
    const all = await bankRecords(o.log);
    const lines = all.filter((r) => r.type === "asp.credit_line/v0.2" && (!f.agent || r.body.borrower === f.agent));
    o.io.out(`the Bank's reserve: ${await o.log.log.balance(BANK_DID)} credits`);
    for (const l of lines) {
      const d = all.find((r) => r.type === "asp.credit_default/v0.2" && r.body.line === l.id);
      o.io.out(`  ${l.id}  ${l.body.borrower as string}  ${(l.body.amount as { value: number }).value} credits for ${l.body.contract as string}  guarantor ${l.body.guarantor as string}  ${d ? `DEFAULTED (${d.id})` : `due ${l.body.due as string}`}`);
    }
    if (!lines.length) o.io.out("no credit line");
    return 0;
  }
  throw new BankUsage("asp bank line --contract <id> --agent <did> --guarantor <sponsor did> | default --line <id> --amount <n> | statement --holder <did> | deposit --holder <did> --amount <n> | withdraw --deposit <id> | reward --deposit <id> --budget <id> | show [--agent <did>]");
}
