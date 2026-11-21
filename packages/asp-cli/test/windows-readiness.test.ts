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
