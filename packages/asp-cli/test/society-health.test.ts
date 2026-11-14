// asp society health (register row DK77): the command on a log with nothing in it, and the figure on a log with finished jobs. The measures are tested in packages/asp-log/test/society-health.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { activityFromRecords } from "@agent-social/asp-log";

async function asp(home: string, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home }, cwd: home };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("asp society health on an empty log: a quiet society is the alarm it names, exit 1; --days is checked", async () => {
  const home = mkdtempSync(join(tmpdir(), "asp-health-"));
  const r = await asp(home, ["society", "health", "--days", "7"]);
  assert.equal(r.code, 1, r.err);
  assert.match(r.out, /Society health, the last 7 days: 0 finished job\(s\)/);
  assert.match(r.out, /ALARM QUIET/);
  const j = await asp(home, ["society", "health", "--days", "7", "--json"]);
  assert.equal(JSON.parse(j.out).alarms[0].id, "QUIET");
  const bad = await asp(home, ["society", "health", "--days", "1"]);
  assert.equal(bad.code, 2);
});

test("finished jobs are read from the log's records: an accepted settlement joined to its contract gives the performer, the price and the kind; a ruling or an unknown contract is left out", () => {
  const rec = (id: string, type: string, issued_at: string, body: unknown, issuer = "did:web:bank") => ({ id, record: { type, issuer, issued_at, body } });
  const { activity } = activityFromRecords([
    rec("c1", "asp.contract/v0.2", "2026-11-01T09:00:00Z", { performer: "did:web:a", price: { value: 120, unit: "credit" }, verification: "oracle" }),
    rec("s1", "asp.settlement/v0.2", "2026-11-02T09:00:00Z", { contract: "c1", basis: "accepted" }),
    rec("s2", "asp.settlement/v0.2", "2026-11-02T10:00:00Z", { contract: "c1", basis: "ruling" }),
    rec("s3", "asp.settlement/v0.2", "2026-11-02T11:00:00Z", { contract: "nope", basis: "accepted" }),
  ] as never);
  assert.equal(activity.length, 1);
  assert.deepEqual([activity[0].agent, activity[0].price, activity[0].kind], ["did:web:a", 120, "oracle"]);
});
