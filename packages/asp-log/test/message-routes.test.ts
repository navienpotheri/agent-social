/**
 * The sealed text of direct messages (register row DK1346; spec-delta S1595): the log holds the hash and the size, the service holds the text and gives it only to the tenants that answer for the sender or the recipient (their own
 * tenant, or the sponsor's); a text that is not the one committed to is refused; a stranger reads nothing; and the wake signal counts a message as something for its recipient. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mentionsOf } from "../src/front-door.ts";
import { messageRoutes } from "../../asp-package/src/message-routes.ts";
import { kit, mk } from "./society-kit.ts";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

async function world() {
  const k = await kit();
  const sponsorA = await k.person("mr-sponsor-a"), sponsorB = await k.person("mr-sponsor-b");
  const a = await k.agent("mr-a", sponsorA), b = await k.agent("mr-b", sponsorB);
  const owned = new Map<string, string[]>([["tenant-a", [a.did]], ["tenant-sponsor-b", [sponsorB.did]], ["tenant-stranger", []]]);
  const handler = messageRoutes({ handle: { log: k.log } as never, owners: { of: (n: string) => owned.get(n) ?? [] }, dir: mkdtempSync(join(tmpdir(), "asp-msg-")) });
  const call = async (tenant: string, method: string, path: string, body?: unknown) => {
    let status = 0, text = "";
    const res = { writeHead: (s: number) => { status = s; }, end: (t: string) => { text = t; } } as unknown as ServerResponse;
    const req = Object.assign((async function* () { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); })(), { method, url: path, headers: {} }) as unknown as IncomingMessage & { on: unknown };
    (req as unknown as { on: (e: string, f: (d?: Buffer) => void) => void }).on = (e, f) => { if (e === "data" && body !== undefined) f(Buffer.from(JSON.stringify(body))); if (e === "end") f(); };
    await handler(req, res, { tenant: { name: tenant, role: "tenant", tokenSha256: "x" } });
    return { status, body: text ? JSON.parse(text) : null };
  };
  return { k, a, b, sponsorA, sponsorB, call };
}

test("DK1346: the sender's tenant stores the text, the recipient's sponsor reads it, a stranger and a wrong text are refused", async () => {
  const w = await world();
  const text = "can you review my plan for the harbour world?";
  const m = mk("agent_message", w.a, { to: w.b.did, kind: "question", body_sha256: sha(text), bytes: Buffer.byteLength(text) }, null, { subject: w.b.did });
  await w.k.log.append(m);
  assert.equal(JSON.stringify((await w.k.log.get(m.id))?.record.body).includes("harbour"), false, "the log never holds the text");
  assert.equal((await w.call("tenant-a", "POST", "/messages/text", { record: m.id, text: "another text" })).body.error.code, "TEXT_MISMATCH");
  assert.equal((await w.call("tenant-stranger", "POST", "/messages/text", { record: m.id, text })).body.error.code, "NOT_YOURS", "only the sender's tenant stores it");
  assert.equal((await w.call("tenant-a", "POST", "/messages/text", { record: "sha256:" + "0".repeat(64), text })).body.error.code, "NOT_A_MESSAGE");
  assert.equal((await w.call("tenant-a", "POST", "/messages/text", { record: m.id, text })).status, 201);
  assert.equal((await w.call("tenant-a", "POST", "/messages/text", { record: m.id, text })).status, 409);
  // the sender's tenant reads its own; the recipient's SPONSOR reads the same message with its text; a stranger reads nothing
  const mine = (await w.call("tenant-a", "GET", `/messages?did=${encodeURIComponent(w.a.did)}`)).body.messages;
  assert.deepEqual([mine.length, mine[0].text, mine[0].kind], [1, text, "question"]);
  const theirs = (await w.call("tenant-sponsor-b", "GET", `/messages?did=${encodeURIComponent(w.b.did)}`)).body.messages;
  assert.equal(theirs[0].text, text, "the recipient's sponsor sees the words");
  assert.equal((await w.call("tenant-stranger", "GET", `/messages?did=${encodeURIComponent(w.b.did)}`)).status, 403, "a stranger cannot read an agent's messages");
  assert.equal((await w.call("tenant-a", "GET", `/messages?did=${encodeURIComponent(w.b.did)}`)).status, 403, "the sender's tenant does not read the recipient's inbox as its own");
  assert.equal((await w.call("tenant-a", "GET", "/messages")).status, 400);
});

test("DK1346: a message not yet given its text is listed without it, and the wake signal counts a message as something for its recipient", async () => {
  const w = await world();
  const before = (await w.k.log.head()).seq;
  const m = mk("agent_message", w.a, { to: w.b.did, kind: "note", body_sha256: sha("hi"), bytes: 2 }, null, { subject: w.b.did });
  await w.k.log.append(m);
  const list = (await w.call("tenant-a", "GET", `/messages?did=${encodeURIComponent(w.a.did)}`)).body.messages;
  assert.equal(list[0].text, undefined, "text not stored yet");
  const pulse = { head: async () => w.k.log.head(), since: (n: number, l: number) => w.k.log.since(n, l) };
  assert.equal(await mentionsOf(pulse as never, w.b.did, before), 1, "the recipient is woken by it");
  assert.equal(await mentionsOf(pulse as never, w.a.did, before), 0, "the sender is not told about its own message");
});
