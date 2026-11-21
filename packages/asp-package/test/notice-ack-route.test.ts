// GET /notices/ack (register row US8, spec-delta S1591): a tenant reads the acknowledgement in force for ITS OWN identities only; another's is refused; the parameters are checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { accountRoutes } from "../src/account.ts";

const MINE = "did:web:example.com:users:me", THEIRS = "did:web:example.com:users:them";
const handler = accountRoutes({
  handle: { log: { noticeAck: async (issuer: string, notice: string) => (issuer === MINE && notice === "asp.my-data/v1" ? { id: "sha256:" + "1".repeat(64), notice, statement_sha256: "a".repeat(64), at: "2026-11-22T00:00:00Z", count: 1 } : null) } },
  owners: { of: (name: string) => (name === "me" ? [MINE] : []) },
  tenants: () => [],
} as never);

async function get(path: string) {
  let status = 0, text = "";
  const res = { writeHead: (s: number) => { status = s; }, end: (t: string) => { text = t; } } as unknown as ServerResponse;
  const handled = await handler({ method: "GET", url: path, headers: {} } as IncomingMessage, res, { tenant: { name: "me", role: "tenant", tokenSha256: "x" } });
  return { handled, status, body: text ? JSON.parse(text) : null };
}

test("a tenant reads the acknowledgement of its own identity; none yet reads as null", async () => {
  const a = await get(`/notices/ack?issuer=${encodeURIComponent(MINE)}&notice=${encodeURIComponent("asp.my-data/v1")}`);
  assert.deepEqual([a.handled, a.status, a.body.ok, a.body.ack.statement_sha256], [true, 200, true, "a".repeat(64)]);
  const none = await get(`/notices/ack?issuer=${encodeURIComponent(MINE)}&notice=${encodeURIComponent("asp.terms/v1")}`);
  assert.deepEqual([none.status, none.body.ack], [200, null]);
});

test("another identity is refused, and a missing parameter is a bad request", async () => {
  const other = await get(`/notices/ack?issuer=${encodeURIComponent(THEIRS)}&notice=${encodeURIComponent("asp.my-data/v1")}`);
  assert.deepEqual([other.status, other.body.error.code], [403, "NOT_YOURS"]);
  assert.equal((await get("/notices/ack?notice=asp.my-data/v1")).status, 400);
});
