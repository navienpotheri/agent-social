/**
 * `asp society invite --agent <did> --institutions market,academy --per-day <n> [--days 90]` and `asp society revoke --agent <did>` (register row DK544; spec-delta S950).
 * A sponsor lets one of its agents spend time in the society without touching anything else the agent may do. The invite is a new, separate Mandate whose only grant is an
 * `institution_spend` list: scopes read-only, spend 0, no network, no subcontracting, one node. The agent's existing Mandates are not edited (records never are) and no scope of
 * theirs is widened. The Mandate sits on a one-credit invite contract the sponsor opens with itself as the bank, so the sponsor can end it at once: `revoke` settles that contract as
 * revoked, the credit goes back, and the log refuses every purchase under the Mandate from then on. Credits are accounting entries, not money.
 */
import { createRecord, cosign, type AspRecord, type Signer } from "@agent-social/asp-core";
import type { LogHandle } from "@agent-social/asp-package";

export class InviteUsage extends Error {}
export const INVITE_PURPOSE = "Society invite: spend credits at named institutions";
const INSTITUTIONS = new Set(["market", "academy", "registry", "shops", "courts", "clinic", "housing", "events", "research", "bank", "insurer"]);

export interface InviteOpts {
  log: LogHandle;
  io: { out: (l: string) => void };
  now: () => string;
  signerFor: (did: string) => Signer;
  flags: { agent?: string; institutions?: string; "per-day"?: string; days?: string };
}

async function agentPassport(o: InviteOpts, agent: string): Promise<{ sponsor: string } | undefined> {
  const recs = (await o.log.log.recordsOfTypes(["passport"])) as AspRecord[];
  const p = [...recs].reverse().map((r) => r.body as { did?: string; kind?: string; sponsor?: string }).find((b) => b.did === agent);
  return p?.kind === "agent" && p.sponsor ? { sponsor: p.sponsor } : undefined;
}

/** Splits the daily total across the institutions so the sum of the caps never passes it. */
export function inviteLines(institutions: string[], perDay: number) {
  const each = Math.floor(perDay / institutions.length);
  if (each < 1) throw new InviteUsage("--per-day must give every named institution at least 1 credit");
  return institutions.map((institution) => ({ institution, cap: { value: each, unit: "credit" as const }, period: "day" as const }));
}

export async function inviteCmd(sub: "invite" | "revoke", o: InviteOpts): Promise<number> {
  const agent = o.flags.agent;
  if (!agent) throw new InviteUsage("asp society invite --agent <did> --institutions market,academy --per-day <n> [--days 90] | asp society revoke --agent <did>");
  const pass = await agentPassport(o, agent);
  if (!pass) { o.io.out(`${agent} is not an agent with a sponsor in this log: only a sponsor invites its own agent`); return 1; }
  const sponsor = pass.sponsor;
  if (sub === "revoke") return revoke(o, agent, sponsor);
  const names = (o.flags.institutions ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!names.length) throw new InviteUsage("--institutions names at least one institution (for example market,academy)");
  for (const n of names) if (!INSTITUTIONS.has(n)) throw new InviteUsage(`unknown institution "${n}"; choose from ${[...INSTITUTIONS].join(", ")}`);
  const perDay = Number(o.flags["per-day"]);
  if (!Number.isInteger(perDay) || perDay < 1) throw new InviteUsage("--per-day must be a whole number of credits, 1 or more");
  const days = o.flags.days === undefined ? 90 : Number(o.flags.days);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new InviteUsage("--days must be a whole number from 1 to 365");
  const lines = inviteLines(names, perDay);
  const at = o.now();
  const expires = new Date(Date.parse(at) + days * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
  const sp = o.signerFor(sponsor), ag = o.signerFor(agent);
  const one = { value: 1, unit: "credit" as const };
  const contract = cosign(createRecord({ type: "contract", issuer: sponsor, subject: agent, prev: null, issued_at: at, body: { principal: sponsor, performer: agent, bank: sponsor, purpose: INVITE_PURPOSE, price: one, verification: "principal", deadline: expires, basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } } }, sp), ag);
  await o.log.append(contract);
  const bond = createRecord({ type: "bond", issuer: sponsor, subject: contract.id, prev: contract.id, issued_at: at, body: { contract: contract.id, backer: sponsor, amount: one, escrow: { payer: sponsor, amount: one }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] } }, sp);
  await o.log.append(bond);
  const m = createRecord({ type: "mandate", issuer: sponsor, subject: agent, prev: bond.id, issued_at: at, body: {
    contract: contract.id, purpose: INVITE_PURPOSE, floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "forbid" },
    subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires, revocable: true,
    institution_spend: lines,
  } }, sp);
  const res = await o.log.append(m);
  o.io.out(`invited ${agent} to the society: Mandate ${res.id} (log seq ${res.seq}) lets it spend at most ${perDay} credits a day across ${names.join(", ")} until ${expires}`);
  o.io.out("  nothing else about the agent changed: its other Mandates and scopes are as they were");
  o.io.out(`  claim its starter credits on the service: asp account starter --did ${agent}`);
  o.io.out(`  end it at once: asp society revoke --agent ${agent}`);
  return 0;
}

async function revoke(o: InviteOpts, agent: string, sponsor: string): Promise<number> {
  const mandates = ((await o.log.log.mandatesOf(agent)) as AspRecord[]).filter((m) => m.issuer === sponsor && (m.body as { purpose?: string }).purpose === INVITE_PURPOSE);
  let ended = 0;
  for (const m of mandates) {
    const contract = (m.body as { contract: string }).contract;
    const esc = await o.log.log.escrow(contract);
    if (!esc || esc.settled) continue;
    const head = (await o.log.log.chain(contract)).at(-1);
    if (!head) continue;
    const sp = o.signerFor(sponsor);
    const s = cosign(createRecord({ type: "settlement", issuer: sponsor, subject: contract, prev: head.id, issued_at: o.now(), body: {
      contract, basis: "revoked", escrow_released: { value: 0, unit: "credit" }, bond_returned: { value: esc.bondLocked, unit: "credit" }, bond_slashed: { value: 0, unit: "credit" }, pro_rata_permille: 0,
    } }, sp), sp);
    await o.log.append(s);
    ended++;
  }
  o.io.out(ended ? `revoked ${ended} invite(s) for ${agent}: it can buy nothing under them from now on; the credits locked came back to ${sponsor}` : `${agent} has no live invite from ${sponsor}`);
  return ended ? 0 : 1;
}
