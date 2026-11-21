// Row DK1752: the lint of a course card for held-out leakage: a held-out token in the card's text, or in the practice set, fails it; a clean card passes; every card of the catalogue is clean or listed as not linted with the
// engine's reason; `asp academy lens lint` prints it and `lens publish` refuses a card that fails. A practice name is never a held-out name (the engines draw them from separate ranges). Synthetic seeds only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { academyCmd } from "../src/academy.ts";
import { loadCatalogue } from "../src/lens-courses/catalogue.ts";
import { ENGINES, engineIds } from "../src/lens-courses/index.ts";
import { lintCard } from "../src/lens-courses/lint.ts";
import { heldoutFor as evalsHeld, practiceFor as evalsPractice } from "../src/lens-courses/evolving-evals.ts";
import { credit, jump, kit, nowIso, registrar, treasury } from "../../asp-log/test/society-kit.ts";
import { REGISTRAR_DID, TREASURY_DID } from "@agent-social/asp-log";

const cards = loadCatalogue(engineIds()).courses;
const evalsCard = cards.find((c) => c.id === "C-L11-1")!;

test("DK1752: a clean card passes; a held-out token in the card's text fails, naming the field", () => {
  const clean = lintCard(evalsCard, ENGINES[evalsCard.generator.engine]);
  assert.deepEqual([clean.linted, clean.problems], [true, []]);
  assert.equal(clean.sampled, 5);
  // the sampled seeds of the lint are those of `lint|<id>|<i>`: a card that carries one of their held-out order numbers leaks
  const seed = "sha256:" + (require_sha(`lint|${evalsCard.id}|0`));
  const token = /#\d{4}[A-Z]/.exec(evalsHeld(seed).map((c) => c.input).join(" "))![0];
  const leaky = { ...evalsCard, free_first_lesson: `${evalsCard.free_first_lesson}; for example order ${token} was refunded too much` };
  const r = lintCard(leaky, ENGINES[leaky.generator.engine]);
  assert.ok(r.problems.some((p) => p.startsWith("free_first_lesson carries ") && p.includes(token)), r.problems.join(" | "));
  // a card with no stated claim or a low pass mark fails the template part
  assert.ok(lintCard({ ...evalsCard, concept: "short" }, ENGINES[evalsCard.generator.engine]).problems.some((p) => /states its claim/.test(p)));
  assert.ok(lintCard({ ...evalsCard, gate: { ...evalsCard.gate, pass_permille: 300 } }, ENGINES[evalsCard.generator.engine]).problems.some((p) => /pass mark/.test(p)));
});

test("DK1752: every card of the catalogue is clean or listed as not linted with the engine's reason; none fails", () => {
  const results = cards.map((c) => lintCard(c, ENGINES[c.generator.engine]));
  assert.equal(results.length, cards.length);
  assert.deepEqual(results.filter((r) => r.problems.length).map((r) => `${r.id}: ${r.problems[0]}`), [], "no card fails");
  const unlinted = results.filter((r) => !r.linted);
  assert.ok(unlinted.every((r) => /offers no distinctive tokens/.test(r.note ?? "")), "each unlinted card says why");
  assert.ok(results.filter((r) => r.linted).length >= 20, `${results.filter((r) => r.linted).length} of ${cards.length} cards are linted; the engines of ${unlinted.map((r) => r.id).join(", ")} offer no tokens`);
});

test("DK1752: a name seen in practice is never a held-out name (the practice and held-out draws use separate ranges), over 200 seeds of the rule-world and reflection engines", () => {
  let checked = 0;
  for (const c of cards) {
    const e = ENGINES[c.generator.engine]!;
    if (!e.leakTokens) continue;
    for (let i = 0; i < 40; i++) {
      const seed = `seed-${c.id}-${i}`;
      const practice = JSON.stringify(e.practice(seed));
      for (const t of e.leakTokens(seed)) { assert.ok(!practice.includes(t), `${c.id} seed ${i}: ${t} is in the practice set and in the held-out tasks`); checked++; }
    }
    if (checked > 4000) break;
  }
  assert.ok(checked > 1000);
  // the evolving-evals engine keeps its own separate order numbers
  const p = JSON.stringify(evalsPractice("x"));
  for (const c of evalsHeld("x")) for (const t of c.input.match(/#\d{4}[A-Z]/g) ?? []) assert.ok(!p.includes(t));
});

test("DK1752: `asp academy lens lint` prints each card and exits 1 on a failure; `lens publish` refuses a card that fails the lint", async () => {
  const k = await kit();
  await k.withPrices();
  const out: string[] = [];
  const run = (sub: string[], flags: Record<string, string | boolean> = {}) => academyCmd("lens", sub, { log: { log: k.log, append: (r: never) => k.log.append(r) } as never, io: { out: (l) => out.push(l) }, now: nowIso, signerFor: () => { throw new Error("no signing needed"); }, flags });
  assert.equal(await run(["lint", evalsCard.id]), 0);
  assert.match(out.join("\n"), new RegExp(`${evalsCard.id}  clean \\(5 sampled seeds\\)`));
  out.length = 0;
  assert.equal(await run(["lint"], { all: true }), 0);
  assert.equal(out.filter((l) => /^C-L/.test(l)).length, cards.length);
  assert.ok(out.some((l) => /not linted: the engine/.test(l)));
  await assert.rejects(() => run(["lint", "C-NOPE"]), /lens lint/);
  // publish refuses a leaky card before anything is signed
  const { publishCmd } = await import("../src/lens-courses/publish-cmd.ts");
  const seed = "sha256:" + require_sha(`lint|${evalsCard.id}|1`);
  const token = /#\d{4}[A-Z]/.exec(evalsHeld(seed).map((c) => c.input).join(" "))![0];
  const leaky = { ...evalsCard, concept: `${evalsCard.concept} (see order ${token})` };
  const log: string[] = [];
  const code = await publishCmd(evalsCard.id, { out: (l) => log.push(l), flags: { author: "a", reviewers: "b,c" }, log: { log: k.log, append: () => { throw new Error("nothing may be appended"); } }, now: nowIso, signerFor: () => { throw new Error("nothing may be signed"); }, catalogue: [leaky] });
  assert.equal(code, 1);
  assert.match(log.join(" | "), /C-L11-1: not published, the lint fails: concept carries /);
  void credit; void jump; void registrar; void treasury; void REGISTRAR_DID; void TREASURY_DID;
});

import { createHash } from "node:crypto";
function require_sha(s: string): string { return createHash("sha256").update(s).digest("hex"); }
