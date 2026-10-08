import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { randomSeed } from "@agent-social/asp-core";
import { createLogServer, hashToken, type Tenant } from "@agent-social/asp-log";
import { COMMONS_VERSION, LocalLog, commonsRoutes, signCommons } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";

const HUMAN = "did:web:example.com:users:navien";
const CODER = "did:web:example.com:agents:coder";
const REV1 = "did:web:example.com:agents:rev1";
const REV2 = "did:web:example.com:agents:rev2";
const TOKEN = "commons-token";
const tenants: Tenant[] = [{ name: "ops", role: "admin", tokenSha256: hashToken(TOKEN) }];

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function setup() {
  const handle = await LocalLog.open(mkdtempSync(join(tmpdir(), "asp-cm-log-")));
  const server = createLogServer({ handle, tenants, extra: commonsRoutes({ root: mkdtempSync(join(tmpdir(), "asp-commons-")), handle }) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const home = mkdtempSync(join(tmpdir(), "asp-cm-home-"));
  const asp = async (args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ASP_LOG_URL: url, ASP_LOG_TOKEN: TOKEN }, cwd: home };
    const code = await main(args, io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  assert.equal((await asp(["identity", "new", "--kind", "human", "--did", HUMAN])).code, 0);
  for (const did of [CODER, REV1, REV2]) assert.equal((await asp(["identity", "new", "--kind", "agent", "--did", did, "--sponsor", HUMAN])).code, 0);
  const note = join(home, "lesson.md");
  writeFileSync(note, "Run migrations before seeding test data, or the seed fails on a missing column.\n");
  return { asp, url, home, note };
}

test("an entry is unreviewed until two other agents endorse it; authors cannot review themselves; citations count once per agent", async () => {
  const { asp, note } = await setup();
  const add = await asp(["commons", "add", note, "--by", CODER, "--title", "Migrations first", "--tag", "testing,database"]);
  assert.equal(add.code, 0, add.err);
  const id = /shared: (sha256:[0-9a-f]{64})/.exec(add.out)![1];
  assert.match((await asp(["commons", "add", note, "--by", CODER, "--title", "Migrations first", "--tag", "testing,database"])).out, /shared: /, "same content, same id");

  assert.match((await asp(["commons", "list"])).out, /\[unreviewed\] Migrations first/);
  assert.match((await asp(["commons", "list", "--tag", "database"])).out, /1 entry/);
  assert.match((await asp(["commons", "list", "--tag", "nothing"])).out, /0 entries/);
  assert.match((await asp(["commons", "list", "--q", "seed fails"])).out, /1 entry/);

  const own = await asp(["commons", "review", id, "--by", CODER, "--verdict", "endorse"]);
  assert.notEqual(own.code, 0);
  assert.match(own.err, /cannot review their own/);

  assert.match((await asp(["commons", "review", id, "--by", REV1, "--verdict", "endorse", "--note", "worked for me"])).out, /now unreviewed/);
  assert.match((await asp(["commons", "review", id, "--by", REV2, "--verdict", "endorse"])).out, /now reviewed/);
  const twice = await asp(["commons", "review", id, "--by", REV1, "--verdict", "dispute"]);
  assert.notEqual(twice.code, 0);
  assert.match(twice.err, /already reviewed/);

  assert.equal((await asp(["commons", "cite", id, "--by", REV1, "--context", "fixed my seed script"])).code, 0);
  assert.equal((await asp(["commons", "cite", id, "--by", REV1, "--context", "and again"])).code, 0);
  assert.equal((await asp(["commons", "cite", id, "--by", CODER, "--context", "citing myself"])).code, 0);
  const show = await asp(["commons", "show", id]);
  assert.match(show.out, /2 endorsement\(s\), 0 dispute\(s\), cited by 1 agent\(s\)/);
  assert.match(show.out, /endorse  did:web:example.com:agents:rev1: worked for me/);
  assert.match((await asp(["commons", "list", "--status", "reviewed"])).out, /1 entry/);
  assert.match((await asp(["commons", "list", "--status", "disputed"])).out, /0 entries/);
});

test("an entry that other agents dispute is marked disputed", async () => {
  const { asp, note } = await setup();
  const id = /shared: (sha256:[0-9a-f]{64})/.exec((await asp(["commons", "add", note, "--by", CODER, "--title", "Dubious"])).out)![1];
  await asp(["commons", "review", id, "--by", REV1, "--verdict", "endorse"]);
  assert.match((await asp(["commons", "review", id, "--by", REV2, "--verdict", "dispute", "--note", "does not reproduce"])).out, /now disputed/);
});

test("the service rejects documents from unknown keys, the wrong DID's key, or altered after signing", async () => {
  const { asp, url, note } = await setup();
  const id = /shared: (sha256:[0-9a-f]{64})/.exec((await asp(["commons", "add", note, "--by", CODER, "--title", "Real"])).out)![1];
  const post = (path: string, body: unknown) => fetch(`${url}/commons/${path}`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const entry = (author: string, title: string) => ({ v: COMMONS_VERSION as typeof COMMONS_VERSION, kind: "entry" as const, author, title, text: "text", tags: [] as string[], createdAt: "2026-01-01T00:00:00Z" });

  // A key the log has never heard of.
  const ghost = { kid: "did:web:example.com:agents:ghost#key-1", seed: randomSeed() };
  const unknown = await post("entries", signCommons(entry("did:web:example.com:agents:ghost", "Ghost"), ghost));
  assert.equal(unknown.status, 403);
  assert.equal(((await unknown.json()) as any).error.code, "UNKNOWN_KEY");

  // A key that does not belong to the claimed author.
  const wrong = await post("entries", signCommons(entry(CODER, "Impostor"), { kid: `${REV1}#key-1`, seed: randomSeed() }));
  assert.equal(wrong.status, 422);
  assert.equal(((await wrong.json()) as any).error.code, "WRONG_KEY");

  // The right DID, but a key that is not in the log: the signature cannot be checked against a registered key.
  const forged = await post("entries", signCommons(entry(CODER, "Forged"), { kid: `${CODER}#key-1`, seed: randomSeed() }));
  assert.equal(forged.status, 403);
  assert.equal(((await forged.json()) as any).error.code, "BAD_SIGNATURE");

  const missing = await post("reviews", signCommons({ v: COMMONS_VERSION, kind: "review", entry: "sha256:" + "0".repeat(64), reviewer: REV1, verdict: "endorse", createdAt: "2026-01-01T00:00:00Z" }, { kid: `${REV1}#key-1`, seed: randomSeed() }));
  assert.notEqual(missing.status, 201);

  // Sharing under a contract whose Mandate does not allow it is refused before anything is signed.
  const noShare = await asp(["commons", "add", note, "--by", CODER, "--title", "Not allowed", "--contract", id]);
  assert.notEqual(noShare.code, 0);
});
