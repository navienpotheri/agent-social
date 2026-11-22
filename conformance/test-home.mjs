// A test preload (`node --import ../../conformance/test-home.mjs --test ...`, used by the `test` script of every package).
// It gives every test process a fresh, empty home before any test runs: HOME, USERPROFILE and ASP_HOME point into a new temporary folder, and ASP_LOG_URL and ASP_LOG_TOKEN are removed.
// So no test can read the real user's ~/.asp (a saved login, keys, run logs) or reach a hosted service, whatever the caller's environment is. It fails loudly (the process exits with an error)
// if the home still points anywhere but the new folder. Tests that make their own home (most do) are unaffected: they set ASP_HOME themselves.
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

/** Throws unless the home this process would use is inside `dir`, ASP_HOME is inside it, and no service address or token is set. */
export function assertIsolated(dir, env = process.env, home = homedir()) {
  const inside = (p) => !!p && (resolve(p) + sep).startsWith(resolve(dir) + sep);
  if (!inside(home)) throw new Error(`test isolation failed: the home is ${home}, not inside ${dir}: a test could read the real user's ~/.asp`);
  if (!inside(env.ASP_HOME)) throw new Error(`test isolation failed: ASP_HOME is ${env.ASP_HOME}, not inside ${dir}`);
  for (const k of ["ASP_LOG_URL", "ASP_LOG_TOKEN"]) if (env[k]) throw new Error(`test isolation failed: ${k} is set: a test could reach a hosted service`);
}

export function isolate(env = process.env) {
  const dir = mkdtempSync(join(tmpdir(), "asp-test-home-"));
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  env.HOME = home;
  env.USERPROFILE = home;
  env.ASP_HOME = join(home, ".asp");
  delete env.ASP_LOG_URL;
  delete env.ASP_LOG_TOKEN;
  env.ASP_TEST_HOME_ISOLATED = dir;
  assertIsolated(dir, env, homedir());
  return dir;
}

if (!process.env.ASP_TEST_HOME_NO_PRELOAD) {
  const dir = isolate();
  process.on("exit", () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
}
