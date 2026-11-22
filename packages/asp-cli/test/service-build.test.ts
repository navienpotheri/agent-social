// DK1803: a service that runs older code than the client. `asp live preflight` compares the record schemas the service reports in /health with the client's (amber when it reports none, red when they differ, green when
// they match), and a service that refuses a record with "must NOT have additional property" is told to the person in plain words, by the client that sends the record, never by dropping the field. Stand-in services only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { schemaFingerprint } from "@agent-social/asp-core";
import { RemoteLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { serviceBuildProblem } from "../src/live-cmd.ts";
import { makeFixture } from "./fixture.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const mine = schemaFingerprint();

async function service(health: unknown, rpc?: { status: number; body: unknown }) {
  const s = createServer((req, res) => {
    req.on("data", () => undefined);
    req.on("end", () => {
      if (req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(health)); return; }
      if (req.url === "/rpc" && rpc) { res.writeHead(rpc.status, { "content-type": "application/json" }); res.end(JSON.stringify(rpc.body)); return; }
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}
async function preflight(url: string) {
  const f = makeFixture(); mkdirSync(f.aspHome, { recursive: true });
  writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ identities: { me: "did:web:x:u:a", agent: "did:web:x:a:a:b", bank: "did:web:x:u:a:bank" } }));
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ANTHROPIC_API_KEY: "sk-ant-api03-" + "Z".repeat(40), ASP_CLAUDE_BIN: process.execPath, ASP_LOG_URL: url }, cwd: f.aspHome };
  const code = await main(["live", "preflight", "--model", "claude-haiku-5-5", "--budget-usd", "5"], io);
  return { code, out: out.join("\n") };
}

test("serviceBuildProblem: no report is amber, a different schema is red and names it, the same is fine, with the remedy", () => {
  assert.equal(serviceBuildProblem(mine, mine), undefined);
  const none = serviceBuildProblem(undefined, mine)!;
  assert.equal(none.level, "warn");
  assert.match(none.text, /older than this client.*update the service, or run with --local/);
  const older = serviceBuildProblem({ ...mine, contract: "deadbeef" }, mine)!;
  assert.equal(older.level, "fail");
  assert.match(older.text, /different record schemas.*contract.*older.*--local/);
  const noType = { ...mine }; delete (noType as Record<string, string>).contract;
  assert.match(serviceBuildProblem(noType, mine)!.text, /no schema for contract/);
});

test("preflight: an old service with no build in /health is AMBER, one with a differing contract schema is RED with the remedy, one with the same schemas is green", async () => {
  const old = await preflight(await service({ ok: true }));
  assert.match(old.out, /AMBER\s+the log service.*does not report which record schemas.*older than this client/s);
  const differing = await preflight(await service({ ok: true, build: { schemas: { ...mine, contract: "00000000" } } }));
  assert.match(differing.out, /RED\s+the log service.*different record schemas.*contract.*run with --local/s);
  assert.equal(differing.code, 1);
  const same = await preflight(await service({ ok: true, build: { schemas: mine } }));
  assert.match(same.out, /GREEN\s+the log service.*same record schemas/s);
});

test("the client says in plain words that the service is older when it refuses a field, and keeps the error code; any other refusal is passed on as it was", async () => {
  const refuse = (message: string) => ({ status: 400, body: { ok: false, error: { name: "AspError", code: "SCHEMA_INVALID", message: `SCHEMA_INVALID: ${message}` } } });
  const url = await service({ ok: true }, refuse("contract must NOT have additional properties"));
  await assert.rejects(() => new RemoteLog(url, "t").append({} as never), (e: Error & { code?: string }) => {
    assert.equal(e.code, "SCHEMA_INVALID");
    assert.match(e.message, /this service runs older code than your client.*does not know a field.*contract must NOT have additional properties.*update it, or run with --local.*Nothing was dropped/s);
    return true;
  });
  const other = await service({ ok: true }, refuse("contract/principal must match format \"did\""));
  await assert.rejects(() => new RemoteLog(other, "t").append({} as never), (e: Error) => { assert.ok(!/older code/.test(e.message)); assert.match(e.message, /must match format/); return true; });
});
