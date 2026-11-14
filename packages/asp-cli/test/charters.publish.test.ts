/** `asp charter publish-all | show | index` on a real log (register rows IS1 and DK382; spec-delta S480): the twelve charters of docs/institutions become signed records with the hash of their text, and the record cannot drift from the document. Fake keys only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, setClock, type Io } from "../src/cli.ts";
import { parseCharters } from "../src/charters.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OP = "did:web:asp.local:operator", OWNER = "did:web:example.com:users:the-owner";
async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

test("the twelve charters are parsed from the documents, and each is published as version 1 with the owner's co-signature and the hash of its text", async () => {
  const docs = join(root, "docs");
  const all = parseCharters(docs);
  assert.equal(all.length, 12);
  assert.equal(all.flatMap((c) => c.institutions).length, 13, "Bank and Insurer share a text and have an account each");
  assert.equal(all.find((c) => c.title === "Registry")!.funding["did:web:asp.local:registry"], "registry");
  assert.equal(all.find((c) => c.title === "Forum")!.funding["did:web:asp.local:forum"], "none");
  assert.equal(all.find((c) => c.title === "Shops and Services")!.funding["did:web:asp.local:shops"], "none");

  const f = makeFixture();
  setClock(() => new Date("2026-11-15T00:00:00Z"));
  const savedOp = process.env.ASP_OPERATOR_DID, savedOwner = process.env.ASP_OWNER_DID;
  process.env.ASP_OPERATOR_DID = OP; process.env.ASP_OWNER_DID = OWNER;
  try {
    for (const d of [OP, OWNER]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    assert.match((await ok(f, ["charter", "index"])).out, /^0 of 13 institutions have a charter in force/);
    const pub = await ok(f, ["charter", "publish-all", "--by", OP, "--cosign-by", OWNER, "--docs", docs]);
    assert.match(pub.out, /13 charter record\(s\) published, each with the owner's co-signature/);
    assert.match((await ok(f, ["charter", "index"])).out, /^13 of 13 institutions have a charter in force/);
    // Publishing again skips what is there.
    assert.match((await ok(f, ["charter", "publish-all", "--by", OP, "--cosign-by", OWNER, "--docs", docs])).out, /0 charter record\(s\) published/);

    // The record carries the hash of the document's text: the cross-check.
    const show = await ok(f, ["charter", "show", "--institution", "did:web:asp.local:courts"]);
    const courts = all.find((c) => c.title === "Courts")!;
    assert.ok(show.out.includes(courts.sha256), "the hash in the log is the hash of the text in docs/institutions");
    assert.equal(courts.sha256, "sha256:" + createHash("sha256").update(courts.text).digest("hex"));
    assert.match(show.out, /version 1, sovereign, active, funding courts, officers did:web:asp.local:operator/);
    // A budget line named by a charter is one the Treasury can fund: the funding names are the budget lines of the drafts.
    assert.match((await ok(f, ["charter", "show", "--institution", "did:web:asp.local:bank"])).out, /funding Bank lending reserve/);
    assert.equal((await asp(f, ["charter", "show"])).code, 2);
    assert.equal((await ok(f, ["log", "verify"])).code, 0);
  } finally { setClock(undefined); if (savedOp === undefined) delete process.env.ASP_OPERATOR_DID; else process.env.ASP_OPERATOR_DID = savedOp; if (savedOwner === undefined) delete process.env.ASP_OWNER_DID; else process.env.ASP_OWNER_DID = savedOwner; }
});
