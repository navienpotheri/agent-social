/**
 * `asp telemetry` (register row DK79; spec-delta S291): consent status over a real log, and the seeded simulation through the lens. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SIGNALS } from "@agent-social/asp-log";
import { TelemetryUsage, telemetryCmd } from "../src/telemetry.ts";
import { DAY, kit, mk, nowIso } from "../../asp-log/test/society-kit.ts";

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

test("show says telemetry is off without a consent, lists a live consent, and drops a revoked one; simulate is reproducible", async () => {
  const k = await kit();
  const sponsor = await k.person("cli-t-sponsor", 10);
  const ag = await k.agent("cli-t-agent", sponsor, { tier: 1, funds: 10 });
  const run = async (sub: string | undefined, flags: Record<string, unknown> = {}) => {
    const out: string[] = [];
    const code = await telemetryCmd(sub, { log: { log: k.log } as any, io: { out: (l) => out.push(l) }, now: nowIso, flags: flags as any });
    return { code, text: out.join("\n") };
  };
  assert.match((await run("show", { by: ag.did })).text, /telemetry: off/);
  const c = mk("telemetry_act", sponsor, { act: "consent", sponsor: sponsor.did, agent: ag.did, signals: ["belief_state", "calibration"], purposes: ["L7-belief-recalibration"], retention_days: 30, from: iso(Date.parse(nowIso()) - DAY), until: iso(Date.parse(nowIso()) + 30 * DAY) }, null, { cosigners: [ag] });
  await k.log.append(c);
  const shown = await run("show", { by: ag.did });
  assert.match(shown.text, /belief_state, calibration for L7-belief-recalibration/);
  assert.match(shown.text, /0 daily digest/);
  const rev = mk("telemetry_act", sponsor, { act: "consent", sponsor: sponsor.did, agent: ag.did, signals: ["calibration"], purposes: ["own_use"], retention_days: 7, from: iso(Date.parse(nowIso()) - DAY), until: iso(Date.parse(nowIso()) + 30 * DAY), revokes: c.id }, null, { cosigners: [ag] });
  await k.log.append(rev);
  const after = await run("show", { by: ag.did });
  assert.doesNotMatch(after.text, /belief_state/);
  assert.match(after.text, /calibration for own_use/);
  const a = await run("simulate", { seed: "7", agents: "24" });
  assert.equal(a.text, (await run("simulate", { seed: "7", agents: "24" })).text);
  assert.match(a.text, new RegExp(`all ${SIGNALS.length} signals each`));
  assert.match(a.text, /simulated numbers, not measurements/);
  const j = JSON.parse((await run("simulate", { seed: "7", json: true })).text);
  assert.equal(j.agents.length, 24);
  await assert.rejects(() => run("show", {}), TelemetryUsage);
  await assert.rejects(() => run("simulate", { agents: "0" }), TelemetryUsage);
  await assert.rejects(() => run("nothing"), TelemetryUsage);
});
