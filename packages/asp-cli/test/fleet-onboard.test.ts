// DK1371: guided fleet onboarding through the real commands on a real local log: blueprints and skills, init, import (CSV, TSV, infrastructure file), a plan with the combined Mandate, the cost and the flagged
// skills, apply (templates, enrolment, resume), the first-hour checklist, rollback, and a 10,000-agent plan and apply with the time stated. Fake keys; mock credits; no model agent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lessonProblems } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { BLUEPRINTS, SKILLS, resolvePersona } from "../src/fleet-blueprints.ts";
import { importManifest, manifestFromAnswers } from "../src/fleet-onboard.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ORG = "did:web:acme.example:org";
const FLEET = "did:web:acme.example:fleets:engineering";
async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
async function setup() {
  const f = makeFixture();
  await ok(f, ["identity", "new", "--kind", "human", "--did", ORG, "--no-recovery"]);
  return f;
}
const answers = ["--sponsor", ORG, "--name", "Engineering", "--purpose", "Keep the build green"];

test("the libraries: six blueprints each with a Mandate template, six skill packs each with the scopes it needs, and every skill text passes the lesson gate's static check", () => {
  assert.deepEqual(Object.keys(BLUEPRINTS).sort(), ["analyst", "developer", "manager", "operator", "researcher", "support"]);
  assert.deepEqual(Object.keys(SKILLS).sort(), ["code-review", "customer-reply", "data-cleaning", "report-writing", "research-summary", "ticket-triage"]);
  for (const b of Object.values(BLUEPRINTS)) {
    assert.ok(Array.isArray(b.mandate.scopes) && (b.mandate.scopes as string[]).length, `${b.id} has a Mandate template`);
    assert.deepEqual(resolvePersona({ blueprint: b.id }).flagged, [], `${b.id}'s own skills fit its own Mandate`);
  }
  for (const s of Object.values(SKILLS)) assert.deepEqual(lessonProblems(s.text), [], `${s.id} passes the static check`);
});

test("init writes a manifest from a few answers; import reads a CSV, a TSV and an infrastructure file into the same manifest; a bad file says what is wrong", async () => {
  const f = await setup();
  const out = join(f.root, "m.json");
  const init = await ok(f, ["fleet", "init", ...answers, "--persona", "developer:3,support:2", "--out", out]);
  assert.match(init.out, /manifest written to .*5 agents in 2 personas/);
  const m = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual(m.personas.map((p: { name: string; count: number; blueprint: string }) => [p.name, p.count, p.blueprint]), [["developer", 3, "developer"], ["support", 2, "support"]]);
  assert.notEqual((await asp(f, ["fleet", "init", ...answers, "--persona", "ceo:1"])).code, 0, "ceo is not a blueprint");
  assert.notEqual((await asp(f, ["fleet", "init", "--sponsor", ORG])).code, 0, "the questions are asked");
  const csv = "persona,count,blueprint,skills,runtime,token_budget\ndeveloper,3,developer,,claude-code,50000\nsupport,2,support,research-summary,,\n";
  const fromCsv = importManifest(csv, "csv", { sponsor: ORG, name: "Engineering", purpose: "Keep the build green" });
  assert.equal(fromCsv.personas[0].token_budget, 50000);
  assert.deepEqual(fromCsv.personas[1].skills, ["research-summary"]);
  const fromTsv = importManifest(csv.replace(/,/g, "\t"), "tsv", { sponsor: ORG, name: "Engineering", purpose: "Keep the build green" });
  assert.deepEqual(fromTsv, fromCsv);
  const iac = JSON.stringify({ resources: [{ type: "asp_fleet", name: "Engineering", sponsor: ORG, purpose: "Keep the build green" }, { type: "asp_persona", name: "developer", count: 3, blueprint: "developer", token_budget: 50000 }, { type: "asp_persona", name: "support", count: 2, blueprint: "support", skills: ["research-summary"] }] });
  assert.deepEqual(importManifest(iac, "json", {}).personas.map((p) => p.name), ["developer", "support"]);
  assert.throws(() => importManifest("persona,n\ndev,3\n", "csv", {}), /needs a persona \(or name\) column and a count column/);
  assert.throws(() => importManifest("persona,count\ndev,0\n", "csv", { sponsor: ORG, name: "X", purpose: "p" }), /row 2: count/);
  assert.throws(() => importManifest("persona,count,blueprint\ndev,1,wizard\n", "csv", { sponsor: ORG, name: "X", purpose: "p" }), /blueprint "wizard" is not in the library/);
  const file = join(f.root, "people.csv"); writeFileSync(file, csv);
  assert.equal((await ok(f, ["fleet", "import", "--file", file, ...answers, "--out", join(f.root, "i.json")])).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, "i.json"), "utf8")).personas.length, 2);
  assert.match((await ok(f, ["fleet", "blueprints"])).out, /developer +Write and test code.*scopes repo\.read, repo\.write, tests\.run; skills code-review, report-writing/);
  assert.equal(manifestFromAnswers({ sponsor: ORG, name: "E", purpose: "p", persona: "analyst:1" }).personas[0].blueprint, "analyst");
});

test("plan shows the combined Mandate and skills, the cost, and flags a skill whose scope the Mandate does not allow; apply refuses a flagged manifest and writes nothing", async () => {
  const f = await setup();
  const file = join(f.root, "m.json");
  const m = manifestFromAnswers({ sponsor: ORG, name: "Engineering", purpose: "Keep the build green", persona: "developer:10,support:5" });
  m.personas[1].skills = ["data-cleaning"];                       // needs repo.write; the support Mandate has repo.read only
  m.personas[0].token_budget = 1000;
  writeFileSync(file, JSON.stringify(m));
  const plan = await ok(f, ["fleet", "plan", "--manifest", file]);
  assert.match(plan.out, /developer +10 +Mandate: repo\.read, repo\.write, tests\.run \(blueprint developer\); skills: code-review, report-writing/);
  assert.match(plan.out, /FLAG +skill data-cleaning needs repo\.write, which this persona's Mandate does not allow/);
  assert.match(plan.out, /starter credits up front 1500 \(15 x 100\), up to 7500 after/);
  assert.match(plan.out, /tokens a month 10000 set in this manifest/);
  assert.equal(JSON.parse((await ok(f, ["fleet", "plan", "--manifest", file, "--json"])).out).flagged.length, 1);
  const refused = await asp(f, ["fleet", "apply", "--manifest", file, "--out", join(f.root, "out")]);
  assert.notEqual(refused.code, 0);
  assert.match(refused.err, /nothing was written: 1 skill needs scopes the persona's Mandate does not allow/);
  assert.equal((await ok(f, ["fleet", "status", "--manifest", file])).out.includes("not declared yet"), true, "nothing was written");
});

test("apply declares the fleet, signs each persona's Mandate template, enrols the agents and carries each persona's skills; a stop resumes; the checklist and rollback follow", async () => {
  const f = await setup();
  const file = join(f.root, "m.json"), out = join(f.root, "out");
  writeFileSync(file, JSON.stringify(manifestFromAnswers({ sponsor: ORG, name: "Engineering", purpose: "Keep the build green", persona: "developer:3,support:2" })));
  assert.match((await ok(f, ["fleet", "checklist", "--manifest", file])).out, /\[ \] the fleet is declared/);
  const first = await asp(f, ["fleet", "apply", "--manifest", file, "--out", out, "--mode", "bundle", "--stop-after", "2"]);
  assert.equal(first.code, 3, "stopped part way");
  assert.match(first.out, /2 Mandate templates in force: developer v1, support v1/);
  const second = await ok(f, ["fleet", "apply", "--manifest", file, "--out", out, "--mode", "bundle"]);
  assert.match(second.out, /2 Mandate templates in force/, "resumed: the templates are not signed twice");
  assert.match(second.out, /5 of 5/);
  const apply = JSON.parse(readFileSync(join(out, "apply.json"), "utf8"));
  assert.deepEqual([apply.complete, apply.templates.length], [true, 2]);
  // each agent's key file lists its persona's skills (a developer carries code-review and report-writing)
  const keys = readdirSync(join(out, "agents")).filter((x) => x.startsWith("developer"));
  assert.equal(keys.length, 3);
  assert.deepEqual(JSON.parse(readFileSync(join(out, "agents", keys[0]), "utf8")).skills, ["code-review", "report-writing"]);
  assert.match((await ok(f, ["fleet", "template", "show", FLEET, "--persona", "support"])).out, /version 1/);
  const list = (await ok(f, ["fleet", "checklist", "--manifest", file, "--out", out])).out;
  assert.match(list, /\[x\] the fleet is declared/);
  assert.match(list, /\[x\] a Mandate template for each of 2 personas/);
  assert.match(list, /\[x\] every agent has joined/);
  // rollback needs a yes, then closes the fleet and deletes the key files; the log keeps what it has
  assert.notEqual((await asp(f, ["fleet", "rollback", "--manifest", file, "--out", out])).code, 0);
  const back = await ok(f, ["fleet", "rollback", "--manifest", file, "--out", out, "--confirm", FLEET]);
  assert.match(back.out, /the fleet is closed to new members; 5 key files deleted/);
  assert.match(back.out, /5 agent identities stay in the log/);
  assert.equal(existsSync(join(out, "agents")), false);
  const receipt = JSON.parse(readFileSync(join(out, "rollback.json"), "utf8"));
  assert.deepEqual([receipt.closed, receipt.key_files_deleted, receipt.members_still_in_the_log], [true, 5, 5]);
  assert.match((await ok(f, ["fleet", "show", FLEET])).out, /\[closed to new members\]/);
  assert.match((await ok(f, ["fleet", "rollback", "--manifest", file, "--out", out, "--confirm", FLEET])).out, /nothing to undo/, "a second rollback is harmless");
});

test("a fleet of 10,000: the plan and the apply (invitations, the invitation mode) on a local log within the stated time", async () => {
  const f = await setup();
  const file = join(f.root, "m.json"), out = join(f.root, "out");
  writeFileSync(file, JSON.stringify(manifestFromAnswers({ sponsor: ORG, name: "Engineering", purpose: "Keep the build green", persona: "developer:6000,support:2500,researcher:1000,manager:500" })));
  let t = Date.now();
  const plan = await ok(f, ["fleet", "plan", "--manifest", file]);
  const planMs = Date.now() - t;
  assert.match(plan.out, /10000 agents in 4 personas/);
  assert.match(plan.out, /starter credits up front 1000000 \(10000 x 100\)/);
  t = Date.now();
  const applied = await ok(f, ["fleet", "apply", "--manifest", file, "--out", out]);
  const applyMs = Date.now() - t;
  console.log(`10,000-agent plan ${planMs} ms, apply (4 templates, 10,000 signed invitations) ${applyMs} ms`);
  assert.match(applied.out, /4 Mandate templates in force/);
  assert.match(applied.out, /10000 of 10000/);
  assert.equal(readFileSync(join(out, "invitations.jsonl"), "utf8").split("\n").filter(Boolean).length, 10000);
  assert.ok(planMs < 10_000, "the plan reads in under 10 seconds");
  assert.ok(applyMs < 15 * 60_000, "the apply takes under 15 minutes");
});
