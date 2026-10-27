/**
 * Path confinement (gap BM6): a file tool or a shell command may touch the project and a few harmless system places, and nothing else. Without this the judge looked at the tool's
 * name only, so an agent allowed to read or write could read `~/.ssh/id_rsa` or write `/etc/cron.d/job`.
 *
 * What it reads is the text of the call: the path arguments of file tools, and the path-like words of a shell command (an absolute path, `~`, `$HOME`, `..`, a drive letter, a
 * redirection target). What it cannot see is a path a program builds at run time, a symlink inside the project that points outside, and a path in an environment variable other than
 * HOME; those need the sandbox (H8) and are listed under BM6 in the register.
 */
import { homedir } from "node:os";
import { posix } from "node:path";

export interface Confine {
  /** The project directory: the only tree an agent may read or write. */
  root: string;
  /** The user's home, for `~` and `$HOME`; defaults to the process's home. */
  home?: string;
}

/** Argument names that carry a file path in the file tools of the supported runtimes. */
const PATH_KEYS = ["file_path", "filepath", "path", "filename", "file", "target_file", "TargetFile", "AbsolutePath", "notebook_path", "directory", "dir", "cwd", "workdir"];
const PATH_LIST_KEYS = ["paths", "files", "file_paths"];
/** Reading or writing here is harmless for a shell command: devices and scratch space. */
const SHELL_OK = [/^\/dev\/(null|zero|stdin|stdout|stderr|tty|urandom|random)$/, /^\/tmp(\/|$)/, /^\/var\/tmp(\/|$)/];
/** System programs and libraries: a command may name them, a redirection into them is still refused. */
const SHELL_READ_OK = [/^\/(usr|bin|sbin|lib|lib64|opt)(\/|$)/];
const SECRET = /(^|\/)\.(ssh|aws|gnupg|kube|netrc|git-credentials|azure|docker)(\/|$)|(^|\/)\.config\/(gcloud|gh)(\/|$)|(^|\/)\.npmrc$|^\/etc(\/|$)|^\/root(\/|$)|^\/proc(\/|$)|docker\.sock$|(^|\/)id_(rsa|ed25519|ecdsa)$|\/appdata\/roaming\/(npm|gcloud)|\/windows\/system32/i;

/** A path as a comparable string: forward slashes, `~` and `$HOME` expanded, relative paths put under the root, `.` and `..` resolved. */
export function resolveIn(p: string, c: Confine): string {
  const home = (c.home ?? homedir()).replace(/\\/g, "/");
  let s = p.trim().replace(/\\/g, "/");
  s = s.replace(/^~(?=\/|$)/, home).replace(/^\$\{?HOME\}?(?=\/|$)/, home);
  const root = c.root.replace(/\\/g, "/");
  const drive = /^[a-zA-Z]:\//.test(s) || /^[a-zA-Z]:\//.test(root);
  const abs = s.startsWith("/") || /^[a-zA-Z]:\//.test(s);
  const out = posix.normalize(abs ? s : `${root}/${s}`).replace(/\/+$/, "") || "/";
  return drive ? out.toLowerCase() : out;
}

function isInside(resolved: string, c: Confine): boolean {
  const root = resolveIn(c.root, { ...c, root: "/" });
  return resolved === root || resolved.startsWith(root === "/" ? "/" : `${root}/`);
}

/** The reason a path is refused, or undefined when it is fine. `mode` is how a shell command uses it. */
function why(p: string, c: Confine, mode: "tool" | "shell" | "shell-write"): string | undefined {
  const r = resolveIn(p, c);
  if (SECRET.test(r) && !isInside(r, c)) return `${p} is a secret or system location (${r}), outside this job's project`;
  if (isInside(r, c)) return undefined;
  if (mode !== "tool" && SHELL_OK.some((re) => re.test(r))) return undefined;
  if (mode === "shell" && SHELL_READ_OK.some((re) => re.test(r))) return undefined;
  return `${p} is outside this job's project (${c.root.replace(/\\/g, "/")})`;
}

/** Path-like words in a shell command, with whether each is the target of a redirection. */
export function shellPaths(cmd: string): { path: string; write: boolean }[] {
  const out: { path: string; write: boolean }[] = [];
  const text = cmd.replace(/['"`]/g, " ");
  const re = /(^|[\s;|&<>=(])(>{1,2}\s*)?((?:~[A-Za-z0-9_.-]*|\$\{?HOME\}?|\/|\.\.(?=\/|\s|$)|[a-zA-Z]:[\\/])[^\s;|&<>()]*|[^\s;|&<>()]*\/\.\.(?=\/|\s|$)[^\s;|&<>()]*)/g;
  for (const m of text.matchAll(re)) {
    const w = m[3];
    if (!w || /^[a-z][a-z0-9+.-]*:\/\//i.test(w)) continue;
    // Printing the home folder's name is not touching it: `echo $HOME`.
    const verb = text.slice(0, m.index).split(/[;|&]/).pop()!.trim().split(/\s+/)[0];
    if (/^\$\{?HOME\}?$/.test(w) && /^(echo|printf|export)$/.test(verb)) continue;
    out.push({ path: w, write: !!m[2] });
  }
  return out;
}

/** The path arguments of a file tool call. */
export function toolPaths(args: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const k of PATH_KEYS) { const v = args[k]; if (typeof v === "string" && v.trim()) found.push(v); }
  for (const k of PATH_LIST_KEYS) { const v = args[k]; if (Array.isArray(v)) for (const x of v) if (typeof x === "string") found.push(x); }
  // apply_patch carries its file names in the patch text.
  for (const k of ["patch", "input", "diff"]) {
    const v = args[k];
    if (typeof v === "string") for (const m of v.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) found.push(m[1].trim());
  }
  return found;
}

/** The refusal for a call that reaches outside the project, or undefined. `shellCmd` is set when the tool is a shell. */
export function confinementRefusal(args: Record<string, unknown>, shellCmd: string | undefined, c: Confine): string | undefined {
  if (shellCmd !== undefined) {
    for (const { path, write } of shellPaths(shellCmd)) {
      const r = why(path, c, write ? "shell-write" : "shell");
      if (r) return r;
    }
    return undefined;
  }
  for (const p of toolPaths(args)) {
    const r = why(p, c, "tool");
    if (r) return r;
  }
  return undefined;
}

/**
 * Gap BM16: writes that are harmless as text and harmful when something else later runs them. Each of these paths is run by a tool the agent does not control (git on the next commit, a
 * CI server, npm on the next install, an editor or another agent on the next start), so a Mandate that grants `repo.write` does not grant them: they need `repo.write.protected`.
 */
export const PROTECTED_SCOPE = "repo.write.protected";
const PROTECTED = /(^|[\s/"'=<>])(\.git\/(hooks|config)(\/|$)|\.gitmodules$|\.husky\/|\.githooks\/|\.pre-commit-config\.yaml$|\.github\/(workflows|actions)\/|\.gitlab-ci\.yml$|\.circleci\/|\.buildkite\/|\.travis\.yml$|azure-pipelines\.yml$|bitbucket-pipelines\.yml$|jenkinsfile$|\.vscode\/(tasks|settings|launch)\.json$|\.claude\/|\.cursor\/|\.codex\/|\.gemini\/|\.mcp\.json$|\.envrc$|\.npmrc$|\.asp\/)/i;
/** Lifecycle scripts that npm runs by itself on install, pack or publish. */
const LIFECYCLE = /"(pre|post)?(install|uninstall|prepare|prepack|pack|publish|prepublishOnly)"\s*:/;
const GIT_CONFIG = /\bgit\s+config\b[^|;&\n]*\b(core\.(hooksPath|fsmonitor|sshCommand|pager|editor)|alias\.|credential\.helper|url\.[^\s]*\.insteadOf)/i;

const slash = (p: string) => p.replace(/\\/g, "/");
const CONTENT_KEYS = ["content", "new_string", "file_text", "new_str", "text", "contents", "ReplacementContent", "CodeContent", "insert_text"];
/** What a file tool call writes. */
export function writtenText(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of CONTENT_KEYS) { const v = args[k]; if (typeof v === "string") parts.push(v); }
  for (const k of ["patch", "input", "diff"]) { const v = args[k]; if (typeof v === "string") parts.push(v); }
  const edits = args.edits;
  if (Array.isArray(edits)) for (const e of edits) if (e && typeof e === "object" && typeof (e as { new_string?: unknown }).new_string === "string") parts.push((e as { new_string: string }).new_string);
  return parts.join("\n");
}

/** The protected place a file-tool write or a shell command would change, or undefined. */
export function protectedTarget(args: Record<string, unknown>, shellCmd: string | undefined): string | undefined {
  if (shellCmd !== undefined) {
    const text = slash(shellCmd);
    const m = PROTECTED.exec(text);
    if (m) return m[0].replace(/^[\s/"'=<>]/, "");
    if (/package\.json/.test(text) && LIFECYCLE.test(text)) return "package.json lifecycle script";
    const g = GIT_CONFIG.exec(text);
    if (g) return `git config ${g[1]}`;
    return undefined;
  }
  for (const p of toolPaths(args).map(slash)) {
    if (PROTECTED.test(p)) return p;
    if (/(^|\/)package\.json$/.test(p) && LIFECYCLE.test(writtenText(args))) return `${p} (lifecycle script)`;
  }
  return undefined;
}

/**
 * Text that, written to a file or into a command, is a payload and not ordinary work: a download piped to a shell, a reverse shell, decoded text run as code, a scheduled job,
 * a planted key. A list of patterns: it catches the plain forms, not an obfuscated one (the sandbox and the egress block still stand behind it).
 */
const RISKY_CONTENT: [RegExp, string][] = [
  [/\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/i, "a download piped into a shell"],
  [/\b(base64|openssl\s+enc)\b[^\n|]*(-d|--decode)[^\n|]*\|\s*(ba|z)?sh\b/i, "decoded text piped into a shell"],
  [/\/dev\/(tcp|udp)\//i, "a raw network socket from the shell"],
  [/\b(nc|ncat|netcat)\b[^\n]*\s-e\b|\bbash\s+-i\s*>&/i, "a reverse shell"],
  [/\b(eval|exec)\s*\(\s*(atob|base64|__import__\(.base64)/i, "decoded text run as code"],
  [/\bos\.system\(\s*['"](curl|wget|nc|bash)\b|\bsubprocess\.\w+\(\s*\[?\s*['"](curl|wget|nc|bash)\b/i, "a script that shells out to the network"],
  [/\bcrontab\b|\/etc\/cron|\bat\s+now\b|systemctl\s+enable|launchctl\s+load|schtasks\s+\/create/i, "a scheduled or persistent job"],
  [/authorized_keys|\bssh-keygen\b[^\n]*-f\s+~/i, "a planted login key"],
];
export function riskyContent(text: string): string | undefined {
  for (const [re, label] of RISKY_CONTENT) if (re.test(text)) return label;
  return undefined;
}

/**
 * Gap BM16, the part that needs memory: what this session downloaded and what it copied out of a secret file. Two chains are refused by it, because each step alone is ordinary:
 * running a file the session itself downloaded, and sending a secret file (or a copy of one) over the network. It reads command text only, so a program that does either inside
 * itself is not seen (the sandbox's egress block is what stops that).
 */
const SECRET_FILE = /(^|\/)(\.env(\.[\w-]+)?|\.netrc|\.git-credentials|credentials(\.\w+)?|id_(rsa|ed25519|ecdsa)|[\w.-]*\.(pem|key|p12|pfx|kdbx)|[\w.-]*(secret|token|passwd|password)[\w.-]*)$/i;
const INTERPRETER = /^(bash|sh|zsh|dash|ksh|python3?|node|deno|bun|perl|ruby|php|pwsh|powershell|source|\.)$/;
const words = (cmd: string) => cmd.replace(/['"`]/g, " ").split(/[\s;|&<>()=]+/).filter(Boolean).map((w) => w.replace(/^@/, ""));
const norm = (w: string) => posix.normalize(slash(w));

export class SessionRecord {
  private downloaded = new Set<string>();
  private tainted = new Set<string>();

  /** The reason this command should be refused given what the session did before, or undefined. */
  check(cmd: string, network: boolean): string | undefined {
    const ws = words(cmd);
    if (network) {
      const hit = ws.find((w) => SECRET_FILE.test(slash(w)) || this.tainted.has(norm(w)));
      if (hit) return `this sends ${hit}, a secret file or a copy of one, over the network`;
    }
    for (let i = 0; i < ws.length; i++) {
      const w = norm(ws[i]);
      const runs = (i === 0 && (ws[i].startsWith("./") || ws[i].startsWith("/"))) || (i > 0 && INTERPRETER.test(ws[i - 1]) && i <= 2);
      if (runs && this.downloaded.has(w)) return `this runs ${ws[i]}, a file this session downloaded and no one has reviewed`;
    }
    return undefined;
  }

  /** Remember what an allowed command did. */
  note(cmd: string, network: boolean): void {
    const ws = words(cmd);
    const out: string[] = [];
    for (const m of cmd.matchAll(/>{1,2}\s*([^\s;|&<>]+)/g)) out.push(m[1]);
    for (const m of cmd.matchAll(/(?:^|\s)(?:-o|-O|--output|--output-document)\s+([^\s;|&<>]+)/g)) out.push(m[1]);
    for (const o of out.map((x) => x.replace(/['"`]/g, ""))) {
      const k = norm(o);
      if (network) this.downloaded.add(k);
      else if (ws.some((w) => SECRET_FILE.test(slash(w)) || this.tainted.has(norm(w)))) this.tainted.add(k);
    }
    if (/\b(cp|mv)\b/.test(cmd) && ws.length >= 3 && ws.slice(1).some((w) => SECRET_FILE.test(slash(w)) || this.tainted.has(norm(w)))) this.tainted.add(norm(ws[ws.length - 1]));
  }
}
