// Row DK1751: a paper becomes a testable property before a course exists: the intake registry (docs/lenses/intakes.json) holds the claim, the falsifier, the measure and the pre-registered plan; a card links to its intake by
// id and hash; `lens publish` refuses a card with no intake unless the operator states why, and refuses a card whose intake changed after the link. Fake keys only. Credits are mock accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REGISTRAR_DID, TREASURY_DID } from "@agent-social/asp-log";
import { loadCatalogue } from "../src/lens-courses/catalogue.ts";
import { engineIds } from "../src/lens-courses/index.ts";
import { publishCmd } from "../src/lens-courses/publish-cmd.ts";
import { cardIntakeProblems, evalsIntake, intakeHash, intakeProblems, loadIntakes } from "../src/lens-loop.ts";
import { jump, kit, nowIso, registrar, treasury } from "../../asp-log/test/society-kit.ts";

const cards = loadCatalogue(engineIds()).courses;
const evals = cards.find((c) => c.id === "C-L11-1")!;
const other = cards.find((c) => c.id !== "C-L11-1" && c.prerequisites.length === 0)!;

test("DK1751: the registry holds the worked example's intake, it passes the checks, and the card links to it by the hash of the plan as it stands", () => {
  const intakes = loadIntakes();
  assert.equal(intakes.length, 1);
  assert.deepEqual(intakeProblems(intakes[0]!, cards), []);
  assert.equal(intakeHash(intakes[0]!), intakeHash(evalsIntake()), "the registry's intake is the worked example's");
  assert.deepEqual(evals.intake, { id: "lens-evals-1", sha256: intakeHash(intakes[0]!) });
  assert.deepEqual(cardIntakeProblems(evals, intakes), []);
  assert.deepEqual(cardIntakeProblems(other, intakes), [], "a card with no intake has no link to check");
});

test("DK1751: a link that cannot hold is named: an intake the registry does not hold, a plan changed after the link (a different hash), an intake for another course", () => {
  const intakes = loadIntakes();
  assert.match(cardIntakeProblems({ ...evals, intake: { id: "nope", sha256: "sha256:" + "0".repeat(64) } }, intakes)[0]!, /registry does not hold/);
  const changed = intakes.map((i) => ({ ...i, prereg: { ...i.prereg, min_effect_permille: i.prereg.min_effect_permille + 1 } }));
  assert.match(cardIntakeProblems(evals, changed)[0]!, /a plan changed after the course was linked to it is a different intake/);
  assert.match(cardIntakeProblems({ ...evals, id: "C-L2-1" }, intakes).join(" "), /is for the course C-L11-1, not C-L2-1/);
});

async function publish(over: { target: string; flags?: Record<string, string | boolean>; catalogue?: typeof cards }) {
  const k = await kit();
  await k.withPrices();
  const [s0, s1, s2] = [await k.person("li-s0", 0), await k.person("li-s1", 0), await k.person("li-s2", 0)];
  const author = await k.agent("li-author", s0, { funds: 0 }), r1 = await k.agent("li-rev1", s1, { funds: 0 }), r2 = await k.agent("li-rev2", s2, { funds: 0 });
  const signers = new Map<string, unknown>([[TREASURY_DID, treasury], [REGISTRAR_DID, registrar], [author.did, author]]);
  const out: string[] = [];
  const run = async () => publishCmd(over.target, { out: (l) => out.push(l), flags: { author: author.did, reviewers: `${r1.did},${r2.did}`, ...(over.flags ?? {}) }, log: { log: k.log, append: (r: never) => k.log.append(r) }, now: nowIso, signerFor: (d) => signers.get(d) as never, ...(over.catalogue ? { catalogue: over.catalogue } : {}) });
  return { k, out, run };
}

test("DK1751: `lens publish` publishes a card that links to its intake, refuses one with none unless the operator states why, and refuses a card whose intake changed", async () => {
  // the card with an intake: published
  const a = await publish({ target: "C-L11-1" });
  assert.equal(await a.run(), 0, a.out.join("\n"));
  jump(73 * 3_600_000);
  assert.equal(await a.run(), 0);
  assert.equal(((await a.k.log.academyRecords(["course"])) as unknown[]).length, 1);
  // a card with no intake: refused, and nothing is signed
  const b = await publish({ target: other.id });
  assert.equal(await b.run(), 1);
  assert.match(b.out.join("\n"), new RegExp(`${other.id}: not published, it has no intake: a paper becomes a testable property`));
  assert.equal(((await b.k.log.priceLists()) as unknown[]).length, 1, "no price list was signed for it");
  // a reason of fewer than ten characters is not a reason
  const c = await publish({ target: other.id, flags: { "no-intake": "old" } });
  assert.equal(await c.run(), 1);
  // with a stated reason: published, and the output says so
  const d = await publish({ target: other.id, flags: { "no-intake": "written before the intake rule (DK1751)" } });
  assert.equal(await d.run(), 0, d.out.join("\n"));
  assert.match(d.out.join("\n"), /published without an intake \(written before the intake rule \(DK1751\)\)/);
  // a card whose intake changed after the link: refused whatever the flag
  const changed = { ...evals, intake: { id: "lens-evals-1", sha256: "sha256:" + "1".repeat(64) } };
  const e = await publish({ target: "C-L11-1", flags: { "no-intake": "written before the intake rule" }, catalogue: [changed as never] });
  assert.equal(await e.run(), 1);
  assert.match(e.out.join("\n"), /not published: C-L11-1: .*a plan changed after the course was linked/);
});
