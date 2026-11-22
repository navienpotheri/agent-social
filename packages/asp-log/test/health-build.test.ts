// DK1803: the service's health answer says which record schemas it runs, so a client can tell a service that is older than it (asp live preflight compares them).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { schemaFingerprint } from "@agent-social/asp-core";
import { EventLog, MemoryStore, createLogServer } from "../src/index.ts";
import { operator, owner, resolver } from "./society-kit.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

test("GET /health says ok and the fingerprint of every record schema the service holds, the same as the client's own", async () => {
  const log = new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: resolver });
  const server = createLogServer({ handle: { log, append: (r: never) => log.append(r), mint: async () => 0 } as never, tenants: [], noAuth: true });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); servers.push(server);
  const j = await (await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/health`)).json() as { ok: boolean; build: { schemas: Record<string, string> } };
  assert.equal(j.ok, true);
  assert.deepEqual(j.build.schemas, schemaFingerprint());
  assert.ok(Object.keys(j.build.schemas).includes("contract"));
});
