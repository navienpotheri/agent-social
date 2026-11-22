// Register rows ML1 (a governed run's end produces a mailable end record), ML2 (a principal with no address: the mail is held with the reason, and `asp notices` shows it) and ML3 (the hosted service sends the run-end
// mail once for each run, with an unsubscribe and a bounce suppression). A governed run (`asp run`) works under a standing job and signs a final Action report, "<runtime> run, <folder>"; it settles no contract, so the
// end-of-Mandate mail never fired (the live run of 2026-11-22, session 660d3959). Fake keys; the mail provider is a stand-in HTTP server on 127.0.0.1; nothing is sent anywhere. Credits are mock accounting entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, ownPort, type Fixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
async function asp(f: Fixture, args: string[], env: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const until = async (what: string, fn: () => boolean, ms = 15_000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 100)); } };
const ALICE = "did:web:example.com:users:alice", CODER = "did:web:example.com:agents:alice-coder", BANK = "did:web:example.com:users:bank";
const METRICS = JSON.stringify({ requests: 12, tool_calls: 9, tokens_in: 120000, tokens_out: 4000, seconds: 95, models: [{ name: "claude-sonnet-5-5", provider: "anthropic" }] });

/** A standing job as `asp run` leaves one: a contract with a bond and a Mandate, Running, never settled. */
async function standingJob(f: Fixture, env: Record<string, string>, purpose: string): Promise<string> {
  const ok = async (args: string[]) => { const r = await asp(f, args, env); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err}`); return r; };
  const intent = /^intent (\S+)/.exec((await ok(["market", "intent", "--by", ALICE, "--purpose", purpose, "--budget", "0", "--deadline", "2026-12-01T00:00:00Z"])).out)![1]!;
  const offer = /^offer (\S+)/.exec((await ok(["market", "offer", "--by", CODER, "--intent", intent, "--price", "0", "--plan", "do it", "--eta", "2026-11-01T00:00:00Z"])).out)![1]!;
  const contract = /^contract (\S+):/.exec((await ok(["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1]!;
  await ok(["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "0", "--escrow-payer", ALICE, "--escrow-amount", "0"]);
  await ok(["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read", "--scopes", "shell.exec", "--spend-cap", "0"]);
  return contract;
}
/** What `asp run` signs when the runtime exits: a final Action report with the refusals the gateway made and the metrics it counted. */
async function runEnds(f: Fixture, env: Record<string, string>, contract: string, killed = false) {
  const r = await asp(f, ["market", "action", "--contract", contract, "--by", CODER, "--scopes-used", "repo.read", "--assurance", "gateway_enforced", "--blocked", "shell.network=1", "--blocked-targets", "shell.network=host:example.net",
    "--metrics", METRICS, "--summary", `claude-code run, /home/test/.asp/runs/2026-11-22T10-00Z${killed ? ", killed mid-run" : ""}`], env);
  assert.equal(r.code, 0, r.err);
  return /^action (\S+)/.exec(r.out)![1]!;
}
async function people(f: Fixture, env: Record<string, string>) {
  for (const [kind, did, sponsor] of [["human", ALICE, undefined], ["agent", CODER, ALICE], ["human", BANK, undefined]] as const) {
    assert.equal((await asp(f, ["identity", "new", "--kind", kind, "--did", did, ...(sponsor ? ["--sponsor", sponsor, "--purpose", "Fix the flaky test"] : [])], env)).code, 0);
  }
}

test("ML1 and ML2, local: a governed run's end is listed by `asp mail pending` and queued as one mail that says what was asked, what was refused (the shell.network refusal), the cost estimate and how it ended; with no address it is held with the reason and `asp notices` shows it; once an address is set it is queued, once", async () => {
  const f = makeFixture();
  await people(f, {});
  const contract = await standingJob(f, {}, "Fix the flaky test");
  // Before the run ends there is nothing to mail.
  assert.match((await asp(f, ["mail", "pending"])).out, /0 ended Mandate\(s\) and 0 alert\(s\) not mailed yet/);
  const action = await runEnds(f, {}, contract);
  const pending = (await asp(f, ["mail", "pending"])).out;
  assert.match(pending, new RegExp(`run-end\\s+Fix the flaky test  \\(${action.slice(0, 19)}, principal ${ALICE}, NO ADDRESS\\)`), pending);
  assert.match(pending, /0 ended Mandate\(s\), 1 run end\(s\) and 0 alert\(s\) not mailed yet/);

  // ML2: no address, so the mail is held, with the reason, and the person is told by `asp notices`.
  const held = await asp(f, ["mail", "watch", "--once"]);
  assert.match(held.err, /held\s+run-end for .*no address for did:web:example\.com:users:alice/);
  assert.match(held.out, /0 mail\(s\) queued/);
  const notices = await asp(f, ["notices", "--did", CODER]);
  assert.match(notices.out, /mail held: run-end: no address for did:web:example\.com:users:alice: set one with asp mail address set/, notices.out);
  assert.equal(existsSync(join(f.aspHome, "outbox")), false, "nothing was written for a mail with no address");

  // An address is set: the held mail is queued, with the run's refusals and an estimate of its cost.
  assert.equal((await asp(f, ["mail", "address", "set", ALICE, "alice@example.org"])).code, 0);
  const q = await asp(f, ["mail", "watch", "--once"]);
  assert.match(q.out, /queued .*run-end-.*\.eml to alice@example\.org: Your agent's run ended: Fix the flaky test/, q.out);
  const txt = readFileSync(join(f.aspHome, "outbox", readdirSync(join(f.aspHome, "outbox")).find((n) => n.endsWith(".txt"))!), "utf8");
  assert.match(txt, /WHAT IT WAS ASKED\n {2}Fix the flaky test/);
  assert.match(txt, /WHAT WAS REFUSED\n {2}1 attempt\(s\) were refused before they ran:\n {2}shell\.network x1 \(host:example\.net\)/, "the shell.network refusal is in the mail");
  assert.match(txt, /WHAT IT COST \(AN ESTIMATE\)\n {2}About \$\d+\.\d\d for 124,000 tokens of claude-sonnet-5-5, from a price table/);
  assert.match(txt, /not your provider's bill/);
  assert.match(txt, /HOW IT ENDED\n {2}The runtime exited and the run's final report was signed\./);
  assert.match(txt, /How strongly it was held to the Mandate: gateway enforced/);
  assert.match(txt, /mock accounting entries, not money/);
  assert.match(txt, /A mail may not arrive/);
  assert.doesNotMatch(txt, /study|aligned|guarantee/i, "no study wording and no promise");
  assert.doesNotMatch((await asp(f, ["notices", "--did", CODER])).out, /mail held/, "the held note is cleared once the mail is queued");
  // Once for each run: the same run is not queued again, a second run is.
  assert.match((await asp(f, ["mail", "watch", "--once"])).out, /0 mail\(s\) queued/);
  await runEnds(f, {}, contract, true);
  const second = await asp(f, ["mail", "watch", "--once"]);
  assert.match(second.out, /Your agent's run was stopped: Fix the flaky test/, "a run killed for a violation is told as such");
  assert.equal(readdirSync(join(f.aspHome, "outbox")).filter((n) => n.endsWith(".eml")).length, 2);
});

test("ML1: an Action that is not the end of a run (a report with another summary) is not mailed, and the old end-of-Mandate mail still goes for a settled job", async () => {
  const f = makeFixture();
  await people(f, {});
  const contract = await standingJob(f, {}, "A job with a mid-run report");
  assert.equal((await asp(f, ["market", "action", "--contract", contract, "--by", CODER, "--scopes-used", "repo.read", "--summary", "interim report, nothing ended"])).code, 0);
  assert.match((await asp(f, ["mail", "pending"])).out, /0 ended Mandate\(s\) and 0 alert\(s\)/);
});

// ---------- ML3: the hosted service ----------
const WHSEC = "whsec_" + Buffer.from("webhook-secret-for-tests").toString("base64");
const svix = (body: string, id = "msg_1", ts = Math.floor(Date.now() / 1000)) => ({
  "svix-id": id, "svix-timestamp": String(ts), "svix-signature": "v1," + createHmac("sha256", Buffer.from(WHSEC.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64"),
});

test("ML3: the hosted service sends one mail for each governed run to the principal's verified address through the provider, with the unsubscribe headers; an unsubscribe and a bounce suppress an address", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-runend-svc-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([
    { name: "team-a", role: "tenant", tokenSha256: hashToken("tok-a"), signup: { at: "2026-10-11T00:00:00Z", addressHash: "x", termsVersion: "v1", google: { sub: "g-1", email: "a@example.org" } } },
    { name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") },
  ]));
  const sent: { auth: string; body: any }[] = [];
  const resend = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    sent.push({ auth: String(req.headers.authorization), body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: `re_${sent.length}` }));
  });
  await new Promise<void>((r) => resend.listen(0, "127.0.0.1", r));
  const resendUrl = `http://127.0.0.1:${(resend.address() as { port: number }).port}`;
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0", "--mail-from", "Agent Social <noreply@example.org>", "--mail-interval", "1", "--mail-resend-url", resendUrl],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, RESEND_API_KEY: "rk_test_key", RESEND_WEBHOOK_SECRET: WHSEC } });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const A = { ASP_LOG_URL: url, ASP_LOG_TOKEN: "tok-a" };
    const f = makeFixture();
    await people(f, A);
    const toA = () => sent.filter((m) => m.body.to[0] === "a@example.org");
    const c1 = await standingJob(f, A, "Fix the flaky test");
    await asp(f, ["market", "action", "--contract", c1, "--by", CODER, "--scopes-used", "repo.read"], A);
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(toA().length, 0, "a report that is not the end of a run sends nothing");
    await runEnds(f, A, c1);
    await until("the run-end mail", () => toA().length >= 1);
    const first = toA()[0]!;
    assert.equal(first.auth, "Bearer rk_test_key");
    assert.equal(first.body.from, "Agent Social <noreply@example.org>");
    assert.match(first.body.subject, /Your agent's run ended: Fix the flaky test/);
    assert.match(first.body.text, /shell\.network x1/);
    assert.match(first.body.text, /not your provider's bill/);
    assert.match(first.body.headers["List-Unsubscribe"], /\/mail\/unsubscribe\?e=a%40example\.org&t=/);
    assert.equal(first.body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.match(first.body.text, /To stop these mails: http/);
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(toA().length, 1, "one mail for the run, however many passes");
    // A second run is a second mail.
    await runEnds(f, A, c1, true);
    await until("the second run's mail", () => toA().length >= 2);
    assert.match(toA()[1]!.body.subject, /Your agent's run was stopped/);

    // The unsubscribe link works (a page first, the POST does it), and the next run's mail is not sent.
    const link = /To stop these mails: (\S+)/.exec(first.body.text)![1]!;
    assert.match(await (await fetch(link)).text(), /Stop these mails\?/);
    assert.match(await (await fetch(link, { method: "POST" })).text(), /You are unsubscribed/);
    await runEnds(f, A, c1);
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(toA().length, 2, "no more mail to an unsubscribed address");

    // A permanent bounce from the provider suppresses an address; a forged webhook does not.
    const hook = (event: unknown, headers: Record<string, string>) => fetch(`${url}/mail/webhook/resend`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(event) });
    const bounce = { type: "email.bounced", data: { to: ["b@example.org"], bounce: { type: "Permanent" } } };
    assert.equal((await hook(bounce, { "svix-id": "x", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,AAAA" })).status, 401);
    assert.equal((await hook(bounce, svix(JSON.stringify(bounce)))).status, 200);
    const state = JSON.parse(readFileSync(`${tokens}.mail.json`, "utf8"));
    assert.equal(state.suppressed["a@example.org"].reason, "unsubscribed");
    assert.equal(state.suppressed["b@example.org"].reason, "bounce");
    assert.equal(Object.keys(state.sent).filter((k) => k.startsWith("run:")).length, 2, "two runs were mailed, once each");
    assert.ok(Object.entries(state.skipped).some(([k, v]) => k.startsWith("run:") && v === "address suppressed"), "the run after the unsubscribe is recorded as skipped, with the reason");
  } finally { server.kill(); resend.close(); }
});

// ---------- ML2: asp join sets the verified address ----------
test("ML2: asp join sets the address the person signed up with (verified by Google) for their identity, so the mail has a destination; with no verified address it says the mail is held and nothing is invented", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-join-mail-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([
    { name: "with-google", role: "tenant", tokenSha256: hashToken("tok-g"), signup: { at: "2026-10-11T00:00:00Z", addressHash: "x", termsVersion: "v1", google: { sub: "g-9", email: "person@example.org" } } },
    { name: "no-google", role: "tenant", tokenSha256: hashToken("tok-n"), signup: { at: "2026-10-11T00:00:00Z", addressHash: "y", termsVersion: "v1" } },
    { name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") },
  ]));
  const port = await ownPort();
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port), "--signup", "--signup-terms-url", `http://127.0.0.1:${port}/terms`, "--signup-difficulty", "8", "--did-domain", `127.0.0.1:${port}`, "--allow-plain-http"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ASP_OPERATOR_DID: `did:web:127.0.0.1%3A${port}:u:operator`, ASP_OWNER_DID: `did:web:127.0.0.1%3A${port}:u:owner` } });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const g = makeFixture();
    const joined = await asp(g, ["join", "--service", url, "--token-env", "TOK", "--yes", "--agent-name", "bot"], { TOK: "tok-g" });
    assert.equal(joined.code, 0, joined.err + joined.out);
    assert.match(joined.out, /mail\s+the end-of-run mail for your agents goes to person@example\.org \(the address you signed up with\)/);
    const book = JSON.parse(readFileSync(join(g.aspHome, "mail-addresses.json"), "utf8")) as Record<string, string>;
    assert.deepEqual(Object.values(book), ["person@example.org"]);
    assert.match(Object.keys(book)[0]!, /:u:with-google$/, "set for the person's own identity, the principal of the agent's jobs");
    const n = makeFixture();
    const bare = await asp(n, ["join", "--service", url, "--token-env", "TOK", "--yes", "--agent-name", "bot"], { TOK: "tok-n" });
    assert.equal(bare.code, 0, bare.err + bare.out);
    assert.match(bare.out, /mail\s+you signed up with no verified address, so the end-of-run mail is held with the reason \(asp notices shows it\)/);
    assert.equal(existsSync(join(n.aspHome, "mail-addresses.json")), false, "no address is invented");
  } finally { server.kill(); }
});

test("ML1: what counts as the end of a run: the gateway's exit report (with the reason it was stopped, when it was), a run with --contract; nothing else", async () => {
  const { runEndOf } = await import("@agent-social/asp-package");
  const act = (summary?: string, extra: Record<string, unknown> = {}) => ({ id: "sha256:" + "a".repeat(64), seq: 1, record: { type: "asp.action/v0.2", issuer: CODER, issued_at: "2026-11-22T10:00:00Z", body: { contract: "sha256:" + "c".repeat(64), scopes_used: [], ...(summary ? { summary } : {}), ...extra } } });
  assert.deepEqual([runEndOf(act("ASP gateway (gateway-enforced, exit): 2 request(s) so far, 900 tokens, 1 blocked"))?.killed, runEndOf(act("ASP gateway (gateway-enforced, exit): 2 request(s) so far, 900 tokens, 1 blocked"))?.runtime], [false, null]);
  const stopped = runEndOf(act("ASP gateway (gateway-enforced, exit): 2 request(s) so far, 900 tokens, 3 blocked; stopped: three blocked attempts in a row"));
  assert.equal(stopped?.killed, true); assert.equal(stopped?.stopped, "three blocked attempts in a row");
  assert.equal(runEndOf(act("codex run, /home/x/.asp/runs/r1"))?.runtime, "codex");
  assert.equal(runEndOf(act("claude-code run, /r, killed mid-run"))?.killed, true);
  assert.equal(runEndOf(act("ASP gateway (gateway-enforced, interval): 1 request(s) so far")), undefined, "an interval report is not an end");
  assert.equal(runEndOf(act()), undefined, "a report with no summary is not an end");
  assert.equal(runEndOf({ ...act("x run, y"), record: { ...act("x run, y").record, type: "asp.delivery/v0.2" } }), undefined, "only an Action");
});

test("ML1: a run is every report from the end of the one before it: a refusal reported in an earlier stretch of the run is in its end mail, and the next run's mail does not repeat it", async () => {
  const f = makeFixture();
  await people(f, {});
  const contract = await standingJob(f, {}, "A standing job with two runs");
  const report = async (summary: string, extra: string[]) => assert.equal((await asp(f, ["market", "action", "--contract", contract, "--by", CODER, "--scopes-used", "repo.read", "--summary", summary, ...extra])).code, 0);
  await report("ASP gateway (gateway-enforced, interval): 1 request(s) so far, 100 tokens, 1 blocked", ["--blocked", "shell.network=1", "--metrics", JSON.stringify({ requests: 1, tokens_in: 100, tokens_out: 10, models: [{ name: "claude-haiku-5-5" }] })]);
  await report("ASP gateway (gateway-enforced, exit): 2 request(s) so far, 300 tokens, 0 blocked", ["--metrics", JSON.stringify({ requests: 1, tokens_in: 100, tokens_out: 90, models: [{ name: "claude-haiku-5-5" }] })]);
  assert.equal((await asp(f, ["mail", "address", "set", ALICE, "alice@example.org"])).code, 0);
  await asp(f, ["mail", "watch", "--once"]);
  const mails = () => readdirSync(join(f.aspHome, "outbox")).filter((n) => n.endsWith(".txt")).sort().map((n) => readFileSync(join(f.aspHome, "outbox", n), "utf8"));
  assert.equal(mails().length, 1);
  assert.match(mails()[0]!, /shell\.network x1/, "the refusal from the interval report is in the run's mail");
  assert.match(mails()[0]!, /300 tokens of claude-haiku-5-5/, "the tokens of the whole run are added");
  await report("ASP gateway (gateway-enforced, interval): 1 request(s) so far, 50 tokens, 2 blocked", ["--blocked", "fs.write=2", "--metrics", JSON.stringify({ requests: 1, tokens_in: 40, tokens_out: 10 })]);
  await report("ASP gateway (gateway-enforced, exit): 1 request(s) so far, 50 tokens, 0 blocked", []);
  await asp(f, ["mail", "watch", "--once"]);
  const all = mails();
  assert.equal(all.length, 2);
  const second = all.find((t) => /fs\.write x2/.test(t))!;
  assert.ok(second && !/shell\.network/.test(second), "the second run's mail has its own refusals and not the first run's");
});
