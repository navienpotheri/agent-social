import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  b64urlEncode, createRecord, publicKeyFromSeed, type AspRecord, type RecordType, type Signer,
} from "@agent-social/asp-core";
import { EventLog } from "../src/index.ts";
import {
  alice, bank, coder, failure, lifecycleCases, memory, passport, pgUrl, postgres, registerParties, type Harness,
} from "./harness.ts";

type Person = { did: string } & Signer;

const FLEET = "did:web:example.com:fleets:payments";
const happy: AspRecord[] = lifecycleCases.find((c: any) => c.name === "happy_path").records;
const [contract, bond, mandate] = happy;

function make(type: RecordType, by: Person | Signer, issuer: string, body: Record<string, unknown>, issuedAt: string,
  opts: { prev?: string | null; subject?: string | null; actor?: string } = {}): AspRecord {
  return createRecord({
    type, issuer, actor: opts.actor, subject: opts.subject ?? null, body, prev: opts.prev ?? null, issued_at: issuedAt,
  }, by);
}

function fleetDecl(by: Person, org: string, issuedAt: string, extra: Record<string, unknown> = {}, prev: string | null = null) {
  return make("fleet", by, by.did, { did: FLEET, org, name: "Payments", purpose: "Keep payments tests green", ...extra }, issuedAt, { prev, subject: FLEET });
}

function agentPassport(did: string, by: Person, key: Signer, issuedAt: string, prev: string | null, extra: Record<string, unknown> = {}) {
  return make("passport", by, by.did, {
    did, kind: "agent", sponsor: alice.did, tier: 1, shape: { keeps_learning: true },
    keys: [{ id: key.kid, type: "Ed25519", public_key: b64urlEncode(publicKeyFromSeed(key.seed)) }], ...extra,
  }, issuedAt, { prev, subject: did });
}

function newAgent(name: string) {
  const did = `did:web:example.com:agents:${name}`;
  return { did, kid: `${did}#key-1`, seed: new Uint8Array(randomBytes(32)) };
}

function nodeKey(n: number): Signer {
  return { kid: `${coder.did}#node-${n}`, seed: new Uint8Array(randomBytes(32)) };
}

function grant(node: Signer, issuedAt: string, expires: string, opts: { by?: Person | Signer; issuer?: string; mandate?: string | null } = {}) {
  const body: Record<string, unknown> = { node: node.kid, public_key: b64urlEncode(publicKeyFromSeed(node.seed)), expires };
  if (opts.mandate !== null) body.mandate = opts.mandate ?? mandate.id;
  return make("node", opts.by ?? coder, opts.issuer ?? coder.did, body, issuedAt);
}

const delivery = (by: Signer, actor: string, issuedAt: string) =>
  make("delivery", by, coder.did, happy[5].body as Record<string, unknown>, issuedAt, { prev: mandate.id, subject: contract.id, actor });

async function rejects(p: Promise<unknown>, code: string, detail?: string) {
  const f = await failure(p);
  assert.equal(f?.code, code, `expected ${code}${detail ? ` (${detail})` : ""}, got ${f ? `${f.code} ${f.detail ?? ""}` : "success"}`);
  if (detail) assert.equal(f!.detail, detail);
}

for (const h of [memory, postgres] as Harness[]) {
  describe(`registry on ${h.name}`, { skip: h === postgres && !pgUrl && "set ASP_TEST_DATABASE_URL to run" }, () => {
    after(() => h.cleanup());

    // ---------- fleets ----------

    test("an org declares a fleet and its agents join by naming it on their passports", async () => {
      const log = new EventLog(await h.make());
      const { coderPassport } = await registerParties(log);
      await log.append(fleetDecl(alice, alice.did, "2026-10-06T09:00:00Z", { max_members: 2 }));
      await log.append(agentPassport(coder.did, alice, coder, "2026-10-06T09:01:00Z", coderPassport, { fleet: FLEET }));
      const fleet = await log.fleet(FLEET);
      assert.equal(fleet?.org, alice.did);
      assert.deepEqual(fleet?.members.map((m) => m.did), [coder.did]);
      assert.equal((await log.verify()).ok, true);
    });

    test("fleet membership needs a declared fleet, the same sponsor, room, and an agent", async () => {
      const log = new EventLog(await h.make());
      const { alicePassport, coderPassport } = await registerParties(log);
      await rejects(log.append(agentPassport(coder.did, alice, coder, "2026-10-06T09:00:00Z", coderPassport, { fleet: FLEET })),
        "GUARD_FAILED", "fleet_unknown");

      await log.append(fleetDecl(alice, alice.did, "2026-10-06T09:01:00Z", { max_members: 1 }));
      await log.append(agentPassport(coder.did, alice, coder, "2026-10-06T09:02:00Z", coderPassport, { fleet: FLEET }));

      const second = newAgent("coder-2");
      await rejects(log.append(agentPassport(second.did, alice, second, "2026-10-06T09:03:00Z", null, { fleet: FLEET })),
        "GUARD_FAILED", "fleet_full");

      const foreign = newAgent("stray");
      await rejects(log.append(agentPassport(foreign.did, bank, foreign, "2026-10-06T09:04:00Z", null, { fleet: FLEET, sponsor: bank.did })),
        "GUARD_FAILED", "fleet_sponsor_mismatch");

      const human = make("passport", alice, alice.did, {
        did: alice.did, kind: "human", fleet: FLEET,
        keys: [{ id: alice.kid, type: "Ed25519", public_key: b64urlEncode(alice.publicKey) }],
      }, "2026-10-06T09:05:00Z", { prev: alicePassport, subject: alice.did });
      await rejects(log.append(human), "GUARD_FAILED", "fleet_member_kind");
    });

    test("only the org declares or updates its fleet, and the org never changes", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      await rejects(log.append(fleetDecl(alice, bank.did, "2026-10-06T09:00:00Z")), "WRONG_ISSUER");
      const decl = await log.append(fleetDecl(alice, alice.did, "2026-10-06T09:01:00Z"));
      await rejects(log.append(fleetDecl(alice, alice.did, "2026-10-06T09:02:00Z")), "BAD_PREV");
      await rejects(log.append(fleetDecl(bank, bank.did, "2026-10-06T09:03:00Z", {}, decl.id)), "GUARD_FAILED", "fleet_org_change");
      await log.append(fleetDecl(alice, alice.did, "2026-10-06T09:04:00Z", { name: "Payments v2" }, decl.id));
      assert.equal((await log.fleet(FLEET))?.name, "Payments v2");
    });

    // ---------- nodes ----------

    async function jobLog(clock: { now: string }) {
      const log = new EventLog(await h.make(), { now: () => new Date(clock.now) });
      await registerParties(log);
      for (const r of [contract, bond, mandate]) await log.append(r);
      return log;
    }

    test("a node signs as itself under its person, and the job advances", async () => {
      const clock = { now: "2026-10-01T10:00:00Z" };
      const log = await jobLog(clock);
      const n7 = nodeKey(7);
      await log.append(grant(n7, "2026-10-01T10:00:00Z", "2026-10-01T12:00:00Z"));
      clock.now = "2026-10-01T10:40:00Z";
      const res = await log.append(delivery(n7, n7.kid, "2026-10-01T10:40:00Z"));
      assert.equal(res.state, "Delivered");

      clock.now = "2026-10-02T00:00:00Z"; // long after the node expired
      assert.equal((await log.verify()).ok, true, "replay uses each record's original append time");
    });

    test("a node key signs only as its node, never identity records, and never after it expires", async () => {
      const clock = { now: "2026-10-01T10:00:00Z" };
      const log = await jobLog(clock);
      const n7 = nodeKey(7);
      await log.append(grant(n7, "2026-10-01T10:00:00Z", "2026-10-01T12:00:00Z"));

      await rejects(log.append(delivery(n7, coder.did, "2026-10-01T10:10:00Z")), "GUARD_FAILED", "node_key_actor");
      await rejects(log.append(grant(nodeKey(8), "2026-10-01T10:10:00Z", "2026-10-01T11:00:00Z", { by: n7 })),
        "GUARD_FAILED", "node_key_actor"); // actor defaults to the person
      const byNode = make("node", n7, coder.did, { node: `${coder.did}#node-9`, public_key: b64urlEncode(publicKeyFromSeed(nodeKey(9).seed)), expires: "2026-10-01T11:00:00Z" },
        "2026-10-01T10:10:00Z", { actor: n7.kid });
      await rejects(log.append(byNode), "GUARD_FAILED", "node_key_identity");

      clock.now = "2026-10-01T12:30:00Z";
      await rejects(log.append(delivery(n7, n7.kid, "2026-10-01T11:59:00Z")), "GUARD_FAILED", "node_key_expired");
    });

    test("a Mandate's max_parallel caps live nodes; expired nodes free their slot", async () => {
      const clock = { now: "2026-10-01T10:00:00Z" };
      const log = await jobLog(clock);
      const max = (mandate.body as any).nodes.max_parallel as number;
      for (let n = 1; n <= max; n++) await log.append(grant(nodeKey(n), "2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z"));
      await rejects(log.append(grant(nodeKey(max + 1), "2026-10-01T10:30:00Z", "2026-10-01T11:00:00Z")), "GUARD_FAILED", "node_max_parallel");
      clock.now = "2026-10-01T11:05:00Z";
      await log.append(grant(nodeKey(max + 2), "2026-10-01T11:05:00Z", "2026-10-01T12:00:00Z"));
    });

    test("node grants: bounded lifetime, inside the Mandate, for the Mandate's own subject, fresh ids", async () => {
      const clock = { now: "2026-10-01T10:00:00Z" };
      const log = await jobLog(clock);
      await rejects(log.append(grant(nodeKey(1), "2026-10-01T10:00:00Z", "2026-10-03T10:00:00Z", { mandate: null })), "GUARD_FAILED", "node_ttl");
      await rejects(log.append(grant(nodeKey(2), "2026-10-01T10:00:00Z", "2026-10-01T09:00:00Z")), "GUARD_FAILED", "node_ttl");
      await rejects(log.append(grant(nodeKey(3), "2026-10-03T23:00:00Z", "2026-10-04T02:00:00Z")), "GUARD_FAILED", "node_outlives_mandate");
      const aliceNode: Signer = { kid: `${alice.did}#node-1`, seed: new Uint8Array(randomBytes(32)) };
      await rejects(log.append(grant(aliceNode, "2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z", { by: alice, issuer: alice.did })),
        "GUARD_FAILED", "node_mandate_subject");
      await rejects(log.append(grant({ kid: coder.kid, seed: coder.seed }, "2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z")),
        "GUARD_FAILED", "key_id_taken");
      await rejects(log.append(grant(nodeKey(4), "2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z", { mandate: contract.id })),
        "GUARD_FAILED", "node_mandate_unknown");
    });
  });
}
