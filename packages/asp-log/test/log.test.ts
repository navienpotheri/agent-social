import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  AspError, b64urlEncode, cosign, createRecord, publicKeyFromSeed, signerFromSeed, staticResolver,
  type AspRecord, type RecordType, type Signer,
} from "@agent-social/asp-core";
import { EventLog, MemoryStore, PostgresStore, type Store } from "../src/index.ts";

const conf = fileURLToPath(new URL("../../../conformance/", import.meta.url));
const load = (f: string) => JSON.parse(readFileSync(conf + f, "utf8"));
const keys: { name: string; did: string; kid: string; seed_hex: string; public_key: string }[] = load("keys.json").keys;
const lifecycleCases = load("vectors/lifecycle.json").cases;
const vectorResolver = staticResolver(Object.fromEntries(keys.map((k) => [k.kid, k.public_key])));

const party = (name: string) => {
  const k = keys.find((k) => k.name === name)!;
  return { did: k.did, ...signerFromSeed(k.kid, Buffer.from(k.seed_hex, "hex")) };
};
const alice = party("alice");
const coder = party("coder");
const bank = party("bank");

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    if (e instanceof AspError) return e.code;
    throw e;
  }
}

let clock = 0;
const at = () => new Date(Date.parse("2026-10-05T09:00:00Z") + clock++ * 60_000).toISOString().replace(".000Z", "Z");

function rec(type: RecordType, by: { did: string } & Signer, body: Record<string, unknown>, prev: string | null, subject: string | null = null): AspRecord {
  return createRecord({ type, issuer: by.did, subject, body, prev, issued_at: at() }, by);
}

function passport(did: string, by: { did: string } & Signer, keyList: { kid: string; seed: Uint8Array }[], prev: string | null, agent = false): AspRecord {
  const body: Record<string, unknown> = {
    did, kind: agent ? "agent" : "human",
    keys: keyList.map((k) => ({ id: k.kid, type: "Ed25519", public_key: b64urlEncode(publicKeyFromSeed(k.seed)) })),
  };
  if (agent) Object.assign(body, { sponsor: alice.did, tier: 1, shape: { keeps_learning: true } });
  return rec("passport", by, body, prev, did);
}

/** Registers alice, the coder agent (sponsored by alice) and the bank through passports in the log. */
async function registerParties(log: EventLog) {
  const a = await log.append(passport(alice.did, alice, [alice], null));
  const c = await log.append(passport(coder.did, alice, [coder], null, true));
  const b = await log.append(passport(bank.did, bank, [bank], null));
  return { alicePassport: a.id, coderPassport: c.id, bankPassport: b.id };
}

// ---------- store factories ----------

interface Harness { name: string; make(): Promise<Store>; cleanup(): Promise<void> }

const memory: Harness = { name: "memory", make: async () => new MemoryStore(), cleanup: async () => {} };

const pgUrl = process.env.ASP_TEST_DATABASE_URL;
// PGlite (scripts/pglite-server.ts) is one session shared by all connections: use one pooled
// connection, and set search_path on the session instead of per connection.
const pglite = process.env.ASP_TEST_PGLITE === "1";
const schemas: string[] = [];
const stores: PostgresStore[] = [];
const postgres: Harness = {
  name: "postgres",
  async make() {
    // Tests run one at a time; release earlier connections so a single-session server is free.
    await Promise.all(stores.splice(0).map((s) => s.close()));
    const schema = `asp_test_${randomBytes(6).toString("hex")}`;
    const admin = new pg.Client({ connectionString: pgUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    if (pglite) await admin.query(`SET search_path TO ${schema}`);
    await admin.end();
    schemas.push(schema);
    const store = new PostgresStore(pglite
      ? { connectionString: pgUrl, max: 1 }
      : { connectionString: pgUrl, options: `-c search_path=${schema}` });
    await store.migrate();
    stores.push(store);
    return store;
  },
  async cleanup() {
    await Promise.all(stores.splice(0).map((s) => s.close()));
    const admin = new pg.Client({ connectionString: pgUrl });
    await admin.connect();
    for (const s of schemas.splice(0)) await admin.query(`DROP SCHEMA ${s} CASCADE`);
    await admin.end();
  },
};

for (const h of [memory, postgres]) {
  describe(`EventLog on ${h.name}`, { skip: h === postgres && !pgUrl && "set ASP_TEST_DATABASE_URL to run" }, () => {
    after(() => h.cleanup());

    for (const c of lifecycleCases) {
      test(`lifecycle vector: ${c.name}`, async () => {
        const log = new EventLog(await h.make(), { fallbackResolver: vectorResolver });
        let failedAt = -1;
        let code: string | undefined;
        for (const [i, r] of c.records.entries()) {
          code = await codeOf(log.append(r));
          if (code) { failedAt = i; break; }
        }
        const head = await log.head();
        if ("state" in c.expect) {
          assert.equal(code, undefined);
          const info = await log.chainInfo(c.records[0].id);
          assert.equal(info?.state, c.expect.state);
          assert.equal(head.seq, c.records.length);
        } else {
          assert.equal(code, c.expect.error);
          assert.equal(failedAt, c.expect.at);
          assert.equal(head.seq, c.expect.at, "a rejected record must leave nothing behind");
        }
        assert.equal((await log.verify()).ok, true);
      });
    }

    test("passports bootstrap the registry; a job then runs on registry keys alone", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const [contract] = lifecycleCases.find((c: any) => c.name === "happy_path").records;
      // The vector chain was signed by the same keys, so it verifies against the registry.
      const res = await log.append(contract);
      assert.equal(res.state, "Contracted");
      // An unregistered sponsor cannot vouch for a new agent: only a self-issued first passport bootstraps its keys.
      const mallory = party("mallory");
      const bot = "did:web:evil.example:bot";
      const sponsored = rec("passport", mallory, {
        did: bot, kind: "agent", sponsor: mallory.did, tier: 0, shape: {},
        keys: [{ id: `${bot}#key-1`, type: "Ed25519", public_key: b64urlEncode(mallory.publicKey) }],
      }, null, bot);
      assert.equal(await codeOf(log.append(sponsored)), "UNKNOWN_KEY");
    });

    test("the whole happy-path job settles on registry keys, and every record lands in one chain", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const records = lifecycleCases.find((c: any) => c.name === "happy_path").records;
      let last;
      for (const r of records) last = await log.append(r);
      assert.equal(last!.state, "Settled");
      const chain = await log.chain(records[0].id);
      assert.deepEqual(chain.map((s) => s.id), records.map((r: AspRecord) => r.id));
    });

    test("key rotation: the old key stops working, the new one works", async () => {
      const log = new EventLog(await h.make());
      const { coderPassport } = await registerParties(log);
      const key2 = { kid: `${coder.did}#key-2`, seed: new Uint8Array(randomBytes(32)) };
      const rotated = passport(coder.did, coder, [key2], coderPassport, true);
      await log.append(rotated);

      const lineage = (by: Signer) => createRecord({
        type: "lineage", issuer: coder.did, subject: coder.did, prev: null, issued_at: at(),
        body: { edge: "update", child: coder.did, parents: [coder.did], change: { layer: "memory", description: "note" } },
      }, by);
      assert.equal(await codeOf(log.append(lineage(coder))), "UNKNOWN_KEY");
      assert.equal(await codeOf(log.append(lineage(key2))), undefined);
      assert.equal((await log.verify()).ok, true, "replay reproduces rotation-time key state");
    });

    test("passport chains: no second root, no update by strangers", async () => {
      const log = new EventLog(await h.make());
      const { alicePassport } = await registerParties(log);
      assert.equal(await codeOf(log.append(passport(alice.did, alice, [alice], null))), "BAD_PREV");
      assert.equal(await codeOf(log.append(passport(alice.did, bank, [bank], alicePassport))), "WRONG_ISSUER");
      assert.equal(await codeOf(log.append(passport(alice.did, alice, [alice], alicePassport))), undefined);
    });

    test("chains never fork", async () => {
      const log = new EventLog(await h.make(), { fallbackResolver: vectorResolver });
      const [contract, bond] = lifecycleCases.find((c: any) => c.name === "happy_path").records;
      await log.append(contract);
      await log.append(bond);
      const rival = createRecord({
        type: "bond", issuer: coder.did, subject: contract.id, prev: contract.id, issued_at: bond.issued_at,
        body: { ...bond.body, slashing_conditions: ["lost_dispute"] },
      }, coder);
      assert.equal(await codeOf(log.append(rival)), "BAD_PREV");
    });

    test("job-only records cannot start or join other chains", async () => {
      const log = new EventLog(await h.make(), { fallbackResolver: vectorResolver });
      const bond = lifecycleCases.find((c: any) => c.name === "happy_path").records[1];
      assert.equal(await codeOf(log.append({ ...bond })), "BAD_PREV", "its prev is not in this log");
      const lonely = rec("bond", coder, bond.body, null, null);
      assert.equal(await codeOf(log.append(lonely)), "ILLEGAL_TRANSITION");
    });

    test("appending the same record twice is a no-op", async () => {
      const log = new EventLog(await h.make(), { fallbackResolver: vectorResolver });
      const [contract] = lifecycleCases.find((c: any) => c.name === "happy_path").records;
      const first = await log.append(contract);
      const again = await log.append(contract);
      assert.equal(again.duplicate, true);
      assert.equal(again.seq, first.seq);
      assert.equal((await log.head()).seq, 1);
    });

    test("the log hash depends only on the records and their order", async () => {
      const records = lifecycleCases.find((c: any) => c.name === "dispute_ruled").records;
      const a = new EventLog(await h.make(), { fallbackResolver: vectorResolver });
      const b = new EventLog(new MemoryStore(), { fallbackResolver: vectorResolver });
      for (const r of records) { await a.append(r); await b.append(r); }
      assert.deepEqual(await a.head(), await b.head());
    });

    test("since() pages through the log in order", async () => {
      const log = new EventLog(await h.make(), { fallbackResolver: vectorResolver });
      const records = lifecycleCases.find((c: any) => c.name === "happy_path").records;
      for (const r of records) await log.append(r);
      const p1 = await log.since(0, 3);
      const p2 = await log.since(3, 100);
      assert.deepEqual([...p1, ...p2].map((s) => s.seq), records.map((_: unknown, i: number) => i + 1));
    });
  });
}

describe("Postgres-only guarantees", { skip: !pgUrl && "set ASP_TEST_DATABASE_URL to run" }, () => {
  let store: PostgresStore;
  before(async () => { store = (await postgres.make()) as PostgresStore; });
  after(() => postgres.cleanup());

  test("records cannot be updated, deleted or truncated", async () => {
    const log = new EventLog(store, { fallbackResolver: vectorResolver });
    const [contract] = lifecycleCases.find((c: any) => c.name === "happy_path").records;
    await log.append(contract);
    await assert.rejects(store.pool.query("UPDATE records SET issuer = 'x'"), /append-only/);
    await assert.rejects(store.pool.query("DELETE FROM records"), /append-only/);
    await assert.rejects(store.pool.query("TRUNCATE records CASCADE"), /append-only/);
  });

  test("concurrent appends to the same chain: exactly one wins", async () => {
    const log = new EventLog(store, { fallbackResolver: vectorResolver });
    const records = lifecycleCases.find((c: any) => c.name === "rejected_then_redelivered").records;
    const contract = records[0];
    // A fresh chain rooted at the same contract is impossible (duplicate), so use a new contract.
    const fresh = cosign(createRecord({ ...contract, type: "contract", issued_at: "2026-11-01T00:00:00Z" }, alice), coder);
    await log.append(fresh);
    const bodies = [1, 2, 3, 4].map((n) => createRecord({
      type: "bond", issuer: coder.did, subject: fresh.id, prev: fresh.id, issued_at: "2026-11-01T00:05:00Z",
      body: { contract: fresh.id, backer: coder.did, amount: { value: 0, unit: "credit" },
        escrow: { payer: alice.did, amount: { value: n, unit: "credit" } }, slashing_conditions: [] },
    }, coder));
    const results = await Promise.allSettled(bodies.map((b) => log.append(b)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await log.chainInfo(fresh.id))?.length, 2);
    assert.equal((await log.verify()).ok, true);
  });
});
