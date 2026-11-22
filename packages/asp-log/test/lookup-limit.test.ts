/**
 * The registry lookup limit (DK125, registry.md RG-14): at most 60 lookups a minute from one address (a burst of a quarter of that), on the lookup routes only, with the retry time named; other public pages and
 * other addresses are not held by it, and 0 turns it off. Fake addresses only.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { DEFAULT_LIMITS, Limits, createLogServer } from "../src/index.ts";
import { kit } from "./society-kit.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

test("DK125: the bucket: a burst of 15 and then one a second, per address; another address has its own; 0 turns it off", () => {
  assert.equal(DEFAULT_LIMITS.lookupPerMinute, 60);
  let t = 0;
  const l = new Limits({ now: () => t });
  const taken = (addr: string) => { let n = 0; while (l.checkLookup(addr).ok) { n++; if (n > 200) break; } return n; };
  assert.equal(taken("10.0.0.1"), 15, "a burst of a quarter of 60");
  const refused = l.checkLookup("10.0.0.1");
  assert.equal(refused.ok, false);
  assert.match((refused as { why: string }).why, /more than 60 registry lookups a minute/);
  assert.ok((refused as { retryAfterSec: number }).retryAfterSec >= 1, "the retry time is named");
  assert.equal(taken("10.0.0.2"), 15, "another address has its own bucket");
  t += 5_000;
  assert.equal(taken("10.0.0.1"), 5, "one a second refills");
  t += 600_000;
  assert.equal(taken("10.0.0.1"), 15, "after a quiet while the burst is back");
  const off = new Limits({ lookupPerMinute: 0, now: () => t });
  for (let i = 0; i < 500; i++) assert.equal(off.checkLookup("10.0.0.3").ok, true);
  const strict = new Limits({ lookupPerMinute: 8, now: () => t });
  let n = 0; while (strict.checkLookup("a").ok) { n++; if (n > 100) break; }
  assert.equal(n, 2, "the burst is a quarter of the limit, at least one");
});

test("DK125: over HTTP, the lookup routes answer 429 with Retry-After after the burst; other public pages and the health check are not held by it", async () => {
  const k = await kit();
  const person = await k.person("lk-person", 10);
  const handle = { append: async () => ({ id: "x", seq: 1 }), log: k.log } as never;
  const server = createLogServer({ handle, tenants: [], noAuth: true, limits: new Limits({ lookupPerMinute: 8 }) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const lookup = `${url}/registry/agents/${encodeURIComponent(person.did)}`;
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await fetch(lookup)).status);
  assert.deepEqual(statuses.slice(0, 2), [200, 200], "the burst is allowed");
  const last = await fetch(lookup);
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get("retry-after")) >= 1, "Retry-After is named");
  assert.equal((await fetch(`${url}/registry/search?q=x`)).status, 429, "a search is a lookup too");
  assert.equal((await fetch(`${url}/registry/names/x`)).status, 429, "so is a name");
  assert.equal((await fetch(`${url}/courts/jurors`)).status, 200, "another public page is not held by the lookup limit");
  assert.equal((await fetch(`${url}/health`)).status, 200);
});
