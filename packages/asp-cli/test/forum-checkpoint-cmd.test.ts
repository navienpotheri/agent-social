// Register row DK791 (S1350): `asp forum checkpoint --by <operator did>` signs the forum head on the operator's machine and appends it to the log; `asp forum verify` then compares the chain with it and fails when
// a forum act is changed afterwards. Fake DIDs and keys only; credits are accounting entries, not money.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createLogServer, hashToken, type Tenant } from "@agent-social/asp-log";
import { LocalLog, forumRoutes } from "@agent-social/asp-package";
import { main, setClock, type Io } from "../src/cli.ts";

const HUMAN = "did:web:example.com:users:navien";
const OPERATOR = "did:web:example.com:agents:operator";
const A = "did:web:example.com:agents:alice";
const TOKEN = "forum-checkpoint-cmd-token";
const tenants: Tenant[] = [{ name: "agents", role: "tenant", tokenSha256: hashToken(TOKEN) }];
const servers: Server[] = [];
after(() => { setClock(undefined); for (const s of servers) s.close(); });

test("DK791: asp forum checkpoint signs the head into the log; asp forum verify reports it and fails when a forum act is changed afterwards", async () => {
  const t = Date.parse("2026-11-21T10:00:00Z");
  setClock(() => new Date(t));
  const logDir = mkdtempSync(join(tmpdir(), "asp-fcc-log-"));
  writeFileSync(join(logDir, "operator.json"), JSON.stringify({ operator: OPERATOR }));
  const handle = await LocalLog.open(logDir);
  const root = mkdtempSync(join(tmpdir(), "asp-fcc-forum-"));
  const forum = forumRoutes({ root, handle, now: () => new Date(t) });
  const server = createLogServer({ handle, tenants, publicRoutes: forum.publicRoutes, extra: forum.writeRoutes });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const home = mkdtempSync(join(tmpdir(), "asp-fcc-home-"));
  const asp = async (args: string[]) => {
    const out: string[] = [], err: string[] = [];
    const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ASP_LOG_URL: url, ASP_LOG_TOKEN: TOKEN, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home }, cwd: home };
    const code = await main(args, io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  assert.equal((await asp(["identity", "new", "--kind", "human", "--did", HUMAN])).code, 0);
  for (const did of [OPERATOR, A]) assert.equal((await asp(["identity", "new", "--kind", "agent", "--did", did, "--sponsor", HUMAN])).code, 0);

  const empty = await asp(["forum", "checkpoint", "--by", OPERATOR]);
  assert.notEqual(empty.code, 0, "an empty forum has nothing to checkpoint");
  const file = join(home, "post.txt");
  writeFileSync(file, "the first post of the checkpoint test");
  assert.equal((await asp(["forum", "post", file, "--by", A, "--title", "first"])).code, 0);
  const cp = await asp(["forum", "checkpoint", "--by", OPERATOR]);
  assert.equal(cp.code, 0, cp.err + cp.out);
  assert.match(cp.out, /checkpoint .*: 1 forum act\(s\), head sha256:/);
  const ok = await asp(["forum", "verify"]);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /1 operator checkpoint\(s\) in the log, the latest at 1 act\(s\)/);
  const head = (await (await fetch(`${url}/forum/head`)).json()) as any;
  assert.equal(head.signed.matches, true);
  assert.equal(head.signed.signed_by, OPERATOR);

  // The same forum act, changed on disk: verify fails.
  const chain = readFileSync(join(root, "chain.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: string });
  const docFile = join(root, "docs", chain[0]!.id.replace(":", "-") + ".json");
  writeFileSync(docFile, JSON.stringify({ ...JSON.parse(readFileSync(docFile, "utf8")), text: "edited after the checkpoint" }));
  const bad = await asp(["forum", "verify"]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /FAILED/);
});
