// Third-party abuse reports (register row H3; spec-delta S430): a site with no passport reports an agent as its own did:web identity, the operator checked the domain's key and countersigned, the log
// refuses a report without that countersignature, from a passport holder, about an unknown agent, or over the rate limits, and the report is a lead with no effect on the accused. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode } from "@agent-social/asp-core";
import { ABUSE_PER_DAY } from "../src/index.ts";
import { Kit, operator, party, refused, type Party } from "./academy-kit.ts";

const site = party("did:web:site.example", 61);
const body = (accused: string, over: Record<string, unknown> = {}) => ({
  accused, kind: "network_abuse", description: "the agent scanned our servers from many addresses overnight",
  reporter_key: { id: site.kid, public_key: b64urlEncode(site.publicKey) },
  proof: { url: "https://site.example/.well-known/did.json", sha256: "sha256:" + "e".repeat(64) }, ...over,
});
const key = (p: Party) => ({ id: p.kid, public_key: b64urlEncode(p.publicKey) });

async function world() {
  const kit = new Kit();
  const sponsor = await kit.person("ab-sponsor");
  const agent = await kit.agent("ab-agent", sponsor, 1);
  const file = (accused: string, by: Party = site, cos: Party[] = [operator], over: Record<string, unknown> = {}) =>
    kit.mk("abuse_report", by, { ...body(accused, over), reporter_key: key(by) }, null, { subject: accused, cosigners: cos });
  return { kit, sponsor, agent, file };
}

test("H3 done (1): an operator-admitted report from a did:web site with no passport is accepted, listed against the accused, and changes nothing about the accused", async () => {
  const w = await world();
  const before = await w.kit.log.reputationOf(w.agent.did);
  const id = await w.kit.put(w.file(w.agent.did));
  const list = await w.kit.log.abuseReportsAbout(w.agent.did);
  assert.deepEqual(list.map((x) => [x.id, x.reporter, x.kind]), [[id, site.did, "network_abuse"]]);
  assert.deepEqual(await w.kit.log.reputationOf(w.agent.did), before, "a report is a lead: no strike, no slash");
  assert.equal((await w.kit.log.verify()).ok, true, "replay verifies the report with the key it names and the operator's countersignature");
});

test("H3 done (2): the domain check is the operator's countersignature; without it, or with a key that is not the one named, the report is refused", async () => {
  const w = await world();
  assert.equal(await refused(w.kit.put(w.file(w.agent.did, site, []))), "abuse_not_admitted");
  const other = party("did:web:site.example", 62);
  // Signed by a key other than the one the record names.
  const forged = w.kit.mk("abuse_report", other, { ...body(w.agent.did), reporter_key: key(site) }, null, { subject: w.agent.did, cosigners: [operator] });
  assert.ok(await refused(w.kit.put(forged)), "a signature by another key is not accepted as the named key's");
  const notWeb = party("did:key:z6MkexampleReporter", 63);
  assert.equal(await refused(w.kit.put(w.file(w.agent.did, notWeb))), "abuse_reporter_not_web");
});

test("H3 done (3): a passport holder reports through the market, a report must name a known agent, and a reporter cannot report itself", async () => {
  const w = await world();
  assert.equal(await refused(w.kit.put(w.file(w.sponsor.did, w.sponsor))), "abuse_reporter_has_passport");
  assert.equal(await refused(w.kit.put(w.file("did:web:example.com:agents:nobody"))), "abuse_accused_unknown");
});

test("H3 done (4): one report per accused a week and five a day for one reporter, so the route cannot be used to harass", async () => {
  const w = await world();
  await w.kit.put(w.file(w.agent.did));
  assert.equal(await refused(w.kit.put(w.file(w.agent.did))), "abuse_repeat");
  const agents = [];
  for (let i = 0; i < ABUSE_PER_DAY; i++) agents.push(await w.kit.agent(`ab-more-${i}`, w.sponsor, 1));
  for (let i = 0; i < ABUSE_PER_DAY - 1; i++) await w.kit.put(w.file(agents[i].did));
  assert.equal(await refused(w.kit.put(w.file(agents[ABUSE_PER_DAY - 1].did))), "abuse_rate", "the sixth report of the day");
  w.kit.addDays(8);
  await w.kit.put(w.file(w.agent.did));
  assert.equal((await w.kit.log.abuseReportsAbout(w.agent.did)).length, 2, "after a week the same reporter may report again");
});
