// Row JO3 (command-line side; the field is spec-delta S1569): `asp market contract` writes the job-data term explicitly in every new contract, with the poster's choices, says in words what it covers, and refuses a
// combination the log would refuse. Fake keys only.
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

async function setup() {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Work"]);
  await ok(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Data term", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "go", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  return { f, intent, offer };
}
const contractArgs = (intent: string, offer: string, extra: string[] = []) => ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer, ...extra];
const dataHandlingOf = async (f: Fixture, id: string) => ((await (await openLog(f.aspHome, {})).log.get(id))!.record.body as { data_handling?: unknown }).data_handling;

test("a new contract carries the job-data term with its defaults, and says what it covers", async () => {
  const { f, intent, offer } = await setup();
  const r = await ok(f, contractArgs(intent, offer));
  const id = /^contract (\S+):/.exec(r.out)![1];
  assert.deepEqual(await dataHandlingOf(f, id), { term: "asp.job-data/v1", commons_sharing: false, retention: "delete_at_settlement", personal_data: "none" });
  assert.match(r.err, /this job's data is shared for the job only/);
  assert.match(r.err, /deletes its copies when the job settles/);
  assert.match(r.err, /does not place it in the commons/);
});

test("the poster's choices are written, and an invalid combination is refused before the log sees it", async () => {
  const { f, intent, offer } = await setup();
  const bad = await asp(f, contractArgs(intent, offer, ["--retain-days", "400"]));
  assert.equal(bad.code, 2);
  assert.match(bad.err, /data_handling_retention_invalid/);
  assert.equal((await asp(f, contractArgs(intent, offer, ["--personal-data", "maybe"]))).code, 2);
  const r = await ok(f, contractArgs(intent, offer, ["--commons-sharing", "--retain-days", "30", "--personal-data", "included"]));
  const id = /^contract (\S+):/.exec(r.out)![1];
  assert.deepEqual(await dataHandlingOf(f, id), { term: "asp.job-data/v1", commons_sharing: true, retention: "retain_days", retain_days: 30, personal_data: "included" });
  assert.match(r.err, /within 30 days after/);
  assert.match(r.err, /may place it in the commons/);
  assert.match(r.err, /includes personal data of other people/);
});
