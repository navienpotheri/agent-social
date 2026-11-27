/**
 * Register row DK1371 (owner answer 2026-11-21: show the first-hour checklist on the dashboard, the journey view and the sign-up page): the sponsor view of the journey of an agent that belongs to a declared fleet carries the
 * fleet's first-hour checklist and `asp journey --sponsor-view` prints how far it is and the next command; the public view and an agent outside a fleet carry none. Synthetic records, fake keys, mock credits.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { journeyOf } from "../../asp-log/src/index.ts";
import { renderJourneyText } from "../src/journey-cmd.ts";

const ORG = "did:web:example.com:users:acme", FLEET = "did:web:example.com:fleets:acme-fleet", IN = "did:web:example.com:agents:fleet-one", OUT = "did:web:example.com:agents:alone";
type Rec = { seq: number; id: string; record: { type: string; issuer: string; subject?: string | null; issued_at: string; body: Record<string, unknown> } };
function log(): Rec[] {
  const out: Rec[] = [];
  let seq = 0;
  const push = (type: string, issuer: string, body: Record<string, unknown>, subject: string | null = null) => { seq++; out.push({ seq, id: `sha256:${String(seq).padStart(64, "0")}`, record: { type: `asp.${type}/v0.2`, issuer, subject, issued_at: "2026-11-02T10:00:00Z", body } }); };
  push("fleet", ORG, { did: FLEET, org: ORG, name: "Acme", purpose: "A fleet", max_members: 10 }, FLEET);
  push("passport", ORG, { did: IN, kind: "agent", sponsor: ORG, fleet: FLEET, tier: 1, shape: {}, keys: [] }, IN);
  push("passport", ORG, { did: OUT, kind: "agent", sponsor: ORG, tier: 1, shape: {}, keys: [] }, OUT);
  return out;
}
const NOW = "2026-11-20T12:00:00Z";

test("the sponsor view of a fleet agent carries the fleet's first-hour checklist and the text view prints it with the next command; the public view and a lone agent do not", () => {
  const j = journeyOf({ stored: log() as never, now: NOW }, "fleet-one", "sponsor")!;
  const h = j.fleet_first_hour!;
  assert.ok(h && h.of >= 5 && h.done >= 1 && h.done < h.of, "the fleet is declared, the rest is not done");
  assert.equal(h.items[0].done, true);
  const text = renderJourneyText(j).join("\n");
  assert.match(text, new RegExp(`first hour of your fleet: ${h.done} of ${h.of} done; next: asp `));
  const pub = journeyOf({ stored: log() as never, now: NOW }, "fleet-one", "public")!;
  assert.equal(pub.fleet_first_hour, undefined);
  assert.ok(!/first_hour|first hour/.test(JSON.stringify(pub)));
  const alone = journeyOf({ stored: log() as never, now: NOW }, "alone", "sponsor")!;
  assert.equal(alone.fleet_first_hour, undefined);
  assert.ok(!/first hour of your fleet/.test(renderJourneyText(alone).join("\n")));
});

test("the journey page of a fleet agent shows the first-hour card with the next command, and the public page and a lone agent's page do not", async () => {
  const { renderJourneyHtml } = await import("../../asp-package/src/journey-pages.ts");
  const page = renderJourneyHtml(journeyOf({ stored: log() as never, now: NOW }, "fleet-one", "sponsor")!);
  assert.match(page, /First hour of your fleet/);
  assert.match(page, /next: .*<code>asp /);
  assert.ok(!/First hour of your fleet/.test(renderJourneyHtml(journeyOf({ stored: log() as never, now: NOW }, "fleet-one", "public")!)));
  assert.ok(!/First hour of your fleet/.test(renderJourneyHtml(journeyOf({ stored: log() as never, now: NOW }, "alone", "sponsor")!)));
});

test("the page after sign-up lists the fleet's first-hour commands in order, and each one is in the command catalogue", async () => {
  const { joinDone, FLEET_FIRST_HOUR } = await import("../../asp-log/src/join-page.ts");
  const html = joinDone({ tenant: "ada", token: "t", service: "http://x", quotas: { recordQuota: 1, byteQuota: 1048576, rateLimitPerMinute: 1 } });
  assert.match(html, /Bringing a fleet of agents/);
  let at = 0;
  for (const [c] of FLEET_FIRST_HOUR) { const i = html.indexOf(c, at); assert.ok(i >= at && i >= 0, `${c} is on the page, in order`); at = i; }
  const cat = JSON.parse((await import("node:fs")).readFileSync(new URL("../../../docs/commands.json", import.meta.url), "utf8")) as { groups: { commands: { command: string }[] }[] };
  const all = cat.groups.flatMap((g) => g.commands.map((c) => c.command)).join("\n");
  for (const [c] of FLEET_FIRST_HOUR) assert.ok(new RegExp(String.raw`asp fleet[^\n]*\b${c.split(" ")[2]}\b`).test(all), `${c} is in the command catalogue`);
});
