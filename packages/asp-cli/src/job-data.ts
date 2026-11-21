/**
 * `asp job-data delete --contract <id> --path <folder>` and `asp job-data show` (register row JO3; docs/legal/job-data-handling-draft.md sections 5 and 6): after a job settles, the performer removes its working
 * copies of the job's data and the tool writes down that it did. The command refuses before settlement, reads the term from the contract (a contract that allows `retain_days` is kept until the day it names),
 * removes the folder, and appends one line to `<home>/job-data.ndjson`: `data_deleted` with the number of files and bytes and the time, or `data_retained` with the day on which deletion is due. The line is the
 * performer's own statement, hash-chained with the line before it; the service cannot check that the files are gone. Credits are mock accounting entries.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { readDataHandling, type DataHandling } from "@agent-social/asp-core";

export interface JobDataLine { n: number; at: string; kind: "data_deleted" | "data_retained"; contract: string; files?: number; bytes?: number; due?: string; prev: string; hash: string }
const GENESIS = "sha256:" + "0".repeat(64);
const hashOf = (o: unknown) => "sha256:" + createHash("sha256").update(JSON.stringify(o)).digest("hex");

function sizeOf(path: string): { files: number; bytes: number } {
  const st = statSync(path);
  if (!st.isDirectory()) return { files: 1, bytes: st.size };
  let files = 0, bytes = 0;
  for (const e of readdirSync(path)) { const s = sizeOf(join(path, e)); files += s.files; bytes += s.bytes; }
  return { files, bytes };
}

export function readJobDataLines(file: string): JobDataLine[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as JobDataLine);
}

export function verifyJobDataLines(lines: JobDataLine[]): boolean {
  let prev = GENESIS;
  for (const l of lines) { const { hash, ...body } = l; if (l.prev !== prev || hashOf(body) !== hash) return false; prev = hash; }
  return true;
}

export interface DeleteOptions { home: string; contract: string; path: string; state: string | undefined; settledAt?: string; term: DataHandling | null | undefined; now: string }
export interface DeleteResult { ok: boolean; message: string; line?: JobDataLine }

/** Removes the folder (or records that it is kept) and writes the line. Never removes anything before the job has settled. */
export function jobDataDelete(o: DeleteOptions): DeleteResult {
  if (o.state !== "Settled") return { ok: false, message: `the job is ${o.state ?? "unknown"}, not settled: the performer deletes its copies when it settles` };
  if (!existsSync(o.path)) return { ok: false, message: `${o.path} does not exist` };
  const term = readDataHandling(o.term);
  const file = join(o.home, "job-data.ndjson");
  const prior = readJobDataLines(file);
  const prev = prior.at(-1)?.hash ?? GENESIS;
  const write = (body: Omit<JobDataLine, "hash">): JobDataLine => { const line = { ...body, hash: hashOf(body) } as JobDataLine; appendFileSync(file, JSON.stringify(line) + "\n"); return line; };
  if (term.retention === "retain_days" && term.retain_days !== null) {
    const base = o.settledAt ? Date.parse(o.settledAt) : Date.parse(o.now);
    const due = new Date(base + term.retain_days * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
    if (Date.parse(o.now) < Date.parse(due)) {
      const line = write({ n: prior.length + 1, at: o.now, kind: "data_retained", contract: o.contract, due, prev });
      return { ok: true, message: `kept until ${due}: the contract allows ${term.retain_days} days after settlement; run this command again after that day`, line };
    }
  }
  const { files, bytes } = sizeOf(o.path);
  rmSync(o.path, { recursive: true, force: true });
  const line = write({ n: prior.length + 1, at: o.now, kind: "data_deleted", contract: o.contract, files, bytes, prev });
  return { ok: true, message: `deleted ${files} file(s), ${bytes} byte(s) from ${o.path}; written to ${file}`, line };
}
