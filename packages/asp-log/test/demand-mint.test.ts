// DK534 (S954): the demand-tied mint: credits minted because paid work was done, to the Treasury only, with the owner, never past a tenth of what performers were paid in the last 30 days. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGuardReport, TREASURY_DID } from "../src/index.ts";
import { DAY, jump, kit, mk, operator, owner, refusedBy } from "./society-kit.ts";

test("S954: a demand mint is capped at a tenth of the credits released to performers in 30 days, goes only to the Treasury with the owner, and the supply rule balances", async () => {
  const k = await kit();
  const poster = await k.person("dm-poster", 300);
  const worker = await k.agent("dm-worker", poster, { funds: 50 });
  const dm = (amount: number, over: Record<string, unknown> = {}, cosigners = [owner]) => mk("mint", operator, { to: TREASURY_DID, amount: { value: amount, unit: "credit" }, reason: "demand", authority: "owner approved", ...over }, null, { cosigners: cosigners as never });

  assert.equal(await refusedBy(k.log.append(dm(1))), "demand_mint_cap", "no paid work yet, no room");
  await k.runJob(poster, worker, 100); // 100 credits released to the performer: the cap is 10
  assert.deepEqual(await k.log.demandMintState(), { ...(await k.log.demandMintState()), paidWork: 100, minted: 0, cap: 10, room: 10 });
  assert.equal(await refusedBy(k.log.append(dm(5, {}, []))), "mint_needs_cosign");
  assert.equal(await refusedBy(k.log.append(dm(5, { to: worker.did }))), "demand_mint_to_treasury");
  assert.equal(await refusedBy(k.log.append(dm(11))), "demand_mint_cap", "more than a tenth");
  await k.log.append(dm(6));
  await k.log.append(dm(4, { authority: "owner approved, second" }));
  assert.equal(await refusedBy(k.log.append(dm(1, { authority: "owner approved, third" }))), "demand_mint_cap", "the cap is used up");
  assert.equal((await k.log.demandMintState()).room, 0);
  assert.equal((await k.log.creditAudit()).verdict, "balanced", "the minted total and the ledger agree");

  // The guard shows how near the cap is (G10); thirty days later the work has left the window and so has the room.
  const rep = await computeGuardReport({ handle: { log: k.log } as never, now: () => Date.parse("2026-11-03T00:00:00Z") });
  const g10 = rep.measures.find((m) => m.id === "G10");
  assert.ok(g10 && g10.triggered && g10.value >= 1, "at the cap the guard says so");
  assert.match(g10!.action, /demand mints/);
  jump(31 * DAY);
  assert.equal((await k.log.demandMintState()).cap, 0);
  assert.equal(await refusedBy(k.log.append(dm(1, { authority: "owner approved, later" }))), "demand_mint_cap");
  assert.equal((await k.log.verify()).ok, true, "replay reproduces every cap check");
});
