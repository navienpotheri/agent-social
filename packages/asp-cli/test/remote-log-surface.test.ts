// The owner's live run of 2026-11-23: `asp charter publish-all` over the hosted service failed with "log.charterOf is not available": the CLI called a method of the log that the service does not list for a client (LOG_METHODS) and
// RemoteLog does not derive. The same fault was found by a scripted audit in 21 more methods used by operator commands (charter index and check, the Bank, the Treasury statement, the registry, abuse, insurance). This test is the
// regression: every method of the log the CLI calls through `log.<method>(` must be callable over the service (listed in LOG_METHODS) or derived by RemoteLog, apart from the methods that write, which a client reaches only
// through append, importRecords and mint. And a stand-in service proves RemoteLog.charterOf answers like the local log, and publish-all works over the remote log end to end.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RemoteLog } from "@agent-social/asp-package";
import { LOG_METHODS } from "../../asp-log/src/server.ts";
import { main, type Io } from "../src/cli.ts";
import { ownPort } from "./fixture.ts";

const cliSrc = fileURLToPath(new URL("../src/", import.meta.url));
const logTs = fileURLToPath(new URL("../../asp-log/src/log.ts", import.meta.url));
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(f) ? [p] : []; });

/** Methods of the log that change something: a client never calls them through `log.`; it appends, imports or mints. */
const WRITERS = new Set(["append", "importRecords", "mint"]);
/** Methods RemoteLog answers itself, from reads the service lists. */
const DERIVED = new Set(["charterOf"]);

test("every method of the log that the CLI calls is callable over the service or derived by RemoteLog (the class of fault of 'log.charterOf is not available')", () => {
  const logSrc = readFileSync(logTs, "utf8");
  const methods = new Set([...logSrc.matchAll(/^  (?:async )?([a-zA-Z]\w*)\(/gm)].map((m) => m[1]!));
  const used = new Map<string, Set<string>>();
  for (const f of walk(cliSrc)) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(/\blog\.(\w+)\(/g)) if (methods.has(m[1]!) && !WRITERS.has(m[1]!)) (used.get(m[1]!) ?? used.set(m[1]!, new Set()).get(m[1]!)!).add(f.slice(cliSrc.length));
  }
  assert.ok(used.size > 80, `${used.size} log methods found in the CLI`);
  const missing = [...used].filter(([k]) => !LOG_METHODS.has(k) && !DERIVED.has(k)).map(([k, v]) => `${k} (${[...v].join(", ")})`);
  assert.deepEqual(missing, [], `the CLI calls these methods of the log, which a service does not list for a client: ${missing.join("; ")}. Add a read-only method to LOG_METHODS (packages/asp-log/src/server.ts) or derive it in RemoteLog.`);
  for (const d of DERIVED) assert.equal(typeof (RemoteLog.prototype as unknown as Record<string, unknown>)[d], "function", `${d} is derived by RemoteLog`);
});

test("RemoteLog.charterOf answers like the local log from the records the service lists: versions oldest first with their record and time, and the version in force at a time (honouring `at`)", async () => {
  const rec = (v: number, from: string, id: string) => ({ id, type: "asp.institution_charter/v0.2", issuer: "did:op", issued_at: `2026-11-0${v}T00:00:00Z`, body: { institution: "did:web:asp.local:forum", version: v, kind: "sovereign", status: "active", text_sha256: `sha256:${v}`, effective_from: from, officers: ["did:op"], funding: "none" } });
  const records = [rec(2, "2026-11-20T00:00:00Z", "r2"), rec(1, "2026-11-01T00:00:00Z", "r1"), { ...rec(1, "2026-11-01T00:00:00Z", "other"), body: { ...rec(1, "x", "x").body, institution: "did:web:asp.local:treasury" } }];
  const calls: string[] = [];
  const s = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => { const b = JSON.parse(Buffer.concat(chunks).toString("utf8")); calls.push(`${b.target}.${b.method}`); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, result: b.method === "recordsOfTypes" ? records : [] })); });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  const remote = new RemoteLog(`http://127.0.0.1:${(s.address() as { port: number }).port}`, "tok");
  const now = await (remote.log as unknown as { charterOf(i: string, at?: string): Promise<{ inForce: { version: number; record: string; at: string } | null; versions: { version: number; record: string }[] }> }).charterOf("did:web:asp.local:forum");
  assert.deepEqual(now.versions.map((v) => [v.version, v.record]), [[1, "r1"], [2, "r2"]], "this institution's versions only, oldest first");
  assert.equal(now.inForce!.version, 2, "version 2 is in force now");
  assert.equal(now.inForce!.at, "2026-11-02T00:00:00Z");
  const earlier = await remote.charterOf("did:web:asp.local:forum", "2026-11-10T00:00:00Z");
  assert.equal(earlier.inForce!.version, 1, "at a time before version 2 took effect, version 1 is in force");
  assert.equal((await remote.charterOf("did:web:asp.local:forum", "2026-10-01T00:00:00Z")).inForce, null, "before the first version: none in force");
  assert.deepEqual((await remote.charterOf("did:web:asp.local:market")).versions, [], "an institution with no charter has no versions");
  assert.ok(calls.every((c) => c === "log.recordsOfTypes"), `only the listed read was used: ${calls.join()}`);
});

test("asp charter publish-all works over the remote log: it skips an institution that has a charter, publishes the ones that have none, each record signed by the operator and co-signed by the owner", { timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-remote-charter-"));
  const tokens = join(dir, "tokens.json");
  const opHome = join(dir, "operator-home");
  const port = await ownPort();
  const url = `http://127.0.0.1:${port}`;
  const OP = `did:web:127.0.0.1%3A${port}:u:operator`, OW = `did:web:127.0.0.1%3A${port}:u:owner`;
  const tokOut: string[] = [];
  await main(["serve", "token", "--tokens", tokens, "--tenant", "ops", "--role", "admin"], { out: (l) => tokOut.push(l), err: () => undefined, env: { ASP_HOME: opHome }, cwd: dir } as Io);
  const tok = tokOut.map((l) => l.trim()).find((l) => /^[A-Za-z0-9_-]{30,}$/.test(l))!;
  const start = (env: Record<string, string>) => new Promise<ReturnType<typeof spawn>>((resolve, reject) => {
    const c = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "db")}`, "--tokens", tokens, "--port", String(port), "--did-domain", `127.0.0.1:${port}`, "--rate-limit", "0", "--write-limit", "0", "--address-limit", "0", "--allow-plain-http"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
    let b = ""; c.stdout!.on("data", (d) => { b += d; if (/listening on/.test(b)) resolve(c); }); c.on("close", () => reject(new Error(`service exited: ${b}`))); setTimeout(() => reject(new Error(`no start: ${b}`)), 30_000);
  });
  let svc = await start({});
  const call = async (args: string[], env: Record<string, string> = {}) => {
    const out: string[] = [], err: string[] = [];
    const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: opHome, ASP_LOG_URL: url, ASP_LOG_TOKEN: tok, ...env }, cwd: dir } as Io);
    return { code, text: out.join("\n") + "\n" + err.join("\n") };
  };
  try {
    for (const d of [OP, OW]) assert.equal((await call(["identity", "new", "--kind", "human", "--did", d, "--no-recovery"])).code, 0);
    svc.kill(); await new Promise((r) => setTimeout(r, 1500));
    svc = await start({ ASP_OPERATOR_DID: OP, ASP_OWNER_DID: OW });
    const E = { ASP_OPERATOR_DID: OP, ASP_OWNER_DID: OW };
    // one institution already has a charter (published by hand), the rest have none
    const docs = fileURLToPath(new URL("../../../docs", import.meta.url));
    const first = await call(["charter", "publish-all", "--by", OP, "--cosign-by", OW, "--docs", docs], E);
    assert.equal(first.code, 0, first.text);
    assert.match(first.text, /\d+ charter record\(s\) published, each with the owner's co-signature/);
    const published = Number(/(\d+) charter record\(s\) published/.exec(first.text)![1]);
    assert.ok(published >= 12, `${published} charters published`);
    const again = await call(["charter", "publish-all", "--by", OP, "--cosign-by", OW, "--docs", docs], E);
    assert.equal(again.code, 0, again.text);
    assert.match(again.text, /0 charter record\(s\) published/);
    assert.match(again.text, /already has a charter, skipped/);
    // each record is signed by the operator and co-signed by the owner, as the service accepted it
    const remote = new RemoteLog(url, tok);
    const recs = (await (remote.log as unknown as { recordsOfTypes(t: string[]): Promise<{ issuer: string; cosignatures?: { signer: string }[]; signatures?: unknown[] }[]> }).recordsOfTypes(["institution_charter"]));
    assert.equal(recs.length, published);
    assert.ok(recs.every((r) => r.issuer === OP), "issued by the operator");
    assert.ok(recs.every((r) => JSON.stringify(r).includes(OW)), "co-signed by the owner");
    const show = await call(["charter", "show", "--institution", "did:web:asp.local:forum"], E);
    assert.match(show.text, /1 version\(s\); in force: version 1/);
    // a command that listed no method before: the charter index, over the service
    const index = await call(["charter", "index"], E);
    assert.equal(index.code, 0, index.text);
    assert.ok(!/is not available/.test(index.text));
  } finally { svc.kill(); }
});
