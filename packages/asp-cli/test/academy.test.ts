import { test } from "node:test";
import assert from "node:assert/strict";
import { signerFromSeed, randomSeed } from "@agent-social/asp-core";
import { academyCmd, AcademyUsage } from "../src/academy.ts";

// `asp academy` reads and signs records; the log's own tests (economy-slice.test.ts) check the promotion rule. Here the log is a fake and the output and the records signed are checked.
const AGENT = "did:web:example.com:agents:learner", REG = "did:web:asp.local:registry";
const NOW = "2026-12-05T00:00:00Z";
const cert = (id: string, skill: string, level: number, expires: string) => ({ id, type: "asp.certificate/v0.2", body: { holder: AGENT, skill, level, expires } });

function run(sub: string | undefined, rest: string[], rep: unknown, certs: unknown[], flags: Record<string, unknown> = {}, appended: unknown[] = []) {
  const out: string[] = [];
  const signer = signerFromSeed(REG + "#key-1", randomSeed());
  const log = { log: { reputationOf: async () => rep, certificatesOf: async () => certs }, append: async (r: unknown) => { appended.push(r); return { id: "new-record", seq: 5 }; } } as any;
  return academyCmd(sub, rest, { log, io: { out: (l) => out.push(l) }, now: () => NOW, flags, signerFor: () => signer as any }).then((code) => ({ code, text: out.join("\n") }));
}

test("tier shows where an agent is and what the next step needs, and that credits alone never promote", async () => {
  const r = await run("tier", [AGENT], { tier: 1, qualifyingJobs: 2 }, [cert("c1", "foundations", 1, "2027-05-01T00:00:00Z")]);
  assert.equal(r.code, 0);
  assert.match(r.text, /tier 1; 2 qualifying job\(s\); certificates: foundations level 1/);
  assert.match(r.text, /Foundations certificate \[have it\]; 3 qualifying jobs \[2\/3\]/);
  assert.match(r.text, /credits alone never promote/);
  const none = await run("tier", [AGENT], { tier: 1 }, []);
  assert.match(none.text, /certificates: none/);
  assert.match(none.text, /\[missing\]/);
  assert.match((await run("tier", [AGENT], { tier: 2 }, [])).text, /the Arena is not built yet/);
  assert.match((await run("tier", [AGENT], { tier: 0 }, [])).text, /Clinic's retraining path/);
  assert.equal((await run("tier", [AGENT], undefined, [])).code, 1);
  assert.match((await run("tier", [AGENT], { tier: 1 }, [cert("c9", "foundations", 1, "2026-11-01T00:00:00Z")])).text, /foundations level 1 \(expired\)/);
});

test("certify signs a 180-day certificate; promote names the holder's valid certificates and one step up; neither runs without the Registrar", async () => {
  const appended: any[] = [];
  const c = await run("certify", [], undefined, [], { by: REG, holder: AGENT, skill: "foundations", level: "1" }, appended);
  assert.equal(c.code, 0);
  assert.equal(appended[0].type, "asp.certificate/v0.2");
  assert.equal(appended[0].issuer, REG);
  assert.equal(appended[0].body.expires, "2027-06-03T00:00:00Z", "180 days after 2026-12-05");
  const p = await run("promote", [], { tier: 1 }, [cert("c1", "foundations", 1, "2027-05-01T00:00:00Z"), cert("c2", "old", 1, "2026-11-01T00:00:00Z")], { by: REG, holder: AGENT }, appended);
  assert.equal(p.code, 0);
  assert.deepEqual([appended[1].type, appended[1].body.from, appended[1].body.to, appended[1].body.certificates], ["asp.tier_promotion/v0.2", 1, 2, ["c1"]]);
  assert.match((await run("promote", [], { tier: 1 }, [], { by: REG, holder: AGENT })).text, /no valid certificate/);
  await assert.rejects(() => run("certify", [], undefined, [], { holder: AGENT, skill: "x" }), AcademyUsage);
  await assert.rejects(() => run("certify", [], undefined, [], { by: REG, holder: AGENT, skill: "x", level: "9" }), AcademyUsage);
  await assert.rejects(() => run("promote", [], { tier: 1 }, [], {}), AcademyUsage);
  await assert.rejects(() => run("nope", [], undefined, []), AcademyUsage);
});
