// Where credits come from and where they go (register row JB6; spec-delta S474): the table in docs/credit-doors.md is the code's, and a job posted by a person, found on the board, assigned, done and settled moves
// credits only by the doors and sinks the table names, with the supply rule balanced at every stop. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWANCE_AMOUNT, BURN_DID, TREASURY_DID } from "../src/index.ts";
import { STARTER_MAX_DIDS, STARTER_PER_DID, STARTER_UPFRONT } from "../src/starter.ts";
import { credit, kit } from "./society-kit.ts";

const doc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "credit-doors.md"), "utf8");

test("JB6: the numbers in the table are the code's", () => {
  assert.match(doc, new RegExp(`up to ${STARTER_MAX_DIDS}`));
  assert.match(doc, new RegExp(`${STARTER_PER_DID} in all, ${STARTER_UPFRONT} at once`));
  assert.match(doc, new RegExp(`\| ${ALLOWANCE_AMOUNT}, once for each identity and sponsor`));
  assert.match(doc, /A credit is \*\*made only by a signed mint\*\*/);
  for (const door of ["sign-up grant", "key-only agent", "Earnings from accepted work", "newcomer allowance"]) assert.ok(doc.includes(door), door);
});

test("JB6: a job through the board moves credits only by the table's doors and sinks, and the books balance at every stop", async () => {
  const k = await kit();
  await k.withPrices();
  const audit = async () => (await k.log.creditAudit()).verdict;
  // Door 1: a person's grant (a signed mint).
  const poster = await k.person("jd-poster", 300);
  const sponsor = await k.person("jd-sponsor", 10);
  const agent = await k.agent("jd-agent", sponsor, { skills: ["code"], funds: 100 });
  const minted = (await k.log.creditAudit()).minted;
  assert.equal(await audit(), "balanced");
  const treasury0 = await k.log.balance(TREASURY_DID), burn0 = await k.log.balance(BURN_DID);

  // The board: a posting costs a deposit (a purchase: split to the Market, the Treasury and the burn).
  const { mk } = await import("./society-kit.ts");
  const intent = await k.intent(poster, { purpose: "Fix the flaky test", budget: credit(60), skills: ["code"] });
  const deposit = await k.buy(poster, "market.posting.deposit", 2);
  await k.log.append(mk("market_act", poster, { act: "posting", intent, board: "main", expires: new Date(Date.parse("2027-01-01")).toISOString().replace(".000Z", "Z"), deposit }));
  assert.equal((await k.log.marketBoard()).length, 1);
  assert.equal(await audit(), "balanced", "the deposit moved credits, it made none");

  // The job: escrow and bond locked, work accepted, settled with the job tax.
  const offer = await k.offer(agent, intent, 60);
  const before = await k.log.balance(agent.did);
  await k.runJob(poster, agent, 60, { intent, offer });
  const tax = Math.floor((60 * 20) / 1000);
  assert.equal(await k.log.balance(agent.did), before + 60, "door 3: the performer earns the price");
  assert.equal((await k.log.balance(TREASURY_DID)) - treasury0 >= tax, true, "sink: the job tax went to the Treasury");
  assert.ok((await k.log.balance(BURN_DID)) >= burn0, "the burn only grows");
  assert.equal((await k.log.creditAudit()).minted, minted, "no credit was made by the job: the minted total did not move");
  assert.equal(await audit(), "balanced");
  assert.equal((await k.log.verify()).ok, true);
});
