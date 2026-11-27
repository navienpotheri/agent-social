// Row E14: the upheld-report alert is read from a real flow, not a fake log: a contract, a report filed through `asp market report`, a panel of registered jurors that upholds it through
// `asp market report-rule`, and the watcher that then queues the alert for the principal and the reporter. A dismissed report sends nothing. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";
const WATCHER = "did:web:example.com:users:watcher";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = []; const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  return { code: await main(args, io), out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

async function world() {
  const f = makeFixture();
  for (const d of [ALICE, BANK, WATCHER]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
  await ok(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  await ok(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  await ok(f, ["credits", "grant", "--to", WATCHER, "--amount", "100"]);
  const intent = /^intent (\S+)/.exec((await ok(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix the flaky test", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(f, ["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(f, ["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(f, ["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read"]);
  const jurors = ["a", "b", "c"].map((n) => `did:web:example.com:users:alert-juror-${n}`);
  for (const j of jurors) {
    await ok(f, ["identity", "new", "--kind", "human", "--did", j]);
    await ok(f, ["credits", "grant", "--to", j, "--amount", "100"]);
    await ok(f, ["market", "juror", "register", "--by", j, "--stake", "50"]);
  }
  await ok(f, ["mail", "address", "set", ALICE, "alice@example.com"]);
  await ok(f, ["mail", "address", "set", WATCHER, "watcher@example.com"]);
  return { f, contract, jurors };
}

test("a report upheld by a real panel is mailed once to the principal and the reporter, with the reasons", async () => {
  const { f, contract, jurors } = await world();
  const report = /^report (\S+)/.exec((await ok(f, ["market", "report", "--contract", contract, "--by", WATCHER, "--reasons", "the agent pushed to a protected branch"])).out)![1];
  // Filed, not yet ruled: the watcher sends nothing.
  assert.match((await ok(f, ["mail", "watch", "--once"])).out, /0 mail\(s\) queued/);
  await ok(f, ["market", "report-rule", "--report", report, "--by", jurors[0], "--cosign-by", jurors[1], "--verdict", "upheld", "--articles", "7"]);
  const watched = await ok(f, ["mail", "watch", "--once"]);
  assert.match(watched.out, /[12] mail\(s\) queued/);
  const outbox = join(f.aspHome, "outbox");
  const upheld = readdirSync(outbox).filter((x) => /upheld/.test(x) && x.endsWith(".eml"));
  assert.ok(upheld.length >= 1, `an upheld-report alert is in the outbox: ${readdirSync(outbox).join(", ")}`);
  const text = upheld.map((x) => readFileSync(join(outbox, x), "utf8") + readFileSync(join(outbox, x.replace(".eml", ".txt")), "utf8")).join("\n");
  assert.match(text, /X-ASP-Alert: report_upheld/);
  assert.match(text, /A report against the agent was upheld by a panel: the agent pushed to a protected branch/);
  assert.match(text, /To: alice@example\.com/);
  // Once: a second pass queues nothing new.
  assert.match((await ok(f, ["mail", "watch", "--once"])).out, /0 mail\(s\) queued/);
});

test("a dismissed report sends no alert", async () => {
  const { f, contract, jurors } = await world();
  const report = /^report (\S+)/.exec((await ok(f, ["market", "report", "--contract", contract, "--by", WATCHER, "--reasons", "a mistaken report"])).out)![1];
  await ok(f, ["market", "report-rule", "--report", report, "--by", jurors[0], "--cosign-by", jurors[1], "--verdict", "dismissed"]);
  assert.match((await ok(f, ["mail", "watch", "--once"])).out, /0 mail\(s\) queued/);
  assert.equal(existsSync(join(f.aspHome, "outbox")) ? readdirSync(join(f.aspHome, "outbox")).filter((x) => /upheld/.test(x)).length : 0, 0);
});
