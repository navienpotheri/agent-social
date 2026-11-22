// No test may read the real user's ~/.asp or reach a hosted service (a worker's clean-checkout run once did, with the owner's saved login). conformance/test-home.mjs is preloaded by the `test` script of every
// package; it gives each test process a fresh home and removes ASP_LOG_URL and ASP_LOG_TOKEN. This test checks the preload itself, in a child process whose caller points at a "real" home and a service,
// and checks that the package scripts use it. Fake paths and fake tokens only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const preload = join(root, "conformance", "test-home.mjs");

test("a child process with the caller's home and a service address set sees a fresh home and no service", () => {
  const fakeReal = mkdtempSync(join(tmpdir(), "fake-real-profile-"));
  const script = "import {homedir} from 'node:os'; console.log(JSON.stringify({home: homedir(), asp: process.env.ASP_HOME, url: process.env.ASP_LOG_URL ?? null, token: process.env.ASP_LOG_TOKEN ?? null, home2: process.env.HOME, up: process.env.USERPROFILE}));";
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, "--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, HOME: fakeReal, USERPROFILE: fakeReal, ASP_HOME: join(fakeReal, ".asp"), ASP_LOG_URL: "https://example.invalid", ASP_LOG_TOKEN: "fake-token-not-a-secret" },
  });
  assert.equal(r.status, 0, r.stderr);
  const seen = JSON.parse(r.stdout) as { home: string; asp: string; url: string | null; token: string | null; home2: string; up: string };
  const real = resolve(fakeReal) + sep;
  for (const p of [seen.home, seen.asp, seen.home2, seen.up]) assert.ok(!(resolve(p) + sep).startsWith(real), `${p} is not the caller's home`);
  assert.ok(resolve(seen.home).startsWith(resolve(tmpdir())), "the home is a temporary folder");
  assert.equal(seen.url, null);
  assert.equal(seen.token, null);
});

test("the check fails loudly when the home is the real profile, when ASP_HOME is outside, or when a service is named", async () => {
  process.env.ASP_TEST_HOME_NO_PRELOAD = "1"; // importing the module here must not isolate this process a second time
  const { assertIsolated } = (await import(pathToFileURL(preload).href)) as { assertIsolated: (dir: string, env?: Record<string, string | undefined>, home?: string) => void };
  const dir = mkdtempSync(join(tmpdir(), "iso-"));
  const ok = { ASP_HOME: join(dir, "home", ".asp") };
  assertIsolated(dir, ok, join(dir, "home"));
  assert.throws(() => assertIsolated(dir, ok, homedir()), /not inside/, "a real profile as the home");
  assert.throws(() => assertIsolated(dir, { ASP_HOME: join(homedir(), ".asp") }, join(dir, "home")), /ASP_HOME/);
  assert.throws(() => assertIsolated(dir, { ...ok, ASP_LOG_URL: "https://example.invalid" }, join(dir, "home")), /ASP_LOG_URL/);
  assert.throws(() => assertIsolated(dir, { ...ok, ASP_LOG_TOKEN: "x" }, join(dir, "home")), /ASP_LOG_TOKEN/);
});

test("every package's test script preloads it", () => {
  for (const p of ["asp-cli", "asp-core", "asp-log", "asp-package"]) {
    const pkg = JSON.parse(readFileSync(join(root, "packages", p, "package.json"), "utf8")) as { scripts: { test: string } };
    assert.match(pkg.scripts.test, /--import \.\.\/\.\.\/conformance\/test-home\.mjs/, `${p}`);
  }
});
