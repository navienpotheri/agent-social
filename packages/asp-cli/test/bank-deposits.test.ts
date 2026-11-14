/**
 * `asp bank deposit | withdraw` on a real log (register row DK294; spec-delta S370): credits are locked with the Bank for 30 days and return whole; an early withdrawal is refused with the rule's reason. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BANK_DID } from "@agent-social/asp-log";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const HOLDER = "did:web:example.com:users:dp-holder";
let clockMs = Date.parse("2026-11-12T00:00:00Z");

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
const balance = async (f: Fixture, did: string) => Number(/(\d+) credit/.exec((await ok(f, ["credits", "balance", did])).out)?.[1] ?? NaN);

test("a deposit locks credits with the Bank for 30 days and returns them whole; an early withdrawal is refused", async () => {
  const f = makeFixture();
  setClock(() => new Date(clockMs));
  try {
    for (const d of [HOLDER, BANK_DID]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    await ok(f, ["credits", "grant", "--to", HOLDER, "--amount", "500"]);
    const before = await balance(f, HOLDER);
    const dep = await ok(f, ["bank", "deposit", "--holder", HOLDER, "--amount", "300"]);
    assert.match(dep.out, /300 credits locked with the Bank for 30 days/);
    const id = /^deposit (\S+):/.exec(dep.out)![1];
    assert.equal(await balance(f, HOLDER), before - 300);
    clockMs += 10 * 86_400_000;
    const early = await asp(f, ["bank", "withdraw", "--deposit", id]);
    assert.notEqual(early.code, 0);
    assert.match(early.err, /locked for 30 days/);
    clockMs += 21 * 86_400_000;
    assert.match((await ok(f, ["bank", "withdraw", "--deposit", id])).out, /returned whole/);
    assert.equal(await balance(f, HOLDER), before);
  } finally { setClock(undefined); }
});
