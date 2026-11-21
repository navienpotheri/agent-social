/**
 * The end mail's memory section after a real write-back (register row E12): a lesson admitted through the audit gate is a signed lineage update on a real package; the mail names each file that changed, not
 * only the count, and says whether the principal reviewed it. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Keystore, admitToMemory, buildMandateMail, collectMandateFacts, listLessons, type HeldOutTask, type MailLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice", CODER = "did:web:example.com:agents:coder";
async function ok(f: ReturnType<typeof makeFixture>, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  assert.equal(await main(args, io), 0, `${args.join(" ")}: ${err.join("\n") || out.join("\n")}`);
}
const heldOut: HeldOutTask[] = [{ id: "a", run: () => true }, { id: "b", run: () => true }, { id: "c", run: () => true }];

test("after a real admitted lesson the mail names the file it wrote, says it is not reviewed, and a Keep changes the sentence", async () => {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Learns"]);
  const pkg = join(f.root, "coder.aspkg");
  await ok(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  const signer = new Keystore(f.aspHome).forDid(CODER)!;
  const [v] = await admitToMemory(pkg, [{ id: "run-tests", text: "Run the tests before saying a change is done.", evidence: [{ kind: "commons_entry", ref: "c-ok" }], source: "course" }], { existing: [], heldOut, minHeldOut: 3, commonsStatus: () => "reviewed", isOwnRun: () => false, signer });
  assert.equal(v.admitted, true);
  const lessons = listLessons(pkg);
  assert.equal(lessons.length >= 1, true);
  const real = lessons[0];
  // the log's view of the same change: one lineage edge with the description the update wrote
  type Rec = { id: string; seq: number; record: { type: string; issuer: string; issued_at: string; body: any } };
  const r = (seq: number, id: string, type: string, at: string, body: any): Rec => ({ id, seq, record: { type, issuer: "did:x", issued_at: at, body } });
  const records = [
    r(1, "c1", "asp.contract/v0.2", "2026-10-01T00:00:00Z", { principal: ALICE, performer: CODER, purpose: "Fix the test", price: { value: 100, unit: "credit" } }),
    r(2, "m1", "asp.mandate/v0.2", "2026-10-01T00:01:00Z", { contract: "c1", scopes: ["repo.read"], spend: { cap: 5, unit: "credit" }, irreversible: { policy: "checkpoint" }, learning: { share_to_commons: false }, expires: "2027-01-01T00:00:00Z" }),
    r(3, "e1", "asp.lineage/v0.2", "2026-10-02T00:05:00Z", { child: CODER, change: { layer: "memory", description: real.description } }),
  ];
  const log: MailLog = { chain: async (c) => records.filter((x) => x.id === c || x.record.body?.contract === c) as never, chainInfo: async () => ({ state: "Settled" }), since: async () => records as never };
  const facts = (await collectMandateFacts(log, "c1"))!;
  const at = facts.memory[0].at;
  const mail = buildMandateMail(facts, { to: "a@b.co", learned: [{ ...real, at }] });
  assert.match(mail.text, /lessons\/run-tests\.md/, "the file that changed is named, not only counted");
  assert.match(mail.text, /1 added: lessons\/run-tests\.md \(not reviewed yet\)/);
  const kept = buildMandateMail(facts, { to: "a@b.co", learned: [{ ...real, at, review: { state: "kept", at: "2026-10-03T00:00:00Z" } }] });
  assert.match(kept.text, /you kept it/);
});
