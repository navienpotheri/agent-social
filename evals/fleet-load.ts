// The fleet load test (DK1362): how fast can one enterprise tenant write to a service on the local-file backend, through the batched append route, and what does a million writes cost in time and in bytes?
//   node evals/fleet-load.ts [--agents 10000] [--sample 6000] [--out docs/fleet-load-test.md]
// It starts a service on a new log, makes `sample` agent passports signed by a sponsor (a sample of the fleet's 10,000), sends them in batches of 200 as the enterprise plan allows, and measures:
//   - writes a second, end to end, over HTTP, and the time for a batch; and the bytes the log takes for a record;
//   - from those, what a fleet of `agents` agents acting at two rates (one act an hour, one act a minute) needs: writes a second, the share of one process it uses, and bytes a month.
// It does not measure a hosted Postgres service or price anything: the money cost needs the operator's price for a machine hour and a gigabyte-month (docs/enterprise-fleets.md says how to compute it). Fake keys.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { b64urlEncode, createRecord, didKeyFromPublicKey, publicKeyFromSeed, randomSeed, signerFromSeed } from "@agent-social/asp-core";
import { hashToken } from "@agent-social/asp-log";
import { RemoteLog } from "@agent-social/asp-package";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const agents = Number(arg("agents", "10000")), sample = Number(arg("sample", "6000")), outFile = arg("out", "");
const cli = fileURLToPath(new URL("../packages/asp-cli/src/cli.ts", import.meta.url));
const dirSize = (d: string): number => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? dirSize(join(d, e.name)) : statSync(join(d, e.name)).size), 0);

const dir = mkdtempSync(join(tmpdir(), "asp-fleet-load-"));
const tokens = join(dir, "tokens.json");
writeFileSync(tokens, JSON.stringify([{ name: "enterprise", role: "tenant", tokenSha256: hashToken("tok-load"), plan: "enterprise" }]));
const logDir = join(dir, "log");
const server = spawn(process.execPath, [cli, "serve", "--db", `local:${logDir}`, "--tokens", tokens, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
const url = await new Promise<string>((resolveUrl, reject) => {
  let buf = "";
  server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolveUrl(m[1]); });
  server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
  setTimeout(() => reject(new Error("no start line")), 30_000);
});
try {
  const remote = new RemoteLog(url, "tok-load");
  const sponsorSeed = randomSeed(), sponsor = didKeyFromPublicKey(publicKeyFromSeed(sponsorSeed)), sponsorSigner = signerFromSeed(`${sponsor}#key-1`, sponsorSeed);
  const stamp = "2026-11-21T00:00:00Z";
  await remote.append(createRecord({ type: "passport", issuer: sponsor, subject: sponsor, prev: null, issued_at: stamp, body: { did: sponsor, kind: "human", keys: [{ id: `${sponsor}#key-1`, type: "Ed25519", public_key: b64urlEncode(publicKeyFromSeed(sponsorSeed)) }] } } as never, sponsorSigner));
  // a declared fleet, so the sponsor's own limit on new agents a day (10) does not apply: a fleet is bounded by its cap
  const fleet = `did:web:load.example:fleets:load`;
  await remote.append(createRecord({ type: "fleet", issuer: sponsor, subject: fleet, prev: null, issued_at: stamp, body: { did: fleet, org: sponsor, name: "load", purpose: "load test", max_members: Math.max(sample, 1) } } as never, sponsorSigner));
  const before = dirSize(logDir);
  // build the sample first, so signing is not in the timing of the service
  const records = Array.from({ length: sample }, () => {
    const seed = randomSeed(), did = didKeyFromPublicKey(publicKeyFromSeed(seed));
    return createRecord({ type: "passport", issuer: sponsor, subject: did, prev: null, issued_at: stamp, body: { did, kind: "agent", keys: [{ id: `${did}#key-1`, type: "Ed25519", public_key: b64urlEncode(publicKeyFromSeed(seed)) }], sponsor, mentor: sponsor, tier: 1, shape: { memory: "files + experience index", keeps_learning: true, modalities: ["text", "code"] }, purpose: "load test agent", fleet } } as never, sponsorSigner);
  });
  const batch = 200, times: number[] = [];
  const t0 = Date.now();
  let done = 0;
  for (let i = 0; i < records.length; i += batch) {
    const t = Date.now();
    let r;
    try { r = await remote.appendBatch(records.slice(i, i + batch) as never); } catch (e) { console.log(`a batch failed after ${done} records: ${(e as Error).message.slice(0, 160)}`); break; }
    times.push(Date.now() - t);
    if (times.length % 5 === 0) console.log(`  ${done + r.appended} records, last batch ${times[times.length - 1]} ms`);
    done += r.appended;
    if (r.stoppedAt !== undefined) { console.log(`stopped at ${done}: ${JSON.stringify(r.results[r.stoppedAt]).slice(0, 200)}`); break; }
  }
  const secs = (Date.now() - t0) / 1000;
  const bytes = dirSize(logDir) - before;
  const perSecond = done / secs, bytesPerRecord = bytes / Math.max(1, done);
  times.sort((a, b) => a - b);
  const p = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
  const rows = [{ label: "one act an hour", perAgentPerSecond: 1 / 3600 }, { label: "one act a minute", perAgentPerSecond: 1 / 60 }].map((r) => {
    const need = agents * r.perAgentPerSecond;
    return { ...r, need, share: need / perSecond, bytesMonth: need * 86400 * 30 * bytesPerRecord, writesMonth: need * 86400 * 30 };
  });
  const md = [
    `# Fleet load test (DK1362)`,
    ``,
    `Run ${new Date().toISOString().slice(0, 10)} by \`node evals/fleet-load.ts --agents ${agents} --sample ${sample}\`, one enterprise-plan tenant, the batched append route, a service on the local-file backend on one machine (${process.platform}, node ${process.version}). Fake keys. Not a hosted Postgres service, and nothing here is priced.`,
    ``,
    `| Measured | Value |`,
    `|---|---|`,
    `| Records written | ${done} agent passports (a sample of the ${agents} agents) in batches of ${batch} |`,
    `| Writes a second, end to end over HTTP | ${perSecond.toFixed(1)} |`,
    `| Time for a batch of ${batch}, median / 95th percentile | ${p(0.5)} ms / ${p(0.95)} ms |`,
    `| Bytes the log takes for a record | ${Math.round(bytesPerRecord)} |`,
    ``,
    `| A fleet of ${agents} agents acting at | Writes a second needed | Share of what this one service wrote | Writes a month | Bytes a month |`,
    `|---|---|---|---|---|`,
    ...rows.map((r) => `| ${r.label} | ${r.need.toFixed(1)} | ${(r.share * 100).toFixed(0)}% | ${Math.round(r.writesMonth).toLocaleString("en")} | ${(r.bytesMonth / 1e9).toFixed(1)} GB |`),
    ``,
    `A million writes took ${(1e6 / perSecond / 3600).toFixed(2)} hours of this service and ${(bytesPerRecord * 1e6 / 1e9).toFixed(2)} GB of log. The money is those two figures times the price of a machine hour and of a gigabyte-month, which the operator sets.`,
  ].join("\n") + "\n";
  console.log(md);
  if (outFile) { mkdirSync(resolve(outFile, ".."), { recursive: true }); writeFileSync(resolve(outFile), md); }
} finally { server.kill(); }
