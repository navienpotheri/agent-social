// DK125 (RG-15): `asp registry status --sponsor <did>` shows a sponsor its agents and what each needs, from the pages the log computes. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RecordPage } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { sponsorStatus } from "../src/registry-status.ts";
import { makeFixture } from "./fixture.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-22T00:00:00Z");
const day = (n: number) => new Date(NOW + n * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
const page = (over: Partial<RecordPage> = {}): RecordPage => ({ did: "did:web:x:agents:a", names: ["a-bot"], level: "sponsored", renewal: null, suspended: null, retired: false, takedowns: [], abuse: [], ...over } as unknown as RecordPage);
const one = (p: RecordPage) => sponsorStatus([p], NOW)[0]!.actions;

test("DK125: a renewal is flagged inside 30 days and again inside 7, and not before; a lapsed identity says how to renew", () => {
  assert.deepEqual(one(page({ renewal: { due: day(31), lapsed: false } })), []);
  assert.match(one(page({ renewal: { due: day(30), lapsed: false } }))[0]!, /30-day notice/);
  assert.match(one(page({ renewal: { due: day(8), lapsed: false } }))[0]!, /30-day notice/);
  assert.match(one(page({ renewal: { due: day(7), lapsed: false } }))[0]!, /7-day notice/);
  assert.match(one(page({ renewal: { due: day(-1), lapsed: true } }))[0]!, /LAPSED.*asp registry renew --by did:web:x:agents:a/);
});

test("DK125: a suspension, a takedown that may still be appealed, an abuse report not yet ruled; a retired agent has nothing to renew; an agent with nothing wrong says nothing", () => {
  assert.match(one(page({ suspended: { until: day(3), reason: "a look-alike name", record: "r" } }))[0]!, /SUSPENDED until/);
  const td = (n: number) => ({ name: "n", reason: "x", articles: ["2"], record: "r", appealable_until: day(n) });
  assert.match(one(page({ takedowns: [td(2)] }))[0]!, /may be appealed until/);
  assert.deepEqual(one(page({ takedowns: [td(-2)] })), [], "a takedown past its appeal date is no action");
  const ab = (state?: "referred" | "ruled") => ({ id: "a", kind: "k", at: day(-1), ...(state ? { outcome: { state, case: "c" } } : {}) });
  assert.match(one(page({ abuse: [ab(), ab("referred"), ab("ruled")] as never }))[0]!, /2 abuse report\(s\) not yet ruled/);
  assert.deepEqual(one(page({ abuse: [ab("ruled")] as never })), []);
  assert.deepEqual(one(page({ retired: true, renewal: { due: day(1), lapsed: false } })), ["retired: nothing to renew"]);
  assert.deepEqual(one(page()), []);
});

test("DK125: the command lists the sponsor's agents; a sponsor with none is told so", async () => {
  const f = makeFixture();
  const asp = async (args: string[]) => {
    const out: string[] = [], err: string[] = [];
    const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root } as Io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  const SPONSOR = "did:web:example.com:users:st-sponsor", AGENT = "did:web:example.com:agents:st-agent", OTHER = "did:web:example.com:users:st-other";
  for (const d of [SPONSOR, OTHER]) assert.equal((await asp(["identity", "new", "--kind", "human", "--did", d])).code, 0);
  assert.equal((await asp(["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR, "--purpose", "work"])).code, 0);
  const r = await asp(["registry", "status", "--sponsor", SPONSOR]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, new RegExp(AGENT));
  assert.match(r.out, /level sponsored/);
  assert.match((await asp(["registry", "status", "--sponsor", SPONSOR, "--json"])).out, /"did":\s*"did:web:example.com:agents:st-agent"/);
  const none = await asp(["registry", "status", "--sponsor", OTHER]);
  assert.equal(none.code, 1);
  assert.match(none.out, /sponsors no agent/);
});
