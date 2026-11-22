// Rows T24, T25, BM2, BM3, BM4, BM7, BM13 to BM15, BM19 (mutation check, launch-bar-2, 2026-11-22): the shell scanner's word lists were tested for a handful of words each. Removing a word from a list went unnoticed
// for most of them (44 of 57 network verbs, 17 of 19 npm subcommands, 9 of 10 shells, among others), although the Containment Benchmark, which is not part of the unit tests, exercises them. This file states each
// word once, through the gateway's own classifier: a network verb reaches the network, a package manager's fetching subcommand does, a shell's -c string is read, an interpreter's code is read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/gateway/judge.ts";

const scope = (command: string) => classify({ name: "Bash", args: { command } }).scope;

// wsl is not a network verb: it runs the command that follows it, which the scanner reads (lane-cli-3, 2026-11-22; `wsl ls` was wrongly refused as network).
const NETWORK_VERBS = ["curl", "wget", "nc", "ncat", "netcat", "ssh", "scp", "sftp", "rsync", "telnet", "ftp", "tftp", "ping", "ping6", "nslookup", "dig", "host", "socat", "aria2c", "lynx", "links", "w3m", "http", "https", "httpie", "iwr", "invoke-restmethod", "irm", "gsutil", "gcloud", "az", "mosh", "traceroute", "tracepath", "whois", "nmap", "masscan", "npx", "bunx", "pnpx", "wscat", "websocat", "mutt", "mail", "sendmail", "ssmtp", "swaks", "pscp", "plink"];

test("each network verb in the scanner's list reaches the network when it names a host", () => {
  const wrong = NETWORK_VERBS.filter((v) => scope(`${v} example.org`) !== "shell.network");
  assert.deepEqual(wrong, []);
});

test("each fetching subcommand of npm, pip, cargo, git and the system package managers reaches the network", () => {
  const wrong: string[] = [];
  for (const s of ["install", "i", "ci", "add", "update", "up", "upgrade", "publish", "exec", "dlx", "create", "view", "audit", "login", "outdated", "info", "search", "init", "x"]) if (scope(`npm ${s} left-pad`) !== "shell.network") wrong.push(`npm ${s}`);
  for (const s of ["install", "download", "search", "wheel"]) if (scope(`pip ${s} requests`) !== "shell.network") wrong.push(`pip ${s}`);
  for (const s of ["install", "fetch", "publish", "update", "add", "search", "login", "yank"]) if (scope(`cargo ${s} serde`) !== "shell.network") wrong.push(`cargo ${s}`);
  for (const s of ["install", "update", "upgrade", "add", "dist-upgrade", "reinstall", "tap", "fetch", "pull", "search", "cask"]) if (scope(`brew ${s} jq`) !== "shell.network") wrong.push(`brew ${s}`);
  for (const s of ["pull", "fetch", "clone", "ls-remote", "remote-update", "subtree", "lfs", "request-pull", "archive-remote", "svn"]) if (scope(`git ${s} origin`) !== "shell.network") wrong.push(`git ${s}`);
  assert.deepEqual(wrong, []);
});

test("a command inside a shell's -c string is read, for every shell in the list", () => {
  const wrong: string[] = [];
  for (const sh of ["sh", "bash", "zsh", "dash", "ksh", "fish", "busybox"]) if (scope(`${sh} -c "curl example.org"`) !== "shell.network") wrong.push(sh);
  for (const sh of ["powershell", "pwsh"]) if (scope(`${sh} -Command "curl example.org"`) !== "shell.network") wrong.push(sh);
  if (scope('cmd /c "curl example.org"') !== "shell.network") wrong.push("cmd");
  assert.deepEqual(wrong, []);
});

test("network code inside an interpreter's code string is read, for every interpreter in the list", () => {
  const code = "import urllib.request; urllib.request.urlopen('http://example.org')";
  const wrong: string[] = [];
  for (const i of ["python", "python2", "python3", "ruby", "perl", "php", "lua", "rscript", "node", "nodejs", "deno"]) {
    const flag = ["ruby", "perl", "node", "nodejs", "bun"].includes(i) ? "-e" : i === "php" ? "-r" : i === "rscript" ? "-e" : "-c";
    if (scope(`${i} ${flag} "${code}"`) !== "shell.network") wrong.push(i);
  }
  assert.deepEqual(wrong, []);
});

test("bun -e and deno eval read their code as an interpreter does: network code is network, other code is a plain execution", () => {
  // A mutation check found that `bun -e "fetch(...)"` and `deno eval "fetch(...)"` were classed as shell.exec, because bun was read only as a package manager and deno eval was not read at all.
  const js = "fetch('http://example.org')";
  for (const c of [`bun -e "${js}"`, `bun --eval "${js}"`, `bun -p "${js}"`, `deno eval "${js}"`, `node --eval "${js}"`, `node -p "${js}"`]) assert.equal(scope(c), "shell.network", c);
  for (const c of ['bun -e "console.log(1)"', 'deno eval "1+1"', "bun run build.ts", "deno run main.ts"]) assert.equal(scope(c), "shell.exec", c);
  for (const c of ["bun install", "bun add left-pad", "bunx cowsay hi"]) assert.equal(scope(c), "shell.network", `${c} is still the package manager`);
});
