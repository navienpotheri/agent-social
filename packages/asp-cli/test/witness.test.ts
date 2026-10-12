import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
const didKeyOf = (text: string) => /(did:key:z[1-9A-HJ-NP-Za-km-z]+)/.exec(text)![1];

/** An operator's log with a funded, bonded, running job: records, minted credits and a ledger a replica must reproduce. */
async function operator() {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["log", "checkpoint", "--as", ALICE]);
  return { f, contract };
}

test("a witness replays an export, reproduces the head and signs it; the operator then needs it with --min-witnesses", async () => {
  const { f } = await operator();
  const exp = join(f.root, "export.ndjson");
  assert.match((await ok(f, ["log", "export", "--out", exp])).out, /exported \d+ record/);

  const w = makeFixture();
  const created = await ok(w, ["identity", "new", "--kind", "human", "--method", "did:key"]);
  const witnessDid = didKeyOf(created.out + created.err);
  const wfile = join(w.root, "witness.ndjson");
  const witnessed = await ok(w, ["log", "witness", exp, "--as", witnessDid, "--out", wfile]);
  assert.match(witnessed.out, /reproduced head seq/);
  // The replica reproduced the ledger too, not just the hash.
  const replica = await ok({ ...w, aspHome: join(w.aspHome, "replica") }, ["credits", "balance", ALICE]);
  assert.match(replica.out, /: 0 credits/, "alice's 1000 is locked in escrow in the replica too, same as at the operator");

  assert.equal((await asp(f, ["log", "verify", "--min-witnesses", "1"])).code, 1, "no witness yet");
  await ok(f, ["log", "witnesses", "add", wfile]);
  const verified = await asp(f, ["log", "verify", "--min-witnesses", "1"]);
  assert.equal(verified.code, 0, verified.out);
  assert.match(verified.out, /witnessed by 1 independent witness/);
  const two = await asp(f, ["log", "verify", "--min-witnesses", "2"]);
  assert.equal(two.code, 1);
  assert.match(two.out, /needs 2 witness/);
});

test("a witness that holds a different history fails verification, and cannot import this log", async () => {
  const { f } = await operator();
  const exp = join(f.root, "export.ndjson");
  await ok(f, ["log", "export", "--out", exp]);

  // A second party with its own, different log signs a checkpoint of that.
  const other = makeFixture();
  await ok(other, ["identity", "new", "--kind", "human", "--did", "did:web:example.com:users:mallory"]);
  await ok(other, ["identity", "new", "--kind", "human", "--did", "did:web:example.com:users:mallory2"]);
  const created = await ok(other, ["identity", "new", "--kind", "human", "--method", "did:key"]);
  const odid = didKeyOf(created.out + created.err);
  const ofile = join(other.root, "other-witness.ndjson");
  await ok(other, ["log", "checkpoint", "--as", odid]);
  const cpLine = (await import("node:fs")).readFileSync(join(other.aspHome, "checkpoints.ndjson"), "utf8");
  (await import("node:fs")).writeFileSync(ofile, cpLine);

  await ok(f, ["log", "witnesses", "add", ofile]);
  const bad = await asp(f, ["log", "verify"]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /it saw a different history/);

  const imp = await asp(other, ["log", "import", exp]);
  assert.equal(imp.code, 1);
  assert.match(imp.err, /diverges from the export|does not match|jumps/);
});

test("incremental export: a witness catches up from where it left off", async () => {
  const { f, contract } = await operator();
  const first = join(f.root, "e1.ndjson");
  await ok(f, ["log", "export", "--out", first]);
  const w = makeFixture();
  const created = await ok(w, ["identity", "new", "--kind", "human", "--method", "did:key"]);
  const wdid = didKeyOf(created.out + created.err);
  await ok(w, ["log", "witness", first, "--as", wdid]);
  const seen = Number(/head seq (\d+)/.exec((await ok(f, ["log", "export", "--out", join(f.root, "tmp.ndjson")])).out)![1]);

  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read"]);
  const second = join(f.root, "e2.ndjson");
  assert.match((await ok(f, ["log", "export", "--since", String(seen), "--out", second])).out, /exported 1 record/);
  const wfile = join(w.root, "w2.ndjson");
  assert.match((await ok(w, ["log", "witness", second, "--as", wdid, "--out", wfile])).out, /replayed 1 record/);
  await ok(f, ["log", "witnesses", "add", wfile]);
  assert.equal((await asp(f, ["log", "verify", "--min-witnesses", "1"])).code, 0);
});

// ---- published feeds ----
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const feedServers: Server[] = [];
/** A real HTTP server serving one folder, standing in for GitHub Pages or any static host. */
async function serveDir(dir: string): Promise<string> {
  const server = createServer((req, res) => {
    const file = join(dir, (req.url ?? "/").split("?")[0]);
    if (existsSync(file) && !file.endsWith("/")) { res.end(readFileSync(file)); } else { res.statusCode = 404; res.end("not found"); }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  feedServers.push(server);
  return `http://127.0.0.1:${(server.address() as any).port}`;
}
test.after(() => { for (const s of feedServers) s.close(); });

/** A witness who has replayed the operator's log and published its checkpoint to a folder. */
async function publishedWitness(f: Fixture) {
  const exp = join(f.root, "export.ndjson");
  await ok(f, ["log", "export", "--out", exp]);
  const w = makeFixture();
  const created = await ok(w, ["identity", "new", "--kind", "human", "--method", "did:key"]);
  const did = didKeyOf(created.out + created.err);
  await ok(w, ["log", "witness", exp, "--as", did]);
  const feed = join(w.root, "feed");
  return { w, did, feed };
}

test("a witness publishes a feed folder; the operator reads it from the folder and from a URL", async () => {
  const { f } = await operator();
  const { w, feed } = await publishedWitness(f);
  assert.match((await ok(w, ["log", "publish", "--to", feed])).out, /published 1 new checkpoint/);
  assert.match((await ok(w, ["log", "publish", "--to", feed])).out, /published 0 new checkpoint/, "publishing again adds nothing");

  await ok(f, ["log", "witnesses", "add", feed]);
  assert.equal((await asp(f, ["log", "verify", "--min-witnesses", "1"])).code, 0);

  const base = await serveDir(feed);
  const g = makeFixture();
  // A second operator copy with the same log reads the same feed over HTTP.
  await ok(g, ["log", "import", join(f.root, "export.ndjson")]);
  await ok(g, ["log", "witnesses", "add", base]);
  const viaUrl = await asp(g, ["log", "verify", "--min-witnesses", "1"]);
  assert.equal(viaUrl.code, 0, viaUrl.out);
  assert.match(viaUrl.out, /witnessed by 1 independent witness/);
});

test("a feed that rewrites its history is refused, and an unreachable feed fails closed", async () => {
  const { f } = await operator();
  const { w, did, feed } = await publishedWitness(f);
  await ok(w, ["log", "publish", "--to", feed]);
  const base = await serveDir(feed);
  await ok(f, ["log", "witnesses", "add", base]);

  // The feed host swaps the old entry for a different one.
  const other = makeFixture();
  const oc = await ok(other, ["identity", "new", "--kind", "human", "--method", "did:key"]);
  await ok(other, ["log", "checkpoint", "--as", didKeyOf(oc.out + oc.err)]);
  writeFileSync(join(feed, "feed.ndjson"), readFileSync(join(other.aspHome, "checkpoints.ndjson")));
  const again = await asp(f, ["log", "witnesses", "add", base]);
  assert.equal(again.code, 1);
  assert.match(again.err, /rewritten its history/);
  void did;

  const dead = await asp(f, ["log", "witnesses", "add", "http://127.0.0.1:1/"]);
  assert.equal(dead.code, 1);
  assert.match(dead.err, /could not fetch/);
  const insecure = await asp(f, ["log", "witnesses", "add", "http://example.com/feed.ndjson"]);
  assert.equal(insecure.code, 1);
  assert.match(insecure.err, /must be https/);
});

test("publish --with-export writes the whole log for others to replay, and only when asked", async () => {
  const { f } = await operator();
  const plain = join(f.root, "pub-plain");
  await ok(f, ["log", "publish", "--to", plain]);
  assert.equal(existsSync(join(plain, "export.ndjson")), false, "the log's contents are not published by default");
  const full = join(f.root, "pub-full");
  await ok(f, ["log", "publish", "--to", full, "--with-export"]);
  assert.equal(existsSync(join(full, "export.ndjson")), true);
  const replayer = makeFixture();
  assert.match((await ok(replayer, ["log", "import", join(full, "export.ndjson")])).out, /imported \d+ record/);
});

// ---- cross-checking ----
import { Keystore, appendCheckpoint, readCheckpoints, signCheckpoint } from "@agent-social/asp-package";

/** The operator signs a second, different history at the seq it already checkpointed: what a forking host would do. */
async function forkedFeed(f: Fixture) {
  const real = readCheckpoints(join(f.aspHome, "checkpoints.ndjson")).at(-1)!;
  const signer = new Keystore(f.aspHome).forDid(ALICE)!;
  const fork = signCheckpoint({ seq: real.seq, logHash: "sha256:" + "b".repeat(64) }, signer);
  const dir = join(f.root, "reader-y");
  appendCheckpoint(join(dir, "feed.ndjson"), fork);
  return { real, fork, dir };
}

test("cross-check proves a fork: the same signer, the same seq, two different hashes", async () => {
  const { f } = await operator();
  const { dir } = await forkedFeed(f);
  const res = await asp(f, ["log", "cross-check", dir]);
  assert.equal(res.code, 1);
  assert.match(res.out, /FORK .* signed two different histories at seq \d+/);
  assert.match(res.out, /cross-check FAILED/);
});

test("cross-check passes when everyone saw the same history, and counts the signers", async () => {
  const { f } = await operator();
  const readerY = join(f.root, "reader-same");
  await ok(f, ["log", "publish", "--to", readerY]);
  const res = await asp(f, ["log", "cross-check", readerY]);
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /cross-check ok: \d+ checkpoint\(s\) from 1 signer\(s\), no fork/);
});

test("witnesses add refuses a feed that contradicts a checkpoint already held, with the signed proof", async () => {
  const { f } = await operator();
  const { dir } = await forkedFeed(f);
  const res = await asp(f, ["log", "witnesses", "add", dir]);
  assert.equal(res.code, 1);
  assert.match(res.out, /FORK/);
  assert.match(res.err, /contradicts checkpoints already held/);
});

test("publish --seen shares the witness checkpoints this home collected, so others can cross-check them", async () => {
  const { f } = await operator();
  const { w, feed } = await publishedWitness(f);
  await ok(w, ["log", "publish", "--to", feed]);
  await ok(f, ["log", "witnesses", "add", feed]);
  const out = join(f.root, "seen-feed");
  assert.match((await ok(f, ["log", "publish", "--to", out, "--seen"])).out, /published 2 new checkpoint/, "its own and the witness's");
  assert.equal(readCheckpoints(join(out, "feed.ndjson")).length, 2);
});
