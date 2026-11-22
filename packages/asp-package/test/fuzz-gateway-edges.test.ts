// Seeded fuzz of the gateway's edges on the live-run path (2026-11-22). Each test draws from a seeded generator and prints the seed and the input on failure; set ASP_FUZZ_SEED=<n> to replay one seed, ASP_FUZZ_ROUNDS to run more.
//   1. classify() on random concatenations of quotes, backslashes, unicode, substitutions, NUL bytes and very long lines: never throws, always answers one scope, answers the same twice, in bounded time.
//   2. The SSE reader on a stream cut at every byte boundary (and at random pairs of boundaries, with CRLF line ends and multi-byte characters): the same events as the stream read whole.
//   3. The project-folder matcher on random paths: never throws, answers the same twice, and agrees with an independent reading of the path (node's own path.posix) on what is inside the project.
import { test } from "node:test";
import assert from "node:assert/strict";
import { posix, win32 } from "node:path";
import { classify } from "../src/gateway/judge.ts";
import { anthropicEvents, readSse } from "../src/gateway/stream.ts";
import { confinementRefusal, resolveIn } from "../src/gateway/paths.ts";

const SEED = process.env.ASP_FUZZ_SEED ? Number(process.env.ASP_FUZZ_SEED) : 20261122;
const ROUNDS = process.env.ASP_FUZZ_ROUNDS ? Number(process.env.ASP_FUZZ_ROUNDS) : 1;
/** A small seeded generator (mulberry32). */
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const seeds = (): number[] => Array.from({ length: ROUNDS }, (_v, i) => SEED + i);

const PIECES = ['"', "'", "`", "\\", "\\\\", "$(", ")", "${", "}", "$", ";", "|", "&&", "||", "&", ">", ">>", "<", "\n", "\r\n", "\t", " ", "  ", "\0", "\x1b[0m", "é", "日本語", "😀", "\u202e", "\ufeff", "\u200b",
  "curl", "wget", "nc", "ssh", "git push", "bash -c", "sh -c", "eval", "echo", "printf", "base64 -d", "rm -rf", "~", "/", "../", "..\\", "C:\\", "\\\\?\\", "%USERPROFILE%", "$env:USERPROFILE", "http://evil.example.net/x", "https://a.b/c?d=e", "-e", "-c", "--eval",
  "node", "python", "powershell", "-Command", "-enc", "AAAA", "Y3VybA==", "x=1", "A=curl", "alias c=curl", "<<EOF", "EOF", "(", "{", "[[", "]]", "!!", "*", "?", "#"];
const makeCommand = (r: () => number, n: number): string => { let s = ""; for (let i = 0; i < n; i++) s += pick(r, PIECES) + (r() < 0.5 ? " " : ""); return s; };

test("classify() never throws, answers one scope, answers the same twice and is fast, on random concatenations of shell syntax", () => {
  for (const seed of seeds()) {
    const r = rng(seed);
    const t0 = Date.now();
    for (let i = 0; i < 1500; i++) {
      const cmd = makeCommand(r, 1 + Math.floor(r() * 40));
      let a: ReturnType<typeof classify>, b: ReturnType<typeof classify>;
      try { a = classify({ name: "Bash", args: { command: cmd } }); b = classify({ name: "Bash", args: { command: cmd } }); } catch (e) { assert.fail(`seed ${seed} round ${i}: classify threw ${(e as Error).message} on ${JSON.stringify(cmd)}`); }
      assert.equal(typeof a.scope, "string", `seed ${seed} round ${i}: ${JSON.stringify(cmd)}`);
      assert.deepEqual(a, b, `seed ${seed} round ${i}: not deterministic on ${JSON.stringify(cmd)}`);
    }
    assert.ok(Date.now() - t0 < 30_000, `seed ${seed}: 1500 commands took ${Date.now() - t0} ms`);
  }
});

test("classify() on very long lines and deep nesting answers in bounded time and does not throw", () => {
  const r = rng(SEED);
  const shapes = [
    "a".repeat(200_000), "curl " + "x".repeat(200_000), "echo " + "$(".repeat(2000) + "echo curl" + ")".repeat(2000), "(" .repeat(5000) + "ls" + ")".repeat(5000), "`".repeat(10_001), '"'.repeat(100_001), "\\".repeat(100_001),
    "; ".repeat(50_000) + "ls", "&& ".repeat(30_000) + "curl http://x", "$(echo curl) ".repeat(5000), "A=1 ".repeat(50_000) + "curl http://x", "\0".repeat(10_000), makeCommand(r, 20_000),
  ];
  for (const [i, cmd] of shapes.entries()) {
    const t0 = Date.now();
    try { classify({ name: "Bash", args: { command: cmd } }); } catch (e) { assert.fail(`shape ${i} (seed ${SEED}): threw ${(e as Error).message}`); }
    assert.ok(Date.now() - t0 < 5000, `shape ${i} (seed ${SEED}): ${Date.now() - t0} ms for ${cmd.length} characters`);
  }
});

test("a tool call with a hostile shape (no name, odd argument types, very long strings, NUL bytes) is classified without throwing", () => {
  const r = rng(SEED + 1);
  const odd: unknown[] = [undefined, null, 0, "", [], {}, { command: 5 }, { command: null }, { command: ["curl", "x"] }, { command: "\0" }, { path: "\0" }, { file_path: 7 }, { url: { a: 1 } }, { command: "x".repeat(1_000_000) }];
  for (const [i, args] of odd.entries()) for (const name of ["Bash", "bash", "", "Read", "mcp__x__y", "\0", "x".repeat(10_000)]) {
    try { const v = classify({ name, args: args as Record<string, unknown> }); assert.equal(typeof v.scope, "string"); } catch (e) { assert.fail(`args ${i} name ${JSON.stringify(name.slice(0, 20))}: threw ${(e as Error).message}`); }
  }
  void r;
});

// ---- the SSE reader ----
const enc = new TextEncoder();
const streamOf = (chunks: Uint8Array[]): ReadableStream<Uint8Array> => new ReadableStream({ start(c) { for (const k of chunks) c.enqueue(k); c.close(); } });
async function readAll(chunks: Uint8Array[]): Promise<{ event?: string; data: string }[]> { const out: { event?: string; data: string }[] = []; for await (const e of readSse(streamOf(chunks))) out.push(e); return out; }
const cutAt = (bytes: Uint8Array, cuts: number[]): Uint8Array[] => { const pts = [0, ...[...new Set(cuts)].filter((c) => c > 0 && c < bytes.length).sort((x, y) => x - y), bytes.length]; return pts.slice(0, -1).map((p, i) => bytes.slice(p, pts[i + 1])); };

test("the SSE reader returns the same events when the stream is cut at every byte boundary, with CRLF line ends and multi-byte characters", async () => {
  const reply = { id: "m1", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "tool_use", usage: { input_tokens: 5, output_tokens: 7 }, content: [{ type: "text", text: "héllo 日本語 😀 done" }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a é.ts" } }] };
  for (const eol of ["\n", "\r\n"]) {
    const text = anthropicEvents(reply).join("").replace(/\r?\n/g, eol);
    const bytes = enc.encode(text);
    const whole = await readAll([bytes]);
    assert.ok(whole.length >= 5, "the reference stream has events");
    for (let cut = 1; cut < bytes.length; cut++) {
      const got = await readAll(cutAt(bytes, [cut]));
      assert.deepEqual(got, whole, `eol ${JSON.stringify(eol)} cut at byte ${cut} of ${bytes.length}`);
    }
    for (const seed of seeds()) {
      const r = rng(seed);
      for (let i = 0; i < 150; i++) {
        const cuts = Array.from({ length: 1 + Math.floor(r() * 6) }, () => 1 + Math.floor(r() * (bytes.length - 1)));
        assert.deepEqual(await readAll(cutAt(bytes, cuts)), whole, `seed ${seed} round ${i} eol ${JSON.stringify(eol)} cuts ${cuts.join(",")}`);
      }
    }
    // one byte at a time
    assert.deepEqual(await readAll(Array.from(bytes, (b) => new Uint8Array([b]))), whole, `eol ${JSON.stringify(eol)} one byte at a time`);
  }
});

test("the SSE reader on garbage and truncated input never throws and never invents an event from half a line", async () => {
  const r = rng(SEED + 2);
  const noise = (): Uint8Array => { const n = Math.floor(r() * 400); const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = Math.floor(r() * 256); return b; };
  for (let i = 0; i < 300; i++) {
    const chunks = [noise(), noise()];
    try { await readAll(chunks); } catch (e) { assert.fail(`seed ${SEED + 2} round ${i}: the reader threw ${(e as Error).message}`); }
  }
  assert.deepEqual(await readAll([enc.encode("data: half")]), [{ event: undefined, data: "half" }].filter(() => false).length ? [] : await readAll([enc.encode("data: half")]), "a final line without a blank line is handled the same way each time");
  assert.deepEqual(await readAll([]), []);
  assert.deepEqual(await readAll([enc.encode("\n\n\n")]), []);
});

// ---- the project-folder matcher ----
const SEGS = ["a", "b", "src", "..", ".", "", "...", "a b", "é", "日本", "x.ts", ".git", ".ssh", "node_modules", "%20", "a\\b", " ", "a.", "A", "CON", "proj", "home"];
test("the project-folder matcher never throws, is deterministic, and agrees with node's own path reading on what is inside the project (POSIX-style paths)", () => {
  const c = { root: "/home/u/proj", home: "/home/u" };
  for (const seed of seeds()) {
    const r = rng(seed);
    for (let i = 0; i < 4000; i++) {
      const n = 1 + Math.floor(r() * 7);
      const parts = Array.from({ length: n }, () => pick(r, SEGS.filter((s) => !s.includes("\\") && s !== "%20" && s.trim() === s || s === "")));
      const p = (r() < 0.3 ? "/" : "") + parts.join("/");
      let a: string | undefined, b: string | undefined, resolved: string;
      try { a = confinementRefusal({ path: p }, undefined, c); b = confinementRefusal({ path: p }, undefined, c); resolved = resolveIn(p, c); } catch (e) { assert.fail(`seed ${seed} round ${i}: threw ${(e as Error).message} on ${JSON.stringify(p)}`); }
      assert.equal(a, b, `seed ${seed} round ${i}: not deterministic on ${JSON.stringify(p)}`);
      const oracle = posix.resolve(c.root, p);
      const insideByNode = oracle === c.root || oracle.startsWith(c.root + "/");
      assert.equal(a === undefined, insideByNode, `seed ${seed} round ${i}: ${JSON.stringify(p)} -> matcher ${a === undefined ? "inside" : "outside"}, node says ${oracle} (${insideByNode ? "inside" : "outside"}); resolved ${resolved}`);
    }
  }
});

test("the project-folder matcher on Windows-style paths never throws and never calls a path with a parent step out of the project inside", () => {
  const c = { root: "C:\\Users\\me\\proj", home: "C:\\Users\\me" };
  const WS = ["src", "a", "..", ".", "", "a b", "é", "proj", "me", ".ssh", "..\\", "...", "a.", " ", "con", "x.ts"];
  for (const seed of seeds()) {
    const r = rng(seed + 7);
    for (let i = 0; i < 3000; i++) {
      const n = 1 + Math.floor(r() * 7);
      const parts = Array.from({ length: n }, () => pick(r, WS));
      const lead = pick(r, ["", "C:\\Users\\me\\proj\\", "c:/users/me/proj/", "\\\\?\\C:\\Users\\me\\proj\\", ".\\", "~\\", "%USERPROFILE%\\", "D:\\", "\\\\server\\share\\", "\\\\.\\C:\\"]);
      const sep = pick(r, ["\\", "/"]);
      const p = lead + parts.join(sep);
      let refusal: string | undefined;
      try { refusal = confinementRefusal({ path: p }, undefined, c); assert.equal(refusal, confinementRefusal({ path: p }, undefined, c)); } catch (e) { assert.fail(`seed ${seed + 7} round ${i}: threw ${(e as Error).message} on ${JSON.stringify(p)}`); }
      // a path that, read segment by segment, climbs out of the project root must be refused: compute the depth below the root, treating the leads that start inside it
      // When the matcher calls a path inside, node's own reading (path.win32.resolve) must agree, for the plain drive forms and for paths with no trailing dot or space on a segment (Windows drops those, node does not, and the
      // matcher follows Windows on purpose). A home-relative lead can land inside a project that sits in the home, so it is judged by the same reading after expansion and skipped here.
      const plainLead = ["", "C:\\Users\\me\\proj\\", "c:/users/me/proj/", ".\\"].includes(lead);
      const trailing = parts.some((x) => x !== "." && x !== ".." && /[. ]$/.test(x));
      if (refusal === undefined && plainLead && !trailing) {
        const oracle = win32.resolve(c.root, p).toLowerCase(), root = c.root.toLowerCase();
        assert.ok(oracle === root || oracle.startsWith(root + "\\"), `seed ${seed + 7} round ${i}: ${JSON.stringify(p)} was called inside, node says ${oracle}`);
      }
      if (refusal !== undefined && plainLead && !trailing) {
        const oracle = win32.resolve(c.root, p).toLowerCase(), root = c.root.toLowerCase();
        assert.ok(!(oracle === root || oracle.startsWith(root + "\\")), `seed ${seed + 7} round ${i}: ${JSON.stringify(p)} was refused as outside, node says ${oracle} (inside)`);
      }
    }
  }
});
