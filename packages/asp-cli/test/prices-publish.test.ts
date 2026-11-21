// Row DK1204: the hosted price list gets `forum.post.long` and `forum.comment.long` through `asp prices publish`, signed by the Treasury; the log's own rules (notice, chain, owner co-signature) decide
// whether it stands, and after it takes effect an author can buy the long form. Fake keys only. Credits are mock accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORUM_COSTS, FORUM_SERVICES } from "@agent-social/asp-package";
import { institutionDid, TREASURY_DID } from "@agent-social/asp-log";
import { pricesCmd, PricesUsage } from "../src/prices.ts";
import { credit, jump, kit, mk, nowIso, owner, treasury } from "../../asp-log/test/society-kit.ts";

const HOUR = 3_600_000;
async function publish(k: Awaited<ReturnType<typeof kit>>, flags: Record<string, string> = { preset: "forum-long" }) {
  const out: string[] = [];
  const signers = new Map<string, unknown>([[TREASURY_DID, treasury], [owner.did, owner]]);
  const code = await pricesCmd("publish", [], { log: { log: k.log, append: (r: never) => k.log.append(r) } as never, io: { out: (l) => out.push(l) }, now: nowIso, signerFor: (d) => signers.get(d) as never, flags });
  return { code, text: out.join("\n") };
}

test("asp prices publish --preset forum-long: the two long forum acts are priced, take effect after the notice, and an author can buy one", async () => {
  const k = await kit();
  await k.withPrices();
  const before = await k.log.priceLists();
  assert.equal(before.length, 1);
  // Too soon: the log refuses a new service with less than 72 hours' notice, and the command says why.
  const soon = await publish(k, { preset: "forum-long", effective: new Date(Date.parse(nowIso()) + 2 * HOUR).toISOString() });
  assert.equal(soon.code, 1);
  assert.match(soon.text, /72 hours' notice/);
  // On time (the default is the earliest the notice allows).
  const done = await publish(k);
  assert.equal(done.code, 0, done.text);
  assert.match(done.text, /price list version 2 signed/);
  const lists = (await k.log.priceLists()) as unknown as { id: string; body: { version: number; items: { service: string; price: number; institution: string }[] } }[];
  assert.equal(lists.length, 2);
  const v2 = lists.find((l) => l.body.version === 2)!;
  assert.equal(v2.body.items.length, (before[0]!.body as { items: unknown[] }).items.length + 2, "the old services are kept");
  const post = v2.body.items.find((i) => i.service === FORUM_SERVICES.post)!;
  assert.equal(post.price, FORUM_COSTS.longPost);
  assert.equal(post.institution, institutionDid("research"));
  assert.equal(v2.body.items.find((i) => i.service === FORUM_SERVICES.comment)!.price, FORUM_COSTS.longComment);

  // Before it takes effect nothing can be bought at it; after, an agent with a Mandate for research buys the long post.
  const sponsor = await k.person("forum-sponsor", 50);
  const author = await k.agent("forum-author", sponsor, { funds: 50 });
  const mandate = await k.openMandate(author, [{ institution: "research", cap: credit(40), period: "month" }]);
  const purchase = (at: string, n: string) => mk("purchase", author, { service: FORUM_SERVICES.post, institution: institutionDid("research"), price_list: v2.id, quantity: 1, amount: credit(FORUM_COSTS.longPost), idempotency: n, mandate }, null, { at });
  await assert.rejects(() => k.log.append(purchase(nowIso(), "early")), /price list in force is/);
  jump(73 * HOUR);
  await k.log.append(purchase(nowIso(), "later"));
});

test("asp prices publish: a rise above 25 % needs the owner's co-signature; the command needs exactly one source and the Treasury's key", async () => {
  const k = await kit();
  await k.withPrices();
  await publish(k);
  const file = (await import("node:fs")).mkdtempSync((await import("node:os")).tmpdir() + "/asp-prices-");
  const f = file + "/items.json";
  const research = institutionDid("research");
  const split = { treasury_permille: 150, burn_permille: 50, payees: [{ account: research, permille: 800 }] };
  (await import("node:fs")).writeFileSync(f, JSON.stringify([{ service: FORUM_SERVICES.post, institution: research, price: 20, class: "standard", split }]));
  const refused = await publish(k, { file: f });
  assert.equal(refused.code, 1);
  assert.match(refused.text, /owner's co-signature/);
  const ok = await publish(k, { file: f, "cosign-by": owner.did });
  assert.equal(ok.code, 0, ok.text);
  await assert.rejects(() => publish(k, {}), PricesUsage);
  await assert.rejects(() => publish(k, { file: f, preset: "forum-long" }), PricesUsage);
  await assert.rejects(() => publish(k, { preset: "nothing" }), PricesUsage);
});
