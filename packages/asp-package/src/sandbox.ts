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

// ---------------------------------------------------------------------------------------------------------------
// The container backend (Docker): the same promise on hosts without bubblewrap (Windows, macOS). The agent runs in a Linux
// container on an internal network, which has no route to the internet; a relay container sits on that network and on the
// default one and forwards to the gateway on the host. With a network scope granted the agent uses the default network.

/** Forwards a TCP port to another host and port (the relay container's whole job). */
export const RELAY_TCP_PY = `import socket, sys, threading
listen, host, port = int(sys.argv[1]), sys.argv[2], int(sys.argv[3])
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
srv.bind(("0.0.0.0", listen)); srv.listen(64)
while True:
    c, _ = srv.accept()
    try: u = socket.create_connection((host, port), timeout=10)
    except OSError: c.close(); continue
    threading.Thread(target=pump, args=(c, u), daemon=True).start()
    threading.Thread(target=pump, args=(u, c), daemon=True).start()
`;

export interface DockerPolicy {
  /** Short unique id for this run, used in container and network names. */
  id: string;
  /** The image the agent runs in; it must contain the agent's program. */
  image: string;
  projectDir: string;
  projectWritable: boolean;
  network: boolean;
  /** The gateway's TCP port on the host. */
  gatewayPort: number;
  relayPort: number;
  /** Where the relay script was written on the host. */
  relayScriptPath: string;
  /** Variables the agent is given. */
  env: Record<string, string>;
  extraBinds?: { path: string; writable?: boolean }[];
  /** Extra files to mount read-only, by host path and container path (for example the MCP config). */
  files?: { host: string; container: string }[];
}

export interface DockerPlan {
  /** Docker commands to run, in order, before the agent. */
  setup: string[][];
  /** The agent's own docker command (run attached, with the terminal). */
  agent: string[];
  /** Run afterwards, whatever happened. */
  cleanup: string[][];
  /** Where the agent finds the gateway. */
  agentBase: string;
}

export function dockerPlan(p: DockerPolicy): DockerPlan {
  const net = `asp-net-${p.id}`;
  const relay = `asp-relay-${p.id}`;
  const hardening = ["--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges"];
  const setup: string[][] = [];
  const cleanup: string[][] = [];
  let agentNet: string[];
  let agentBase: string;
  if (p.network) {
    agentNet = ["--add-host", "host.docker.internal:host-gateway"];
    agentBase = `http://host.docker.internal:${p.gatewayPort}`;
  } else {
    setup.push(
      ["network", "create", "--internal", net],
      ["create", "--name", relay, "--network", net, "--network-alias", "gateway", ...hardening, "--user", "65534:65534", "-v", `${p.relayScriptPath}:/relay.py:ro`, p.image, "python", "/relay.py", String(p.relayPort), "host.docker.internal", String(p.gatewayPort)],
      // The relay is the only container with a route to the host; the agent's network is internal and has none.
      ["network", "connect", "bridge", relay],
      ["start", relay],
    );
    cleanup.push(["rm", "-f", relay], ["network", "rm", net]);
    agentNet = ["--network", net];
    agentBase = `http://gateway:${p.relayPort}`;
  }
  const binds: string[] = [];
  (p.extraBinds ?? []).forEach((b, i) => binds.push("-v", `${b.path}:/bind/${i}:${b.writable ? "rw" : "ro"}`));
  for (const f of p.files ?? []) binds.push("-v", `${f.host}:${f.container}:ro`);
  const env: string[] = [];
  for (const [k, v] of Object.entries({ HOME: "/tmp", ...p.env })) env.push("-e", `${k}=${v}`);
  const agent = [
    "run", "--rm", "--init", "--name", `asp-agent-${p.id}`, ...agentNet, ...hardening, "--tmpfs", "/tmp", "--user", "65534:65534",
    "--pids-limit", "512", "--memory", "2g", "-w", "/work", "-v", `${p.projectDir}:/work:${p.projectWritable ? "rw" : "ro"}`, ...binds, ...env, p.image,
  ];
  return { setup, agent, cleanup, agentBase };
}
