/**
 * The standing jobs kept on this machine (`<home>/standing.json`), one for each agent and permission set, shared by every session of that agent (register row T3). Two sessions started in the same moment
 * (two terminals) used to read the file, change their copy and write it back, so one could lose the other's session count, or both could make a standing job and the second overwrite the first. `claimStanding`
 * now reads again under the file lock, adopts a job another session made in the meantime, and adds this session to the count in the same step.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withFileLock } from "@agent-social/asp-log";

export interface StandingJob { contract: string; agent: string; key: string; createdAt: string; expiresAt: string; scopes: string[]; hosts: string[]; gate?: string[]; sessions: number }

export const standingPath = (home: string) => join(home, "standing.json");
export function readStanding(home: string): Record<string, StandingJob> { try { return JSON.parse(readFileSync(standingPath(home), "utf8")); } catch { return {}; } }
export function writeStanding(home: string, s: Record<string, StandingJob>): void { mkdirSync(home, { recursive: true }); writeFileSync(standingPath(home), JSON.stringify(s, null, 2) + "\n"); }

/**
 * Takes a session on the standing job `job` (made by this session when `created`). Under the lock, on a fresh read: a job under the same key that has another contract and was made after this session
 * looked is adopted instead of this one (`adopted` says so); the count is the stored count plus one. `countThisSession` is false for `--prepare`, which only makes sure the job exists.
 */
export function claimStanding(home: string, key: string, job: StandingJob, created: boolean, countThisSession = true): { job: StandingJob; adopted: boolean } {
  let out!: { job: StandingJob; adopted: boolean };
  mkdirSync(home, { recursive: true });
  withFileLock(standingPath(home), () => {
    const all = readStanding(home);
    const there = all[key];
    const adopted = !!(created && there && there.contract !== job.contract);
    const base = adopted ? there! : (there && there.contract === job.contract ? there : job);
    const use: StandingJob = { ...base, sessions: base.sessions + (countThisSession ? 1 : 0) };
    all[key] = use;
    writeStanding(home, all);
    out = { job: use, adopted };
  });
  return out;
}
export const standingExists = (home: string) => existsSync(standingPath(home));
