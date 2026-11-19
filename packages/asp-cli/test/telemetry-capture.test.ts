// Row DK652 (owner answer TM1): `asp run` sends the run's trajectory and task text to the telemetry store when it is on, and the signed Action carries only the hashes; with the store off nothing is sent; the account export lists the store
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

test("DK652: a run sends its trajectory and task to the store and only the hashes reach the signed Action; off sends nothing; export lists the store; closing deletes the text and keeps the hashes", { timeout: 300_000 }, async () => {
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

    // On (the default): the trajectory and the task are in the store; the Action carries only their hashes.
    const r1 = await run();
    assert.ok(r1.code === 0 || r1.code === 10, `${r1.err}\n${r1.out}`);
    let listed: string[] = [];
    for (let i = 0; i < 20 && listed.length < 2; i++) { listed = (await call(["telemetry", "list"])).out.split(String.fromCharCode(10)).filter(Boolean); if (listed.length < 2) await new Promise((r) => setTimeout(r, 500)); }
    assert.equal(listed.length, 2, `a trajectory and a message are stored: ${listed.join(" | ")}`);
    assert.ok(listed.some((l) => /trajectory/.test(l)) && listed.some((l) => /message/.test(l)));
    const hashes = listed.map((l) => /(sha256:[0-9a-f]{64})/.exec(l)![1]);
    const lg = await openLog(f.aspHome, { ASP_LOG_URL: url, ASP_LOG_TOKEN: cfg.token } as never);
    const actions = (await lg.log.recordsOfTypes(["action"])) as unknown as { body: { artifacts?: { uri: string; sha256: string }[] } }[];
    const refs = actions.flatMap((a) => a.body.artifacts ?? []).filter((x) => x.uri.startsWith("asp://telemetry/"));
    assert.deepEqual(refs.map((x) => x.sha256).sort(), [...hashes].sort(), "the Action cites the hashes of what was stored");
    assert.ok(!JSON.stringify(actions).includes("zebra-quartz"), "the task text is not in the signed log");
    const stored = readdirSync(join(`${tokens}.telemetry`, "tm-run-agent", "content"));
    assert.equal(stored.length, 2);

    // Off: nothing more is sent.
    assert.equal((await call(["telemetry", "off"])).code, 0);
    const r2 = await run();
    assert.ok(r2.code === 0 || r2.code === 10, `${r2.err}\n${r2.out}`);
    assert.equal((await call(["telemetry", "list"])).out.split("\n").filter(Boolean).length, 2, "nothing new while it is off");
    const refs2 = ((await lg.log.recordsOfTypes(["action"])) as unknown as { body: { artifacts?: { uri: string }[] } }[]).flatMap((a) => a.body.artifacts ?? []).filter((x) => x.uri.startsWith("asp://telemetry/"));
    assert.equal(refs2.length, 2, "and the new Action cites none");

    // Export lists the store with its content; closing deletes the text and keeps the hashes.
    const out = join(f.root, "export");
    assert.equal((await call(["account", "export", "--out", out])).code, 0);
    const exported = JSON.parse(readFileSync(join(out, "telemetry.json"), "utf8")) as { on: boolean; entries: { hash: string; content?: string }[] };
    assert.equal(exported.on, false);
    assert.equal(exported.entries.length, 2);
    assert.ok(exported.entries.every((e) => typeof e.content === "string" && e.content.length > 0));
    assert.ok(exported.entries.some((e) => e.content!.includes("zebra-quartz")), "the task text is in the export");
    const closed = await call(["account", "close", "--confirm", "tm-run-agent", "--skip-export"]);
    assert.equal(closed.code, 0, closed.err);
    assert.equal(readdirSync(join(`${tokens}.telemetry`, "tm-run-agent", "content")).length, 0, "the text is gone");
    const state = readFileSync(join(`${tokens}.telemetry`, "tm-run-agent", "state.json"), "utf8");
    for (const h of hashes) assert.ok(state.includes(h), "the hash is kept");
    assert.ok(!state.includes("zebra-quartz"));
    assert.equal(existsSync(join(out, "telemetry.json")), true);
  } finally { server.kill(); upstream.close(); }
});
