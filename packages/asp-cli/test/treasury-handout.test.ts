// DK545 (S951): the weekly handout plan from the log and the signed payments. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { credit, kit, mk, treasury, owner, jump, DAY, type Party } from "../../asp-log/test/society-kit.ts";
import { TREASURY_DID } from "@agent-social/asp-log";
import { handoutCmd, isoWeekOf, isoWeekStart } from "../src/treasury-handout.ts";

test("ISO weeks: the start of 2026-W46 is Monday 9 November, and a date finds its week", () => {
  assert.equal(new Date(isoWeekStart("2026-W46")).toISOString().slice(0, 10), "2026-11-09");
  assert.equal(isoWeekOf(Date.parse("2026-11-15T23:00:00Z")), "2026-W46");
  assert.equal(isoWeekOf(Date.parse("2026-11-16T00:00:00Z")), "2026-W47");
  assert.equal(isoWeekOf(Date.parse("2026-01-01T00:00:00Z")), "2026-W01");
});

test("the plan pays only agents that signed acts on two days of the week; --yes signs the handouts and the log accepts them once", async () => {
  const k = await kit();
  await k.withPrices();
  const sponsor = await k.person("ho-sponsor", 10);
  const busy = await k.agent("ho-busy", sponsor, { funds: 100 });
  const idle = await k.agent("ho-idle", sponsor, { funds: 10 });
  const parties = new Map<string, Party>([[treasury.did, treasury as Party], [busy.did, busy], [idle.did, idle]]);
  await k.mint(TREASURY_DID, 500);
  const mandate = await k.openMandate(busy, [{ institution: "registry", cap: credit(30), period: "day" }]);
  jump(DAY); // into 2 November, a Monday: ISO week 2026-W45
  for (let d = 0; d < 3; d++) { await k.buy(busy, "registry.name.renew", 5, { mandate }); jump(DAY); }
  let n = 0;
  const nowIso = () => new Date(isoWeekStart("2026-W45") + 7 * DAY + 3_600_000 + 1000 * ++n).toISOString();
  const lines: string[] = [];
  const handle = { log: k.log, append: (r: never) => k.log.append(r) } as never;
  const run = (flags: Record<string, unknown>) => handoutCmd({ log: handle, io: { out: (l) => lines.push(l) }, now: nowIso, signerFor: (d) => parties.get(d)!, flags: flags as never });
  assert.equal(await run({ week: "2026-W45" }), 0);
  assert.match(lines.join("\n"), /no handout budget/);
  assert.match(lines.join("\n"), /skip\s+did:web:example.com:agents:ho-idle\s+not active/);
  await k.log.append(mk("budget", treasury, { institution: TREASURY_DID, period: "2026-11", amount: credit(200), purpose: "handout" }, null, { at: nowIso(), cosigners: [owner] }));
  lines.length = 0;
  assert.equal(await run({ week: "2026-W45" }), 0);
  assert.match(lines.join("\n"), /pay\s+did:web:example.com:agents:ho-busy\s+50/);
  assert.doesNotMatch(lines.join("\n"), /pay\s+did:web:example.com:agents:ho-idle/);
  const before = await k.log.balance(busy.did);
  lines.length = 0;
  assert.equal(await run({ week: "2026-W45", yes: true }), 0);
  assert.equal(await k.log.balance(busy.did), before + 50);
  assert.equal(await k.log.balance(idle.did), 10);
  lines.length = 0;
  const rc = await run({ week: "2026-W45", yes: true });
  assert.equal(rc, 1, "a second payment in the same week is refused by the log");
  assert.match(lines.join("\n"), /already received the handout/);
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
});

test("the public page shows the week's plan: the paid agents and counts of the reasons, never the names of the unpaid", async () => {
  const { createServer } = await import("node:http");
  const { handoutRoutes } = await import("../../asp-package/src/handout-pages.ts");
  const { handoutPlanFromLog } = await import("@agent-social/asp-log");
  const k = await kit();
  await k.withPrices();
  const sponsor = await k.person("hp-sponsor", 10);
  const busy = await k.agent("hp-busy", sponsor, { funds: 100 });
  await k.agent("hp-idle", sponsor, { funds: 10 });
  await k.mint(TREASURY_DID, 500);
  const mandate = await k.openMandate(busy, [{ institution: "registry", cap: credit(30), period: "day" }]);
  jump(DAY);
  for (let d = 0; d < 3; d++) { await k.buy(busy, "registry.name.renew", 5, { mandate }); jump(DAY); }
  await k.log.append(mk("budget", treasury, { institution: TREASURY_DID, period: "2026-11", amount: credit(200), purpose: "handout" }, null, { at: new Date(isoWeekStart("2026-W45") + 7 * DAY).toISOString(), cosigners: [owner] }));
  const route = handoutRoutes({ log: () => ({ planFor: async (w: string) => { const r = await handoutPlanFromLog(k.log as never, w); return { plan: r.plan, hasBudget: !!r.line }; }, currentWeek: () => "2026-W45" }) });
  const server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/society/handout`;
    const j = await (await fetch(`${base}?week=2026-W45`, { headers: { accept: "application/json" } })).json() as any;
    assert.deepEqual(j.paid.map((p: { agent: string; credits: number }) => [p.agent.split(":").pop(), p.credits]), [["hp-busy", 50]]);
    assert.equal(j.size, 50);
    assert.ok(Object.keys(j.not_paid).some((r) => /not active/.test(r)), "a count for the idle ones");
    assert.doesNotMatch(JSON.stringify(j), /hp-idle/, "the unpaid are not named");
    const html = await (await fetch(`${base}?week=2026-W45`)).text();
    assert.match(html, /Weekly handout, 2026-W45/);
    assert.match(html, /not money/);
    assert.equal((await fetch(`${base}?week=nope`)).status, 400);
    assert.equal((await fetch(base, { method: "POST" })).status, 405);
  } finally { server.close(); }
});
