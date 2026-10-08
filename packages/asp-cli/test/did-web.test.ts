import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { didWebUrl, fetchDidWebKeys } from "@agent-social/asp-core";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

/** A real HTTP server standing in for the domain that publishes a DID document. */
const servers: Server[] = [];
async function serve(doc: (port: number) => unknown, status = 200): Promise<number> {
  const server = createServer((req, res) => {
    if (req.url === "/users/bob/did.json") { res.statusCode = status; res.end(JSON.stringify(doc((server.address() as any).port))); }
    else { res.statusCode = 404; res.end("{}"); }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return (server.address() as any).port;
}
after(() => { for (const s of servers) s.close(); });

const docFor = (did: string, x: string) => ({
  "@context": ["https://www.w3.org/ns/did/v1"], id: did,
  verificationMethod: [{ id: `${did}#key-1`, type: "JsonWebKey2020", controller: did, publicKeyJwk: { kty: "OKP", crv: "Ed25519", x } }],
});

/** Bob creates a did:web identity on his own machine and exports the passport; returns it with its key. */
async function bob(port: number) {
  const did = `did:web:127.0.0.1%3A${port}:users:bob`;
  const f = makeFixture();
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", did])).code, 0);
  const file = join(f.root, "bob-passport.json");
  assert.equal((await asp(f, ["identity", "export", did, "--out", file])).code, 0);
  const record = JSON.parse(readFileSync(file, "utf8"));
  return { did, file, x: record.body.keys[0].public_key as string };
}

test("didWebUrl follows the did:web method: well-known for a bare domain, a path otherwise, http only for localhost", () => {
  assert.equal(didWebUrl("did:web:example.com"), "https://example.com/.well-known/did.json");
  assert.equal(didWebUrl("did:web:example.com:users:alice"), "https://example.com/users/alice/did.json");
  assert.equal(didWebUrl("did:web:localhost%3A8080:a"), "http://localhost:8080/a/did.json");
  assert.throws(() => didWebUrl("did:key:z6Mk"));
});

test("fetchDidWebKeys reads the Ed25519 keys a real server publishes, and refuses a document for another DID", async () => {
  const port = await serve((p) => docFor(`did:web:127.0.0.1%3A${p}:users:bob`, "A".repeat(43)));
  const keys = await fetchDidWebKeys(`did:web:127.0.0.1%3A${port}:users:bob`);
  assert.equal(keys.length, 1);
  assert.equal(keys[0].length, 32);
  const wrongPort = await serve(() => docFor("did:web:example.com:users:someone-else", "A".repeat(43)));
  await assert.rejects(fetchDidWebKeys(`did:web:127.0.0.1%3A${wrongPort}:users:bob`), /describes did:web:example.com:users:someone-else/);
});

test("identity register: a did:web passport whose key the DID document publishes is admitted", async () => {
  let x = "A".repeat(43);
  const port = await serve((p) => docFor(`did:web:127.0.0.1%3A${p}:users:bob`, x));
  const b = await bob(port);
  x = b.x; // bob publishes his real key on his domain
  const registry = makeFixture();
  const res = await asp(registry, ["identity", "register", b.file]);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /every key is published by its DID document/);
  assert.equal((await asp(registry, ["identity", "show", b.did])).code, 0);
});

test("identity register: a key the DID document does not publish, a missing document, and an unknown method are all refused", async () => {
  // Document publishes some other key.
  const port = await serve((p) => docFor(`did:web:127.0.0.1%3A${p}:users:bob`, "B".repeat(43)));
  const b = await bob(port);
  const registry = makeFixture();
  const mismatch = await asp(registry, ["identity", "register", b.file]);
  assert.equal(mismatch.code, 1);
  assert.match(mismatch.err, /does not publish/);
  // Nothing at all is served: fail closed.
  const dead = await bob(1);
  const unreachable = await asp(registry, ["identity", "register", dead.file]);
  assert.equal(unreachable.code, 1);
  assert.match(unreachable.err, /cannot verify/);
  // --trust-unverified is an explicit, loud opt-out.
  const forced = await asp(registry, ["identity", "register", dead.file, "--trust-unverified"]);
  assert.equal(forced.code, 0, forced.err);
  assert.match(forced.err, /NOT checked/);
});

test("identity register: a did:key passport needs no fetch (the log checks that the DID is the key)", async () => {
  const f = makeFixture();
  const created = await asp(f, ["identity", "new", "--kind", "human", "--method", "did:key"]);
  assert.equal(created.code, 0, created.err);
  const did = /(did:key:z[1-9A-HJ-NP-Za-km-z]+)/.exec(created.out + created.err)![1];
  const file = join(f.root, "key-passport.json");
  assert.equal((await asp(f, ["identity", "export", did, "--out", file])).code, 0);
  const registry = makeFixture();
  const res = await asp(registry, ["identity", "register", file]);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /self-certifying/);
});
