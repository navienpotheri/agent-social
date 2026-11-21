/**
 * Shared set-up for the lens course tests: an Academy world on the log with the course priced by its card and published, and an agent package on disk to write back to.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Keystore } from "@agent-social/asp-package";
import { institutionDid } from "@agent-social/asp-log";
import { Kit, SERVICES, registrar, treasury } from "../../asp-log/test/academy-kit.ts";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";
import { courseItem, courseService, type CourseCard } from "../src/lens-courses/index.ts";

/** A log with the Academy's price list carrying the card's item (the price of the card, the author's share), the course published by its author with the Registrar's countersignature and two independent reviewers. */
export async function school(card: CourseCard) {
  const k = new Kit();
  const academy = institutionDid("academy");
  const author = await k.agent(`${card.id.toLowerCase()}-author`), r1 = await k.agent(`${card.id.toLowerCase()}-rev1`), r2 = await k.agent(`${card.id.toLowerCase()}-rev2`);
  const at = k.tick();
  const standard = [{ service: SERVICES.sitting, institution: academy, price: 20, class: "standard", split: { treasury_permille: 200, burn_permille: 100, payees: [{ account: academy, permille: 700 }] } }];
  const body = { version: 1, effective_from: at, bounds_version: 1, job_tax_permille: 50, items: [...standard, courseItem(card, author.did)] };
  (k as unknown as { list: string }).list = await k.put(k.mk("price_list", treasury, body, null, { at }));
  const hash = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");
  const course = await k.put(k.mk("course", author, { course: card.id, title: card.title, skill: card.generator.engine, level: 1, lessons: [hash("lesson")], exercises: hash(card.generator.engine), exercise_count: 1, price_service: courseService(card), author_share_permille: card.teacher.share_permille, reviews: [hash("r1"), hash("r2")], reviewers: [r1.did, r2.did] }, null, { subject: null, cosigners: [registrar] }));
  return { k, author, course };
}

/** An agent package on disk (a sponsor and an agent with a key), for the lesson gate. */
export async function agentPackage() {
  const f = makeFixture();
  const run = async (args: string[]) => { const io = { out: () => {}, err: () => {}, env: { ASP_HOME: f.aspHome }, cwd: f.root } as unknown as Io; assert.equal(await main(args, io), 0, args.join(" ")); };
  const ALICE = "did:web:example.com:users:alice", CODER = "did:web:example.com:agents:coder";
  await run(["identity", "new", "--kind", "human", "--did", ALICE]);
  await run(["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Learns"]);
  const pkg = join(f.root, "coder.aspkg");
  await run(["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  return { pkg, signer: new Keystore(f.aspHome).forDid(CODER)! };
}
