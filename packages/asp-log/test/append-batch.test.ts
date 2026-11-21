// DK1362 (S1418): a batch route that appends many signed records in one request, each judged on its own, each taking a place in the tenant's write limit and quota; limits by plan. Real log, fake tokens.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { EventLog, MemoryStore, Limits, UsageStore, createLogServer, hashToken, type Tenant } from "../src/index.ts";
import { keysOf, mk, party, resolver, operator, owner } from "./society-kit.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const listen = async (s: Server) => { await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s); return `http://127.0.0.1:${(s.address() as { port: number }).port}`; };

const passports = (n: number, tag: string) => Array.from({ length: n }, (_, i) => { const p = party(`did:web:example.com:users:${tag}-${i}`); return mk("passport", p, { did: p.did, kind: "human", keys: keysOf(p) }, null, { subject: p.did }); });

async function setup(tenants: Tenant[], o: { plans?: never; write?: number; records?: number } = {}) {
  const log = new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver });
  const handle = { log, append: (r: never) => log.append(r), mint: async () => 0 } as never;
  const usage = new UsageStore();
  const limits = new Limits({ appendPerMinute: o.write ?? 0, tenantPerMinute: 0 } as never);
  const server = createLogServer({ handle, tenants, noAuth: false, usage, limits, ...(o.records ? { defaultRecordQuota: o.records } : {}), ...((o as { plans?: object }).plans ? { plans: (o as unknown as { plans: object }).plans as never } : {}) });
  const url = await listen(server);
  const batch = (tok: string, records: unknown[], extra: Record<string, unknown> = {}) => fetch(`${url}/append-batch`, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ records, ...extra }) });
  return { log, usage, batch, url };
}
const T: Tenant[] = [{ name: "ops", role: "admin", tokenSha256: hashToken("op") }, { name: "alpha", role: "tenant", tokenSha256: hashToken("ta") }];

test("a batch appends every record in order, judges each on its own, and reports each result; a refused record does not stop the rest unless asked", async () => {
  const { log, batch } = await setup(T);
  const recs = passports(5, "batch-ok");
  const dup = mk("mint", party("did:web:example.com:users:not-the-operator"), { to: recs[0].subject, amount: { value: 5, unit: "credit" }, reason: "test", authority: "operator" }, null, { subject: recs[0].subject });
  const r = await (await batch("ta", [...recs, dup])).json() as { result: { accepted: number; refused: number; results: { ok: boolean; seq?: number; error?: { code: string } }[] } };
  assert.deepEqual([r.result.accepted, r.result.refused], [5, 1], "a mint by someone who is not the operator is refused on its own");
  assert.deepEqual(r.result.results.map((x) => x.ok), [true, true, true, true, true, false]);
  assert.deepEqual(r.result.results.slice(0, 5).map((x) => x.seq), [1, 2, 3, 4, 5], "in order");
  assert.equal((await log.head()).seq, 5);
  const bad = passports(3, "batch-stop");
  const stopped = await (await batch("ta", [bad[0], { not: "a record" }, bad[1], bad[2]], { stopOnError: true })).json() as { result: { accepted: number; results: { error?: { code: string } }[] } };
  assert.equal(stopped.result.accepted, 1);
  assert.deepEqual(stopped.result.results.slice(2).map((x) => x.error?.code), ["SKIPPED", "SKIPPED"]);
  assert.equal((await batch("ta", [])).status, 400, "an empty batch");
  assert.equal((await batch("nope", passports(1, "x"))).status, 401);
});

test("every record of a batch takes a place in the tenant's write limit: a batch cannot go round it, a batch larger than the burst is refused whole, and a plan raises the limit", async () => {
  const lowT: Tenant[] = [T[0], { name: "alpha", role: "tenant", tokenSha256: hashToken("ta") }];
  const { batch, log } = await setup(lowT, { write: 40 });
  assert.equal((await batch("ta", passports(11, "big"))).status, 429, "11 writes against a burst of 10 (a quarter of 40 a minute)");
  assert.equal((await log.head()).seq, 0, "nothing was appended");
  assert.equal((await batch("ta", passports(8, "fit"))).status, 200);
  assert.equal((await batch("ta", passports(5, "over"))).status, 429, "8 are used, 5 more would be 13 of 10");
  // a plan: the tenant's own writeLimitPerMinute replaces the default
  const planT: Tenant[] = [T[0], { name: "alpha", role: "tenant", tokenSha256: hashToken("ta"), writeLimitPerMinute: 400 } as Tenant];
  const s2 = await setup(planT, { write: 40 });
  assert.equal((await s2.batch("ta", passports(60, "plan"))).status, 200, "60 writes under a plan of 400 a minute (a burst of 100)");
  // limits by plan: the table fills what the tenant does not set
  const byPlan: Tenant[] = [T[0], { name: "alpha", role: "tenant", tokenSha256: hashToken("ta"), plan: "fleet" } as Tenant];
  const s3 = await setup(byPlan, { write: 40, plans: { fleet: { writeLimitPerMinute: 800, recordQuota: 1000 } } as never });
  assert.equal((await s3.batch("ta", passports(150, "fleet"))).status, 200, "the fleet plan allows 800 a minute (a burst of 200)");
});

test("the batch counts in the tenant's record quota and in its usage", async () => {
  const { batch, usage } = await setup(T, { records: 10 });
  assert.equal((await batch("ta", passports(6, "q1"))).status, 200);
  assert.equal(usage.get("alpha").records, 6);
  assert.equal((await batch("ta", passports(5, "q2"))).status, 403, "6 + 5 is over the quota of 10");
  assert.equal(usage.get("alpha").records, 6, "a refused batch counts for nothing");
  assert.equal(usage.month("alpha", new Date().toISOString().slice(0, 7)).writes, 6);
});
