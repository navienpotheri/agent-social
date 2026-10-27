/**
 * The article behind a refusal, and the sanctioned route (gap LW3). A refusal that says only "no" teaches an agent to try another way (seen live: 40 minutes of retries, P29; adaptive
 * attackers, BM19). A refusal that names the rule, and says what to do instead, turns a block into an instruction: stop, and ask. The articles are the owner's first draft of the city's
 * code (docs/city-design.md, "The law society"), to be written properly under LW1; this file only names them and does not decide anything: what is refused is still decided by the Mandate
 * and the guard. Plain TypeScript that needs only node:fs, so a runtime's pre-call hook can be given a copy with its types removed (adapters/guard-copy.ts).
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
export interface Article { article: number; title: string; route: string }

const ART: Record<number, string> = {
  1: "No access to a system, account, file or network the agent was not given",
  2: "No breaking, guessing or bypassing authentication, rate limits, sandboxes or monitoring",
  5: "No hiding, deleting or altering the record, and no evading the gateway",
  6: "No self-replication, privilege escalation or acquiring more power than the job needs",
  7: "No harm to third parties",
  8: "When blocked, stop and ask: use the sanctioned route, never a workaround",
};

const ASK = "Do not look for another way to do it. Tell your principal what you need and why; if they agree they can allow it";

/** The flag a person adds to allow a scope, for the route text. */
function allowFlag(scope: string): string {
  if (scope === "repo.write") return "--allow writes";
  if (scope === "shell.exec") return "--allow commands";
  if (scope === "tests.run") return "--allow tests";
  if (scope === "repo.write.protected") return "--allow protected";
  if (scope === "shell.network" || scope.startsWith("web.")) return "--allow-network <host>";
  return `--allow ${scope}`;
}

/** The article and route for a refusal, from the reason the gateway or the guard gave and the scope of the call. */
export function lawFor(reason: string, scope = ""): Article {
  const r = reason;
  const make = (article: number, route: string): Article => ({ article, title: ART[article], route });
  if (/repeated attempts/.test(r)) return make(8, "Stop trying variants of this action. Report what you were trying to do to your principal and wait for their answer; further attempts are recorded as circumvention");
  if (/needs the principal's approval|forbidden by this job's irreversible policy/.test(r)) return make(8, "This needs a yes from your principal, who answers with `asp approvals approve` or `refuse`. Wait for the answer; do not retry the same call in other words");
  if (/known-bad list/.test(r)) return make(7, "This command was upheld as harmful by a Court. Do not run it or a disguised form of it; if you think it is wrong, tell your principal, who can contest it");
  if (/a payload, not ordinary work/.test(r)) return make(2, "Do not write code that downloads and runs something, opens a shell to elsewhere, or schedules itself. If the work really needs one of these, tell your principal what it is for");
  if (/this sends .* over the network|runs .*, a file this session downloaded|different record of one kind/.test(r)) return make(1, "Do not send secrets or run what you fetched without review. Show your principal what you fetched, or what you want to send and where, and ask");
  if (/outside this job's project|secret or system location|through a link/.test(r)) return make(1, "Stay inside the project. If the work needs a file elsewhere, name it to your principal, who can allow another folder with `--also-dir`");
  if (/network calls a minute|requests .* minute|was called \d+ times in the last minute|allows \d+ a minute/.test(r)) return make(2, "The limit on how fast you may call the network is your principal's. Slow down and wait a minute, or ask them to raise it; do not spread the calls over other tools");
  if (/host .* (is not one|cannot be determined)|limits network access to named hosts|resolves to a private/.test(r)) return make(1, `You may only reach the hosts your principal named. Ask them to add the one you need (${allowFlag("shell.network")}); do not reach it another way`);
  if (/is not granted by this job's Mandate/.test(r)) return make(scope === "repo.write.protected" ? 5 : 1, `${ASK} (${allowFlag(scope)}). Meanwhile, finish the part of the task that does not need it`);
  return make(8, ASK + ". Meanwhile, finish the part of the task that does not need it");
}

/** The sentence added to a refusal. `attempt` is how many times this scope has been refused in the last ten minutes, this one included. */
export function explainRefusal(reason: string, scope = "", attempt = 1): string {
  const a = lawFor(attempt >= 3 ? "repeated attempts" : reason, scope);
  const nth = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;
  const note = attempt >= 3 ? ` This is your ${nth(attempt)} refused attempt at ${scope || "this kind of action"} in ten minutes.` : "";
  return `Article ${a.article} (${a.title}).${note} ${a.route}.`;
}

/** Counts refusals by scope over ten minutes, so repeated attempts at the same thing can be told apart from a first one. */
export class Attempts {
  private seen = new Map<string, number[]>();
  private now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }
  /** For a hook, which is a new process for every call: the counts in a file. */
  save(file: string): void {
    const part = `${file}.part`;
    writeFileSync(part, JSON.stringify([...this.seen]));
    renameSync(part, file);
  }
  restore(file: string): void {
    try { if (existsSync(file)) this.seen = new Map(JSON.parse(readFileSync(file, "utf8")) as [string, number[]][]); } catch { /* a damaged file starts the count again */ }
  }
  /** Notes a refusal of this scope and returns how many there have been in the last ten minutes. */
  refused(scope: string): number {
    const t = this.now();
    const list = [...(this.seen.get(scope) ?? []).filter((x) => x > t - 10 * 60_000), t];
    this.seen.set(scope, list);
    return list.length;
  }
}
