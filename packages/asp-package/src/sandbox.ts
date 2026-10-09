/**
 * The sandbox level (docs/gateway-design.md, P4): run an agent process inside a Linux sandbox (bubblewrap) whose only way
 * out is the gateway, so even what the agent's own code does is bounded, not just the tool calls the model asks for.
 *
 *  - network: none, unless the Mandate grants a network scope (shell.network or web.read); the agent reaches the gateway
 *    through a relay that forwards a loopback port inside the sandbox to a Unix socket outside it;
 *  - files: the system read-only, the home folder hidden, /tmp private, the project read-only unless the Mandate grants
 *    repo.write, the agent's memory folder and the relay folder writable, plus whatever --sandbox-bind adds;
 *  - the environment is cleared and rebuilt from a short list, so provider keys held by the operator never reach the agent;
 *  - the sandbox dies with its parent.
 * The Action then carries assurance `sandbox_enforced`. Linux only (WSL counts); Windows and macOS need a container backend.
 */
import { execFileSync } from "node:child_process";

export interface SandboxPolicy {
  projectDir: string;
  /** The Mandate grants repo.write. */
  projectWritable: boolean;
  /** The Mandate grants a network scope, so the sandbox keeps the host's network. */
  network: boolean;
  /** The agent's memory folder, writable. */
  memoryDir?: string;
  /** A folder holding the gateway's Unix socket and the relay script, mounted at /tmp/asp (inside the private /tmp). */
  socketDir: string;
  /** The loopback port the relay listens on inside the sandbox. */
  relayPort: number;
  extraBinds?: { path: string; writable?: boolean }[];
  /** Variables the agent is given (the gateway URL, API key placeholder, config paths). */
  env: Record<string, string>;
  /** The home folder to hide. */
  home: string;
}

/** The scopes that mean the Mandate allows the agent to reach the network itself. */
export const NETWORK_SCOPES = ["shell.network", "web.read"];
export const policyNeedsNetwork = (scopes: readonly string[]) => scopes.some((s) => NETWORK_SCOPES.includes(s));

export function sandboxAvailable(): { ok: boolean; reason?: string } {
  if (process.platform !== "linux") return { ok: false, reason: `the sandbox level needs Linux (bubblewrap); this is ${process.platform}. On Windows run the gateway inside WSL.` };
  try { execFileSync("bwrap", ["--version"], { stdio: "ignore" }); return { ok: true }; } catch { return { ok: false, reason: "bubblewrap (bwrap) is not installed or not on PATH" }; }
}

/** Forwards a loopback port to a Unix socket. Python is tried first (small, usually present), then Node. */
export const RELAY_PY = `import socket, sys, threading
port, path = int(sys.argv[1]), sys.argv[2]
def pump(a, b):
    try:
        while True:
            d = a.recv(65536)
            if not d: break
            b.sendall(d)
    except OSError: pass
    finally:
        for s in (a, b):
            try: s.shutdown(socket.SHUT_RDWR)
            except OSError: pass
srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", port)); srv.listen(64)
while True:
    c, _ = srv.accept()
    u = socket.socket(socket.AF_UNIX)
    try: u.connect(path)
    except OSError: c.close(); continue
    threading.Thread(target=pump, args=(c, u), daemon=True).start()
    threading.Thread(target=pump, args=(u, c), daemon=True).start()
`;
export const RELAY_JS = `const net = require("node:net");
const [port, path] = [Number(process.argv[2]), process.argv[3]];
net.createServer((c) => { const u = net.connect(path); c.pipe(u).pipe(c); const end = () => { c.destroy(); u.destroy(); }; c.on("error", end); u.on("error", end); }).listen(port, "127.0.0.1");
`;

const KEEP_ENV = ["PATH", "LANG", "LC_ALL", "TERM", "TZ"];

/** The bubblewrap argument list that runs \`command\` under the policy. */
export function bwrapArgs(p: SandboxPolicy, command: string[], parentEnv: NodeJS.ProcessEnv = process.env): string[] {
  const a: string[] = ["--die-with-parent", "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--clearenv"];
  if (!p.network) a.push("--unshare-net");
  a.push("--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--tmpfs", p.home);
  a.push(p.projectWritable ? "--bind" : "--ro-bind", p.projectDir, p.projectDir);
  if (p.memoryDir) a.push("--bind", p.memoryDir, p.memoryDir);
  a.push("--bind", p.socketDir, "/tmp/asp");
  for (const b of p.extraBinds ?? []) a.push(b.writable ? "--bind" : "--ro-bind", b.path, b.path);
  a.push("--chdir", p.projectDir);
  const env: Record<string, string> = { HOME: p.home, ...p.env };
  for (const k of KEEP_ENV) if (parentEnv[k] !== undefined && env[k] === undefined) env[k] = parentEnv[k]!;
  for (const [k, v] of Object.entries(env)) a.push("--setenv", k, v);
  // The relay runs inside the sandbox next to the agent; with the network shared it is not needed.
  const relay = p.network
    ? "exec \"$@\""
    : `if command -v python3 >/dev/null 2>&1; then python3 /tmp/asp/relay.py ${p.relayPort} /tmp/asp/gw.sock & elif command -v node >/dev/null 2>&1; then node /tmp/asp/relay.cjs ${p.relayPort} /tmp/asp/gw.sock & fi; exec "$@"`;
  a.push("--", "sh", "-c", relay, "sh", ...command);
  return a;
}
