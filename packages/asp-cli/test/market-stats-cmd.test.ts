// asp market stats | monthly (market.md 7, 8; register row DK1453): the same figures the public routes serve, as text and as --json; a bad month is a usage error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
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

test("asp market dynamics (DK1456) reads the season, demand, guide prices and waves on a log with no day recorded, in text and JSON", async () => {
  const home = mkdtempSync(join(tmpdir(), "asp-market-dynamics-"));
  const text = await asp(home, ["market", "dynamics", "--at", "2026-05-12T12:00:00Z"]);
  assert.equal(text.code, 0, text.err);
  assert.match(text.out, /Market dynamics \(asp-market-dynamics\/1\)/);
  assert.match(text.out, /seed not revealed yet/);
  assert.match(text.out, /season 2026 Q2: the building season.*favours skilled/);
  assert.match(text.out, /guide price by class: trivial 5 credits/);
  assert.match(text.out, /no entrant wave announced/);
  const json = JSON.parse((await asp(home, ["market", "dynamics", "--at", "2026-05-12T12:00:00Z", "--json"])).out);
  assert.equal(json.halted, false);
  assert.equal(json.demand.length, 5);
  assert.ok(json.demand.every((d: { index: number }) => d.index === 1000));
});

test("asp market risk (DK1455): show says none is in force, replay of a candidate on an empty log counts nothing, suggest refuses an unknown offer, publish needs a key", async () => {
  const home = mkdtempSync(join(tmpdir(), "asp-market-risk-"));
  const show = await asp(home, ["market", "risk", "show"]);
  assert.equal(show.code, 0, show.err);
  assert.match(show.out, /no risk model is in force/);
  const file = join(home, "terms.json");
  writeFileSync(file, JSON.stringify({ class_permille: { trivial: 0, routine: 100, skilled: 0, critical: 0 }, verification_permille: { deterministic: 0, principal: 0, arbiter: 0 }, poster_permille: 0, escrow_share_permille: 900 }));
  const replay = await asp(home, ["market", "risk", "replay", "--file", file]);
  assert.equal(replay.code, 0, replay.err);
  assert.match(replay.out, /replay over 90 days: 0 settled contract\(s\)/);
  const bad = await asp(home, ["market", "risk", "suggest", "--offer", "sha256:" + "0".repeat(64)]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.err, /not an offer/);
  const noKey = await asp(home, ["market", "risk", "publish", "--file", file, "--effective", "2027-01-01T00:00:00Z", "--by", "did:web:asp.local:treasury"]);
  assert.notEqual(noKey.code, 0);
  assert.match(noKey.err, /no key for/);
  assert.notEqual((await asp(home, ["market", "risk", "nonsense"])).code, 0);
});
