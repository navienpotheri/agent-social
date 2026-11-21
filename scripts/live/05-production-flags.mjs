// Live check 05: the production flags (rows O2 and T12; docs/live-check-cli.md). Against a running service it proves, from the outside, what the deployed start line is meant to give:
// Google as the only way to sign up, 600 reads and 120 writes a minute for a tenant, and the limits file kept over a restart. With --local it starts a real service on this machine with exactly the flags of
// docs/deploy/setup-server.sh and runs the same checks (this is what was logged for the rows).
//
//   node scripts/live/05-production-flags.mjs --service https://<domain> --token <a throwaway tenant's token> [--seconds 65] [--unit asp-log] [--yes]
//   node scripts/live/05-production-flags.mjs --local [--seconds 65]
//
// The throwaway tenant: sign up at https://<domain>/join with a test Google account, or on the server `asp serve token --tokens /var/lib/asp/tokens.json --tenant drill-limits` (remove it after).
// The write test sends invalid appends, so nothing is written to the log; the read test sends cheap reads. It takes about two and a half minutes at the default 65 seconds a phase.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { args, session } from "./lib.mjs";

const a = args();
const cli = fileURLToPath(new URL("../../packages/asp-cli/src/cli.ts", import.meta.url));
const seconds = Number(a.seconds ?? 65);
const s = session("production-flags", { yes: !!a.yes });

async function startLocal() {
  const dir = mkdtempSync(join(tmpdir(), "asp-flags-"));
  const tokens = join(dir, "tokens.json");
  const make = (tenant, role) => new Promise((res) => { let out = ""; const c = spawn(process.execPath, [cli, "serve", "token", "--tokens", tokens, "--tenant", tenant, ...(role ? ["--role", role] : [])], { stdio: ["ignore", "pipe", "ignore"] }); c.stdout.on("data", (d) => (out += d)); c.on("close", () => res(out.trim().split("\n").at(-1))); });
  await make("ops", "admin");
  const token = await make("drill");
  // The flags of docs/deploy/setup-server.sh. The Google client is a stand-in: nothing contacts Google until someone signs in.
  const flags = ["--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--host", "127.0.0.1", "--port", "0", "--trust-proxy", "--limits-state", join(dir, "limits-state.json"), "--rate-limit", "600", "--write-limit", "120", "--address-limit", "1200", "--max-in-flight", "16", "--signup", "--signup-terms-url", "https://example.org/terms", "--signup-terms-version", "2026-10", "--signup-daily-cap", "50", "--public-url", "http://127.0.0.1", "--google-client-id", "local-client-id", "--google-redirect-uri", "http://127.0.0.1/auth/callback", "--signup-require-google"];
  const server = spawn(process.execPath, [cli, "serve", ...flags], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GOOGLE_CLIENT_SECRET: "local-client-secret" } });
  const url = await new Promise((resolve, reject) => { let buf = ""; server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); }); server.on("close", () => reject(new Error(`the service exited: ${buf}`))); setTimeout(() => reject(new Error(`no start line: ${buf}`)), 30_000); });
  return { url, token, stop: () => server.kill(), dir, flags: flags.join(" ") };
}

const local = a.local ? await startLocal() : undefined;
const service = (local?.url ?? a.service ?? "").replace(/\/$/, "");
const token = local?.token ?? a.token;
if (!service || !token) { console.error("usage: node scripts/live/05-production-flags.mjs --service https://<domain> --token <throwaway tenant token>   (or --local)"); process.exit(2); }

const rpc = (method, extra = {}) => fetch(`${service}/rpc`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-forwarded-for": a.address ?? "203.0.113.77" }, body: JSON.stringify({ target: "log", method, args: [], ...extra }) });
const badAppend = () => fetch(`${service}/rpc`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-forwarded-for": a.address ?? "203.0.113.77" }, body: JSON.stringify({ target: "handle", method: "append", args: [{ not: "a record" }] }) });

/** Sends `fire()` about 20 times a second for `secs` seconds and counts the answers. */
async function hammer(fire, secs) {
  let ok = 0, limited = 0, other = 0;
  const t0 = Date.now();
  const tick = async () => { try { const r = await fire(); if (r.status === 429) limited++; else if (r.status === 200) ok++; else other++; } catch { other++; } };
  const inflight = new Set();
  while (Date.now() - t0 < secs * 1000) {
    for (let k = 0; k < 4; k++) { const p = tick().finally(() => inflight.delete(p)); inflight.add(p); }
    await new Promise((r) => setTimeout(r, 200));
  }
  await Promise.all(inflight);
  return { ok, limited, other, sent: ok + limited + other };
}

try {
  s.title(`Production flags against ${service}${local ? " (a local service started with the flags of docs/deploy/setup-server.sh)" : ""}`);
  if (local) s.say(`start line: asp serve ${local.flags.replace(local.dir, "<dir>")}`);
  await s.check("the service answers /health", async () => (await fetch(`${service}/health`)).status === 200);
  const info = await (await fetch(`${service}/signup`)).json().catch(() => ({}));
  s.say(`info: a person signs up with Google only (/join). An agent with only a key may enrol itself: keyOnly is ${info.keyOnly} here (by design for the sponsor-less route, DK540; --no-key-only-signup closes it).`);
  await s.check("the proof-of-work sign-up is refused: POST /signup with no Google account does not make a tenant", async () => {
    const r = await fetch(`${service}/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "should-not-exist" }) });
    return r.status >= 400 ? true : `answered ${r.status}`;
  });
  await s.check("the sign-up page /join answers", async () => (await fetch(`${service}/join`)).status === 200);
  await s.check("an unauthenticated /rpc is refused", async () => (await fetch(`${service}/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status === 401);

  if (a.unit && !local) {
    const r = await s.run("systemctl", ["cat", String(a.unit)]);
    const text = r.out.replace(/\\\r?\n\s*/g, " ");
    for (const f of ["--signup-require-google", "--limits-state", "--rate-limit 600", "--write-limit 120"]) await s.check(`the deployed start line (systemctl cat ${a.unit}) has ${f}`, async () => text.includes(f) || `not found in ${r.code === 0 ? "the unit" : r.err}`);
  } else if (!local) {
    await s.human("Check the deployed start line on the server.", ["Run:  systemctl cat asp-log | tr -d '\\\\' | grep -o -e '--signup-require-google' -e '--limits-state [^ ]*' -e '--rate-limit [0-9]*' -e '--write-limit [0-9]*'", "All four must appear. (Or rerun this script on the server with --unit asp-log.)"]);
  }

  s.say(`\nReads: about 20 a second for ${seconds} seconds. A tenant is allowed 600 a minute, with a burst on top.`);
  const reads = await hammer(() => rpc("head"), seconds);
  // A bucket of 600 a minute holds a burst of a quarter minute on top: the most that gets through in `seconds` is the burst plus the rate.
  const readsExpected = 600 / 4 + (600 / 60) * seconds;
  await s.check(`reads: ${reads.ok} allowed, ${reads.limited} refused with 429 of ${reads.sent}; expected about ${Math.round(readsExpected)} (the burst of 150 and 10 a second)`, async () => reads.limited > 0 && reads.ok >= readsExpected * 0.85 && reads.ok <= readsExpected * 1.15 ? true : `expected the limit to bite and about ${Math.round(readsExpected)} allowed`);
  await new Promise((r) => setTimeout(r, 5000));
  s.say(`\nWrites (invalid appends, so nothing is stored): about 20 a second for ${seconds} seconds. A tenant is allowed 120 a minute.`);
  const writes = await hammer(badAppend, seconds);
  const writesAllowed = writes.ok + writes.other; // an invalid append that was let through answers 200 with an error body or 4xx from the log: it was not rate limited
  const writesExpected = 120 / 4 + (120 / 60) * seconds;
  await s.check(`writes: ${writesAllowed} let through, ${writes.limited} refused with 429 of ${writes.sent}; expected about ${Math.round(writesExpected)} (the burst of 30 and 2 a second)`, async () => writes.limited > 0 && writesAllowed >= writesExpected * 0.8 && writesAllowed <= writesExpected * 1.2 ? true : `expected the limit to bite and about ${Math.round(writesExpected)} let through`);

  if (local) {
    const stateFile = join(local.dir, "limits-state.json");
    await new Promise((r) => setTimeout(r, 2500));
    await s.check("the limits state is kept in files (the buckets and the salted address hashes survive a restart)", async () => existsSync(`${stateFile}.buckets`) && existsSync(`${stateFile}.salt`) && readFileSync(`${stateFile}.buckets`, "utf8").length > 2 ? true : `no limits files at ${stateFile}.buckets / .salt`);
    await s.check("the state holds no raw address (only salted hashes)", async () => !readFileSync(`${stateFile}.buckets`, "utf8").includes("203.0.113.77") ? true : "a raw address is in the file");
  } else {
    await s.human("Check the limits file is there on the server.", ["Run:  ls -l /var/lib/asp/limits-state.json*   (limits-state.json.buckets and .salt exist and their time is recent)"]);
    await s.human("Restart the service and check sign-in lockouts and limits are not reset.", ["Run:  sudo systemctl restart asp-log && sleep 3 && curl -fsS " + service + "/health", "Then run this script again with --seconds 10: the answers still come back 429 for the bucket you just used."]);
  }
} finally {
  local?.stop();
}
process.exit(s.done());
