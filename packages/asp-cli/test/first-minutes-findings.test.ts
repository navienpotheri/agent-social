// Findings of the stranger's first-15-minutes walk (docs/first-15-minutes.md): `asp <command> --help` is help for that command and not the whole reference; the full reference stays at `asp --help`; the wording of a
// session's first line does not read as a system-level network block.
import { test } from "node:test";
import assert from "node:assert/strict";
import { main, type Io } from "../src/cli.ts";

async function asp(args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: "C:/nonexistent-asp-home-for-help" }, cwd: process.cwd() };
  return { code: await main(args, io), out: out.join("\n"), err: err.join("\n") };
}

test("asp join --help is help for join, short; asp --help is still the whole reference", async () => {
  const j = await asp(["join", "--help"]);
  assert.equal(j.code, 0);
  assert.match(j.out, /asp join/);
  assert.ok(j.out.split("\n").length < 40, `${j.out.split("\n").length} lines: help for one command, not the reference`);
  const all = await asp(["--help"]);
  assert.ok(all.out.split("\n").length > 200, "the full reference");
});

test("the guide says the gateway refuses calls that reach the network, not that the session has no network", async () => {
  const g = await asp(["help", "start"]);
  const text = g.out + (await asp(["join", "--help"])).out;
  assert.doesNotMatch(text, /has no network unless/);
  assert.match(text, /the gateway refuses calls that reach the network unless you name hosts/);
});
