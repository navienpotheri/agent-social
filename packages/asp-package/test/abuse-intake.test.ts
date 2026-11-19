// DK351: an outsider files a signed abuse report on the hosted service with no account: the route checks the reporter's domain key itself, countersigns with the operator's key and appends; a wrong key, a changed
// document, a non did:web reporter and too many reports from one address are refused. Fake keys and a fake DID-document fetch only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { b64urlEncode } from "@agent-social/asp-core";
import { kit, mk, operator, party } from "../../asp-log/test/society-kit.ts";
import { abuseIntakeRoutes } from "../src/abuse-intake.ts";

const sha = (t: string) => "sha256:" + createHash("sha256").update(t).digest("hex");
const docFor = (did: string, publicKey: Uint8Array) => JSON.stringify({ id: did, verificationMethod: [{ id: `${did}#key-1`, controller: did, type: "JsonWebKey2020", publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: b64urlEncode(publicKey) } }], authentication: [`${did}#key-1`] });

test("the intake route admits a report whose domain publishes the signing key, and refuses the rest, with a limit for each address", async () => {
  const k = await kit();
  const sponsor = await k.person("ai-sponsor", 10);
  const agent = await k.agent("ai-scanner", sponsor, { funds: 5 });
  const site = party("did:web:victim-site.example"), other = party("did:web:other-site.example"), liar = party("did:web:liar.example");
  const docs = new Map<string, string>([["https://victim-site.example/.well-known/did.json", docFor(site.did, site.publicKey)], ["https://other-site.example/.well-known/did.json", docFor(other.did, new Uint8Array(32).fill(9))], ["https://liar.example/.well-known/did.json", docFor(liar.did, liar.publicKey)]]);
  const fetchLike = async (u: string) => { const t = docs.get(u); return { ok: t !== undefined, status: t === undefined ? 404 : 200, text: async () => t ?? "" }; };
  const report = (by: typeof site, docUrl: string, over: Record<string, unknown> = {}, proofHash = sha(docs.get(docUrl) ?? "")) => mk("abuse_report", by, { accused: agent.did, kind: "network_abuse", description: "the agent scanned our servers overnight", reporter_key: { id: by.kid, public_key: b64urlEncode(by.publicKey) }, proof: { url: docUrl, sha256: proofHash }, ...over }, null, { subject: agent.did });
  const route = abuseIntakeRoutes({ handle: { log: k.log, append: (r: never) => k.log.append(r) } as never, operator: operator as never, fetch: fetchLike as never, perAddressPerDay: 3 });
  const server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/abuse/report`;
  const post = async (rec: unknown) => { const r = await fetch(base, { method: "POST", body: JSON.stringify(rec) }); return { status: r.status, body: await r.json() as any }; };
  try {
    const good = await post(report(site, "https://victim-site.example/.well-known/did.json"));
    assert.equal(good.status, 200, JSON.stringify(good.body));
    assert.equal((await k.log.abuseReportsAbout(agent.did)).length, 1, "recorded as a lead against the agent");
    // A site whose document does not publish the key the report is signed with is refused; so is a changed document.
    assert.equal((await post(report(other, "https://other-site.example/.well-known/did.json"))).body.error.code, "KEY_NOT_PUBLISHED");
    docs.set("https://liar.example/.well-known/did.json", docFor(liar.did, liar.publicKey) + " ");
    assert.equal((await post(report(liar, "https://liar.example/.well-known/did.json", {}, sha("something else")))).body.error.code, "DOC_CHANGED");
    // Fourth try from the same address within the day is rate limited (the three before it were counted whatever they were).
    assert.equal((await post(report(site, "https://victim-site.example/.well-known/did.json"))).status, 429);
    assert.equal((await fetch(base)).status, 405);
    assert.equal((await post({ type: "asp.mandate/v0.2" })).status, 429, "still limited");
  } finally { server.close(); }
  const notDidWeb = abuseIntakeRoutes({ handle: { log: k.log, append: (r: never) => k.log.append(r) } as never, operator: operator as never, fetch: fetchLike as never });
  const server2 = createServer(async (req, res) => { if (!(await notDidWeb(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server2.listen(0, "127.0.0.1", r));
  try {
    const url2 = `http://127.0.0.1:${(server2.address() as { port: number }).port}/abuse/report`;
    const bad = await fetch(url2, { method: "POST", body: JSON.stringify({ ...JSON.parse(JSON.stringify(report(site, "https://victim-site.example/.well-known/did.json"))), issuer: "did:key:zabc" }) });
    assert.equal(((await bad.json()) as any).error.code, "NOT_DID_WEB");
    assert.equal((await fetch(url2, { method: "POST", body: "not json" })).status, 400);
  } finally { server2.close(); }
});
