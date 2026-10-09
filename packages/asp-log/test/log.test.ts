import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  b64urlEncode, cosign, createRecord, type AspRecord, type Signer,
} from "@agent-social/asp-core";
import { EventLog, MemoryStore, PostgresStore } from "../src/index.ts";
import {
  alice, at, bank, codeOf, coder, lifecycleCases, memory, party, passport, pgUrl, postgres, rec, registerParties, vectorResolver,
} from "./harness.ts";

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

    test("verifyCheckpoint (decision D5): true only for the exact hash the log actually had at that seq", async () => {
      const log = new EventLog(await h.make(), { fallbackResolver: vectorResolver });
      const records = lifecycleCases.find((c: any) => c.name === "happy_path").records;
      const heads: { seq: number; logHash: string }[] = [];
      for (const r of records) { await log.append(r); heads.push(await log.head()); }

      // Every checkpoint taken along the way still verifies against the finished log.
      for (const h of heads) assert.equal(await log.verifyCheckpoint(h), true);
      // A wrong hash at a real seq, a real hash claimed at the wrong seq, and a seq beyond the log all fail.
      assert.equal(await log.verifyCheckpoint({ seq: heads[2].seq, logHash: heads[1].logHash }), false);
      assert.equal(await log.verifyCheckpoint({ seq: heads[1].seq, logHash: heads[2].logHash }), false);
      assert.equal(await log.verifyCheckpoint({ seq: heads.at(-1)!.seq + 10, logHash: heads.at(-1)!.logHash }), false);
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
    await log.mint(alice.did, 100); // the escrow each bond locks must be covered, or every one fails for that reason
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
