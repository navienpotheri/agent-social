// Rows D12 and DK272 (spec-delta S1593): `asp market mandate --private-scopes a,b` writes learning.private_scopes into the Mandate; a bad list is refused before the log sees it; without the flag the Mandate
// names none. (The gateway reads the list from the Mandate and --private-scopes can only narrow it; the sealing itself is tested in packages/asp-package/test/private-memory-run.test.ts.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { openLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";
async function asp(f: Fixture, args: string[]) {
  const out: string[] = []; const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  return { code: await main(args, io), out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

test("the Mandate carries the private scopes the sponsor names, and a bad list is refused", async () => {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Work"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Scopes", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "go", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  const mandate = (extra: string[]) => asp(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read", ...extra]);
  const bad = await mandate(["--private-scopes", "Bad Name"]);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /--private-scopes/);
  assert.equal((await mandate(["--private-scopes", "notes,notes"])).code, 2, "a duplicate is refused");
  assert.equal((await mandate(["--private-scopes", "notes,plans"])).code, 0);
  const m = (await (await openLog(f.aspHome, {})).log.chain(contract)).find((x) => x.record.type === "asp.mandate/v0.2")!;
  assert.deepEqual((m.record.body as { learning: { private_scopes?: string[] } }).learning.private_scopes, ["notes", "plans"]);
});
