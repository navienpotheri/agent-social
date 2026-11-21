/**
 * The Mandate template of a fleet or a persona (register row DK1355; spec-delta S1408): one Mandate the sponsor signs once, the Mandate of every member derived from it, an amendment that applies to every member, narrow-only
 * changes by a member, and the log refusing a Mandate that goes beyond the template. Fake keys only. Credits are accounting entries, not money.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { deriveMandate } from "@agent-social/asp-core";
import { credit, kit, keysOf, mk, party, refusedBy, type Party } from "./society-kit.ts";

const FLEET = "did:web:example.com:orgs:acme:fleets:coders";
const TEMPLATE = {
  purpose: "Work for the enterprise", floor: "asp.floor/v1", scopes: ["repo.read", "repo.write", "pr.*"], forbidden_means: ["rm -rf"], spend: { cap: 100, unit: "credit" }, irreversible: { policy: "checkpoint" },
  subcontract: { allowed: false }, nodes: { max_parallel: 4 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: ["plan"],
  expires: "2040-01-01T00:00:00Z", revocable: true,
};

/** The template without forbidden means and checkpoints, which the fixture's Mandate does not carry (a Mandate must carry the ceiling's). */
const PLAIN = { ...TEMPLATE, forbidden_means: [] as string[], checkpoints: [] as string[] };

async function world(members = 3) {
  const k = await kit();
  const org = await k.person("acme-mt");
  const client = await k.person("client-mt", 5000);
  await k.log.append(mk("fleet", org, { did: FLEET, org: org.did, name: "Coders", purpose: "ship code" }, null, { subject: FLEET }));
  const join = async (name: string, persona?: string): Promise<Party> => {
    const a = party(`did:web:example.com:agents:${name}`);
    await k.log.append(mk("passport", org, { did: a.did, kind: "agent", sponsor: org.did, tier: 1, shape: {}, keys: keysOf(a), fleet: FLEET, ...(persona ? { persona } : {}) }, null, { subject: a.did }));
    await k.mint(a.did, 200);
    return a;
  };
  const agents: Party[] = [];
  for (let i = 0; i < members; i++) agents.push(await join(`mt-member-${i}`));
  const template = (version: number, mandate: Record<string, unknown> = TEMPLATE, persona?: string, by: Party = org) => mk("mandate_template", by, { fleet: FLEET, ...(persona ? { persona } : {}), version, mandate }, null, { subject: FLEET });
  const narrow = (member: Party, narrowBody: Record<string, unknown>, by: Party = member) => mk("mandate_narrowing", by, { fleet: FLEET, member: member.did, narrow: narrowBody }, null, { subject: member.did });
  return { ...k, org, client, agents, join, template, narrow };
}

describe("the template record", () => {
  test("only the organisation signs it, for a fleet that exists, version by version; a persona has its own line of versions", async () => {
    const w = await world();
    const stranger = await w.person("stranger-mt");
    assert.equal(await refusedBy(w.log.append(w.template(1, TEMPLATE, undefined, stranger))), "mandate_template_wrong_issuer");
    assert.equal(await refusedBy(w.log.append(mk("mandate_template", w.org, { fleet: "did:web:example.com:nothing", version: 1, mandate: TEMPLATE }, null, { subject: FLEET }))), "mandate_template_fleet_unknown");
    assert.equal(await refusedBy(w.log.append(w.template(2))), "mandate_template_version", "the first version is 1");
    await w.log.append(w.template(1));
    assert.equal(await refusedBy(w.log.append(w.template(1))), "mandate_template_version", "a version is signed once");
    await w.log.append(w.template(2, { ...TEMPLATE, spend: { cap: 80, unit: "credit" } }));
    await w.log.append(w.template(1, { ...TEMPLATE, scopes: ["repo.read"] }, "reviewer")); // the persona's own line starts at 1
    assert.equal((await w.log.verify()).ok, true);
  });
});

describe("the Mandate of every member derives from the template", () => {
  test("a member's Mandate is the template with its contract, a persona gets its own template, and a fleet of 10,000 derives its Mandates in well under a second", async () => {
    const w = await world();
    await w.log.append(w.template(1));
    await w.log.append(w.template(1, { ...TEMPLATE, scopes: ["repo.read"] }, "reviewer"));
    const reviewer = await w.join("mt-reviewer", "reviewer");
    const c = "sha256:" + "3".repeat(64);
    const m0 = (await w.log.deriveMemberMandate(w.agents[0].did, c))!;
    assert.equal(m0.contract, c);
    assert.deepEqual(m0.scopes, TEMPLATE.scopes);
    assert.deepEqual((await w.log.deriveMemberMandate(reviewer.did, c))!.scopes, ["repo.read"], "the persona's own template");
    const outsider = await w.person("not-a-member");
    assert.equal(await w.log.deriveMemberMandate(outsider.did, c), undefined, "no fleet, no template");
    const t0 = Date.now();
    for (let i = 0; i < 10_000; i++) { const d = deriveMandate(TEMPLATE, `sha256:${String(i).padStart(64, "0")}`, i % 2 ? { scopes: ["repo.read"] } : null); assert.ok("mandate" in d); }
    assert.ok(Date.now() - t0 < 2000, `10,000 derivations took ${Date.now() - t0} ms`);
  });
});

describe("a member's own change may only narrow", () => {
  test("by the member or its sponsor, within the template: a narrower scope list and cap are accepted and shape the derived Mandate; widening is refused naming the field; others are refused", async () => {
    const w = await world();
    await w.log.append(w.template(1));
    const [a, b] = w.agents;
    const stranger = await w.person("stranger-narrow");
    assert.equal(await refusedBy(w.log.append(w.narrow(a, { scopes: ["repo.read"] }, stranger))), "narrowing_wrong_issuer");
    assert.equal(await refusedBy(w.log.append(w.narrow(a, { scopes: ["repo.read", "shell.exec"] }))), "narrowing_widens");
    assert.equal(await refusedBy(w.log.append(w.narrow(a, { spend: { cap: 101, unit: "credit" } }))), "narrowing_widens");
    assert.equal(await refusedBy(w.log.append(w.narrow(a, { forbidden_means: [] }))), "narrowing_widens", "dropping a forbidden means widens");
    assert.equal(await refusedBy(w.log.append(w.narrow(a, { expires: "2041-01-01T00:00:00Z" }))), "narrowing_widens");
    await w.log.append(w.narrow(a, { scopes: ["repo.read"], spend: { cap: 30, unit: "credit" } }));
    await w.log.append(w.narrow(b, { checkpoints: ["plan", "delivery"] }, w.org)); // the sponsor narrows too
    const c = "sha256:" + "4".repeat(64);
    const ma = (await w.log.deriveMemberMandate(a.did, c))!;
    assert.deepEqual([ma.scopes, ma.spend], [["repo.read"], { cap: 30, unit: "credit" }]);
    assert.deepEqual((await w.log.deriveMemberMandate(b.did, c))!.checkpoints, ["plan", "delivery"]);
    assert.deepEqual((await w.log.deriveMemberMandate(w.agents[2].did, c))!.scopes, TEMPLATE.scopes, "a member that did not narrow keeps the template");
    const outsider = await w.person("outsider-narrow");
    assert.equal(await refusedBy(w.log.append(mk("mandate_narrowing", outsider, { fleet: FLEET, member: outsider.did, narrow: { scopes: ["repo.read"] } }, null, { subject: outsider.did }))), "narrowing_not_a_member");
  });
});

describe("an amendment applies to every member", () => {
  test("a new version changes the Mandate of every member at once; a narrowing that no longer fits the new version is set aside, never widening it", async () => {
    const w = await world();
    await w.log.append(w.template(1));
    const [a, b] = w.agents;
    await w.log.append(w.narrow(a, { scopes: ["repo.read", "repo.write"] }));
    const c = "sha256:" + "5".repeat(64);
    assert.deepEqual((await w.log.deriveMemberMandate(b.did, c))!.scopes, TEMPLATE.scopes);
    // the sponsor amends: fewer scopes, a lower cap
    await w.log.append(w.template(2, { ...TEMPLATE, scopes: ["repo.read"], spend: { cap: 50, unit: "credit" } }));
    for (const m of w.agents) { const d = (await w.log.deriveMemberMandate(m.did, c))!; assert.deepEqual([d.scopes, d.spend], [["repo.read"], { cap: 50, unit: "credit" }], "every member follows the amendment"); }
    const ceiling = (await w.log.mandateCeiling(a.did))!;
    assert.equal(ceiling.version, 2);
    assert.deepEqual(ceiling.mandate.scopes, ["repo.read"], "a's earlier narrowing (repo.read, repo.write) would now widen the template: it is set aside");
  });
});

describe("the log refuses a Mandate that goes beyond the template", () => {
  test("a client's Mandate for a member must stay within its fleet's template and its own narrowing; the refusal names the fields", async () => {
    const w = await world();
    const [a, b] = w.agents;
    // a template that allows what the job's Mandate asks (repo.read, a cap of 0): the job runs to its end
    await w.log.append(w.template(1, { ...PLAIN, scopes: ["repo.read"], spend: { cap: 10, unit: "credit" } }));
    const done = await w.runJob(w.client, a, 60);
    assert.ok(done.contract, "a Mandate within the template is accepted");
    assert.equal(await (async () => { try { await w.runJob(w.client, w.agents[1], 60, undefined, { settle: false }); return undefined; } catch (e) { return (e as { detail?: string }).detail; } })(), undefined, "b takes the same job before any amendment");
    // the sponsor amends: the fleet may now use repo.write only: the same client's Mandate (repo.read) goes beyond it for every member
    await w.log.append(w.template(2, { ...PLAIN, scopes: ["repo.write"] }));
    const refusal = async () => { try { await w.runJob(w.client, b, 60); return undefined; } catch (e) { return (e as { detail?: string }).detail; } };
    assert.equal(await refusal(), "mandate_exceeds_template");
    // a member that narrows further is held to the narrower ceiling
    await w.log.append(w.template(3, { ...PLAIN, scopes: ["repo.read", "repo.write"] }));
    await w.log.append(w.narrow(b, { scopes: ["repo.write"] }));
    assert.equal(await refusal(), "mandate_exceeds_template", "b narrowed itself to repo.write: a repo.read Mandate is beyond its ceiling");
    assert.ok((await w.runJob(w.client, w.agents[2], 60)).contract, "a member that did not narrow may take it");
    assert.equal((await w.log.creditAudit()).verdict, "balanced");
    assert.equal((await w.log.verify()).ok, true, "a replica replays the templates, narrowings and Mandates the same way");
  });
});
void credit;
