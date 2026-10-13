import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../bin/asp.mjs", import.meta.url));

// Found in the owner's walkthrough: `asp account show | head -1` died with a raw "EPIPE: broken pipe" stack trace, because head closed the pipe after one line.
test("a reader that stops early (head, a pager that is quit) ends asp quietly: no stack trace, exit 0", async () => {
  const child = spawn(process.execPath, ["--experimental-strip-types", bin, "help", "all"], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  // Read one chunk, then close the pipe, as `head -1` does.
  await new Promise<void>((resolve) => child.stdout.once("data", () => { child.stdout.destroy(); resolve(); }));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  assert.doesNotMatch(stderr, /EPIPE|Unhandled 'error' event|at .*node:internal/, stderr);
  assert.equal(code, 0, stderr);
});
