// Row DK520 (spec-delta S961): `asp watcher register` puts the watcher's key in the log, `asp watcher publish` puts its collusion findings there (a tampered one is skipped, a repeat is ignored), and `asp clinic finding-checkup` cites one
// in a checkup order. A finding is a lead, not a verdict. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLINIC_DID, WATCHER_DID } from "@agent-social/asp-log";
import { SocietyWatcher } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

test("DK520: a ring found by the watcher is signed, put in the log, and the Clinic's checkup cites it; a tampered finding and an unknown finding are refused", async () => {
  const f = makeFixture();
  const asp = async (args: string[]) => {
    const out: string[] = [], err: string[] = [];
    const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root } as Io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  const S1 = "did:web:example.com:users:ring-sponsor-1", S2 = "did:web:example.com:users:ring-sponsor-2", A1 = "did:web:example.com:agents:ring-a", A2 = "did:web:example.com:agents:ring-b";
  for (const d of [S1, S2, CLINIC_DID]) assert.equal((await asp(["identity", "new", "--kind", "human", "--did", d])).code, 0);
  assert.equal((await asp(["identity", "new", "--kind", "agent", "--did", A1, "--sponsor", S1, "--purpose", "work"])).code, 0);
  assert.equal((await asp(["identity", "new", "--kind", "agent", "--did", A2, "--sponsor", S2, "--purpose", "work"])).code, 0);

  // The watcher's folder, with a signed collusion finding, a tampered copy of it and a finding of another kind (not put in the log).
  const dir = mkdtempSync(join(tmpdir(), "asp-watcher-"));
  mkdirSync(dir, { recursive: true });
  const w = new SocietyWatcher({ log: { since: async () => [] }, dir });
  const ring = w.sign({ kind: "collusion", detail: { kind: "ring", agents: [A1, A2], jobs: [], why: "three accepted jobs in a closed loop" }, detectedAt: "2026-11-19T00:00:00Z", latestActionAt: "2026-11-19T00:00:00Z", head: 10 });
  const tampered = { ...ring, id: "sha256:" + "1".repeat(64) };
  const burst = w.sign({ kind: "purchase_burst", detail: { sponsor: S1, issuers: [A1], count: 20, amount: 100, firstAt: "2026-11-19T00:00:00Z", lastAt: "2026-11-19T00:05:00Z" }, detectedAt: "2026-11-19T00:00:00Z", latestActionAt: "2026-11-19T00:00:00Z", head: 11 });
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ findings: [ring, tampered, burst] }));

  assert.match((await asp(["watcher", "publish", "--watch-dir", dir])).err + "", /./, "nothing yet: the watcher is not registered");
  const reg = await asp(["watcher", "register", "--watch-dir", dir]);
  assert.equal(reg.code, 0, reg.err);
  assert.match(reg.out, new RegExp(`${WATCHER_DID} registered`));
  assert.match((await asp(["watcher", "register", "--watch-dir", dir])).out, /already registered/);
  const pub = await asp(["watcher", "publish", "--watch-dir", dir]);
  assert.equal(pub.code, 0, pub.err);
  assert.match(pub.out, /1 finding\(s\) put in the log, 0 already there/);
  assert.match(pub.err, /signature does not verify/, "the tampered copy is skipped");
  const recId = /is in the log as (sha256:[0-9a-f]{64})/.exec(pub.out)![1];
  assert.match((await asp(["watcher", "publish", "--watch-dir", dir])).out, /0 finding\(s\) put in the log, 1 already there/);

  // The Clinic cites it.
  const chk = await asp(["clinic", "finding-checkup", "--finding", recId, "--agent", A1]);
  assert.equal(chk.code, 0, chk.err);
  assert.match(chk.out, /a checkup for did:web:example.com:agents:ring-a, due within 7 days/);
  const bad = await asp(["clinic", "finding-checkup", "--finding", "sha256:" + "8".repeat(64), "--agent", A2]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.err, /not a finding signed by the society watcher/);
  assert.notEqual((await asp(["clinic", "finding-checkup", "--agent", A2])).code, 0, "a finding is required");
});
