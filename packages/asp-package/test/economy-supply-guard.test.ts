import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { economySupplyRoutes } from "../src/economy-supply.ts";

// The public supply page shows the guard measures (DK1, credits.md 5.6) next to the supply figures; they are read at request time, and a triggered one says what the action is and that it is the operator's decision.
const AUDIT = {
  head: { seq: 7, logHash: "c".repeat(64) }, minted: 1000, mintedSigned: 1000, mintedUnsigned: 0, burned: 40, treasury: 60,
  institutions: [], accounts: 5, balances: 940, circulating: 760,
  locked: { escrow: 60, bond: 0, feeReserves: 0, jurorStakes: 0, reportDeposits: 0, total: 60 }, verdict: "balanced" as const, problems: [],
};
const GUARD = (triggered: boolean) => ({
  at: "2026-11-12T00:00:00Z", anyTriggered: triggered,
  measures: [{ id: "G5", label: "hoarding: share held by the top 1 %", value: triggered ? 0.62 : 0.1, threshold: "above 0.50", triggered, action: "publish, and review the tax rate" }],
  unavailable: [{ id: "G7", label: "dormancy", reason: "upkeep does not exist yet" }],
});

async function serve<T>(guard: (() => Promise<any>) | undefined, fn: (url: string) => Promise<T>): Promise<T> {
  const route = economySupplyRoutes({ audit: async () => AUDIT, ...(guard ? { guard } : {}) });
  const server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { return await fn(`http://127.0.0.1:${(server.address() as { port: number }).port}`); } finally { server.close(); }
}

test("the supply page lists the guard measures, marks a triggered one and names the action, and lists the measures it cannot compute", async () => {
  await serve(async () => GUARD(true), async (url) => {
    const body = await (await fetch(`${url}/economy/supply?format=json`)).json() as any;
    assert.equal(body.guard.anyTriggered, true);
    assert.equal(body.guard.measures[0].id, "G5");
    const html = await (await fetch(`${url}/economy/supply`)).text();
    assert.match(html, /Guard measures/);
    assert.match(html, /A measure is over its threshold; the action named is the operator&#39;s decision|A measure is over its threshold; the action named is the operator's decision/);
    assert.match(html, /G5/);
    assert.match(html, /Action: publish, and review the tax rate/);
    assert.match(html, /not available: dormancy: upkeep does not exist yet/);
  });
  await serve(async () => GUARD(false), async (url) => {
    const html = await (await fetch(`${url}/economy/supply`)).text();
    assert.match(html, /No measure is over its threshold/);
    assert.doesNotMatch(html, /Action: publish/);
  });
});

test("without a guard the page is as before: no guard section", async () => {
  await serve(undefined, async (url) => {
    assert.doesNotMatch(await (await fetch(`${url}/economy/supply`)).text(), /Guard measures/);
    assert.equal(((await (await fetch(`${url}/economy/supply?format=json`)).json()) as any).guard, undefined);
  });
});

test("a failing guard read is a plain server error, not a page that hides it", async () => {
  await serve(async () => { throw new Error("the ledger could not be read"); }, async (url) => {
    const res = await fetch(`${url}/economy/supply`);
    assert.equal(res.status, 500);
    assert.match(await res.text(), /the ledger could not be read/);
  });
});
