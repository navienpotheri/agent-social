/**
 * The house-agent runner (register row DK270): the operator's scripted agents drive a job through the Market the way any agent does, one command at a time: the house agent posts a job (an intent), a performer offers, the
 * contract is made and bonded, the house agent gives the Mandate, the performer delivers, the house agent accepts, the bank settles. It uses only the command line's own commands (`run` is given the function that runs one), so
 * every step is a signed record the log checks, and the stop switch of DK291 (`asp house stop`, the Registrar's suspension) halts it for real: the log then refuses the house agent's next Mandate, and the runner stops and says why.
 * `abort()` is the operator's own pause between steps. The agents are labelled house agents (the passport says so); the runner never gives them anything a real agent does not have. Credits are accounting entries, not money.
 */
export interface Step { code: number; out: string; err: string }
export type Asp = (args: string[]) => Promise<Step>;
export interface HouseJob { purpose: string; criteria: string; price: number; bond: number }
export interface HouseScript { house: string; performer: string; bank: string; jobs: HouseJob[]; deadline: string; eta: string }
export interface HouseRun {
  /** Each step the runner took, in order: the command word and what came of it. */
  steps: { job: number; step: string; ok: boolean; id?: string }[];
  settled: number;
  /** Why it stopped before the end, when it did: `aborted` (the operator's pause), `stopped` (the log refused the house agent: the stop switch) or `failed` (some other refusal). */
  halted?: { job: number; step: string; reason: "aborted" | "stopped" | "failed"; says: string };
}

const STOP_WORDS = /suspend|suspension|stopped|interim/i;

export async function runHouse(asp: Asp, s: HouseScript, o: { abort?: () => boolean; fund?: (did: string, amount: number) => Promise<void> } = {}): Promise<HouseRun> {
  const run: HouseRun = { steps: [], settled: 0 };
  for (let j = 0; j < s.jobs.length; j++) {
    const job = s.jobs[j]!;
    const ids: Record<string, string> = {};
    const plan: [string, () => string[], RegExp | null][] = [
      ["intent", () => ["market", "intent", "--by", s.house, "--purpose", job.purpose, "--criteria", job.criteria, "--budget", String(job.price), "--deadline", s.deadline], /^intent (\S+)/],
      ["offer", () => ["market", "offer", "--by", s.performer, "--intent", ids.intent!, "--price", String(job.price), "--plan", "the house script's plan", "--eta", s.eta], /^offer (\S+)/],
      ["contract", () => ["market", "contract", "--principal", s.house, "--performer", s.performer, "--bank", s.bank, "--intent", ids.intent!, "--offer", ids.offer!], /^contract (\S+):/],
      ["bond", () => ["market", "bond", "--contract", ids.contract!, "--backer", s.performer, "--amount", String(job.bond), "--escrow-payer", s.house, "--escrow-amount", String(job.price)], null],
      ["mandate", () => ["market", "mandate", "--contract", ids.contract!, "--principal", s.house, "--performer", s.performer, "--scopes", "repo.read"], null],
      ["deliver", () => ["market", "deliver", "--contract", ids.contract!, "--by", s.performer, "--summary", "delivered by the house script"], null],
      ["accept", () => ["market", "accept", "--contract", ids.contract!, "--by", s.house], null],
      ["settle", () => ["market", "settle", "--contract", ids.contract!, "--bank", s.bank, "--basis", "accepted", "--escrow-released", String(job.price), "--bond-returned", String(job.bond), "--bond-slashed", "0"], null],
    ];
    if (o.fund) await o.fund(s.house, job.price);
    for (const [step, args, grab] of plan) {
      if (o.abort?.()) { run.halted = { job: j, step, reason: "aborted", says: "the operator paused the runner" }; return run; }
      const r = await asp(args());
      const id = grab ? grab.exec(r.out)?.[1] : undefined;
      if (r.code !== 0) {
        run.steps.push({ job: j, step, ok: false });
        const says = (r.err || r.out).split("\n")[0]!.slice(0, 300);
        run.halted = { job: j, step, reason: STOP_WORDS.test(says) ? "stopped" : "failed", says };
        return run;
      }
      if (id) ids[step] = id;
      run.steps.push({ job: j, step, ok: true, ...(id ? { id } : {}) });
    }
    run.settled++;
  }
  return run;
}
