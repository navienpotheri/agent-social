// Live check 01: install and the first minutes on a clean machine (rows T1, T2, U16; docs/live-check-cli.md). Run it in a fresh clone on a Mac, on a clean Linux machine and on Windows; on each it proves the
// install, that `asp` alone shows where to start, and the first-minutes failure modes that can be scripted (a folder that is not a git repository, a path with spaces, a folder with many files); the two that need a person
// (Ctrl-C in the middle of a session, the laptop going to sleep) are steps for you.
//
//   git clone https://github.com/navienpotheri/agent-social && cd agent-social && npm install
//   node scripts/live/01-clean-machine.mjs [--yes]
//
// It uses a temporary ASP_HOME, so it touches nothing of yours. Credits are accounting entries, not money. No model agent is used.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { args, session } from "./lib.mjs";

const a = args();
const s = session("clean-machine", { yes: !!a.yes });
const bin = fileURLToPath(new URL("../../packages/asp-cli/bin/asp.mjs", import.meta.url));
const home = mkdtempSync(join(tmpdir(), "asp live home "));       // with spaces on purpose
const asp = (argv, o = {}) => s.run(process.execPath, [bin, ...argv], { env: { ...process.env, ASP_HOME: home, NO_COLOR: "1" }, ...o });

s.title(`Clean machine: ${process.platform} ${process.arch}, node ${process.version}`);
const [major, minor] = process.versions.node.split(".").map(Number);
await s.check("node is 22.18 or newer (the TypeScript runs directly, there is no build step)", async () => major > 22 || (major === 22 && minor >= 18) ? true : `this is ${process.version}: asp should say so plainly, see the next check`);
await s.check("the node-version guard of the bin says what to do on an old node (it ran, or it refused in words)", async () => { const r = await asp(["--version"]); return r.code === 0 || /node/i.test(r.out + r.err) ? true : `exit ${r.code}: ${r.err.slice(0, 200)}`; });
const home1 = await asp([]);
await s.check("`asp` alone shows a short home with the commands to start (U16: not the source file's comments)", async () => home1.code === 0 && /asp join/.test(home1.out) && !/#!\/usr\/bin\/env/.test(home1.out) ? true : `exit ${home1.code}: ${(home1.out + home1.err).slice(0, 300)}`);
await s.check("`asp help` and `asp help all` print", async () => { const h = await asp(["help"]); const all = await asp(["help", "all"]); return h.code === 0 && all.code === 0 && all.out.length > 5000 ? true : `help ${h.code}, help all ${all.code} (${all.out.length} chars)`; });
await s.check("`asp status` and `asp runs` work with nothing set up (a plain message, no stack trace)", async () => { const st = await asp(["status"]); const r = await asp(["runs"]); return !/at .*\.ts:\d+/.test(st.err + r.err) && st.code < 2 && r.code < 2 ? true : `${st.err.slice(0, 200)} ${r.err.slice(0, 200)}`; });
await s.check("an unknown command says what to type instead of crashing", async () => { const r = await asp(["frobnicate"]); return r.code !== 0 && !/at .*\.ts:\d+/.test(r.err) && r.err.length > 10 ? true : r.err.slice(0, 200); });

s.title("The first minutes that can be scripted (T2)");
const dir = mkdtempSync(join(tmpdir(), "asp project "));   // not a git repository, and with spaces in the path
writeFileSync(join(dir, "README.md"), "# a project that is not under git\n");
await s.check("an identity can be made from a folder that is not a git repository and has spaces in its path", async () => { const r = await asp(["identity", "new", "--kind", "human", "--did", "did:web:example.com:users:live-check"], { cwd: dir }); return r.code === 0 ? true : `exit ${r.code}: ${r.err.slice(0, 200)}`; });
const big = mkdtempSync(join(tmpdir(), "asp big "));
for (let d = 0; d < 20; d++) { mkdirSync(join(big, `d${d}`)); for (let f = 0; f < 100; f++) writeFileSync(join(big, `d${d}`, `f${f}.txt`), "x".repeat(200)); }
await s.check("a folder with 2,000 files does not make `asp init` or `asp status` hang (under 30 seconds)", async () => { const t0 = Date.now(); const r = await asp(["init"], { cwd: big }); const st = await asp(["status"], { cwd: big }); return Date.now() - t0 < 30_000 && r.code < 2 && st.code < 2 ? true : `${Math.round((Date.now() - t0) / 1000)} s, init ${r.code}, status ${st.code}`; });

await s.human("Ctrl-C in the middle of a session (T2).", ["Start a session that waits, for example:  node " + bin + " gateway --help   is not enough: use docs/live-check-cli.md script 03 and press Ctrl-C while it waits for the stand-in agent.", "Afterwards run:  node " + bin + " run-log show   on the newest run folder: it says how the run ended (interrupted), `asp run-log verify` passes, and nothing is left half written."]);
await s.human("The laptop goes to sleep in the middle of a session (T2; the one a script cannot do).", ["Start script 03 with a slow stand-in:  node scripts/live/03-gateway-stand-in.mjs --slow 120", "Close the lid for a minute, open it, let it finish.", "It must finish or fail in words (the call that was in flight is retried or refused), and `asp run-log verify` passes on its log."]);
if (process.platform === "darwin") await s.human("macOS only: an older node.", ["If you have an older node (for example 20) available: run `node bin/asp.mjs` with it.", "It must print what to do (install node 22.18 or newer), not a stack trace."]);
process.exit(s.done());
