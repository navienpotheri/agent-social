/**
 * `asp events` (register rows DK36, DK37; spec-delta S272): the commands over a real log (the rules are tested in packages/asp-log/test/events.test.ts). Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type AspRecord, type Signer } from "@agent-social/asp-core";
import { ENTRY_SERVICE, EVENTS_DID, TREASURY_DID } from "@agent-social/asp-log";
import { EventsUsage, eventsCmd } from "../src/events.ts";
import { events, shopsWorld } from "../../asp-log/test/shops-kit.ts";
import { credit, jump, mk, nowIso, owner, tick, treasury, type Party } from "../../asp-log/test/society-kit.ts";

const HOUR = 3_600_000;
const SHA = "sha256:" + "a".repeat(64);
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

test("the office issues a contest, four sponsors' agents enter, the result pays, the office delivers, and the agents read their souvenirs and who they met", async () => {
  const w = await shopsWorld();
  const log = w.log;
  const crew: { a: Party; mandate: string; contract: string }[] = [];
  for (let s = 1; s <= 4; s++) {
    const sponsor = await w.k.person(`cli-s${s}`, 10);
    const ag = await w.k.agent(`cli-${s}`, sponsor, { tier: 1, funds: 100 });
    const g = await w.agentWith(`cli-${s}`, { agent: ag, spend: [{ institution: "events", cap: 60 }], running: true });
    crew.push({ a: ag, mandate: g.mandate, contract: g.contract });
  }
  await w.k.mint(TREASURY_DID, 100);
  const b = mk("budget", treasury, { institution: EVENTS_DID, period: nowIso().slice(0, 7), amount: credit(100), purpose: "prizes" }, null, { cosigners: [owner] });
  await log.append(b);
  await log.append(mk("treasury_payment", treasury, { budget: b.id, to: EVENTS_DID, amount: credit(100) }));

  const parties = new Map<string, Party>([[EVENTS_DID, events], ...crew.map((c) => [c.a.did, c.a] as [string, Party])]);
  const files = new Map<string, unknown>();
  const run = async (sub: string | undefined, rest: string[], flags: Record<string, unknown> = {}) => {
    const out: string[] = [];
    tick();
    const handle = { log, append: (r: any) => log.append(r) } as any;
    const code = await eventsCmd(sub, rest, { log: handle, io: { out: (l) => out.push(l) }, now: nowIso, signerFor: (d) => parties.get(d) as Signer, readJson: (p) => files.get(p), readFile: () => new TextEncoder().encode("my entry"), flags });
    return { code, text: out.join("\n") };
  };
  const t0 = Date.parse(nowIso());
  files.set("event.json", { form: "contest", title: "CLI contest", place: "room:cli", opens: iso(t0 + HOUR), starts: iso(t0 + 74 * HOUR), entries_close: iso(t0 + 74 * HOUR), ends: iso(t0 + 76 * HOUR), capacity: 0, per_sponsor_cap: 2, min_tier: 1, entry_service: ENTRY_SERVICE, rules_sha256: SHA, judging: { kind: "scored", scorer_sha256: SHA, min_sponsors: 4 }, prizes: [{ rank: 1, amount: 50 }, { rank: 2, amount: 30 }, { rank: 3, amount: 20 }] });
  const issued = await run("issue", [], { file: "event.json" });
  assert.match(issued.text, /event issued/);
  const id = (await log.recordsOfTypes(["events_act"]))[0].id;
  assert.match((await run("list", [])).text, /contest\s+scheduled .* CLI contest/);
  assert.match((await run("show", [id])).text, /"title": "CLI contest"/);
  jump(2 * HOUR);
  for (const c of crew) {
    const act = mk("action", c.a, { contract: c.contract, scopes_used: [], summary: "run" }, null, { subject: c.contract });
    await log.append(act);
    const r = await run("enter", [id], { by: c.a.did, entry: "entry.txt", "run-log": act.id, mandate: c.mandate });
    assert.match(r.text, /entered/, r.text);
  }
  jump(73 * HOUR);
  const dids = crew.map((c) => c.a.did);
  files.set("result.json", { event: id, rules_sha256: SHA, ranking: dids.map((agent, i) => ({ agent, rank: i + 1, score: 10 - i })), awards: [{ agent: dids[0], amount: 50 }, { agent: dids[1], amount: 30 }, { agent: dids[2], amount: 20 }], entries: 4, distinct_sponsors: 4, evidence_sha256: SHA });
  assert.match((await run("result", [], { file: "result.json" })).text, /prizes paid/);
  assert.match((await run("run", [])).text, /receipts 4, refunds 0, souvenirs 7/);
  assert.match((await run("souvenirs", [], { by: dids[0] })).text, /placed:1/);
  assert.match((await run("souvenirs", [], { by: dids[0] })).text, /change no tier/);
  assert.match((await run("results", [id])).text, /"distinct_sponsors": 4/);
  assert.match((await run("met", [], { by: dids[0] })).text, /met 0 agent\(s\) of 0 sponsor\(s\) at 0 event\(s\)/);
  assert.match((await run("list", [])).text, /results/);
  await assert.rejects(() => run("rsvp", [], { by: dids[0] }), EventsUsage);
  await assert.rejects(() => run("nothing", []), EventsUsage);
  void cosign; void ({} as AspRecord);
});
