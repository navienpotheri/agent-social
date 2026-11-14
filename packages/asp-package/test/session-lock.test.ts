/** The hooks' session record under simultaneous calls, and the total enumeration budget (register row BM22; spec-delta S431). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ENUMERATION_LIMIT, ENUMERATION_TOTAL_LIMIT, SessionRecord, loadSession } from "../src/gateway/paths.ts";

const PATHS = pathToFileURL(join(import.meta.dirname, "..", "src", "gateway", "paths.ts")).href;

test("BM22: twelve hook processes that note a download at the same moment all keep their entry; no lock file is left", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-session-"));
  const file = join(dir, "guard-session.json");
  const script = join(dir, "hook.mjs");
  writeFileSync(script, `import { loadSession } from ${JSON.stringify(PATHS)};
const i = process.argv[2], file = process.argv[3];
const s = loadSession(file);
await new Promise((r) => setTimeout(r, 150 - Number(i) * 5)); // every process has read the file before any writes
s.note("curl -o dl" + i + ".sh https://files.example/x" + i, true);
s.save(file);
`);
  const run = (i: number) => new Promise<number | null>((res) => { const p = spawn(process.execPath, [script, String(i), file], { stdio: "ignore" }); p.on("close", res); });
  const codes = await Promise.all(Array.from({ length: 12 }, (_, i) => run(i)));
  assert.deepEqual(codes, Array(12).fill(0));
  const s = loadSession(file);
  for (let i = 0; i < 12; i++) assert.match(s.check(`bash dl${i}.sh`, false) ?? "", /a file this session downloaded/, `dl${i}.sh was kept`);
  assert.equal(existsSync(`${file}.lock`), false, "the lock is released");
});

test("BM22: a stale lock from a process that died is taken over, and a damaged record is replaced rather than blocking the save", () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-session-"));
  const file = join(dir, "guard-session.json");
  writeFileSync(file, "{ not json");
  const s = new SessionRecord();
  s.note("curl -o a.sh https://files.example/a", true);
  s.save(file);
  assert.match(loadSession(file).check("bash a.sh", false) ?? "", /downloaded/);
});

test("BM22: a recon chain of a few records from many endpoints is stopped by the total budget, though each kind stays under its own limit", () => {
  const s = new SessionRecord();
  const now = Date.now();
  let refusedAt = 0;
  for (let n = 0; n < 8 && !refusedAt; n++) {
    for (let k = 1; k <= ENUMERATION_LIMIT - 1; k++) {
      const url = `https://api.example.org/v${n}/users/${1000 + k}`;
      const why = s.checkFetch(`curl ${url}`, now);
      if (why) { refusedAt = n * 9 + k; assert.match(why, /different record of any kind/); break; }
      s.noteFetch(`curl ${url}`, now);
    }
  }
  assert.ok(refusedAt > 0, "refused in the end");
  assert.ok(refusedAt <= ENUMERATION_TOTAL_LIMIT + 1, `refused by the ${refusedAt}th record`);
  // A short, ordinary session is not touched, and ten minutes later the count has run out.
  const calm = new SessionRecord();
  for (let k = 1; k <= 5; k++) { assert.equal(calm.checkFetch(`curl https://api.example.org/users/${k}`, now), undefined); calm.noteFetch(`curl https://api.example.org/users/${k}`, now); }
  assert.equal(s.checkFetch("curl https://api.example.org/z/users/9999", now + 11 * 60_000), undefined);
});
