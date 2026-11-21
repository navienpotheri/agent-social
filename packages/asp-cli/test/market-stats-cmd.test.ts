// asp market stats | monthly (market.md 7, 8; register row DK1453): the same figures the public routes serve, as text and as --json; a bad month is a usage error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";

async function asp(home: string, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home }, cwd: home };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("asp market stats and monthly read an empty Market without error, in text and in JSON, and refuse a bad month", async () => {
  const home = mkdtempSync(join(tmpdir(), "asp-market-stats-"));
  const text = await asp(home, ["market", "stats"]);
  assert.equal(text.code, 0, text.err);
  assert.match(text.out, /Market statistics \(whole log\)/);
  assert.match(text.out, /postings 0: open 0.*fill rate n\/a/);
  const report = await asp(home, ["market", "monthly", "--month", "2026-11"]);
  assert.equal(report.code, 0, report.err);
  assert.match(report.out, /monthly report for 2026-11/);
  const json = JSON.parse((await asp(home, ["market", "stats", "--json"])).out);
  assert.equal(json.postings.total, 0);
  assert.equal(json.fillRate, null);
  assert.equal(json.month, null);
  const bad = await asp(home, ["market", "monthly", "--month", "2026-13"]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.err, /not a month/);
});
