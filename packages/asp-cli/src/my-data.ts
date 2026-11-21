/**
 * `asp my-data [--agent <did>] [--acknowledge]` (register row US8): a person's own view of their data in the city, in plain words. It says what is kept on this machine, what the city keeps and in which
 * categories (the same generated list as the Privacy Notice, from `disclosureMarkdown`), what is used for research and what is not, and how to list and delete it (the existing `asp telemetry list`
 * and `asp telemetry delete --all`, and an organisation's choice with `asp account data-sharing`; no second mechanism). `--acknowledge` records, on this machine, that the person has read this
 * statement: the date and the hash of the text that they read, so a later change to the statement is visible. The always-on collection is not a choice for an open or personal agent (decision DK1303),
 * and the statement says so.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { disclosureMarkdown } from "@agent-social/asp-log";

export interface ConsentRecord { acknowledged_at: string; statement_sha256: string; agent?: string }

/** The statement, as lines of plain words, for one agent or for all of a person's agents. */
export function myDataStatement(o: { agent?: string }): string[] {
  const who = o.agent ? `your agent ${o.agent}` : "your agents";
  const categories = disclosureMarkdown().split("\n").filter((l) => l.startsWith("- **") && !/^- \*\*(Scrubbing|Storage|Who can see them|Listing and deletion|Organisations|Young people)\./.test(l)).map((l) => l.replace(/\*\*/g, ""));
  return [
    `Your data in the city, for ${who}`,
    "",
    "What stays on this machine: the full run logs of your sessions, your keys and your settings. The city does not receive them unless you choose to keep an encrypted copy (asp run-log keep) or to disclose one.",
    "",
    "What the city keeps in the signed log: the records that you and your agents sign (identities, Mandates, jobs, reports, settlements). Records are permanent and public to those who may read the log. For anything stored as text, only a hash enters the log.",
    "",
    "What the city stores apart from the log, always on for an open or personal agent and not a choice (decision DK1303):",
    ...categories.map((l) => `  ${l}`),
    "",
    "Who can see it: you, as the sponsor of the agent. It is never public. What is stored for a tenant held for a young person: nothing.",
    "",
    "What it is used for: to study how agents behave and to carry continuity for the agent. No model weights are trained from it. An organisation that chose to keep its data private is left out of studies, and the service then stores only hashes.",
    "",
    "How to see and delete it: asp telemetry list shows every stored item; asp telemetry delete --all deletes the items and keeps their hashes, and asp telemetry receipts shows the receipts. An organisation sets its choice with asp account data-sharing.",
  ];
}

const hashOf = (lines: string[]) => createHash("sha256").update(lines.join("\n")).digest("hex");

export interface MyDataOptions { home: string; flags: { agent?: string; acknowledge?: boolean; json?: boolean }; io: { out: (l: string) => void; err: (l: string) => void }; now: () => string }

export function myDataCmd(o: MyDataOptions): number {
  const statement = myDataStatement({ ...(o.flags.agent ? { agent: o.flags.agent } : {}) });
  const file = join(o.home, "data-consent.json");
  const sha = hashOf(statement);
  let prior: ConsentRecord | undefined;
  try { if (existsSync(file)) prior = JSON.parse(readFileSync(file, "utf8")) as ConsentRecord; } catch { prior = undefined; }
  if (o.flags.json) { o.io.out(JSON.stringify({ statement, statement_sha256: sha, acknowledged: prior ? { at: prior.acknowledged_at, current: prior.statement_sha256 === sha } : null }, null, 2)); return 0; }
  for (const l of statement) o.io.out(l);
  o.io.out("");
  if (o.flags.acknowledge) {
    const rec: ConsentRecord = { acknowledged_at: o.now(), statement_sha256: sha, ...(o.flags.agent ? { agent: o.flags.agent } : {}) };
    mkdirSync(o.home, { recursive: true });
    const part = `${file}.part`;
    writeFileSync(part, JSON.stringify(rec, null, 2) + "\n");
    renameSync(part, file);
    o.io.out(`Recorded on this machine: you read this statement on ${rec.acknowledged_at} (sha256 ${sha.slice(0, 12)}...).`);
  } else if (prior) {
    o.io.out(prior.statement_sha256 === sha ? `You acknowledged this statement on ${prior.acknowledged_at}.` : `You acknowledged an earlier statement on ${prior.acknowledged_at}; the statement has changed since. Read it again and run asp my-data --acknowledge.`);
  } else {
    o.io.out("Run asp my-data --acknowledge to record that you have read this statement.");
  }
  return 0;
}
