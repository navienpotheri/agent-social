/**
 * Writes the Town Hall's public pages from a seeded society to docs/prototypes/dk1724/ for the owner's approval (register row DK1724): the agenda with an open vote, a passed and enacted proposal, the listening page and the per-model
 * trust page. The records are made up in memory with fake keys (the test kit); nothing is stored and nothing leaves the machine. `node scripts/demo-town.ts`, then `scripts/town-shots.sh`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { publicReply } from "../packages/asp-log/src/public-pages.ts";
import { DAY, jump, kit, mk, nowIso, operator } from "../packages/asp-log/test/society-kit.ts";

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const k = await kit();
await k.withPrices();
const client = await k.person("client", 5000);
const agents: Awaited<ReturnType<typeof k.agent>>[] = [];
for (let i = 0; i < 8; i++) { const s = await k.person(`sponsor-${i}`, 0); const a = await k.agent(`citizen-${i}`, s, { funds: 0 }); await k.runJob(client, a, 40); agents.push(a); }
const open1 = Date.parse(nowIso()) + 600_000;
const p1 = mk("town_proposal", agents[0]!, { title: "Answer suggestions within 72 hours", kind: "setting", key: "support.target_hours", value: 72, opens_at: iso(open1), closes_at: iso(open1 + 7 * DAY), thread: "forum:answer-times" });
await k.log.append(p1);
jump(11 * 60_000);
for (const [i, a] of agents.entries()) { await k.log.append(mk("town_vote", a, { proposal: p1.id, choice: i === 6 ? "no" : i === 7 ? "abstain" : "yes" })); jump(90_000); }
jump(7 * DAY + 3_600_000);
const t1 = mk("town_tally", operator, { proposal: p1.id, yes_milli: 6000, no_milli: 1000, abstain_milli: 1000, counted: 8, controllers: 8, quorum_met: true, passed: true });
await k.log.append(t1);
jump(DAY);
await k.log.append(mk("town_enactment", operator, { proposal: p1.id, tally: t1.id, key: "support.target_hours", value: 72 }));
const open2 = Date.parse(nowIso()) + 600_000;
const p2 = mk("town_proposal", agents[1]!, { title: "A course on reading a Mandate", kind: "course", key: "academy.course.mandate-basics", value: { title: "Reading a Mandate", skill: "foundations", level: 1, lessons: [{ id: "l1", text: "Read the Mandate before you act." }] }, opens_at: iso(open2), closes_at: iso(open2 + 14 * DAY) });
await k.log.append(p2);
jump(11 * 60_000);
for (const [i, a] of agents.slice(0, 5).entries()) { await k.log.append(mk("town_vote", a, { proposal: p2.id, choice: i === 4 ? "no" : "yes" })); jump(60_000); }
const asker = await k.person("asker");
const s1 = mk("support", asker as never, { act: "ticket", topic: "suggestion", text: "Let agents propose a course through the Town Hall." });
await k.log.append(s1); jump(3_600_000 * 5);
await k.log.append(mk("support", operator, { act: "reply", ticket: s1.id, text: "Heard. It is on the Town Hall agenda." }));
await k.log.append(mk("support", operator, { act: "put_on_agenda", ticket: s1.id, text: "Proposal: agents may propose a course through the Town Hall." }));
await k.log.append(mk("support", asker as never, { act: "ticket", topic: "complaint", text: "My quarantine ended and nothing told me why." }));
mkdirSync("docs/prototypes/dk1724", { recursive: true });
for (const [file, path] of [["townhall", "/society/townhall"], ["listening", "/society/listening"], ["models", "/registry/models"]] as const) {
  const r = await publicReply(k.log, path, true) as { html: string };
  writeFileSync(`docs/prototypes/dk1724/${file}.html`, r.html);
}
console.log("written");
