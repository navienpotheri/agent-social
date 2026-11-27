// Row DK683: society velocity: credits that changed hands in the last seven days and how many each active agent moved, counted from purchases, settlements and transfers only; faucets are not counted; the supply page shows it. Fake records only.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AspRecord } from "@agent-social/asp-core";
import { velocityOf } from "../src/index.ts";
import { economySupplyRoutes } from "../../asp-package/src/economy-supply.ts";

const DAY = 86_400_000, NOW = Date.parse("2026-11-19T00:00:00Z");
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
let n = 0;
const rec = (type: string, issuer: string, daysAgo: number, body: Record<string, unknown>, id = `r${n++}`) => ({ type: `asp.${type}/v0.2`, id, issuer, actor: issuer, subject: null, issued_at: at(daysAgo), body } as unknown as AspRecord);
const agent = (did: string) => rec("passport", did, 40, { did, kind: "agent", sponsor: "did:s" });
const credit = (v: number) => ({ value: v, unit: "credit" });

test("DK683: velocity counts purchases, escrow released and transfers in the last seven days, per active agent; mints and starter claims are not counted; the week before gives the direction", () => {
  const recs: AspRecord[] = [
    agent("did:a"), agent("did:b"), agent("did:c"), rec("passport", "did:person", 40, { did: "did:person", kind: "human" }),
    rec("purchase", "did:a", 2, { amount: credit(30) }), rec("purchase", "did:a", 3, { amount: credit(20) }), rec("purchase", "did:person", 1, { amount: credit(100) }),
    rec("contract", "did:person", 6, { principal: "did:person", performer: "did:b" }, "c1"),
    rec("settlement", "did:bank", 2, { contract: "c1", basis: "accepted", escrow_released: credit(60), bond_returned: credit(0), bond_slashed: credit(0) }),
    rec("internal_transfer", "did:s", 4, { to: "did:c", amount: credit(10) }),
    rec("mint", "did:operator", 1, { to: "did:a", amount: credit(5000), reason: "x" }), rec("starter_claim", "did:a", 1, { part: "upfront", amount: credit(100) }),
    rec("purchase", "did:a", 10, { amount: credit(40) }), // last week
  ];
  const v = velocityOf(recs, NOW);
  assert.equal(v.thisWeek.moved, 30 + 20 + 100 + 60 + 10, "purchases, escrow released and the transfer; no mint, no starter claim");
  assert.equal(v.thisWeek.movements, 5);
  assert.equal(v.thisWeek.activeAgents, 3, "did:a bought, did:b performed, did:c received; the person is not an agent");
  assert.equal(v.thisWeek.perActiveAgent, Math.round((220 / 3) * 100) / 100);
  assert.equal(v.lastWeek.moved, 40);
  assert.equal(v.lastWeek.activeAgents, 1);
  assert.equal(v.direction, "up");
  assert.equal(v.agents, 3);
  assert.equal(v.activeShare, 1);
  assert.match(v.note, /not a target/);
  assert.equal(velocityOf([], NOW).thisWeek.perActiveAgent, null, "nothing moved, nothing to divide");
  assert.equal(velocityOf([], NOW).direction, "n/a");
});

test("DK683: the supply page shows the velocity in the page and in the JSON", async () => {
  const recs = [agent("did:a"), rec("purchase", "did:a", 1, { amount: credit(25) })];
  const audit = { head: { seq: 1, logHash: "sha256:" + "0".repeat(64) }, minted: 0, mintedSigned: 0, mintedUnsigned: 0, burned: 0, treasury: 0, institutions: [], accounts: 0, balances: 0, circulating: 0, locked: { escrow: 0, bond: 0, feeReserves: 0, jurorStakes: 0, reportDeposits: 0, total: 0 }, verdict: "balanced" as const, problems: [] };
  const route = economySupplyRoutes({ audit: async () => audit, velocity: async () => velocityOf(recs, NOW) });
  const call = async (q: string) => { let body = ""; const res = { writeHead() {}, end(b?: string) { body = b ?? ""; }, setHeader() {} } as never; await route({ url: "/economy/supply" + q, method: "GET", headers: {} } as never, res); return body; };
  assert.match(await call(""), /Velocity[\s\S]*25 credit\(s\) changed hands in the last 7 days[\s\S]*25 per active agent/);
  assert.equal(JSON.parse(await call("?format=json")).velocity.thisWeek.moved, 25);
});
