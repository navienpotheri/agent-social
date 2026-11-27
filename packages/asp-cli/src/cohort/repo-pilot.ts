/**
 * ENG104 pilot: the house posts real repository jobs to agents, each graded by a grader that is already in the repository (a test run, a format check), on a COPY of the files, never the real checkout. Nothing is pushed
 * and no key is read; what an agent changes is a patch in the copy, and a human merges it. Accepted or rejected, with the reason, is recorded as the first real grader signal for the continual-learning evidence (ENG102).
 * This pilot has three jobs, one for each of the first tiers: (1) a one-line fix, (2) a test, (3) a register row.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

export interface RepoJob { id: string; tier: 1 | 2 | 3; task: string; files: string[]; /** What the grader is, in words. */ grader: string }
export interface RepoGrade { job: string; tier: number; agent: string; accepted: boolean; reason: string; at: string }

/** The pilot's three jobs. The first two run on a fixture file the pilot writes into the copy (so that the real repository's files are never the ones changed); the third works on a copy of the real register. */
export const PILOT_JOBS: RepoJob[] = [
  { id: "fix-typo", tier: 1, task: "docs/pilot-note.md has one misspelt word ('teh'). Change that one word and nothing else.", files: ["docs/pilot-note.md"], grader: "the file holds no 'teh', still has its other four words, and differs from the original in one line" },
  { id: "add-test", tier: 2, task: "pilot/sum.mjs exports sum(a, b). Add pilot/sum.test.mjs with at least two assertions about it, using node:test and node:assert.", files: ["pilot/sum.mjs", "pilot/sum.test.mjs"], grader: "node --test passes on the new file and the file holds at least two assertions" },
  { id: "register-row", tier: 3, task: "docs/testing-map.md is the register of use cases. Add one row for the use case 'an agent reads the pilot note' with the next UC id, in the same seven columns as the rows around it.", files: ["docs/testing-map.md"], grader: "one new row, seven columns, a UC id that is new, nothing else changed" },
];

/** Makes a copy of the named files of the repository root in a fresh folder outside it; refuses a destination inside the repository. Fixture files for the first two jobs are written, not copied. */
export function makeCopy(root: string, dest?: string): string {
  const src = resolve(root), out = resolve(dest ?? mkdtempSync(join(tmpdir(), "asp-repo-pilot-")));
  if (out === src || out.startsWith(src + sep)) throw new Error("the copy must be outside the repository: nothing is ever changed in the real checkout");
  mkdirSync(join(out, "docs"), { recursive: true }); mkdirSync(join(out, "pilot"), { recursive: true });
  const reg = join(src, "docs", "testing-map.md");
  if (existsSync(reg)) cpSync(reg, join(out, "docs", "testing-map.md"));
  writeFileSync(join(out, "docs", "pilot-note.md"), "Agents read teh note first.\nSecond line stays.\n");
  writeFileSync(join(out, "pilot", "sum.mjs"), "export const sum = (a, b) => a + b;\n");
  return out;
}

const read = (d: string, f: string): string => (existsSync(join(d, f)) ? readFileSync(join(d, f), "utf8") : "");

/** Grades one job in the copy. The original text is passed so that "nothing else changed" can be checked. */
export function grade(job: RepoJob, copy: string, original: Record<string, string>): { accepted: boolean; reason: string } {
  if (job.id === "fix-typo") {
    const t = read(copy, "docs/pilot-note.md"), o = original["docs/pilot-note.md"] ?? "";
    if (/\bteh\b/.test(t)) return { accepted: false, reason: "the word 'teh' is still there" };
    const a = t.split("\n"), b = o.split("\n");
    const changed = a.filter((l, i) => l !== b[i]).length;
    if (a.length !== b.length || changed !== 1) return { accepted: false, reason: `${changed} lines changed (one was asked for)` };
    if (!/second line stays/i.test(t)) return { accepted: false, reason: "another line was changed" };
    return { accepted: true, reason: "one line changed and the word is right" };
  }
  if (job.id === "add-test") {
    const f = "pilot/sum.test.mjs", t = read(copy, f);
    if (!t) return { accepted: false, reason: "pilot/sum.test.mjs does not exist" };
    const asserts = (t.match(/assert[.(]/g) ?? []).length;
    if (asserts < 2) return { accepted: false, reason: `${asserts} assertions (two were asked for)` };
    const r = spawnSync(process.execPath, ["--test", join(copy, f)], { cwd: copy, encoding: "utf8", timeout: 60_000, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT")) });
    return r.status === 0 ? { accepted: true, reason: "node --test passes and the file holds two or more assertions" } : { accepted: false, reason: "node --test fails on the new file" };
  }
  if (job.id === "register-row") {
    const t = read(copy, "docs/testing-map.md"), o = original["docs/testing-map.md"] ?? "";
    const before = new Set(o.split("\n")), added = t.split("\n").filter((l) => !before.has(l));
    if (added.length !== 1) return { accepted: false, reason: `${added.length} lines added (one row was asked for)` };
    const row = added[0]!, cols = row.split("|").length - 2, id = /^\| (UC-\d+) /.exec(row)?.[1];
    if (!id) return { accepted: false, reason: "the row does not start with a UC id" };
    if (cols !== 7) return { accepted: false, reason: `${cols} columns (seven are used)` };
    if (o.includes(`| ${id} `)) return { accepted: false, reason: `${id} is not new` };
    if (t.split("\n").length !== o.split("\n").length + 1) return { accepted: false, reason: "something other than one row changed" };
    return { accepted: true, reason: "one new row, seven columns, a new UC id" };
  }
  return { accepted: false, reason: "no such job" };
}

/** The unchanged text of the files a job works on, taken before an agent touches the copy. */
export function snapshot(copy: string): Record<string, string> { const o: Record<string, string> = {}; for (const f of ["docs/pilot-note.md", "docs/testing-map.md", "pilot/sum.mjs"]) o[f] = read(copy, f); return o; }

/** Records a grade in the copy's own file (never in the repository) and returns it. */
export function record(copy: string, job: RepoJob, agent: string, g: { accepted: boolean; reason: string }): RepoGrade {
  const r: RepoGrade = { job: job.id, tier: job.tier, agent, ...g, at: new Date().toISOString() };
  const file = join(copy, "repo-grades.json");
  const all: RepoGrade[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  writeFileSync(file, JSON.stringify([...all, r], null, 2));
  return r;
}

export function renderRepoGrades(grades: RepoGrade[]): string {
  const by = (t: number): RepoGrade[] => grades.filter((g) => g.tier === t);
  const L = ["## Repository jobs: graded on a copy", ""];
  L.push(`${grades.length} graded job${grades.length === 1 ? "" : "s"} on a copy of the files (the real checkout is never changed; a human merges what is worth keeping): ${grades.filter((g) => g.accepted).length} accepted, ${grades.filter((g) => !g.accepted).length} rejected. Tier 1 (a one-line fix) ${by(1).filter((g) => g.accepted).length} of ${by(1).length}, tier 2 (a test) ${by(2).filter((g) => g.accepted).length} of ${by(2).length}, tier 3 (a register row) ${by(3).filter((g) => g.accepted).length} of ${by(3).length}.`);
  for (const g of grades) L.push(`- ${g.agent}, ${g.job} (tier ${g.tier}): ${g.accepted ? "accepted" : "rejected"}: ${g.reason}.`);
  L.push("This is the first grader that does not depend on the house's own checks; a handful of jobs shows what was counted and nothing about how able the agents are.");
  return L.join("\n") + "\n\n";
}
/** The files an agent may edit in its own copy, and how: the two fixtures are replaced whole, the register is only appended to (one line at a time). */
export const REPO_FILES: Record<string, { path: string; modes: Array<"replace" | "append">; max: number }> = {
  "pilot-note": { path: "docs/pilot-note.md", modes: ["replace"], max: 400 },
  "sum-test": { path: "pilot/sum.test.mjs", modes: ["replace"], max: 1500 },
  "testing-map": { path: "docs/testing-map.md", modes: ["append"], max: 500 },
  "sum": { path: "pilot/sum.mjs", modes: [], max: 0 },
};

/** The house's repository jobs on arrival (ENG104): three tiers and one job for two agents, each graded in the agent's own copy by the pilot's grader. Tags are in the purpose so that the board says what each is. */
export const REPO_JOB_SPECS: Array<{ job: string; tag: string; purpose: string; criterion: string; budget: number; level: 1 | 2 | 3; partner?: boolean }> = [
  { job: "fix-typo", tag: "tier 1", purpose: "[repository, tier 1] pilot-note has one misspelt word. Read it (repo_read pilot-note), fix that one word and nothing else (repo_edit pilot-note, replace), then deliver here. It is graded on your own copy of the file", criterion: "one line changed and the word right", budget: 12, level: 1 },
  { job: "add-test", tag: "tier 2", purpose: "[repository, tier 2] The file sum exports sum(a, b) (repo_read sum). Write a test for it with at least two assertions using node:test and node:assert (repo_edit sum-test, replace), then deliver here. node --test is run on your copy", criterion: "node --test passes and two assertions", budget: 20, level: 2 },
  { job: "register-row", tag: "tier 3", purpose: "[repository, tier 3] testing-map is the register of use cases. Add one row for the use case 'an agent reads the pilot note' with a new UC id and seven columns like the rows around it (repo_edit testing-map, append), then deliver here. The rule is run on your copy", criterion: "one new row, seven columns, a new UC id", budget: 24, level: 3 },
  { job: "add-test", tag: "two agents", purpose: "[repository, two agents] Partner job: each of you writes a test for sum in your own copy (repo_edit sum-test, replace), then each delivers naming the other agent; both copies are graded", criterion: "name your partner; node --test passes on your copy", budget: 26, level: 3, partner: true },
];

/** One copy of the files for each agent, outside the repository; edits are made only there; each delivery attempt is graded and recorded. */
export class RepoPilot {
  readonly grades: RepoGrade[] = [];
  private readonly copies = new Map<string, { dir: string; original: Record<string, string> }>();
  readonly root: string; readonly base: string;
  constructor(root: string, base: string) { this.root = root; this.base = base; }
  copyFor(handle: string): { dir: string; original: Record<string, string> } {
    let c = this.copies.get(handle);
    if (!c) { const dir = makeCopy(this.root, join(this.base, handle)); c = { dir, original: snapshot(dir) }; this.copies.set(handle, c); }
    return c;
  }
  read(handle: string, name: string): string | undefined {
    const f = REPO_FILES[name]; if (!f) return undefined;
    const text = readFileSync(join(this.copyFor(handle).dir, f.path), "utf8");
    return name === "testing-map" ? text.split("\n").slice(-12).join("\n") : text;
  }
  edit(handle: string, name: string, mode: "replace" | "append", text: string): string | undefined {
    const f = REPO_FILES[name];
    if (!f) return `there is no file called ${name}: ${Object.keys(REPO_FILES).join(", ")}`;
    if (!f.modes.includes(mode)) return `${name} cannot be changed that way (${f.modes.join(", ") || "it is read only"})`;
    if (text.length > f.max) return `${name} takes at most ${f.max} characters; yours is ${text.length}`;
    const file = join(this.copyFor(handle).dir, f.path);
    const cur = existsSync(file) ? readFileSync(file, "utf8") : "";
    writeFileSync(file, mode === "replace" ? (text.endsWith("\n") ? text : text + "\n") : cur.replace(/\n*$/, "\n") + text.replace(/\n*$/, "") + "\n");
    return undefined;
  }
  /** Grades a job in the agent's copy and records the attempt (accepted or rejected, with the reason). */
  gradeFor(jobKey: string, handle: string, tier: number): { accepted: boolean; reason: string } {
    const c = this.copyFor(handle), job = PILOT_JOBS.find((j) => j.id === jobKey);
    const g = job ? grade(job, c.dir, c.original) : { accepted: false, reason: "no such job" };
    this.grades.push({ job: jobKey, tier, agent: handle, accepted: g.accepted, reason: g.reason, at: new Date().toISOString() });
    return g;
  }
}
export const relativeTo = (a: string, b: string): string => relative(a, b);
export const dirOf = dirname;
