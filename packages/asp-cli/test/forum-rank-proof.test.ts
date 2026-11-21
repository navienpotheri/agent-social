// Register rows DK1742 and DK1768 (S1599): `asp forum rank-checkpoint --by <operator>` signs the Merkle root of the forum's standing votes and the hash of the rank inputs into the log; `asp forum vote-prove` checks a voter's vote
// against the signed root; a vote the service left out has no proof; a vote cast after the checkpoint is not in the signed root yet. Fake DIDs and keys only; credits are accounting entries, not money.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { merkleRoot } from "@agent-social/asp-core";
import { createLogServer, hashToken, type Tenant } from "@agent-social/asp-log";
import { LocalLog, forumRoutes, rankCheckpointOf, voteLeaf } from "@agent-social/asp-package";
import { main, setClock, type Io } from "../src/cli.ts";

const HUMAN = "did:web:example.com:users:rp-human", OPERATOR = "did:web:example.com:agents:rp-operator";
const AUTHOR = "did:web:example.com:agents:rp-author", V1 = "did:web:example.com:agents:rp-v1", V2 = "did:web:example.com:agents:rp-v2", V3 = "did:web:example.com:agents:rp-v3";
const TOKEN = "forum-rank-proof-token";
const tenants: Tenant[] = [{ name: "agents", role: "tenant", tokenSha256: hashToken(TOKEN) }];
const servers: Server[] = [];
after(() => { setClock(undefined); for (const s of servers) s.close(); });

test("DK1768: the operator signs the root of the standing votes; a voter proves its vote against it; a later vote is not in the signed root; a missing vote has no proof", async () => {
  let t = Date.parse("2026-11-22T10:00:00Z");
  setClock(() => new Date(t));
  const logDir = mkdtempSync(join(tmpdir(), "asp-rp-log-"));
  writeFileSync(join(logDir, "operator.json"), JSON.stringify({ operator: OPERATOR }));
  const handle = await LocalLog.open(logDir);
  const root = mkdtempSync(join(tmpdir(), "asp-rp-forum-"));
  const forum = forumRoutes({ root, handle, now: () => new Date(t) });
  const server = createLogServer({ handle, tenants, publicRoutes: forum.publicRoutes, extra: forum.writeRoutes });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const home = mkdtempSync(join(tmpdir(), "asp-rp-home-"));
  const asp = async (args: string[]) => {
    const out: string[] = [], err: string[] = [];
    const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ASP_LOG_URL: url, ASP_LOG_TOKEN: TOKEN, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home }, cwd: home };
    const code = await main(args, io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  const ok = async (a: string[]) => { const r = await asp(a); assert.equal(r.code, 0, `${a.join(" ")}: ${r.err || r.out}`); return r; };
  await ok(["identity", "new", "--kind", "human", "--did", HUMAN]);
  for (const did of [OPERATOR, AUTHOR, V1, V2, V3]) await ok(["identity", "new", "--kind", "agent", "--did", did, "--sponsor", HUMAN]);
  const file = join(home, "post.txt"); writeFileSync(file, "a post to vote on");
  const posted = await ok(["forum", "post", file, "--by", AUTHOR, "--title", "a post"]);
  const post = /(sha256:[0-9a-f]{64})/.exec(posted.out)?.[1];
  assert.ok(post, "the post id is in the reply");
  const target = post!;
  await ok(["forum", "vote", target, "--by", V1, "--up"]);
  await ok(["forum", "vote", target, "--by", V2, "--up"]);

  const cp = await ok(["forum", "rank-checkpoint", "--by", OPERATOR]);
  assert.match(cp.out, /rank checkpoint .*: 2 standing vote\(s\) for 2026-11-22, root [0-9a-f]{64}/);
  const live = (await (await fetch(`${url}/forum/rank-checkpoint`)).json()) as { votes_root: string; votes: number; rank_sha256: string };
  assert.equal(live.votes, 2);
  assert.equal(live.votes_root, merkleRoot([voteLeaf({ voter: V1, target, value: 1 }), voteLeaf({ voter: V2, target, value: 1 })]), "the service's root is the Merkle root of the standing votes");
  assert.deepEqual(rankCheckpointOf([{ voter: V1, target, value: 1 }, { voter: V2, target, value: 1 }], "2026-11-22").votes_root, live.votes_root);
  // a voter proves its vote against the signed root
  const proof = await ok(["forum", "vote-prove", target, "--by", V1]);
  assert.match(proof.out, /the proof checks against the service's current root [0-9a-f]+\s+and that root is the one the operator signed/s);
  // a vote that was never cast has no proof; a vote cast after the checkpoint is not in the signed root yet
  const none = await asp(["forum", "vote-prove", target, "--by", V3]);
  assert.notEqual(none.code, 0, "V3 never voted: nothing to prove");
  await ok(["forum", "vote", target, "--by", V3, "--up"]);
  const late = await asp(["forum", "vote-prove", target, "--by", V3]);
  assert.notEqual(late.code, 0);
  assert.match(late.out, /the proof checks against the service's current root [0-9a-f]+\s+but the latest signed root \(2026-11-22\) is a different one: your vote came after it/s);
  // the next checkpoint contains it
  t += 86_400_000;
  await ok(["forum", "rank-checkpoint", "--by", OPERATOR]);
  assert.equal((await asp(["forum", "vote-prove", target, "--by", V3])).code, 0, "the later checkpoint holds the vote");
});
