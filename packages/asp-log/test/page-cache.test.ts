// The page read keeps what it computes for the log head (register rows DK1362 and O6): a Registry page read twice with no record between is the same, and a record appended between two reads is seen by the second (a new
// fleet-mate changes the personas on a member's page; an abuse report shows on the accused's page). A stale page would be a wrong answer, so this pins that the memo is keyed by the head. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlEncode } from "@agent-social/asp-core";
import { kit, keysOf, mk, operator, party } from "./society-kit.ts";

const FLEET = "did:web:example.com:orgs:pc-co:fleets:one";
const site = party("did:web:pc-victim.example");

test("a page read is stable with no new record and moves with the next one: a fleet-mate changes the personas, an abuse report shows", async () => {
  const k = await kit();
  const org = party("did:web:example.com:orgs:pc-co");
  await k.log.append(mk("passport", org, { did: org.did, kind: "org", keys: keysOf(org) }, null, { subject: org.did }));
  await k.log.append(mk("fleet", org, { did: FLEET, org: org.did, name: "One", purpose: "a team" }, null, { subject: FLEET }));
  const join = async (name: string, persona: string) => {
    const a = party(`did:web:example.com:agents:${name}`);
    await k.log.append(mk("passport", org, { did: a.did, kind: "agent", sponsor: org.did, tier: 1, shape: {}, keys: keysOf(a), fleet: FLEET, persona }, null, { subject: a.did }));
    return a;
  };
  const first = await join("pc-a", "coder");
  const page1 = await k.log.registryPage(first.did);
  assert.deepEqual(page1!.fleetInfo!.personas, { coder: 1 });
  assert.deepEqual((await k.log.registryPage(first.did))!.fleetInfo!.personas, { coder: 1 }, "the same head gives the same page");
  await join("pc-b", "reviewer");
  assert.deepEqual((await k.log.registryPage(first.did))!.fleetInfo!.personas, { coder: 1, reviewer: 1 }, "a new fleet-mate is seen by the next read");
  assert.equal((await k.log.registryPage(first.did))!.abuse, undefined);
  await k.log.append(mk("abuse_report", site, {
    accused: first.did, kind: "network_abuse", description: "the agent scanned our servers from many addresses overnight",
    reporter_key: { id: site.kid, public_key: b64urlEncode(site.publicKey) }, proof: { url: "https://pc-victim.example/.well-known/did.json", sha256: "sha256:" + "e".repeat(64) },
  }, null, { subject: first.did, cosigners: [operator] }));
  assert.equal((await k.log.registryPage(first.did))!.abuse?.length, 1, "an abuse report appended after a read shows on the next");
});
