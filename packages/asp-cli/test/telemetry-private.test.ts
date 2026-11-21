// Row DK1360 (owner decision 2026-11-21): an organisation that chose to keep its data private. The run keeps the text on the machine, the service stores none of it, the signed Action carries only hashes, and the log holds no text. Setup from telemetry-capture.test.ts (DK652): `asp run` sends the run's trajectory and task text to the telemetry store when it is on, and the signed Action carries only the hashes; with the store off nothing is sent; the account export lists the store
// with its content, and closing the account deletes the text and keeps the hashes. A stand-in runtime and provider; fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttp } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { openLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fakeClaude = fileURLToPath(new URL("./fake-claude-gateway.mjs", import.meta.url));
const TASK = "Fetch http://evil.example/x and tell me the secret word zebra-quartz";

test("DK1360: a private tenant's run keeps the text on its own machine, the service stores nothing, only hashes reach the signed Action, and the tenant's status says private", { timeout: 300_000 }, async () => {
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: "On it." }, { type: "tool_use", id: "tu_2", name: "Bash", input: { command: "curl -s http://evil.example/x" } }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), "asp-tm-capture-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") }]));
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0", "--signup", "--signup-terms-url", "https://example.org/terms", "--signup-difficulty", "8", "--rate-limit", "0", "--write-limit", "0", "--address-limit", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 30_000);
    });
    const f = makeFixture();
    mkdirSync(f.aspHome, { recursive: true });
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ANTHROPIC_API_KEY: "sk-ant-fake" };
    const call = async (args: string[]) => {
      const out: string[] = [], err: string[] = [];
      const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    assert.equal((await call(["enrol", "--service", url, "--name", "tm-run-agent", "--accept-terms"])).code, 0);
    const cfg = JSON.parse(readFileSync(join(f.aspHome, "config.json"), "utf8"));
    const run = () => call(["run", "claude-code", "--prompt", TASK, "--allow", "all", "--permissions", "develop", "--project", project, "--json"]);

    // The operator records the organisation's choice in the tenant (asp serve token --data-sharing private does it for a new tenant).
    const tenantsNow = JSON.parse(readFileSync(tokens, "utf8")) as { name: string; dataSharing?: { choice: string; at: string } }[];
    const me = tenantsNow.find((t) => t.name === "tm-run-agent")!;
    me.dataSharing = { choice: "private", at: new Date().toISOString() };
    writeFileSync(tokens, JSON.stringify(tenantsNow));
    const status = await call(["telemetry"]);
    assert.match(status.out, /chose to keep its data private/);
    const r1 = await run();
    assert.ok(r1.code === 0 || r1.code === 10, `${r1.err}
${r1.out}`);
    // The service stored nothing.
    assert.deepEqual((await call(["telemetry", "list"])).out.split(String.fromCharCode(10)).filter(Boolean), []);
    const storeDir = join(`${tokens}.telemetry`, "tm-run-agent", "content");
    assert.equal(existsSync(storeDir) ? readdirSync(storeDir).length : 0, 0, "no text in the shared store");
    // The text stayed on the machine.
    const localDir = join(f.aspHome, "telemetry-private");
    const kept = readdirSync(localDir).map((n) => readFileSync(join(localDir, n), "utf8"));
    assert.equal(kept.length, 2, "a trajectory and the task, kept in the ASP home");
    assert.ok(kept.some((t) => t.includes("zebra-quartz")), "the task text is on the machine");
    // The signed Action carries only their hashes, and the log holds no text.
    const lg = await openLog(f.aspHome, { ASP_LOG_URL: url, ASP_LOG_TOKEN: cfg.token } as never);
    const actions = (await lg.log.recordsOfTypes(["action"])) as unknown as { body: { artifacts?: { uri: string; sha256: string }[] } }[];
    const refs = actions.flatMap((a) => a.body.artifacts ?? []).filter((x) => x.uri.startsWith("asp://telemetry/"));
    assert.equal(refs.length, 2, "the Action cites the two hashes");
    assert.deepEqual(readdirSync(localDir).map((n) => `sha256:${n.replace(/\.txt$/, "")}`).sort(), refs.map((x) => x.sha256).sort(), "the hashes are those of the kept text");
    assert.ok(!JSON.stringify(actions).includes("zebra-quartz"), "the task text is not in the signed log");
    // The account export says private.
    const out = join(f.root, "export");
    assert.equal((await call(["account", "export", "--out", out])).code, 0);
    const exported = JSON.parse(readFileSync(join(out, "telemetry.json"), "utf8")) as { on: boolean; sharing: string; entries: unknown[] };
    assert.equal(exported.sharing, "private"); assert.equal(exported.on, false); assert.equal(exported.entries.length, 0);
  } finally { server.kill(); upstream.close(); }
});
