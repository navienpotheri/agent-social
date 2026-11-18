// DK544 (S950): a sponsor invites its agent to spend time in the society without widening anything, and can end it at once. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { credit, kit, refusedBy, mk, type Party } from "../../asp-log/test/society-kit.ts";
import { inviteCmd, InviteUsage } from "../src/society-invite.ts";

async function setup() {
  const k = await kit();
  await k.withPrices();
  const sponsor = await k.person("inv-sponsor", 50);
  const agent = await k.agent("inv-agent", sponsor, { funds: 200 });
  // The agent already has a Mandate of its own with a scope and a spend cap; the invite must leave it alone.
  const before = await k.openMandate(agent, [{ institution: "registry", cap: credit(10), period: "month" }]);
  const parties = new Map<string, Party>([[sponsor.did, sponsor], [agent.did, agent]]);
  const lines: string[] = [];
  const handle = { log: k.log, append: (r: never) => k.log.append(r) } as never;
  const run = (sub: "invite" | "revoke", flags: Record<string, string>) => inviteCmd(sub, { log: handle, io: { out: (l) => lines.push(l) }, now: () => new Date(Date.parse("2026-11-02T00:00:00Z")).toISOString(), signerFor: (d) => parties.get(d)!, flags });
  return { k, sponsor, agent, before, run, lines };
}
const mandatesOf = async (k: Awaited<ReturnType<typeof setup>>["k"], did: string) => (await k.log.mandatesOf(did)) as { id: string; body: Record<string, unknown> }[];

test("DK544: the invite adds one Mandate whose only grant is institution_spend; the agent's existing Mandate is untouched and no scope is widened", async () => {
  const { k, agent, before, run, lines } = await setup();
  const old = JSON.stringify((await mandatesOf(k, agent.did)).find((m) => m.id === before));
  assert.equal(await run("invite", { agent: agent.did, institutions: "market,academy", "per-day": "20" }), 0);
  const all = await mandatesOf(k, agent.did);
  assert.equal(all.length, 2);
  assert.equal(JSON.stringify(all.find((m) => m.id === before)), old, "the existing Mandate is byte for byte the same");
  const inv = all.find((m) => m.id !== before)!.body as { scopes: string[]; spend: { cap: number }; network?: unknown; subcontract: { allowed: boolean }; institution_spend: { institution: string; cap: { value: number }; period: string }[] };
  assert.deepEqual(inv.scopes, ["repo.read"]);
  assert.equal(inv.spend.cap, 0);
  assert.equal(inv.network, undefined);
  assert.equal(inv.subcontract.allowed, false);
  assert.deepEqual(inv.institution_spend.map((l) => [l.institution, l.cap.value, l.period]), [["market", 10, "day"], ["academy", 10, "day"]]);
  assert.match(lines.join("\n"), /nothing else about the agent changed/);
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
});

test("DK544: the daily cap holds, only the named institutions can be bought from, and the sponsor revokes at once", async () => {
  const { k, agent, run } = await setup();
  await run("invite", { agent: agent.did, institutions: "registry", "per-day": "10" });
  const inv = (await mandatesOf(k, agent.did)).at(-1)!.id;
  await k.buy(agent, "registry.name.claim", 10, { mandate: inv });
  assert.match(String(await refusedBy(k.buy(agent, "registry.name.renew", 5, { mandate: inv }))), /cap/, "the registry line is 10 a day");
  assert.equal(await refusedBy(k.buy(agent, "market.posting.deposit", 2, { mandate: inv })), "institution_not_in_mandate", "an institution not named");
  // Revoke: the next purchase is refused for the revocation, not for the cap or the institution.
  assert.equal(await run("revoke", { agent: agent.did }), 0);
  assert.equal(await refusedBy(k.buy(agent, "registry.name.renew", 5, { mandate: inv })), "mandate_revoked");
  assert.equal(await run("revoke", { agent: agent.did }), 1, "nothing left to revoke");
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
});

test("DK544: only a sponsor's own agent, known institutions and sane numbers are accepted", async () => {
  const { agent, run, lines } = await setup();
  assert.equal(await run("invite", { agent: "did:web:example.com:agents:nobody", institutions: "market", "per-day": "5" }), 1);
  assert.match(lines.at(-1)!, /not an agent with a sponsor/);
  await assert.rejects(() => run("invite", { agent: agent.did, institutions: "market,mars", "per-day": "5" }), InviteUsage);
  await assert.rejects(() => run("invite", { agent: agent.did, institutions: "market", "per-day": "0" }), InviteUsage);
  await assert.rejects(() => run("invite", { agent: agent.did, institutions: "market,academy", "per-day": "1" }), InviteUsage);
});

test("DK544: the command is in the catalogue and the docs", () => {
  const cat = readFileSync(fileURLToPath(new URL("../../../docs/commands.md", import.meta.url)), "utf8");
  assert.match(cat, /asp society invite/);
  assert.match(cat, /revoke --agent/);
});
