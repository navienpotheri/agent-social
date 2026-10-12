import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { b64urlDecode, publicKeyFromDidKey } from "@agent-social/asp-core";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const createdDid = (out: string) => /^created (?:human|agent) (did:key:z\S+)/m.exec(out)?.[1];

test("--method did:key derives a self-certifying identity: no --did needed, a fresh key each time", async () => {
  const f = makeFixture();
  const res = await asp(f, ["identity", "new", "--kind", "human", "--method", "did:key"]);
  assert.equal(res.code, 0, res.err);
  const did = createdDid(res.out);
  assert.ok(did, "the created DID is printed");

  const shown = JSON.parse((await asp(f, ["identity", "show", did!])).out);
  const key = shown.keys.find((k: any) => k.kid === `${did}#key-1`);
  assert.ok(key, "the key is registered under <did>#key-1");
  // did:key is self-certifying: the DID itself decodes to the exact key that was registered for it.
  assert.deepEqual(publicKeyFromDidKey(did!), b64urlDecode(key.publicKey));

  const secondDid = createdDid((await asp(f, ["identity", "new", "--kind", "human", "--method", "did:key"])).out);
  assert.notEqual(secondDid, did, "each did:key identity is freshly generated, never reused");
});

test("an agent can also use --method did:key, sponsored the same way as a did:web agent", async () => {
  const f = makeFixture();
  const sponsor = "did:web:example.com:users:sponsor";
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", sponsor])).code, 0);

  const res = await asp(f, ["identity", "new", "--kind", "agent", "--method", "did:key", "--sponsor", sponsor]);
  assert.equal(res.code, 0, res.err);
  const did = createdDid(res.out);
  assert.ok(did);
  const shown = JSON.parse((await asp(f, ["identity", "show", did!])).out);
  assert.equal(shown.sponsor, sponsor);
});

test("a did:key agent packs and runs exactly like a did:web one", async () => {
  const f = makeFixture(); // a Claude Code project fixture; see fixture.ts
  const sponsor = "did:web:example.com:users:sponsor";
  await asp(f, ["identity", "new", "--kind", "human", "--did", sponsor]);
  const agentRes = await asp(f, ["identity", "new", "--kind", "agent", "--method", "did:key", "--sponsor", sponsor]);
  const agentDid = createdDid(agentRes.out)!;

  const pkg = join(f.root, "agent.aspkg");
  const packed = await asp(f, ["pack", "--runtime", "claude-code", "--agent", agentDid, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal(packed.code, 0, packed.err);
  assert.equal((await asp(f, ["verify", pkg])).code, 0);

  const dry = await asp(f, ["run", pkg, "--backend", "claude-code", "--project", f.project, "--prompt", "hi", "--dry-run"],
    { GITHUB_TOKEN: "t", API_BASE: "x", ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude.mjs", import.meta.url)) });
  assert.equal(dry.code, 0, dry.err);
});

test("without --did or --method did:key, identity new is a usage error naming both options", async () => {
  const f = makeFixture();
  const res = await asp(f, ["identity", "new", "--kind", "human"]);
  assert.equal(res.code, 2);
  assert.match(res.err, /--did/);
  assert.match(res.err, /--method did:key/);
});

test("--did still takes priority: giving both --did and --method uses the given DID", async () => {
  const f = makeFixture();
  const res = await asp(f, ["identity", "new", "--kind", "human", "--did", "did:web:example.com:users:explicit", "--method", "did:key"]);
  assert.equal(res.code, 0, res.err);
  assert.match(res.out, /^created human did:web:example\.com:users:explicit/);
});
