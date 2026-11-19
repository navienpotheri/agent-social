// DK532 (S956): the service routes for hosted bots: make the key, register the passport with custody service (the sponsor signs it), have the service sign the bot's acts; a tenant reaches only its own bots, a
// local agent has none, a passport is never signed by the service, and the operator can take the sealed key file. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64urlDecode, b64urlEncode } from "@agent-social/asp-core";
import { kit, mk } from "../../asp-log/test/society-kit.ts";
import { HostedSigner } from "../src/hosted-signer.ts";
import { hostedBotRoutes } from "../src/hosted-routes.ts";

test("create a hosted bot, register its passport, have the service sign its act; isolation, refusals and the operator's backup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-hostedr-"));
  const file = join(dir, "hosted.keys");
  const signer = new HostedSigner(file, "a-long-operator-passphrase");
  const k = await kit();
  const sponsor = await k.person("hr-sponsor", 10);
  const handle = { log: k.log, append: (r: never) => k.log.append(r) } as never;
  const route = hostedBotRoutes({ handle, signer, domain: "asp.example", file });
  let tenant = { name: "alice", role: "tenant" };
  const server = createServer(async (req, res) => { if (!(await route(req, res, { tenant }))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = async (path: string, body: unknown) => { const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() as any }; };
  try {
    assert.equal((await post("/hosted/bots", { name: "Bad Name" })).status, 400);
    const made = await post("/hosted/bots", { name: "bot1" });
    assert.equal(made.status, 200);
    assert.equal(made.body.did, "did:web:asp.example:a:alice:bot1");
    assert.equal((await post("/hosted/bots", { name: "bot1" })).status, 409, "a second key for the same bot is refused");
    assert.equal(made.body.private_key, undefined, "the private half never leaves the store");

    // Before the sponsor registers the passport with custody service the service signs nothing.
    const act = { type: "lineage", body: { edge: "update", child: made.body.did, parents: [made.body.did], change: { layer: "memory", description: "hosted note" } } };
    assert.equal((await post("/hosted/bots/bot1/sign", act)).body.error.code, "NO_PASSPORT");
    await k.log.append(mk("passport", sponsor, { did: made.body.did, kind: "agent", sponsor: sponsor.did, custody: "service", tier: 1, shape: {}, keys: [{ id: made.body.kid, type: "Ed25519", public_key: made.body.public_key }] }, null, { subject: made.body.did }));
    assert.deepEqual(b64urlDecode(made.body.public_key).length, 32);
    const signed = await post("/hosted/bots/bot1/sign", act);
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
    assert.equal(signed.body.custody, "service");
    const rec = (await k.log.get(signed.body.id))!.record;
    assert.equal(rec.issuer, made.body.did, "the record is the bot's own");

    // Refusals: a passport is never the service's to sign, a bot that is not hosted, another tenant's bot, a bad body.
    assert.equal((await post("/hosted/bots/bot1/sign", { type: "passport", body: {} })).body.error.code, "BAD_TYPE");
    assert.equal((await post("/hosted/bots/localbot/sign", act)).body.error.code, "NOT_HOSTED");
    tenant = { name: "mallory", role: "tenant" };
    assert.equal((await post("/hosted/bots/bot1/sign", act)).body.error.code, "NOT_HOSTED", "mallory has no bot1: its namespace is its own");
    assert.equal((await fetch(`${base}/hosted/backup`)).status, 403);
    tenant = { name: "ops", role: "admin" };
    const sealed = await (await fetch(`${base}/hosted/backup`)).text();
    assert.equal(sealed, readFileSync(file, "utf8"));
    assert.doesNotMatch(sealed, /bot1|alice/, "the backup is the sealed file: no readable DID or key");
    assert.throws(() => new HostedSigner(join(dir, "copy.keys"), "short"));
    void b64urlEncode;
  } finally { server.close(); }
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
});
