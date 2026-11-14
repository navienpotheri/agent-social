/**
 * `asp abuse file | admit | list` on real logs and a real local web server (register row H3; spec-delta S430): a site files a signed report as its own did:web identity, the operator fetches the site's DID
 * document, checks the key and the hash, countersigns and records it; a site that does not publish the key, or a document that changed, is refused. Fake keys only.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64urlEncode } from "@agent-social/asp-core";
import { Keystore } from "@agent-social/asp-package";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const OPERATOR = "did:web:asp.local:operator";
async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

const docs = new Map<string, string>();
const server = createServer((req, res) => { const body = docs.get(req.url ?? ""); if (body === undefined) { res.writeHead(404); res.end(); } else { res.writeHead(200, { "content-type": "application/json" }); res.end(body); } });
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
after(() => server.close());
const port = (server.address() as { port: number }).port;
const SITE = `did:web:127.0.0.1%3A${port}`;
const docFor = (did: string, publicKey: Uint8Array) => JSON.stringify({ id: did, verificationMethod: [{ id: `${did}#key-1`, controller: did, type: "JsonWebKey2020", publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: b64urlEncode(publicKey) } }] });

test("a site files a signed abuse report, the operator checks its domain's key and admits it, and a wrong key or a changed document is refused", async () => {
  setClock(() => new Date("2026-11-14T00:00:00Z"));
  const savedOp = process.env.ASP_OPERATOR_DID;
  process.env.ASP_OPERATOR_DID = OPERATOR;
  try {
    const reporter = makeFixture(), op = makeFixture();
    // The site's machine: an identity for its did:web name (a person here is any did:web identity).
    await ok(reporter, ["identity", "new", "--kind", "human", "--did", SITE]);
    const siteSigner = new Keystore(reporter.aspHome).forDid(SITE)! as unknown as { publicKey: Uint8Array };
    docs.set("/.well-known/did.json", docFor(SITE, siteSigner.publicKey));
    // The operator's machine: its own key, a sponsor and the accused agent.
    for (const d of [OPERATOR, "did:web:example.com:users:ab-sponsor"]) await ok(op, ["identity", "new", "--kind", "human", "--did", d]);
    await ok(op, ["identity", "new", "--kind", "agent", "--did", "did:web:example.com:agents:scanner", "--sponsor", "did:web:example.com:users:ab-sponsor"]);
    const accused = "did:web:example.com:agents:scanner";

    const dir = mkdtempSync(join(tmpdir(), "asp-abuse-"));
    const file = join(dir, "report.json");
    const filed = await ok(reporter, ["abuse", "file", "--by", SITE, "--accused", accused, "--kind", "network_abuse", "--description", "the agent scanned our servers from many addresses overnight", "--out", file]);
    assert.match(filed.out, /nothing is recorded yet/);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(saved.type, "asp.abuse_report/v0.2");
    assert.equal(saved.cosigs, undefined, "filing does not countersign: only the operator's admission does");

    // The operator's log has no record of it until admission.
    assert.match((await ok(op, ["abuse", "list", "--accused", accused])).out, /0 abuse report/);
    const admitted = await ok(op, ["abuse", "admit", file, "--cosign-by", OPERATOR]);
    assert.match(admitted.out, new RegExp(`${SITE.replace(/[.%]/g, "\\$&")} controls its domain's key`));
    assert.match((await ok(op, ["abuse", "list", "--accused", accused])).out, /1 abuse report\(s\)[\s\S]*network_abuse/);

    // A site that does not publish the key it signed with: refused.
    docs.set("/.well-known/did.json", docFor(SITE, new Uint8Array(32).fill(7)));
    const wrongKey = join(dir, "wrong.json");
    await ok(reporter, ["abuse", "file", "--by", SITE, "--accused", accused, "--kind", "spam", "--description", "the agent posted the same advert in our forum again and again", "--out", wrongKey]);
    // The document the report hashed is the one served now (it was fetched while filing), but it does not publish the signing key.
    const noKey = await asp(op, ["abuse", "admit", wrongKey, "--cosign-by", OPERATOR]);
    assert.notEqual(noKey.code, 0);
    assert.match(noKey.err, /does not publish the key the report is signed with/);

    // A document that changed after the report was filed: refused with its own reason.
    docs.set("/.well-known/did.json", docFor(SITE, siteSigner.publicKey));
    const stale = join(dir, "stale.json");
    await ok(reporter, ["abuse", "file", "--by", SITE, "--accused", accused, "--kind", "other", "--description", "the agent kept connecting to our private test server", "--out", stale]);
    docs.set("/.well-known/did.json", docFor(SITE, siteSigner.publicKey) + " ");
    const changed = await asp(op, ["abuse", "admit", stale, "--cosign-by", OPERATOR]);
    assert.notEqual(changed.code, 0);
    assert.match(changed.err, /is not the one the report states/);
    assert.match((await ok(op, ["abuse", "list", "--accused", accused])).out, /1 abuse report\(s\)/, "only the admitted one is in the log");

    assert.equal((await asp(reporter, ["abuse", "file", "--by", "did:key:z6Mkabc", "--accused", accused, "--kind", "spam", "--description", "x".repeat(30)])).code, 2, "a reporter is a did:web identity");
    writeFileSync(join(dir, "junk.json"), "{}");
  } finally { setClock(undefined); if (savedOp === undefined) delete process.env.ASP_OPERATOR_DID; else process.env.ASP_OPERATOR_DID = savedOp; }
});
