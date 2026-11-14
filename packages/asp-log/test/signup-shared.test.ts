import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Gap O19: two service processes sharing one tokens file cannot both take the last place of the day, or one name.
test("processes signing people up at the same moment: the day's cap holds, no one is lost, no name twice", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "su-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, "[]");
  const log = pathToFileURL(fileURLToPath(new URL("../src/index.ts", import.meta.url))).href;
  const script = `import { Signup, renameSyncRetry, withFileLock } from ${JSON.stringify(log)};
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
const file = ${JSON.stringify(tokens)};
let stamp = "", cache = [];
const tenants = () => { const st = statSync(file); const k = st.mtimeMs + ":" + st.size; if (k !== stamp) { cache = JSON.parse(readFileSync(file, "utf8")); stamp = k; } return cache; };
const s = new Signup({ tenants, add: (t) => { const cur = JSON.parse(readFileSync(file, "utf8")); cur.push(t); const tmp = file + "." + process.pid + ".tmp"; writeFileSync(tmp, JSON.stringify(cur)); renameSyncRetry(tmp, file); },
  termsVersion: "t", difficulty: 0, perAddressPerDay: 100, dailyCap: 12, perGoogleAccount: 100, exclusive: (fn) => withFileLock(file, fn) });
const me = process.argv[1];
let ok = 0, full = 0, taken = 0;
for (let i = 0; i < 6; i++) {
  const r = s.registerVerified("203.0.113." + me, { name: "name-" + (i % 3) + "-" + me.slice(0, 2), accept_terms: true, terms_version: "t", declaration: "adult_or_guardian" }, { sub: "g-" + me + "-" + i, email: "x@example.org" });
  if (r.ok) ok++; else if (r.code === "SIGNUP_FULL") full++; else if (r.code === "NAME_TAKEN") taken++;
}
console.log(JSON.stringify({ ok, full, taken }));`;
  const run = (id: string) => new Promise<{ ok: number; full: number; taken: number }>((resolve, reject) => {
    const p = spawn(process.execPath, ["--input-type=module", "-e", script, id], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", (c) => (c === 0 ? resolve(JSON.parse(out.trim().split("\n").at(-1)!)) : reject(new Error(err))));
  });
  const results = await Promise.all(["aa1", "bb2", "cc3", "dd4", "ee5"].map(run));
  const made = results.reduce((n, r) => n + r.ok, 0);
  const saved = JSON.parse(readFileSync(tokens, "utf8")) as { name: string }[];
  assert.equal(saved.length, made, "every sign-up that was told yes is in the file: none lost to another process writing over it");
  assert.equal(saved.length, 12, "the day's cap of 12 held, not 12 per process");
  assert.equal(new Set(saved.map((t) => t.name)).size, saved.length, "no name twice");
  assert.equal(results.reduce((n, r) => n + r.full, 0) > 0, true, "the rest were turned away");
});

test("a sign-up turned away because the day is full is counted, with no one's details", async () => {
  const { Signup } = await import("../src/signup.ts");
  const tenants: unknown[] = [];
  let turned = 0;
  const su = new Signup({ tenants: () => tenants as never, add: (t) => { tenants.push(t); }, termsVersion: "t", difficulty: 0, dailyCap: 1, perGoogleAccount: 10, onTurnedAway: () => { turned++; } });
  const body = (name: string) => ({ name, accept_terms: true, terms_version: "t", declaration: "adult_or_guardian" });
  assert.equal(su.registerVerified("203.0.113.1", body("first-one"), { sub: "g1", email: "a@example.org" }).ok, true);
  const second = su.registerVerified("203.0.113.2", body("second-one"), { sub: "g2", email: "b@example.org" });
  assert.equal(second.ok, false);
  assert.equal(turned, 1);
});
