// Row DK1400: `asp academy lens publish` puts a lens card into a fresh log without a script, in the two steps the log's rules need (the Treasury's price-list item, then the course record after the notice), and the card can
// then be sat through `asp academy lens sit`. The log refuses what it refuses (two reviewers of other sponsors) and the command says so. Fake keys only. Credits are mock accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TREASURY_DID, REGISTRAR_DID } from "@agent-social/asp-log";
import { academyCmd } from "../src/academy.ts";
import { loadCatalogue } from "../src/lens-courses/catalogue.ts";
import { engineIds } from "../src/lens-courses/index.ts";
import { credit, jump, kit, nowIso, registrar, treasury } from "../../asp-log/test/society-kit.ts";

const HOUR = 3_600_000;
const card = loadCatalogue(engineIds()).courses.find((c) => c.prerequisites.length === 0)!;

async function world() {
  const k = await kit();
  await k.withPrices();
  const [s0, s1, s2, s3] = [await k.person("lp-s0", 0), await k.person("lp-s1", 0), await k.person("lp-s2", 0), await k.person("lp-learner-s", 100)];
  const author = await k.agent("lp-author", s0, { funds: 0 }), r1 = await k.agent("lp-rev1", s1, { funds: 0 }), r2 = await k.agent("lp-rev2", s2, { funds: 0 });
  const learner = await k.agent("lp-learner", s3, { funds: 200 });
  const signers = new Map<string, unknown>([[TREASURY_DID, treasury], [REGISTRAR_DID, registrar], [author.did, author], [learner.did, learner]]);
  const run = async (sub: string[], flags: Record<string, string | boolean> = {}) => {
    const out: string[] = [];
    let code = 0, err = "";
    try { code = await academyCmd("lens", sub, { log: { log: k.log, append: (r: never) => k.log.append(r) } as never, io: { out: (l) => out.push(l) }, now: nowIso, signerFor: (d) => signers.get(d) as never, flags }); } catch (e) { err = (e as Error).message; code = 2; }
    return { code, text: out.join("\n") + err };
  };
  return { k, author, r1, r2, s0, learner, run };
}

test("DK1400: a card is published on a fresh log in two runs of one command, and then it can be sat", async () => {
  const w = await world();
  const flags = { author: w.author.did, reviewers: `${w.r1.did},${w.r2.did}` };
  // run 1: the price-list item is signed and announced; the course record has to wait for the notice
  const first = await w.run(["publish", card.id], flags);
  assert.equal(first.code, 0, first.text);
  assert.match(first.text, /price list version 2 signed/);
  assert.match(first.text, /run this command again/);
  assert.equal(((await w.k.log.academyRecords(["course"])) as unknown[]).length, 0, "no course record before the item is in force");
  assert.match((await w.run(["sit", card.id], { by: w.learner.did })).text + "", /./, "reading the free lesson does not need a published course");
  const early = await w.run(["publish", card.id], flags);
  assert.match(early.text, /announced but not yet in force/);
  // run 2, after the notice: the course record, signed by the author and countersigned by the Registrar
  jump(73 * HOUR);
  const second = await w.run(["publish", card.id], flags);
  assert.equal(second.code, 0, second.text);
  assert.match(second.text, new RegExp(`${card.id}: published`));
  const courses = (await w.k.log.academyRecords(["course"])) as unknown as { issuer: string; body: { course: string; reviewers: string[]; author_share_permille: number }; cosigs?: unknown[] }[];
  assert.equal(courses.length, 1);
  assert.deepEqual([courses[0]!.issuer, courses[0]!.body.course, courses[0]!.body.reviewers.length, courses[0]!.cosigs?.length], [w.author.did, card.id, 2, 1]);
  assert.equal(courses[0]!.body.author_share_permille, card.teacher.share_permille);
  // a third run does nothing twice
  assert.match((await w.run(["publish", card.id], flags)).text, /already published/);
  assert.equal(((await w.k.log.academyRecords(["course"])) as unknown[]).length, 1);
  // the card can now be enrolled in and sat
  const mandate = await w.k.openMandate(w.learner, [{ institution: "academy", cap: credit(100), period: "month" }]);
  const enrol = await w.run(["sit", card.id], { by: w.learner.did, enrol: true, mandate });
  assert.equal(enrol.code, 0, enrol.text);
  assert.ok(!/not published/.test(enrol.text), enrol.text);
  assert.equal((await w.k.log.verify()).ok, true);
});

test("DK1400: the log's refusals are printed as they are: reviewers of the author's own sponsor, and a missing author or reviewers", async () => {
  const w = await world();
  const same = await w.k.agent("lp-twin", w.s0, { funds: 0 });
  await w.run(["publish", card.id], { author: w.author.did, reviewers: `${w.r1.did},${w.r2.did}` });
  jump(73 * HOUR);
  const bad = await w.run(["publish", card.id], { author: w.author.did, reviewers: `${w.r1.did},${same.did}` });
  assert.equal(bad.code, 1);
  assert.match(bad.text, /review_same_sponsor|same sponsor/);
  assert.equal(((await w.k.log.academyRecords(["course"])) as unknown[]).length, 0);
  assert.equal((await w.run(["publish", card.id], {})).code, 2, "an author is required");
  assert.equal((await w.run(["publish", card.id], { author: w.author.did, reviewers: w.r1.did })).code, 2, "two reviewers are required");
  assert.equal((await w.run(["publish", "NO-SUCH"], { author: w.author.did, reviewers: `${w.r1.did},${w.r2.did}` })).code, 2);
});

test("DK1400: --all publishes every card in the catalogue (one price list, then every course record)", async () => {
  const w = await world();
  const flags = { all: true, author: w.author.did, reviewers: `${w.r1.did},${w.r2.did}`, "no-intake": "written before the intake rule (DK1751)" };
  const cards = loadCatalogue(engineIds()).courses;
  assert.equal((await w.run(["publish"], flags)).code, 0);
  assert.equal(((await w.k.log.priceLists()) as unknown[]).length, 2, "one list for all the cards");
  jump(73 * HOUR);
  const done = await w.run(["publish"], flags);
  assert.equal(done.code, 0, done.text);
  assert.equal(((await w.k.log.academyRecords(["course"])) as unknown[]).length, cards.length);
  assert.equal((await w.k.log.verify()).ok, true);
});
