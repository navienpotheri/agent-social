// Row H4 (spec-delta S1457; owner decision of 2026-11-21): an outside victim's remedy has a clock. A credible report gets a takedown or a suspension within 2 working days and a written response within 7 days, and `asp abuse due`
// says where each clock stands, from the log alone. The remedy is DK530's; this is the operator not letting a report sit. Fake keys only; nothing is sent to anyone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, b64urlEncode, type Signer } from "@agent-social/asp-core";
import { drawPanel } from "../src/index.ts";
import { ACTION_WORKING_DAYS, RESPONSE_DAYS, abuseClocks, abuseDueCmd, addWorkingDays, readAbuseRecords } from "../../asp-cli/src/abuse-due.ts";
import { DAY, jump, kit, mk, nowIso, operator, party, registrar, type Party } from "./society-kit.ts";

const site = party("did:web:victim-site.example");
const CODE = { version: "1.0", articles: ["7"] };

test("working days skip Saturday and Sunday: two working days after a Friday is Tuesday, after a Wednesday is Friday; seven days is seven calendar days", () => {
  assert.equal(addWorkingDays("2026-11-27T10:00:00Z", 2), "2026-12-01T10:00:00Z", "Friday + 2 working days = Tuesday");
  assert.equal(addWorkingDays("2026-11-25T10:00:00Z", 2), "2026-11-27T10:00:00Z", "Wednesday + 2 = Friday");
  assert.equal(addWorkingDays("2026-11-28T10:00:00Z", 2), "2026-12-01T10:00:00Z", "Saturday + 2 = Tuesday (Monday is the first working day)");
  assert.equal(addWorkingDays("2026-11-26T10:00:00Z", 0), "2026-11-26T10:00:00Z");
  assert.deepEqual([ACTION_WORKING_DAYS, RESPONSE_DAYS], [2, 7]);
});

async function world() {
  const k = await kit();
  const jurors: Party[] = [];
  for (let i = 0; i < 9; i++) { const j = await k.person(`ad-juror-${i}`, 500); await k.log.append(mk("juror", j, { did: j.did, stake: { value: 100, unit: "credit" } }, null)); jurors.push(j); }
  const byDid = new Map(jurors.map((j) => [j.did, j]));
  const sponsor = await k.person("ad-sponsor", 100);
  const agent = await k.agent("ad-agent", sponsor, { funds: 10 });
  const other = await k.agent("ad-other", sponsor, { funds: 10 });
  const file = async (accused: Party = agent, tag = "x") => {
    const r = mk("abuse_report", site, { accused: accused.did, kind: "network_abuse", description: `the agent scanned our servers overnight (${tag})`, reporter_key: { id: site.kid, public_key: b64urlEncode(site.publicKey) }, proof: { url: "https://victim-site.example/.well-known/did.json", sha256: "sha256:" + "e".repeat(64) } }, null, { subject: accused.did, cosigners: [operator] });
    await k.log.append(r); return r;
  };
  const suspend = async (who: Party) => { const r = mk("registry_act", registrar, { act: "identity_suspension", holder: who.did, reason: "reported abuse", code: { version: "1.0", articles: ["4.1"] }, until: new Date(Date.parse(nowIso()) + 5 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z") }, null); await k.log.append(r); return r; };
  const decide = async (rep: { id: string }, accused: Party, extra: Record<string, unknown>) => {
    const c = mk("court_act", registrar, { act: "abuse_case", report: rep.id }, null); await k.log.append(c);
    const panel = await drawPanel(k.log.store as never, { principal: sponsor.did, performer: accused.did, seed: c.id, size: 3 });
    const [first, ...rest] = panel.slice(0, 2).map((d) => byDid.get(d)!);
    let r = mk("court_act", first, { act: "abuse_ruling", case: c.id, reasons: ["the agent scanned the reporter's servers"], code: CODE, ...extra }, null);
    for (const s of rest) r = cosign(r, s as Signer);
    await k.log.append(r); return r;
  };
  return { k, agent, other, file, suspend, decide, handle: { log: k.log } as never };
}
const clocks = async (w: Awaited<ReturnType<typeof world>>, at: string) => abuseClocks(await readAbuseRecords(w.handle), at);
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString().replace(/\.\d{3}Z$/, "Z");

test("a report with nothing done: both clocks run, the action is overdue after two working days and the response after seven days", async () => {
  const w = await world();
  const rep = await w.file();
  const filed = (await w.k.log.get(rep.id))!.record.issued_at;
  let [row] = await clocks(w, plus(filed, 3_600_000));
  assert.equal(row.report, rep.id); assert.equal(row.accused, w.agent.did); assert.equal(row.kind, "network_abuse");
  assert.equal(row.action.state, "due"); assert.equal(row.response.state, "due");
  assert.equal(row.response.due, plus(filed, 7 * DAY));
  [row] = await clocks(w, plus(row.action.due, 60_000));
  assert.equal(row.action.state, "overdue"); assert.equal(row.response.state, "due", "the response clock is longer");
  [row] = await clocks(w, plus(row.response.due, 60_000));
  assert.equal(row.action.state, "overdue"); assert.equal(row.response.state, "overdue");
});

test("a suspension of the accused after the report stops the action clock; a suspension of someone else, or before the report, does not; the response clock keeps running", async () => {
  const w = await world();
  await w.suspend(w.agent);                                  // before the report
  jump(DAY);
  const rep = await w.file();
  const filed = (await w.k.log.get(rep.id))!.record.issued_at;
  await w.suspend(w.other);                                  // someone else
  let [row] = await clocks(w, plus(filed, 5 * DAY));
  assert.equal(row.action.state, "overdue", "neither the earlier suspension nor the other agent's counts");
  jump(DAY);
  const s = await w.suspend(w.agent);
  [row] = await clocks(w, plus(filed, 5 * DAY));
  assert.equal(row.action.state, "done"); assert.equal(row.action.how, "the accused was suspended"); assert.equal(row.action.doneAt, (await w.k.log.get(s.id))!.record.issued_at);
  assert.equal(row.response.state, "due", "a suspension is not a written response");
  [row] = await clocks(w, plus(filed, 8 * DAY));
  assert.equal(row.response.state, "overdue");
});

test("an upheld finding with its remedy and reasons closes both clocks; a dismissed finding is the response and needs no action", async () => {
  const w = await world();
  const up = await w.file(w.agent, "upheld");
  jump(DAY);
  const ruling = await w.decide(up, w.agent, { finding: "upheld", remedy: "takedown" });
  let rows = await clocks(w, plus(nowIso(), 30 * DAY));
  let row = rows.find((r) => r.report === up.id)!;
  assert.equal(row.action.state, "done"); assert.equal(row.action.how, "upheld, remedy takedown");
  assert.equal(row.response.state, "done"); assert.equal(row.response.how, "upheld with reasons");
  assert.equal(row.outcome, "upheld, remedy takedown");
  assert.equal(row.response.doneAt, (await w.k.log.get(ruling.id))!.record.issued_at);
  jump(DAY);
  const dis = await w.file(w.other, "dismissed");
  jump(DAY);
  await w.decide(dis, w.other, { finding: "dismissed" });
  rows = await clocks(w, plus(nowIso(), 30 * DAY));
  row = rows.find((r) => r.report === dis.id)!;
  assert.equal(row.action.state, "not_needed"); assert.match(row.action.how!, /dismissed: nothing to take down/);
  assert.equal(row.response.state, "done");
});

test("asp abuse due: says what is overdue and what to do, lists only open clocks unless --all, gives JSON, and exits 1 when something is overdue", async () => {
  const w = await world();
  const open = await w.file(w.agent, "open");
  jump(DAY);
  const closed = await w.file(w.other, "closed");
  jump(DAY);
  await w.decide(closed, w.other, { finding: "dismissed" });
  const filed = (await w.k.log.get(open.id))!.record.issued_at;
  const run = async (at: string, flags: { all?: boolean; json?: boolean } = {}) => { const out: string[] = []; const code = await abuseDueCmd({ log: w.handle, io: { out: (l) => out.push(l) }, now: () => at, ...flags }); return { code, out: out.join("\n") }; };
  let r = await run(plus(filed, 3_600_000));
  assert.equal(r.code, 0);
  assert.match(r.out, /^2 admitted abuse report\(s\); 1 with a clock still running, 0 overdue \(a takedown or suspension within 2 working days, a written response within 7 days\)/);
  assert.ok(r.out.includes(open.id.slice(0, 15)) && !r.out.includes(closed.id.slice(0, 15)), "only the open one is listed");
  assert.match(r.out, /action\s+due \d{4}-/); assert.match(r.out, /response\s+due \d{4}-/);
  r = await run(plus(filed, 10 * DAY));
  assert.equal(r.code, 1);
  assert.match(r.out, /1 overdue/); assert.match(r.out, /action\s+OVERDUE since/); assert.match(r.out, /response\s+OVERDUE since/);
  assert.match(r.out, /An overdue report is the operator's to act on today: asp house stop.*docs\/incident-runbook\.md section 3/);
  r = await run(plus(filed, 10 * DAY), { all: true });
  assert.ok(r.out.includes(closed.id.slice(0, 15)) && /not needed \(the finding is dismissed/.test(r.out), "--all lists the closed ones too");
  const j = JSON.parse((await run(plus(filed, 10 * DAY), { json: true })).out);
  assert.equal(j.total, 2); assert.equal(j.open, 1); assert.equal(j.overdue, 1); assert.equal(j.reports[0].report, open.id);
  // nothing in the log: no reports, no clock
  const empty = await world();
  const e = await (async () => { const out: string[] = []; const code = await abuseDueCmd({ log: empty.handle, io: { out: (l) => out.push(l) }, now: () => "2026-12-01T00:00:00Z" }); return { code, out: out.join("\n") }; })();
  assert.equal(e.code, 0); assert.match(e.out, /^0 admitted abuse report\(s\); 0 with a clock still running, 0 overdue/);
});
