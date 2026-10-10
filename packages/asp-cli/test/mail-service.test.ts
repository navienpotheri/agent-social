import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
async function asp(f: Fixture, args: string[], env: Record<string, string>) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const until = async (what: string, fn: () => boolean, ms = 12_000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 100)); } };
const ALICE = "did:web:example.com:users:alice", CODER = "did:web:example.com:agents:alice-coder", BANK = "did:web:example.com:users:bank";
const WHSEC = "whsec_" + Buffer.from("webhook-secret-for-tests").toString("base64");
const svix = (body: string, id = "msg_1", ts = Math.floor(Date.now() / 1000)) => ({
  "svix-id": id, "svix-timestamp": String(ts), "svix-signature": "v1," + createHmac("sha256", Buffer.from(WHSEC.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64"),
});

test("service mail: the end-of-Mandate mail goes to the principal's verified address once, with an unsubscribe that works; a dispute notifies the operator; the provider's bounce webhook suppresses an address and a forged one is refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-mail-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([
    { name: "team-a", role: "tenant", tokenSha256: hashToken("tok-a"), signup: { at: "2026-10-11T00:00:00Z", addressHash: "x", termsVersion: "v1", google: { sub: "g-1", email: "a@example.org" } } },
    { name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") },
  ]));
  // A stand-in for Resend.
  const sent: { auth: string; body: any }[] = [];
  const resend = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    sent.push({ auth: String(req.headers.authorization), body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: `re_${sent.length}` }));
  });
  await new Promise<void>((r) => resend.listen(0, "127.0.0.1", r));
  const resendUrl = `http://127.0.0.1:${(resend.address() as { port: number }).port}`;
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0", "--mail-from", "Agent Social <noreply@example.org>", "--mail-operator", "ops@example.org", "--mail-interval", "1", "--mail-resend-url", resendUrl],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, RESEND_API_KEY: "rk_test_key", RESEND_WEBHOOK_SECRET: WHSEC } });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const A = { ASP_LOG_URL: url, ASP_LOG_TOKEN: "tok-a" };
    const a = makeFixture();
    for (const [kind, did, sponsor] of [["human", ALICE, undefined], ["agent", CODER, ALICE], ["human", BANK, undefined]] as const) {
      assert.equal((await asp(a, ["identity", "new", "--kind", kind, "--did", did, ...(sponsor ? ["--sponsor", sponsor, "--purpose", "Fix the flaky test"] : [])], A)).code, 0);
    }
    const job = async (args: string[]) => { const r = await asp(a, args, A); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err}`); return r; };
    const start = async (purpose: string) => {
      const intent = /^intent (\S+)/.exec((await job(["market", "intent", "--by", ALICE, "--purpose", purpose, "--budget", "0", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
      const offer = /^offer (\S+)/.exec((await job(["market", "offer", "--by", CODER, "--intent", intent, "--price", "0", "--plan", "do it", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
      const contract = /^contract (\S+):/.exec((await job(["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
      await job(["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "0", "--escrow-payer", ALICE, "--escrow-amount", "0"]);
      await job(["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER]);
      await job(["market", "deliver", "--contract", contract, "--by", CODER, "--summary", "Done"]);
      return contract;
    };
    const finish = async (contract: string) => {
      await job(["market", "accept", "--contract", contract, "--by", ALICE]);
      await job(["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "accepted", "--escrow-released", "0", "--bond-returned", "0", "--bond-slashed", "0"]);
    };

    // The job ends: one mail to the principal's verified address, through the provider, with the unsubscribe headers.
    await finish(await start("Fix the flaky test"));
    await until("the end-of-job mail", () => sent.some((m) => m.body.to[0] === "a@example.org"));
    const first = sent.find((m) => m.body.to[0] === "a@example.org")!;
    assert.equal(first.auth, "Bearer rk_test_key");
    assert.equal(first.body.from, "Agent Social <noreply@example.org>");
    assert.match(first.body.subject, /Your agent finished: Fix the flaky test/);
    assert.match(first.body.headers["List-Unsubscribe"], /\/mail\/unsubscribe\?e=a%40example\.org&t=/);
    assert.equal(first.body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.match(first.body.text, /To stop these mails: http/);
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(sent.filter((m) => m.body.to[0] === "a@example.org").length, 1, "once, however many passes");

    // The unsubscribe link: a page first (a prefetch changes nothing), the POST does it; a damaged link does not.
    const link = /To stop these mails: (\S+)/.exec(first.body.text)![1];
    assert.match(await (await fetch(link)).text(), /Stop these mails\?/);
    assert.equal((await fetch(link.replace(/t=.*/, "t=forged"), { method: "POST" })).status, 400);
    assert.match(await (await fetch(link, { method: "POST" })).text(), /You are unsubscribed/);
    await finish(await start("A second job"));
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(sent.filter((m) => m.body.to[0] === "a@example.org").length, 1, "no more mail to an unsubscribed address");

    // A dispute opens: the operator is told, once, with no unsubscribe footer.
    const disputed = await start("A job that goes wrong");
    await job(["market", "reject", "--contract", disputed, "--by", ALICE, "--reasons", "not good enough"]);
    await until("the operator's note", () => sent.some((m) => m.body.to[0] === "ops@example.org"));
    const note = sent.find((m) => m.body.to[0] === "ops@example.org")!;
    assert.match(note.body.subject, /A dispute is open: A job that goes wrong/);
    assert.ok(note.body.text.includes(disputed) && note.body.text.includes("asp court docket") && !note.body.headers, "operator notes carry no unsubscribe");
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(sent.filter((m) => m.body.to[0] === "ops@example.org").length, 1);

    // The provider's webhook: a forged call is refused, a signed bounce suppresses the address, a soft bounce does not.
    const hook = async (event: unknown, headers: Record<string, string>) => fetch(`${url}/mail/webhook/resend`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(event) });
    const bounce = { type: "email.bounced", data: { to: ["b@example.org"], bounce: { type: "Permanent" } } };
    assert.equal((await hook(bounce, { "svix-id": "x", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,AAAA" })).status, 401);
    assert.equal((await hook(bounce, svix(JSON.stringify(bounce)))).status, 200);
    const soft = { type: "email.bounced", data: { to: ["c@example.org"], bounce: { type: "Transient" } } };
    assert.equal((await hook(soft, svix(JSON.stringify(soft), "msg_2"))).status, 200);
    const state = JSON.parse(readFileSync(`${tokens}.mail.json`, "utf8"));
    assert.deepEqual(Object.keys(state.suppressed).sort(), ["a@example.org", "b@example.org"]);
    assert.equal(state.suppressed["a@example.org"].reason, "unsubscribed");
    assert.equal(state.suppressed["b@example.org"].reason, "bounce");
    assert.ok(Object.keys(state.sent).some((k) => k.startsWith("final:")) && Object.values(state.skipped).includes("address suppressed"));
  } finally {
    server.kill(); resend.close();
  }
});
