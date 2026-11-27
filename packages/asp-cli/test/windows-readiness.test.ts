// Windows readiness of the live run (owner's machine: Windows 11, PowerShell, folders under OneDrive with spaces). Each test names the Windows behaviour it protects. A test that needs Windows says so and is
// skipped elsewhere with that reason; the live run is on Windows, and these run on the builder's Windows machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const WIN = process.platform === "win32";
const tree = fileURLToPath(new URL("./fake-claude-tree.mjs", import.meta.url));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
async function asp(f: Fixture, args: string[], env: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io;
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("Windows: asp stop --all ends the agent AND the processes it started (a child that started a grandchild); nothing is left running", { skip: WIN ? false : "the tree kill (taskkill /T) is the Windows path; on POSIX a process group would be used and is not built" }, async () => {
  const f = makeFixture();
  const treeDir = mkdtempSync(join(tmpdir(), "asp-tree-"));
  const project = join(f.root, "project"); mkdirSync(project, { recursive: true }); mkdirSync(f.aspHome, { recursive: true });
  const running = asp(f, ["run", "claude-code", "--local", "--prompt", "x", "--project", project], { ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: tree, TREE_DIR: treeDir, ASP_GATEWAY_KILL_GRACE_MS: "300" });
  for (let i = 0; i < 150 && !existsSync(join(treeDir, "grandchild.pid")); i++) await wait(100);
  const pids = ["agent", "child", "grandchild"].map((n) => Number(readFileSync(join(treeDir, `${n}.pid`), "utf8")));
  assert.ok(pids.every(alive), "all three are running before the stop");
  const lasp = (args: string[]) => asp(f, ["--home", join(f.aspHome, "local"), ...args]);
  assert.match((await lasp(["stop", "--all"])).out, /stopping 1 session/);
  await running;
  for (let i = 0; i < 100 && pids.some(alive); i++) await wait(100);
  assert.deepEqual(pids.map(alive), [false, false, false], "the agent, its child and its grandchild are all gone");
});

// Paths: the owner's folders have spaces and sit under OneDrive. A shell command with a quoted absolute path inside the project must not be refused, one outside it must be, and a secret reached through a Windows variable must be.
import { judge } from "@agent-social/asp-package";
test("paths with spaces: a quoted absolute path inside the project is allowed in bash and PowerShell, outside it or in a sibling folder with the same prefix is refused, and %USERPROFILE% and $env:USERPROFILE reach the secret guard", () => {
  const base = mkdtempSync(join(tmpdir(), "asp path "));
  const root = join(base, "OneDrive", "Desktop", "D by dt", "agent social");
  mkdirSync(root, { recursive: true });
  const scopes = ["repo.read", "repo.write", "shell.exec"];
  const sh = (command: string, name = "Bash") => judge({ name, args: { command } }, scopes, [], undefined, undefined, { root });
  const f = join(root, "src", "a.ts");
  for (const c of [`cat "${f}"`, `cat '${f}'`, `echo x > "${f}"`]) assert.equal(sh(c).allow, true, c);
  for (const c of [`Get-Content "${f}"`, `Set-Content "${f}" -Value x`]) assert.equal(sh(c, "PowerShell").allow, true, c);
  assert.equal(sh(`cat "${join(base, "OneDrive", "Desktop", "D by dt", "secret file.txt")}"`).allow, false, "outside the project");
  assert.equal(sh(`cat "${root} other${String.fromCharCode(92)}a.ts"`).allow, false, "a sibling with the same prefix");
  if (WIN) {
    const bs = String.fromCharCode(92);
    assert.equal(sh(`type %USERPROFILE%${bs}.ssh${bs}id_rsa`).allow, false);
    assert.equal(sh(`Get-Content $env:USERPROFILE${bs}.ssh${bs}id_rsa`, "PowerShell").allow, false);
    assert.equal(sh("echo %USERPROFILE%").allow, true, "printing the home folder's name is not touching it");
  }
});

// Encoding, busy port and sleep (live-run readiness on Windows).
import { createServer as createNet } from "node:net";
import { writeFileSync as wf } from "node:fs";
import { decodeText, readTextFile } from "@agent-social/asp-package";
import { preflightChecks, type LiveCtx } from "../src/live-cmd.ts";

test("a file written by Windows PowerShell (UTF-8 with a BOM, UTF-16 LE or BE with a BOM, CRLF) is read, not refused", () => {
  const json = JSON.stringify({ a: 1, name: "caf\u00e9" }, null, 2).replace(/\n/g, "\r\n");
  assert.deepEqual(JSON.parse(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json, "utf8")]))), { a: 1, name: "caf\u00e9" });
  assert.deepEqual(JSON.parse(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, "utf16le")]))), { a: 1, name: "caf\u00e9" });
  const be = Buffer.from(json, "utf16le"); be.swap16();
  assert.deepEqual(JSON.parse(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))), { a: 1, name: "caf\u00e9" });
  assert.equal(decodeText(Buffer.from("plain")), "plain");
  const dir = mkdtempSync(join(tmpdir(), "asp-bom-"));
  wf(join(dir, "x.yaml"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("runtime: claude-code\r\n", "utf16le")]));
  assert.equal(readTextFile(join(dir, "x.yaml")), "runtime: claude-code\r\n");
});

const baseCtx = (over: Partial<LiveCtx> = {}): LiveCtx => ({ home: mkdtempSync(join(tmpdir(), "asp-h-")), env: { ANTHROPIC_API_KEY: "k".repeat(20), ASP_CLAUDE_BIN: process.execPath }, out: () => undefined, flags: { budgetUsd: "5", model: "claude-haiku-5-5" }, stopAll: async () => 0, mandateOf: async () => undefined, identities: () => undefined, ...over });

test("preflight: a busy --port is red and says what to do; a free one is green and says no firewall prompt is expected", async () => {
  const s = createNet(); await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const busy = (s.address() as { port: number }).port;
  const red = (await preflightChecks(baseCtx({ flags: { budgetUsd: "5", model: "claude-haiku-5-5", port: String(busy) } }))).find((k) => k.name === `port ${busy}`)!;
  assert.equal(red.status, "fail");
  assert.match(red.detail, /already in use: leave --port out/);
  await new Promise((r) => s.close(r));
  const green = (await preflightChecks(baseCtx({ flags: { budgetUsd: "5", model: "claude-haiku-5-5", port: String(busy) } }))).find((k) => k.name === `port ${busy}`)!;
  assert.equal(green.status, "ok");
  assert.match(green.detail, /no firewall prompt/);
  assert.equal((await preflightChecks(baseCtx({ flags: { port: "99999" } }))).find((k) => /^port /.test(k.name))!.status, "fail");
});

test("preflight: a machine that sleeps when idle or acts on the lid gets an amber warning that says how to stop it; one that does not is green; unreadable settings are amber", async () => {
  const power = (acIdle: number, dcIdle: number, acLid: number) => (cmd: string, args: string[]) => args.includes("STANDBYIDLE")
    ? `Current AC Power Setting Index: 0x${acIdle.toString(16).padStart(8, "0")}\nCurrent DC Power Setting Index: 0x${dcIdle.toString(16).padStart(8, "0")}`
    : `Current AC Power Setting Index: 0x${acLid.toString(16).padStart(8, "0")}\nCurrent DC Power Setting Index: 0x00000001`;
  const sleepy = (await preflightChecks(baseCtx({ query: power(900, 300, 1) }))).find((k) => k.name === "sleep")!;
  assert.equal(sleepy.status, "warn");
  assert.match(sleepy.detail, /sleeps after 15 minute\(s\) idle on mains power.*5 minute\(s\) on battery.*closing the lid/);
  assert.match(sleepy.detail, /powercfg \/change standby-timeout-ac 0 \(this check changes nothing\)/);
  const fine = (await preflightChecks(baseCtx({ query: power(0, 0, 0) }))).find((k) => k.name === "sleep")!;
  assert.equal(fine.status, "ok");
  assert.equal((await preflightChecks(baseCtx({ query: () => undefined }))).find((k) => k.name === "sleep")!.status, "warn");
});
