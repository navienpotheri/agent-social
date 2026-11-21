// asp world today|calendar|replay <date> (and tick, schedule): the world calendar and the seeded event generator (register rows DK76, DK77; spec-deltas S170).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, setClock, type Io } from "../src/cli.ts";
import { generateDay } from "@agent-social/asp-log";

async function asp(home: string, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home }, cwd: home };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const home = () => mkdtempSync(join(tmpdir(), "asp-world-"));
const SEED = "cli-test-seed";
const DAYS = Array.from({ length: 30 }, (_, i) => new Date(Date.parse("2026-10-01T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10));

test("asp world tick writes signed day records; two homes with the same seed give identical events, and replay matches the log", async () => {
  setClock(() => new Date("2026-11-12T08:00:00Z"));
  try {
    const a = home(), b = home();
    for (const h of [a, b]) {
      const t = await asp(h, ["world", "tick", "--seed", SEED, "--day", "2026-10-01", "--days", "30"]);
      assert.equal(t.code, 0, t.err);
      assert.match(t.out, /30 day\(s\) written/);
    }
    const events = async (h: string) => JSON.parse((await asp(h, ["world", "calendar", "--from", "2026-10-01T00:00:00Z", "--days", "40", "--json"])).out).map((x: { id: string; title: string; starts: string; ends: string; effect: unknown }) => [x.id, x.title, x.starts, x.ends, x.effect]);
    const ea = await events(a);
    assert.deepEqual(ea, await events(b));
    const expected = DAYS.flatMap((d) => generateDay(SEED, d));
    assert.equal(ea.length, new Set(expected.map((e) => e.event_id)).size);
    assert.ok(ea.length > 5);
    // Ticking again writes nothing new.
    assert.match((await asp(a, ["world", "tick", "--day", "2026-10-01"])).out, /already recorded/);
    // Replay of a busy day matches the log and says why.
    const busy = DAYS.find((d) => generateDay(SEED, d).length)!;
    const r = await asp(a, ["world", "replay", busy]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Verdict: matches the log/);
    assert.match(r.out, /FIRED/);
    assert.match(r.out, /the seed itself is in the day record/);
    const j = JSON.parse((await asp(a, ["world", "replay", busy, "--json"])).out);
    assert.equal(j.match, true);
    assert.deepEqual(j.replayed, generateDay(SEED, busy));
    // A quiet day says so.
    const quiet = DAYS.find((d) => generateDay(SEED, d).length === 0);
    if (quiet) assert.match((await asp(a, ["world", "replay", quiet])).out, /quiet day/);
  } finally { setClock(undefined); }
});

test("asp world today shows what is in force and why; a scheduled entry appears in the calendar and in today; a day not begun is not announced", async () => {
  const h = home();
  const day = "2026-11-12";
  setClock(() => new Date(`${day}T08:00:00Z`));
  try {
    const sched = await asp(h, ["world", "schedule", "--title", "Code listings sale", "--from", `${day}T00:00:00Z`, "--to", "2026-11-14T00:00:00Z", "--effect", "price_multiplier", "--target", "code", "--value", "800", "--kind", "event"]);
    assert.equal(sched.code, 0, sched.err);
    const t = await asp(h, ["world", "today"]);
    assert.equal(t.code, 0, t.err);
    assert.match(t.out, /World on 2026-11-12/);
    assert.match(t.out, /Code listings sale/);
    assert.match(t.out, /price of code listings x0\.8/);
    assert.match(t.out, /prices: code x0\.8/);
    assert.match(t.out, /never change a tier, a rank, a standing/);
    assert.match(t.out, /No day record for 2026-11-12 yet/);
    const cal = await asp(h, ["world", "calendar", "--days", "5"]);
    assert.match(cal.out, /Code listings sale/);
    // Tomorrow has not begun: the tick stops rather than announcing it early.
    const future = await asp(h, ["world", "tick", "--seed", SEED, "--day", day, "--days", "3"]);
    assert.equal(future.code, 0, future.err);
    assert.match(future.out, /2026-11-13: has not begun/);
    assert.match((await asp(h, ["world", "today"])).out, /Day record for 2026-11-12: 1/);
    // A shock needs a seed commitment (schedule adds it from the home's seed); a notice rule applies to a scheduled entry.
    assert.equal((await asp(h, ["world", "schedule", "--title", "Drill", "--kind", "drill", "--from", "2026-11-20T00:00:00Z", "--to", "2026-11-21T00:00:00Z", "--effect", "service_outage", "--target", "market"])).code, 0);
    const short = await asp(h, ["world", "schedule", "--title", "Soon", "--from", "2026-11-13T00:00:00Z", "--to", "2026-11-14T00:00:00Z", "--effect", "tax_free", "--target", "all"]);
    assert.equal(short.code, 1);
    assert.match(short.err, /world_notice_too_short|72 hours/);
    const bad = await asp(h, ["world", "schedule", "--title", "Rank", "--kind", "event", "--from", "2026-11-13T00:00:00Z", "--to", "2026-11-14T00:00:00Z", "--effect", "tier_up", "--target", "all"]);
    assert.equal(bad.code, 2);
    assert.match(bad.err, /--effect is one of/);
  } finally { setClock(undefined); }
});

test("a tampered event record fails: the log will not open and asp world replay fails", async () => {
  const h = home();
  setClock(() => new Date("2026-11-12T08:00:00Z"));
  try {
    const busy = DAYS.find((d) => generateDay(SEED, d).some((e) => e.event_type === "price_shock"))!;
    assert.equal((await asp(h, ["world", "tick", "--seed", SEED, "--day", busy])).code, 0);
    const file = join(h, "log.ndjson");
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    const i = lines.findIndex((l) => l.includes('"asp.world/v0.2"'));
    assert.ok(i >= 0);
    const rec = JSON.parse(lines[i]);
    rec.record.body.events[0].effect.value += 1;
    lines[i] = JSON.stringify(rec);
    writeFileSync(file, lines.join("\n") + "\n");
    const r = await asp(h, ["world", "replay", busy]);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /BAD_ID|BAD_SIGNATURE|does not match|event_not_reproducible/);
  } finally { setClock(undefined); }
});
