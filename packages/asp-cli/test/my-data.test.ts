// Row US8: `asp my-data` states a person's data in the city in plain words from the same generated category list as the Privacy Notice, points to the existing list and delete commands (no second
// mechanism), and records on the person's machine that they read it (the date and the hash of the statement), noticing when the statement later changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { disclosureMarkdown, SIGNALS, DISCLOSURE } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

async function run(f: ReturnType<typeof makeFixture>, args: string[]) {
  const out: string[] = []; const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  return { code: await main(args, io), out: out.join("\n"), err: err.join("\n") };
}

test("the statement names what stays here, what the city keeps, every collected category, the use, and the list and delete commands", async () => {
  const f = makeFixture();
  const r = await run(f, ["my-data"]);
  assert.equal(r.code, 0, r.err);
  for (const re of [/What stays on this machine/, /What the city keeps in the signed log/, /always on for an open or personal agent and not a choice/, /It is never public/, /No model weights are trained/, /asp telemetry list/, /asp telemetry delete --all/, /asp account data-sharing/, /nothing/i]) assert.match(r.out, re);
  for (const s of SIGNALS) assert.ok(r.out.includes(DISCLOSURE[s].category), `${s} is named`);
  assert.ok(disclosureMarkdown().includes("Reasoning traces"), "the same list as the Privacy Notice");
  assert.match(r.out, /Run asp my-data --acknowledge/);
});

test("--acknowledge records the date and the hash of the statement on this machine; a changed statement is noticed", async () => {
  const f = makeFixture();
  assert.equal(existsSync(join(f.aspHome, "data-consent.json")), false);
  const ack = await run(f, ["my-data", "--agent", "did:web:example.com:agents:coder", "--acknowledge"]);
  assert.equal(ack.code, 0, ack.err);
  assert.match(ack.out, /Recorded on this machine: you read this statement on /);
  const rec = JSON.parse(readFileSync(join(f.aspHome, "data-consent.json"), "utf8"));
  assert.match(rec.statement_sha256, /^[0-9a-f]{64}$/);
  assert.equal(rec.agent, "did:web:example.com:agents:coder");
  const again = await run(f, ["my-data", "--agent", "did:web:example.com:agents:coder"]);
  assert.match(again.out, /You acknowledged this statement on /);
  writeFileSync(join(f.aspHome, "data-consent.json"), JSON.stringify({ ...rec, statement_sha256: "0".repeat(64) }));
  assert.match((await run(f, ["my-data", "--agent", "did:web:example.com:agents:coder"])).out, /the statement has changed since/);
  const json = JSON.parse((await run(f, ["my-data", "--json"])).out);
  assert.ok(Array.isArray(json.statement) && json.statement_sha256);
});

test("--acknowledge --by signs the acknowledgement into the log as a notice_ack record, readable as the latest for the issuer", async () => {
  const { openLog } = await import("@agent-social/asp-package");
  const f = makeFixture();
  const owner = "did:web:example.com:users:reader";
  assert.equal((await run(f, ["identity", "new", "--kind", "human", "--did", owner])).code, 0);
  const r = await run(f, ["my-data", "--acknowledge", "--by", owner]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Signed into the log as the record /);
  const json = JSON.parse((await run(f, ["my-data", "--json"])).out);
  const handle = await openLog(f.aspHome, {});
  const latest = await (handle.log as unknown as { noticeAck: (issuer: string, notice: string) => Promise<{ statement_sha256: string } | undefined> }).noticeAck(owner, "asp.my-data/v1");
  assert.equal(latest?.statement_sha256, JSON.parse(readFileSync(join(f.aspHome, "data-consent.json"), "utf8")).statement_sha256);
  assert.ok(json.statement_sha256);
  // Without an identity it says that it is not signed into the log.
  assert.match((await run(f, ["my-data", "--acknowledge"])).out, /Not signed into the log: name your identity with --by/);
  // A key that is not here cannot sign.
  assert.notEqual((await run(f, ["my-data", "--acknowledge", "--by", "did:web:example.com:users:nobody"])).code, 0);
});
