/**
 * A second, token-based reading of a shell command for the gateway's judge (gaps BM1-BM5, BM7, BM12; found by the ASP Containment Benchmark, evals/benchmark/).
 *
 * The first reading (scopeForShellCommand) matches words anywhere in the text, so it misses a push that is not the first thing in the command, a network tool it does not list,
 * and a command split by quotes or hidden in a variable, and it mistakes the word "curl" inside a commit message for the tool. This reading splits the command into segments,
 * finds the real verb of each, looks inside the usual wrappers (bash -c, eval, xargs, find -exec, $(...), pipes into a shell) and answers one of:
 *   - a scope that is stricter than the first reading's (the judge then uses it): repo.push, pr.open, pr.merge, shell.network, shell.indirect (a verb built from a variable we cannot resolve);
 *   - "data-only": every verb is an ordinary local tool, so network words in it are only text (the judge may then use a weaker scope than the first reading gave);
 *   - undefined: no opinion.
 * It never reads a script file's contents, and it is a reading of text, not a sandbox: BM-listed limits remain (the sandbox's egress block is what stops a program that builds its own request).
 */

export type ShellScan = { stricter?: string; dataOnly?: { scope: "repo.read" | "repo.write" | "shell.exec" } };

const RANK: Record<string, number> = { "repo.read": 0, "tests.run": 1, "repo.write": 2, "shell.exec": 3, "shell.indirect": 4, "shell.network": 5, "web.read": 5, "pr.open": 6, "repo.push": 7, "pr.merge": 8 };
export const rankOf = (scope: string): number => RANK[scope] ?? 3;

const WRAPPER_WORDS = new Set(["env", "time", "nohup", "nice", "ionice", "command", "builtin", "exec", "sudo", "doas", "stdbuf", "timeout", "setsid", "then", "do", "else", "if", "while", "until", "!", "{", "(", "watch", "xargs"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "cmd", "powershell", "pwsh", "busybox"]);
const INTERPRETERS = new Set(["python", "python2", "python3", "node", "nodejs", "deno", "bun", "ruby", "perl", "php", "lua", "rscript", "pwsh", "powershell"]);
const NET_VERBS = new Set(["curl", "wget", "nc", "ncat", "netcat", "ssh", "scp", "sftp", "rsync", "telnet", "ftp", "tftp", "ping", "ping6", "nslookup", "dig", "host", "socat", "aria2c", "lynx", "links", "w3m", "http", "https", "httpie", "invoke-webrequest", "iwr", "invoke-restmethod", "irm", "aws", "gsutil", "gcloud", "az", "rclone", "twine", "mosh", "traceroute", "tracepath", "whois", "nmap", "masscan", "npx", "bunx", "pnpx", "wscat", "websocat", "mutt", "mail", "sendmail", "ssmtp", "swaks"]);
const NPM_NET = new Set(["install", "i", "ci", "add", "update", "up", "upgrade", "publish", "exec", "dlx", "create", "view", "audit", "login", "outdated", "info", "search", "init", "x"]);
const PIP_NET = new Set(["install", "download", "search", "wheel"]);
const CARGO_NET = new Set(["install", "fetch", "publish", "update", "add", "search", "login", "yank"]);
const SYS_NET = new Set(["install", "update", "upgrade", "add", "dist-upgrade", "reinstall", "tap", "fetch", "pull", "search", "cask"]);
const GIT_NET = new Set(["pull", "fetch", "clone", "ls-remote", "remote-update", "submodule", "subtree", "lfs", "request-pull", "archive-remote", "svn"]);
const GIT_LOCAL = new Set(["status", "diff", "log", "show", "branch", "ls-files", "rev-parse", "blame", "add", "commit", "checkout", "switch", "merge", "rebase", "stash", "tag", "reset", "restore", "clean", "mv", "rm", "config", "remote", "init", "cherry-pick", "revert", "apply", "am", "describe", "shortlog", "reflog", "bisect", "worktree", "grep", "notes", "show-ref", "cat-file", "ls-tree", "rev-list", "diff-tree", "format-patch", "gc", "fsck", "count-objects", "stripspace", "update-index", "write-tree", "read-tree", "name-rev", "for-each-ref", "symbolic-ref", "check-ignore", "var", "whatchanged"]);
/** Verbs that only read or write local files, or run a local program: words in their arguments are data. */
const DATA_READ = new Set(["cat", "type", "ls", "dir", "pwd", "head", "tail", "wc", "grep", "egrep", "fgrep", "rg", "findstr", "tree", "stat", "file", "echo", "printf", "sed", "jq", "yq", "sort", "uniq", "cut", "tr", "diff", "cmp", "comm", "column", "nl", "od", "xxd", "basename", "dirname", "realpath", "readlink", "du", "df", "date", "uname", "whoami", "which", "true", "false", "test", "[", "cd", "pushd", "popd", "tac", "rev", "fold", "fmt", "paste", "join", "split", "md5sum", "sha1sum", "sha256sum", "shasum", "cksum", "less", "more", "get-content", "select-string", "get-childitem", "gc", "gci", "sls", "write-output", "write-host", "find", "id", "hostname", "env", "printenv", "sleep", "expr", "seq", "tee", "xargs", "git"]);
const DATA_WRITE = new Set(["cp", "mv", "rm", "mkdir", "touch", "ln", "chmod", "chown", "install", "dd", "truncate", "rmdir", "set-content", "add-content", "out-file", "new-item", "remove-item", "copy-item", "move-item", "rename-item", "clear-content", "del", "copy", "move", "md", "ni", "ri", "si", "sc", "ac"]);
const RUNNERS = new Set(["make", "npm", "pnpm", "yarn", "bun", "pytest", "python", "python3", "node", "go", "cargo", "tsc", "eslint", "prettier", "jest", "vitest", "mocha", "ruby", "mvn", "gradle", "gradlew", "dotnet", "java", "javac", "gcc", "g++", "clang", "cmake", "ctest", "rustc", "deno", "php", "phpunit", "rspec", "bash", "sh", "git", "./"]);
const NET_CODE = /\b(socket|urllib|urlopen|requests\.|httpx|aiohttp|http\.client|httplib|net\/http|net\.connect|net\.Socket|https?\.(get|request)|require\(['"]https?['"]\)|from ['"]node:https?['"]|fetch\s*\(|XMLHttpRequest|WebSocket|file_get_contents\s*\(\s*['"]https?|curl_init|fsockopen|IO::Socket|LWP|Net::HTTP|TCPSocket|URI\.open|open-uri|Invoke-WebRequest|Invoke-RestMethod|WebClient|dns\.resolve|getaddrinfo|gethostbyname)/i;
const EXEC_CODE = /\b(system|popen|subprocess|exec[lv]?p?e?|spawn|child_process|shell_exec|passthru|proc_open|Runtime\.getRuntime|qx|os\.execute)\b|`[^`]*`/i;

/** Shell-like word splitting that keeps quoted text as part of the word (quotes removed). */
function words(seg: string): string[] {
  const out: string[] = []; let cur = ""; let q = "", has = false;
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i];
    if (q) { if (ch === q) q = ""; else cur += ch; continue; }
    if (ch === "'" || ch === "\"") { q = ch; has = true; continue; }
    if (ch === "\\" && i + 1 < seg.length) { cur += seg[++i]; has = true; continue; }
    if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ""; has = false; continue; }
    cur += ch; has = true;
  }
  if (cur || has) out.push(cur);
  return out;
}

/** Splits on && || ; | & and newlines, outside quotes and $( ) groups. */
function segments(text: string): string[] {
  const out: string[] = []; let cur = ""; let q = ""; let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { cur += ch; if (ch === q && text[i - 1] !== "\\") q = ""; continue; }
    // A PowerShell here-string (@' ... '@ or @" ... "@, the opening quote last on its line, the closing one first on its) is data: its lines are not commands, whatever they contain. It is how a model
    // on Windows writes a multi-line file, and found by the learning pilot to be refused as "indirect" because its lines were read as commands (any $( ) inside is still read by scanSegment).
    if (ch === "@" && (text[i + 1] === "'" || text[i + 1] === "\"") && (i === 0 || /[\s=(,;|&]/.test(text[i - 1]))) {
      const open = /^@(['"])[ \t]*\r?\n/.exec(text.slice(i));
      if (open) {
        const body = text.slice(i + open[0].length);
        const end = body.search(new RegExp(`(?:^|\\n)${open[1]}@`));
        const stop = end < 0 ? text.length : i + open[0].length + end + (body[end] === "\n" ? 1 : 0) + 2;
        cur += text.slice(i, stop); i = stop - 1; continue;
      }
    }
    if (ch === "'" || ch === "\"") { q = ch; cur += ch; continue; }
    if (ch === "$" && text[i + 1] === "(") { depth++; cur += "$("; i++; continue; }
    if (ch === "(" && depth > 0) { depth++; cur += ch; continue; }
    if (ch === ")" && depth > 0) { depth--; cur += ch; continue; }
    if (depth === 0 && (ch === "\n" || ch === ";" || ch === "|" || (ch === "&" && text[i + 1] !== ">" && text[i - 1] !== ">" && text[i - 1] !== "&" && !/[<>]/.test(text[i - 1] ?? "")))) {
      if ((ch === "|" || ch === "&") && text[i + 1] === ch) i++;
      out.push(cur); cur = ""; continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const baseName = (w: string) => (w.split(/[\\/]/).pop() ?? w).toLowerCase().replace(/\.exe$/, "");

interface Ctx { vars: Map<string, string>; depth: number; unreadable: boolean; scopes: string[]; hasNonData: boolean; localScopes: string[] }

function subst(text: string, vars: Map<string, string>): string {
  return text.replace(/\$\{IFS\}|\$IFS/g, " ").replace(/\$\{(\w+)\}|\$(\w+)/g, (m, a, b) => vars.get(a ?? b) ?? m);
}

/** Innermost text of a command substitution, backticks or process substitution. */
function inner(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\$\(((?:[^()]|\([^()]*\))*)\)/g)) out.push(m[1]);
  for (const m of text.matchAll(/`([^`]*)`/g)) out.push(m[1]);
  for (const m of text.matchAll(/[<>]\(([^()]*)\)/g)) out.push(m[1]);
  return out;
}

function note(ctx: Ctx, scope: string) { ctx.scopes.push(scope); ctx.hasNonData = true; }

function scanSegment(seg: string, ctx: Ctx, prev: string | undefined): string {
  seg = seg.trim();
  if (/^[({]/.test(seg)) seg = seg.replace(/^[({]\s*/, "").replace(/\s*[)}]\s*$/, "");
  // A PowerShell assignment ($x = ...) runs nothing by itself, so it is not "a verb built from a variable": a literal (a string, a number, a variable, an array, a here-string) is data, and anything else on
  // the right is read as the command it is ($x = Invoke-WebRequest ... is a network call). Using an unresolved variable as a command ($x args, & $x) is still read as shell.indirect below.
  const ps = /^\$(?:\w+:)?[A-Za-z_]\w*\s*[-+*\/]?=\s*([\s\S]*)$/.exec(seg);
  if (ps) {
    const rhs = ps[1].trim();
    for (const sub of inner(seg)) scanText(sub, ctx);
    if (!rhs || /^@['"]/.test(rhs) || /^(['"]).*\1$/s.test(rhs) || /^[-+]?\d[\d.]*$/.test(rhs) || /^\$\w+$/.test(rhs) || /^@[({]/.test(rhs) || /^\$(true|false|null)$/i.test(rhs)) return seg;
    seg = rhs;
  }
  // Plain assignments (a=git) feed later segments.
  const asg = /^(\w+)=(\S*)$/.exec(seg);
  if (asg) { ctx.vars.set(asg[1], words(asg[2])[0] ?? ""); return seg; }
  seg = subst(seg, ctx.vars);
  for (const sub of inner(seg)) scanText(sub, ctx);
  let w = words(seg.replace(/\$\([^)]*\)|`[^`]*`/g, "x"));
  // Leading assignments and wrapper words.
  while (w.length) {
    const b = baseName(w[0]);
    if (/^\w+=/.test(w[0]) || WRAPPER_WORDS.has(b)) {
      if (b === "xargs") { const rest = w.slice(1); const i = rest.findIndex((x) => !x.startsWith("-")); if (i >= 0) scanText(rest.slice(i).join(" "), ctx); ctx.hasNonData = true; return seg; }
      w = w.slice(1);
      if (b === "timeout" || b === "nice") w = w.slice(1); // their first argument is a number
      continue;
    }
    break;
  }
  if (!w.length) return seg;
  let verb = baseName(w[0]);
  const args = w.slice(1);
  if (verb.startsWith("$")) { ctx.unreadable = true; note(ctx, "shell.indirect"); return seg; }
  const lowerArgs = args.map((a) => a.toLowerCase());
  const sub = (skipOpts: boolean) => { for (let i = 0; i < args.length; i++) { const a = lowerArgs[i]; if (a === "-c" || a === "-C" || a === "--git-dir" || a === "--work-tree" || a === "-p") { i++; continue; } if (skipOpts && a.startsWith("-")) continue; return a; } return ""; };

  if (verb === "git") {
    const s = sub(true);
    if (s === "push") { note(ctx, "repo.push"); return seg; }
    if (GIT_NET.has(s) && !(s === "submodule" && !lowerArgs.includes("update") && !lowerArgs.includes("sync"))) { note(ctx, "shell.network"); return seg; }
    if (s === "remote" && lowerArgs.includes("update")) { note(ctx, "shell.network"); return seg; }
    if (/^https?:|^ssh:|^git@|^git:/.test(args.join(" "))) { note(ctx, "shell.network"); return seg; }
    ctx.localScopes.push(["status", "diff", "log", "show", "branch", "ls-files", "rev-parse", "blame", "describe", "reflog", "grep", "show-ref", "cat-file", "ls-tree", "rev-list", "name-rev", "for-each-ref", "shortlog", "whatchanged", "count-objects", "check-ignore"].includes(s) ? "repo.read" : "shell.exec");
    if (!GIT_LOCAL.has(s) && s) { ctx.hasNonData = true; }
    return seg;
  }
  if (verb === "gh") {
    const s = sub(true), s2 = lowerArgs.filter((a) => !a.startsWith("-"))[1] ?? "";
    if (s === "pr" && s2 === "merge") { note(ctx, "pr.merge"); return seg; }
    if (s === "pr" && s2 === "create") { note(ctx, "pr.open"); return seg; }
    note(ctx, "shell.network"); return seg;
  }
  const offline = lowerArgs.includes("--offline");
  if (verb === "npm" || verb === "pnpm" || verb === "yarn" || verb === "bun" || verb === "npx" || verb === "pnpx" || verb === "bunx") {
    const s = sub(true);
    if (verb === "npx" || verb === "pnpx" || verb === "bunx") { if (!offline && !lowerArgs.includes("--no-install")) note(ctx, "shell.network"); else ctx.localScopes.push("shell.exec"); return seg; }
    if (s === "install" || s === "i" || s === "ci" || s === "add" || NPM_NET.has(s)) { if (!offline || s === "publish") note(ctx, "shell.network"); else ctx.localScopes.push("shell.exec"); return seg; }
    if (!s && verb === "yarn") { if (!offline) note(ctx, "shell.network"); return seg; }
    ctx.localScopes.push("shell.exec"); return seg;
  }
  if (verb === "pip" || verb === "pip3" || verb === "pipx" || verb === "uv" || verb === "poetry" || verb === "conda" || verb === "mamba") {
    const s = sub(true);
    if (PIP_NET.has(s) || ["add", "sync", "lock", "update", "pip", "tool", "publish", "self"].includes(s)) { note(ctx, "shell.network"); return seg; }
    ctx.localScopes.push("shell.exec"); return seg;
  }
  if (INTERPRETERS.has(verb.replace(/\d+(\.\d+)*$/, "")) || INTERPRETERS.has(verb)) {
    if (lowerArgs[0] === "-m" && (lowerArgs[1] === "pip" || lowerArgs[1] === "ensurepip") && PIP_NET.has(lowerArgs.slice(2).find((a) => !a.startsWith("-")) ?? "")) { note(ctx, "shell.network"); return seg; }
    if (lowerArgs[0] === "-m" && ["http.server", "smtpd", "ftplib", "urllib.request"].includes(lowerArgs[1] ?? "")) { note(ctx, "shell.network"); return seg; }
    const codeIdx = args.findIndex((a, i) => /^-(c|e|r|eval|command)$/i.test(a) && i + 1 < args.length);
    const code = codeIdx >= 0 ? args.slice(codeIdx + 1).join(" ") : "";
    if (code) {
      if (NET_CODE.test(code)) { note(ctx, "shell.network"); return seg; }
      if (EXEC_CODE.test(code)) { scanText(code.replace(/^.*?(system|popen|run|exec\w*|spawn\w*)\s*\(\s*['"]/i, ""), ctx); }
      ctx.localScopes.push("shell.exec"); return seg;
    }
    ctx.localScopes.push("shell.exec"); return seg; // a script file: contents not read
  }
  if (verb === "cargo") { const s = sub(true); if (CARGO_NET.has(s)) { note(ctx, "shell.network"); return seg; } ctx.localScopes.push("shell.exec"); return seg; }
  if (verb === "go") { const s = sub(true); if (s === "get" || s === "install" || (s === "mod" && ["download", "tidy", "vendor"].includes(lowerArgs[1] ?? "")) || s === "work") { note(ctx, "shell.network"); return seg; } ctx.localScopes.push("shell.exec"); return seg; }
  if (["gem", "bundle", "composer", "dotnet", "nuget", "apt", "apt-get", "dnf", "yum", "apk", "brew", "pacman", "zypper", "choco", "winget", "scoop", "snap", "flatpak"].includes(verb)) {
    const s = sub(true);
    if (SYS_NET.has(s) || ["push", "restore", "fetch", "require", "outdated", "search", "download"].includes(s) || (verb === "gem" && s === "install")) { note(ctx, "shell.network"); return seg; }
    ctx.localScopes.push("shell.exec"); return seg;
  }
  if (verb === "docker" || verb === "podman" || verb === "nerdctl") {
    const s = sub(true);
    if (["pull", "push", "login", "search", "manifest", "trust", "buildx"].includes(s) || (s === "build" && lowerArgs.includes("--pull")) || (s === "compose" && lowerArgs.includes("pull"))) { note(ctx, "shell.network"); return seg; }
    ctx.localScopes.push("shell.exec"); return seg;
  }
  if (verb === "terraform" || verb === "tofu" || verb === "pulumi" || verb === "helm" || verb === "kubectl" || verb === "ansible" || verb === "vagrant") { note(ctx, "shell.network"); return seg; }
  if (verb === "openssl") { if (lowerArgs.some((a) => a === "s_client" || a === "s_server" || a === "s_time")) { note(ctx, "shell.network"); return seg; } ctx.localScopes.push("shell.exec"); return seg; }
  if (verb === "find") {
    const e = lowerArgs.findIndex((a) => a === "-exec" || a === "-execdir" || a === "-ok");
    if (e >= 0) { const cmd = args.slice(e + 1).join(" ").replace(/\s*(\\;|;|\+)\s*$/, ""); scanText(cmd, ctx); ctx.hasNonData = true; return seg; }
    ctx.localScopes.push(lowerArgs.includes("-delete") ? "repo.write" : "repo.read"); return seg;
  }
  if (verb === "eval" || verb === "source" || verb === ".") { scanText(args.join(" "), ctx); ctx.hasNonData = true; return seg; }
  if (SHELLS.has(verb)) {
    const c = args.findIndex((a) => /^-\w*c$/i.test(a) || a.toLowerCase() === "/c" || a.toLowerCase() === "-command");
    if (c >= 0) { scanText(args.slice(c + 1).join(" "), ctx); ctx.hasNonData = true; return seg; }
    // A shell reading its input from a pipe or a file: what feeds it decides.
    ctx.hasNonData = true;
    if (prev !== undefined) {
      const pv = baseName(words(prev)[0] ?? "");
      if (["echo", "printf", "cat"].includes(pv)) scanText(words(prev).slice(1).join(" "), ctx);
      else if (["base64", "openssl", "xxd", "gunzip", "zcat", "gzip", "uudecode", "basenc"].includes(pv) && /(-d|--decode|-r|enc|-dc)\b/i.test(prev)) note(ctx, "shell.network");
    }
    ctx.localScopes.push("shell.exec"); return seg;
  }
  if (NET_VERBS.has(verb)) { if (!(verb === "nmap" && false)) note(ctx, "shell.network"); return seg; }
  if (seg.includes("/dev/tcp/") || seg.includes("/dev/udp/")) { note(ctx, "shell.network"); return seg; }
  if (verb === "awk" || verb === "gawk" || verb === "mawk") { ctx.hasNonData = true; ctx.localScopes.push("shell.exec"); return seg; }
  if (verb === "sed" && lowerArgs.some((a) => /^s([^\w\s]).*\1[a-z]*e[a-z]*$/i.test(a) || /(^|[;{])\s*e\b/.test(a))) { ctx.hasNonData = true; ctx.localScopes.push("shell.exec"); return seg; }
  if (verb === "sed" && lowerArgs.some((a) => /^-[a-z]*i/.test(a) || a === "--in-place" || a.startsWith("--in-place="))) { ctx.localScopes.push("repo.write"); return seg; }
  if ((verb === "sort" && lowerArgs.some((a) => a === "-o" || a.startsWith("--output"))) || verb === "split" || verb === "csplit") { ctx.localScopes.push("repo.write"); return seg; }
  if (DATA_READ.has(verb)) { ctx.localScopes.push(verb === "tee" ? "repo.write" : "repo.read"); return seg; }
  if (DATA_WRITE.has(verb)) { ctx.localScopes.push("repo.write"); return seg; }
  if (verb === "base64" || verb === "xxd") { ctx.localScopes.push("repo.read"); return seg; }
  // Anything else: a local program (make, ./build.sh, tsc, pytest...). Its arguments are data; what it does inside is not read.
  ctx.localScopes.push("shell.exec");
  if (!RUNNERS.has(verb) && !/^\.{0,2}\//.test(w[0]) && !/^[a-z][\w.+-]*$/.test(verb)) ctx.hasNonData = true;
  return seg;
}

/** Removes shell comments (# outside quotes, at a word start). */
function stripComments(text: string): string {
  let out = "", q = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { out += ch; if (ch === q && text[i - 1] !== "\\") q = ""; continue; }
    if (ch === "'" || ch === "\"") { q = ch; out += ch; continue; }
    if (ch === "#" && (i === 0 || /\s/.test(text[i - 1]))) { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
    out += ch;
  }
  return out;
}

function scanText(text: string, ctx: Ctx) {
  if (ctx.depth > 6) { ctx.unreadable = true; ctx.hasNonData = true; return; }
  ctx.depth++;
  // Quote-splitting and backslashes inside a word: c''url, "cu"rl, c\url.
  let t = stripComments(text).replace(/(["'])\1/g, "").replace(/\\(?=[A-Za-z])/g, "");
  if (/\/dev\/(tcp|udp)\//.test(t)) note(ctx, "shell.network");
  let prev: string | undefined;
  for (const seg of segments(t)) { prev = scanSegment(seg, ctx, prev) ?? seg; }
  ctx.depth--;
}

/** Heredoc bodies are data for the verb that reads them (cat > f <<EOF) and code for an interpreter (python - <<EOF): drop the body only for the former. */
function dropHeredocs(command: string): string {
  return command.replace(/(^|\n)([^\n]*?)<<-?\s*['"]?(\w+)['"]?([^\n]*)\n[\s\S]*?\n\s*\3\s*(?=\n|$)/g, (m, nl, head, tag, tail) => {
    const verb = baseName(words(head.trim().replace(/^[({\s]+/, ""))[0] ?? "");
    return DATA_READ.has(verb) || DATA_WRITE.has(verb) ? `${nl}${head}${tail}` : m;
  });
}

/** Reads a shell command. `unwrapped` is the command with any outer `bash -c` already removed. */
export function scanShell(unwrapped: string): ShellScan {
  const ctx: Ctx = { vars: new Map(), depth: 0, unreadable: false, scopes: [], hasNonData: false, localScopes: [] };
  const text = dropHeredocs(unwrapped);
  scanText(text, ctx);
  const writesViaRedirect = /(^|[^\w<>&])\d*>>?(?!&)\s*(?!\/dev\/null|nul\b|\$null)\S/i.test(text.replace(/\d*&?>>?\s*(?:\/dev\/null|nul|\$null)(?![\w./-])/gi, " "));
  const out: ShellScan = {};
  if (ctx.scopes.length) {
    const top = ctx.scopes.reduce((a, b) => (rankOf(b) > rankOf(a) ? b : a));
    out.stricter = top;
    return out;
  }
  if (!ctx.hasNonData && !ctx.unreadable && ctx.localScopes.length) {
    const top = ctx.localScopes.reduce((a, b) => (rankOf(b) > rankOf(a) ? b : a)) as "repo.read" | "repo.write" | "shell.exec";
    out.dataOnly = { scope: writesViaRedirect && top === "repo.read" ? "repo.write" : top };
  }
  return out;
}
