// Row ENG120: a value that starts with a dash after a value-taking option (a base64url token does so about one time in 64) is that option's value. Tested for --token and for every other option that takes a value and has
// "token" in its name, and as a property of every string option; a following known option is still an option.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { OPTIONS, joinDashValues } from "../src/cli.ts";

const opts = OPTIONS as unknown as Record<string, { type: string }>;
const strings = Object.entries(opts).filter(([, v]) => v.type === "string").map(([k]) => k);

test("a token that starts with a dash is the value of --token and of every option with token in its name", () => {
  const tokenish = strings.filter((k) => /token/.test(k));
  assert.ok(tokenish.includes("token"), "--token takes a value");
  for (const k of tokenish) for (const v of ["-abc_DEF-123", "-_xyz", "--abc", "-9"]) {
    const argv = ["join", `--${k}`, v, "--agents", "3"];
    const p = parseArgs({ args: joinDashValues(argv), options: OPTIONS as never, allowPositionals: true });
    const got = (p.values as Record<string, unknown>)[k];
    assert.equal(Array.isArray(got) ? got[0] : got, v, `--${k} ${v}`);
    assert.equal((p.values as Record<string, unknown>)["agents"], "3");
  }
});

test("every option that takes a value accepts a value that starts with a dash", () => {
  for (const k of strings) {
    const p = parseArgs({ args: joinDashValues([`--${k}`, "-x1_y"]), options: OPTIONS as never, allowPositionals: true });
    const got = (p.values as Record<string, unknown>)[k];
    assert.equal(Array.isArray(got) ? got[0] : got, "-x1_y", `--${k}`);
  }
});

test("a following known option is still an option, a plain value and a single dash are unchanged, and a boolean option does not take a value", () => {
  assert.deepEqual(joinDashValues(["--token", "--agents", "3"]), ["--token", "--agents", "3"]);
  assert.deepEqual(joinDashValues(["--token", "--agents=3"]), ["--token", "--agents=3"]);
  assert.deepEqual(joinDashValues(["--token", "abc"]), ["--token", "abc"]);
  assert.deepEqual(joinDashValues(["--token", "-"]), ["--token", "-"]);
  assert.deepEqual(joinDashValues(["--token", "-abc"]), ["--token=-abc"]);
  const bool = Object.entries(opts).find(([, v]) => v.type === "boolean")![0];
  assert.deepEqual(joinDashValues([`--${bool}`, "-abc"]), [`--${bool}`, "-abc"]);
});
