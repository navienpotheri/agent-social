// Row US8 (mutation check, launch-bar-2, 2026-11-22): `asp my-data --json` says whether the recorded acknowledgement is of the CURRENT statement (true) or of an earlier one (false), and the line that records it
// shows the first twelve characters of the hash and no fewer. The older tests read only the text form and a short hash prefix went unnoticed. Fake home; no service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

async function run(f: ReturnType<typeof makeFixture>, args: string[]) {
  const out: string[] = []; const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  return { code: await main(args, io), out: out.join("\n"), err: err.join("\n") };
}

test("the JSON form says that the acknowledgement is current, then not current once the statement has changed", async () => {
  const f = makeFixture();
  assert.equal(JSON.parse((await run(f, ["my-data", "--json"])).out).acknowledged, null, "nothing acknowledged yet");
  const ack = await run(f, ["my-data", "--acknowledge"]);
  assert.equal(ack.code, 0, ack.err);
  const sha = JSON.parse((await run(f, ["my-data", "--json"])).out).statement_sha256 as string;
  assert.ok(ack.out.includes(`sha256 ${sha.slice(0, 12)}...)`), "twelve characters of the hash, then the ellipsis");
  assert.equal(JSON.parse((await run(f, ["my-data", "--json"])).out).acknowledged.current, true);
  const file = join(f.aspHome, "data-consent.json");
  const rec = JSON.parse(readFileSync(file, "utf8")) as { statement_sha256: string };
  writeFileSync(file, JSON.stringify({ ...rec, statement_sha256: "0".repeat(64) }));
  assert.equal(JSON.parse((await run(f, ["my-data", "--json"])).out).acknowledged.current, false, "an earlier statement is not the current one");
});
