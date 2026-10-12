import { test } from "node:test";
import assert from "node:assert/strict";
import { didAllowed, didDocument, didFor, didOfPath, namespaceGuard, namespaceOf } from "../src/index.ts";

const D = "log.example.org";
const tenant = (name: string, role: "tenant" | "admin" = "tenant") => ({ name, role, tokenSha256: "0".repeat(64) });

test("a tenant's namespace: its person, further people and agents are allowed; another tenant's, another domain's and malformed names are not; did:key always is", () => {
  const ns = namespaceOf(D, "team-a");
  assert.equal(ns.person, "did:web:log.example.org:u:team-a");
  for (const ok of ["did:web:log.example.org:u:team-a", "did:web:log.example.org:u:team-a:bank", "did:web:log.example.org:a:team-a:coder", "did:key:z6MkAnything"]) assert.equal(didAllowed(ok, D, "team-a"), true, ok);
  for (const no of ["did:web:log.example.org:u:team-b", "did:web:log.example.org:a:team-b:coder", "did:web:log.example.org:u:team-ab", "did:web:other.example.org:u:team-a", "did:web:log.example.org:a:team-a", "did:web:log.example.org:a:team-a:Bad_Name", "did:web:log.example.org:a:team-a:coder:extra", "did:web:thedeeptransformation.com:users:alice"]) assert.equal(didAllowed(no, D, "team-a"), false, no);
  assert.equal(didFor(D, "team-a", "human"), "did:web:log.example.org:u:team-a");
  assert.equal(didFor(D, "team-a", "human", "bank"), "did:web:log.example.org:u:team-a:bank");
  assert.equal(didFor(D, "team-a", "agent", "coder"), "did:web:log.example.org:a:team-a:coder");
  assert.throws(() => didFor(D, "team-a", "agent"), /needs a name/);
  assert.equal(namespaceOf("127.0.0.1:8787", "t-1").person, "did:web:127.0.0.1%3A8787:u:t-1", "a port is encoded as did:web asks");
});

test("a DID document's address maps to one DID and back; the document lists the passport's keys as Ed25519 JWKs", () => {
  assert.equal(didOfPath(D, "/u/team-a/did.json"), "did:web:log.example.org:u:team-a");
  assert.equal(didOfPath(D, "/u/team-a/bank/did.json"), "did:web:log.example.org:u:team-a:bank");
  assert.equal(didOfPath(D, "/a/team-a/coder/did.json"), "did:web:log.example.org:a:team-a:coder");
  for (const bad of ["/a/team-a/did.json", "/u/T/did.json", "/u/team-a/Bad Name/did.json", "/x/team-a/did.json", "/u/team-a/coder/more/did.json", "/u/team-a"]) assert.equal(didOfPath(D, bad), undefined, bad);
  const doc = didDocument("did:web:log.example.org:u:team-a", [{ id: "did:web:log.example.org:u:team-a#key-1", public_key: "AAAA" }, { id: "did:web:log.example.org:u:team-a#recovery-1", public_key: "BBBB" }]);
  assert.equal(doc.id, "did:web:log.example.org:u:team-a");
  assert.deepEqual(doc.verificationMethod.map((m) => [m.id.split("#")[1], m.publicKeyJwk.x, m.publicKeyJwk.crv]), [["key-1", "AAAA", "Ed25519"], ["recovery-1", "BBBB", "Ed25519"]]);
  assert.equal(doc.authentication.length, 2);
});

test("the namespace guard: a tenant's passport outside its namespace is refused (also inside an import), other records and admins are not touched", async () => {
  const g = namespaceGuard({ domain: D });
  const passport = (did: string) => ({ type: "asp.passport/v0.2", issuer: did, body: { did } });
  assert.equal(await g({ tenant: tenant("team-a"), method: "append", args: [passport("did:web:log.example.org:a:team-a:coder")] }), undefined);
  const refused = await g({ tenant: tenant("team-a"), method: "append", args: [passport("did:web:log.example.org:u:team-b")] });
  assert.match(refused!, /not an identity this tenant may create.*did:web:log\.example\.org:u:team-a/);
  assert.match((await g({ tenant: tenant("team-a"), method: "importRecords", args: [[{ record: passport("did:web:thedeeptransformation.com:users:alice") }]] }))!, /not an identity/);
  assert.equal(await g({ tenant: tenant("team-a"), method: "append", args: [{ type: "asp.action/v0.2", issuer: "did:web:elsewhere:x", body: {} }] }), undefined);
  assert.equal(await g({ tenant: tenant("ops", "admin"), method: "append", args: [passport("did:web:log.example.org:court:juror-1")] }), undefined);
});

import { agentCapGuard } from "../src/index.ts";

test("the agent cap: a tenant may have only so many agents; an update to one it has, a person, an admin and other records are not counted", async () => {
  const mine = new Set(["did:web:log.example.org:a:team-a:one", "did:web:log.example.org:a:team-a:two", "did:web:log.example.org:u:team-a"]);
  const g = agentCapGuard({ domain: D, max: 2, owners: { of: () => [...mine] } });
  const passport = (did: string) => ({ type: "asp.passport/v0.2", issuer: did, body: { did } });
  assert.match((await g({ tenant: tenant("team-a"), method: "append", args: [passport("did:web:log.example.org:a:team-a:three")] }))!, /already has 2 agents; the beta allows 2/);
  assert.equal(await g({ tenant: tenant("team-a"), method: "append", args: [passport("did:web:log.example.org:a:team-a:one")] }), undefined, "an update to an agent it already has");
  assert.equal(await g({ tenant: tenant("team-a"), method: "append", args: [passport("did:web:log.example.org:u:team-a:bank")] }), undefined, "a person is not an agent");
  assert.equal(await g({ tenant: tenant("ops", "admin"), method: "append", args: [passport("did:web:log.example.org:a:team-a:three")] }), undefined);
  assert.equal(await g({ tenant: tenant("team-a"), method: "append", args: [{ type: "asp.action/v0.2", issuer: "x", body: {} }] }), undefined);
});
