// The operator's powers, their limits and the public record of its acts (register row GV9; spec-delta S485). Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TREASURY_DID, institutionDid } from "../src/index.ts";
import { publicReply } from "../src/public-pages.ts";
import { Kit, credit, hashOf, operator, owner, refused, registrar, treasury } from "./academy-kit.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const src = (f: string) => readFileSync(join(root, "packages/asp-log/src", f), "utf8");
const doc = readFileSync(join(root, "docs/operator-powers.md"), "utf8");

test("GV9: each limit the page states is a rule in the code", () => {
  const rules = src("log.ts") + src("registry-rules.ts") + src("courts-rules.ts") + src("institution-charters.ts");
  for (const r of ["mint_needs_cosign", "interim_too_long", "takedown_not_heard", "charter_notice", "charter_needs_owner", "appeal_panel_conflict"]) { assert.ok(doc.includes(r), `the page names ${r}`); assert.ok(rules.includes(`"${r}"`), `${r} is a rule`); }
  assert.ok(doc.includes("budget_over_balance"));
  assert.match(src("log.ts"), /budget_(over_balance|exceeds)/);
  for (const w of ["Create credits", "Set a Treasury budget", "Suspend an identity", "Remove a name", "Publish or change a charter", "Seat a Court", "GET /operator/acts", "Succession"]) assert.ok(doc.includes(w), w);
});

test("GV9: the operator's acts are a public, ordered list that includes its mints, budgets, charters and suspensions, with the reason, and an act cannot be removed", async () => {
  const k = new Kit();
  await k.put(k.mk("mint", operator, { to: TREASURY_DID, amount: credit(1000), reason: "treasury_issuance", authority: "operator" }, null, { subject: TREASURY_DID, cosigners: [owner] }));
  await k.put(k.mk("budget", treasury, { institution: institutionDid("registry"), period: "2026-11", amount: credit(100), purpose: "charter" }, null, { cosigners: [owner] }));
  await k.put(k.mk("institution_charter", operator, { institution: institutionDid("registry"), version: 1, kind: "sovereign", status: "active", text_sha256: hashOf("a"), effective_from: k.now(), officers: [operator.did], funding: "registry" }, null, { subject: institutionDid("registry"), cosigners: [owner] }));
  const holder = await k.person("op-holder");
  const sus = k.mk("registry_act", registrar, { act: "identity_suspension", holder: holder.did, reason: "credible harm to a third party was reported", code: { version: "1.0", articles: ["4.1"] }, until: new Date(Date.parse(k.now()) + 3 * 86_400_000).toISOString().replace(".000Z", "Z") });
  await k.put(sus);
  const acts = await k.log.operatorActs();
  const kinds = acts.map((a) => `${a.type}:${a.act ?? ""}`);
  for (const w of ["mint:", "budget:", "institution_charter:", "registry_act:identity_suspension"]) assert.ok(kinds.some((x) => x.startsWith(w.replace(/:$/, ":"))), `${w} is listed: ${kinds.join(" ")}`);
  const suspension = acts.find((a) => a.act === "identity_suspension")!;
  assert.match(suspension.reason ?? "", /credible harm/);
  assert.ok(acts.every((a, i) => i === 0 || Date.parse(a.at) >= Date.parse(acts[i - 1].at)), "in log order");
  // A person's own records are not in it.
  assert.ok(!acts.some((a) => a.by === holder.did));
  const page = await publicReply(k.log, "/operator/acts", false);
  const r = (page!.json as { result: { note: string; acts: { id: string }[] } }).result;
  assert.equal(r.acts.length, acts.length);
  assert.match(r.note, /append-only/);
  // The limit a power has is a refusal: a suspension of eight days is refused.
  const eight = k.mk("registry_act", registrar, { act: "identity_suspension", holder: holder.did, reason: "too long", code: { version: "1.0", articles: ["4.1"] }, until: new Date(Date.parse(k.now()) + 8 * 86_400_000).toISOString().replace(".000Z", "Z") });
  assert.equal(await refused(k.log.append(eight)), "interim_too_long");
  assert.equal((await k.log.operatorActs()).length, acts.length, "a refused act is not on the list");
});
