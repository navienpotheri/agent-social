// asp watch --circumvention (register row DK92): the flag, its help and its limits. The detector itself is tested in packages/asp-package/test/circumvention.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";

async function asp(home: string, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home }, cwd: home };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("asp watch --circumvention on a log with no actions finds nothing and exits 0; a threshold below 2 is a usage error", async () => {
  const home = mkdtempSync(join(tmpdir(), "asp-circ-"));
  const r = await asp(home, ["watch", "--circumvention"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /watched 0 action\(s\) .* retried or gone around/);
  assert.match(r.out, /no circumvention pattern found/);
  const bad = await asp(home, ["watch", "--circumvention", "--min-retries", "1"]);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /--min-retries must be a whole number, 2 or more/);
});
