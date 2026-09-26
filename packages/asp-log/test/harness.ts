import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  AspError, b64urlEncode, createRecord, publicKeyFromSeed, signerFromSeed, staticResolver,
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
  return (await failure(p))?.code;
}

/** The AspError code and detail a promise rejects with, or undefined if it resolves. */
async function failure(p: Promise<unknown>): Promise<{ code: string; detail?: string } | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    if (e instanceof AspError) return { code: e.code, detail: e.detail };
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
export {
  alice, at, bank, codeOf, coder, failure, keys, lifecycleCases, memory, party, passport, pgUrl, postgres,
  rec, registerParties, vectorResolver, type Harness,
};
