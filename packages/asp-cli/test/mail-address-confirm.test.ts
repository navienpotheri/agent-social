// Register row ML4 (KO2 of docs/key-only-audit.md): a key-only agent has no sponsor and no verified Google address, so the service had nowhere to send its mail and told it nothing. Now it names an address
// (`asp notices address set`), the service sends a code to it, the agent enters the code (`asp notices address confirm`), and the address is used for mail only from then on. Until then the mail is HELD with the
// reason (and shown by `asp notices`), not dropped: when the address is proved, the held run-end mail goes out, once. Fake keys; the mail provider is a stand-in server on 127.0.0.1; nothing is sent anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
async function asp(f: Fixture, args: string[], env: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n"), all: out.join("\n") + "\n" + err.join("\n") };
}
const until = async (what: string, fn: () => boolean, ms = 20_000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 100)); } };
const ALICE = "did:web:example.com:users:alice", CODER = "did:web:example.com:agents:alice-coder", BANK = "did:web:example.com:users:bank";
const METRICS = JSON.stringify({ requests: 3, tool_calls: 2, tokens_in: 9000, tokens_out: 500, seconds: 12, models: [{ name: "claude-haiku-5-5" }] });

test("KO2/ML4: a key-only tenant's run-end mail is HELD with the reason until it names an address and proves it with the code; then the held mail goes out once; a wrong code, a second tenant, an unsubscribed address and a fourth code are each refused", { timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-addr-confirm-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([
    { name: "keyonly", role: "tenant", tokenSha256: hashToken("tok-k") },
    { name: "other", role: "tenant", tokenSha256: hashToken("tok-o") },
    { name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") },
  ]));
  const sent: { body: any }[] = [];
  const resend = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    sent.push({ body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: `re_${sent.length}` }));
  });
  await new Promise<void>((r) => resend.listen(0, "127.0.0.1", r));
  const resendUrl = `http://127.0.0.1:${(resend.address() as { port: number }).port}`;
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0", "--mail-from", "Agent Social <noreply@example.org>", "--mail-interval", "1", "--mail-resend-url", resendUrl],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, RESEND_API_KEY: "rk_test_key" } });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const K = { ASP_LOG_URL: url, ASP_LOG_TOKEN: "tok-k" };
    const f = makeFixture();
    const ok = async (args: string[], env = K) => { const r = await asp(f, args, env); assert.equal(r.code, 0, `${args.join(" ")}: ${r.all}`); return r; };
    for (const [kind, did, sponsor] of [["human", ALICE, undefined], ["agent", CODER, ALICE], ["human", BANK, undefined]] as const) await ok(["identity", "new", "--kind", kind, "--did", did, ...(sponsor ? ["--sponsor", sponsor, "--purpose", "Fix the flaky test"] : [])]);
    const intent = /^intent (\S+)/.exec((await ok(["market", "intent", "--by", ALICE, "--purpose", "Fix the flaky test", "--budget", "0", "--deadline", "2026-12-01T00:00:00Z"])).out)![1]!;
    const offer = /^offer (\S+)/.exec((await ok(["market", "offer", "--by", CODER, "--intent", intent, "--price", "0", "--plan", "do it", "--eta", "2026-11-01T00:00:00Z"])).out)![1]!;
    const contract = /^contract (\S+):/.exec((await ok(["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1]!;
    await ok(["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "0", "--escrow-payer", ALICE, "--escrow-amount", "0"]);
    await ok(["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read", "--spend-cap", "0"]);
    await ok(["market", "action", "--contract", contract, "--by", CODER, "--scopes-used", "repo.read", "--blocked", "shell.network=1", "--metrics", METRICS, "--summary", "ASP gateway (gateway-enforced, exit): 3 request(s) so far, 9500 tokens, 1 blocked"]);

    // No address: nothing is sent, the mail is held, and the service says so (and why) when the tenant asks.
    let held: any[] = [];
    for (let i = 0; i < 100 && !held.length; i++) { held = ((await (await fetch(`${url}/mail/address`, { headers: { authorization: "Bearer tok-k" } })).json()) as { held: any[] }).held; if (!held.length) await new Promise((r) => setTimeout(r, 200)); }
    assert.equal(held.length, 1, "one mail is held");
    assert.match(held[0].why, /^no address: principal did:web:example\.com:users:alice$/);
    assert.equal(sent.length, 0, "nothing was sent: there is no address");
    const before = await ok(["notices", "--did", CODER]);
    assert.match(before.out, /mail held: .*no address: principal did:web:example\.com:users:alice \(asp notices address set <address>\)/, before.out);
    assert.match((await ok(["notices", "address"])).out, /mail address: none\. Mail about your agents is held, not lost/);

    // Naming an address sends a code and nothing else; a bad address, a second tenant and an admin are refused.
    assert.equal((await asp(f, ["notices", "address", "set", "not-an-address"], K)).code, 1);
    assert.equal((await fetch(`${url}/mail/address`, { method: "POST", headers: { authorization: "Bearer tok-ops", "content-type": "application/json" }, body: JSON.stringify({ address: "x@example.org" }) })).status, 401, "the operator's token is not a tenant");
    assert.equal((await fetch(`${url}/mail/address`, { method: "POST", body: "{}" })).status, 401, "no token");
    const named = await ok(["notices", "address", "set", "keyonly@example.org"]);
    assert.match(named.out, /a code was sent to keyonly@example\.org .*Until then no mail goes to that address/);
    await until("the code mail", () => sent.length === 1);
    assert.equal(sent[0]!.body.to[0], "keyonly@example.org");
    assert.match(sent[0]!.body.subject, /Your code to confirm this address/);
    const code = /The code is (\d{6})\./.exec(sent[0]!.body.text)![1]!;
    assert.ok(!sent[0]!.body.headers, "a code mail is a transaction: no mail list headers");
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(sent.length, 1, "the held run-end mail is NOT sent to an address that has not proved itself");

    // A wrong code does not confirm, and counts; another tenant cannot use this tenant's code.
    const wrong = await asp(f, ["notices", "address", "confirm", code === "000000" ? "111111" : "000000"], K);
    assert.equal(wrong.code, 1); assert.match(wrong.err, /that is not the code \(4 tries left\)/);
    const stranger = await fetch(`${url}/mail/address/confirm`, { method: "POST", headers: { authorization: "Bearer tok-o", "content-type": "application/json" }, body: JSON.stringify({ code }) });
    assert.equal(stranger.status, 404, "another tenant has no code waiting");
    assert.equal(sent.length, 1);

    // The right code confirms: the held mail goes out, once, to the confirmed address, with the unsubscribe headers.
    const good = await ok(["notices", "address", "confirm", code]);
    assert.match(good.out, /confirmed: mail about your agents, held or new, now goes to keyonly@example\.org/);
    await until("the held run-end mail", () => sent.some((m) => /Your agent's run ended/.test(m.body.subject)));
    const mail = sent.find((m) => /Your agent's run ended/.test(m.body.subject))!;
    assert.equal(mail.body.to[0], "keyonly@example.org");
    assert.match(mail.body.text, /shell\.network x1/);
    assert.match(mail.body.headers["List-Unsubscribe"], /keyonly%40example\.org/);
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(sent.filter((m) => /Your agent's run ended/.test(m.body.subject)).length, 1, "once");
    assert.match((await ok(["notices", "address"])).out, /mail address: keyonly@example\.org \(confirmed .*\)\n  mail held for want of an address: 0/);
    const state = JSON.parse(readFileSync(`${tokens}.mail.json`, "utf8"));
    assert.ok(!JSON.stringify(state).includes(code), "the code is kept only as a keyed hash");
    assert.equal(state.held && Object.keys(state.held).length, 0, "nothing is held any more");

    // An address that unsubscribed gets no code; a tenant gets three codes a day and the fourth is refused.
    await fetch(await (async () => { const u = /To stop these mails: (\S+)/.exec(mail.body.text)![1]!; return u; })(), { method: "POST" });
    const refused = await asp(f, ["notices", "address", "set", "keyonly@example.org"], K);
    assert.equal(refused.code, 1); assert.match(refused.err, /asked not to be mailed by this service/);
    for (const a of ["b1@example.org", "b2@example.org"]) assert.equal((await asp(f, ["notices", "address", "set", a], K)).code, 0);
    const fourth = await asp(f, ["notices", "address", "set", "b3@example.org"], K);
    assert.equal(fourth.code, 1); assert.match(fourth.err, /three codes have been sent today/);
  } finally { server.kill(); resend.close(); }
});
