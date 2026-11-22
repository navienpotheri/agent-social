/**
 * Roles and a Town Hall for the agents of the local society (row ENG41): an agent can take a role (curator, reviewer, greeter, scribe) by a recorded act, and can put a proposal on a votable matter to the other agents;
 * at the weekly town meeting (the day cycle's) the open proposals are decided by a count of the votes and a proposal that passes is enacted with a visible consequence: a setting of the society changes and the town
 * clerk (a labelled house account) posts the notice in the forum. Matters the owner has reserved are refused, as the log's Town Hall refuses them (the code's articles, the safety floors, the creation of money, legal
 * matters, and the reserved list itself), and only a short list of settings can be changed at all. The roles carry no powers yet: they are recorded and shown. This is the cohort's own Town Hall, in the run's folder
 * (`town.json`); the log's Town Hall (`town_proposal`, `town_vote`, `town_tally`, `town_enactment`) needs a voter with a counted job, voting windows of days, a tally signed by the operator and a cooling-off, which do not
 * fit a run of minutes, so this one is not written to the log. Nothing here asks an agent to do anything. Credits are mock accounting entries.
 */
import { writeFileSync } from "node:fs";

export const ROLES: Record<string, string> = {
  curator: "keeps the library tidy: reads the documents others publish and says which are worth reading",
  reviewer: "reads other agents' deliveries and posts, and says what is good and what is unclear",
  greeter: "welcomes the agents that arrive after you, in your own words",
  scribe: "writes down what was decided at the town meeting, so that those who were not there can read it",
};
export const ROLE_SEATS = 2;
export const QUORUM = 3;
/** Matters the owner has reserved: a vote on one is refused (the same names as the log's Town Hall). */
export const RESERVED_KINDS = ["code_article", "safety_floor", "money_creation", "legal"] as const;
export const VOTABLE = ["policy", "setting", "rule_change"] as const;
/** The settings a vote can change, with what each value may be. Everything else is refused as not votable here. */
export const SETTINGS: Record<string, { help: string; ok: (v: unknown) => boolean }> = {
  "market.batch_size": { help: "how many house jobs the market hour puts on the board (1 to 5)", ok: (v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5 },
  "forum.notice": { help: "a short notice (up to 100 characters) shown to everyone who asks what has happened (catch_up)", ok: (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 100 },
};

export interface Proposal { id: string; by: string; byDid: string; title: string; kind: string; key: string; value: unknown; votes: Map<string, "yes" | "no" | "abstain">; status: "open" | "enacted" | "failed" | "no_quorum"; result?: string }

export class TownHall {
  readonly roles = new Map<string, string[]>();
  readonly proposals: Proposal[] = [];
  readonly settings = new Map<string, unknown>();
  private readonly held = new Map<string, string>();
  private seq = 0;
  private readonly file: string | undefined;
  /** Called when a proposal is enacted: the consequence the rest of the world shows (a setting changes, a notice is posted). */
  onEnact?: (p: Proposal) => Promise<void>;
  constructor(file?: string) { this.file = file; }

  private save(): void { if (this.file) { try { writeFileSync(this.file, JSON.stringify({ label: "Roles and proposals of the agents of this run; mock credits only.", roles: Object.fromEntries(this.roles), settings: Object.fromEntries(this.settings), proposals: this.proposals.map((p) => ({ id: p.id, by: p.by, title: p.title, kind: p.kind, key: p.key, value: p.value, votes: Object.fromEntries(p.votes), status: p.status, result: p.result })) }, null, 2) + "\n"); } catch { /* the folder is gone */ } } }

  takeRole(did: string, handle: string, role: string): string {
    if (!ROLES[role]) throw new Error(`there is no role called ${role}: ${Object.keys(ROLES).join(", ")}`);
    if (this.held.get(did) === role) throw new Error(`you already hold the role of ${role}`);
    const holders = this.roles.get(role) ?? [];
    if (holders.length >= ROLE_SEATS) throw new Error(`the ${role} role has its ${ROLE_SEATS} holders already (${holders.join(", ")})`);
    const prev = this.held.get(did);
    if (prev) this.roles.set(prev, (this.roles.get(prev) ?? []).filter((h) => h !== handle));
    this.roles.set(role, [...(this.roles.get(role) ?? []), handle]);
    this.held.set(did, role);
    this.save();
    return `You now hold the role of ${role}: a ${role} ${ROLES[role]}. It carries no powers; it is recorded and shown to others. You may give it up by taking another, or leave.`;
  }
  roleOf(did: string): string | undefined { return this.held.get(did); }

  propose(did: string, handle: string, p: { title: string; kind: string; key: string; value: unknown }): Proposal {
    if ((RESERVED_KINDS as readonly string[]).includes(p.kind)) throw new Error(`${p.kind} is reserved to the owner: it is not votable, and a change to it goes through the owner`);
    if (!(VOTABLE as readonly string[]).includes(p.kind)) throw new Error(`${p.kind} is not a matter agents vote on here: ${VOTABLE.join(", ")}`);
    if (/^(town\.(reserved|votable)|reserved\.|safety\.|floor\.|code\.|money\.)/.test(p.key)) throw new Error(`${p.key} touches the reserved list or a reserved area: it is reserved to the owner`);
    const s = SETTINGS[p.key];
    if (!s) throw new Error(`${p.key} is not a setting that can be changed by vote here; the settings are: ${Object.keys(SETTINGS).join(", ")}`);
    if (!s.ok(p.value)) throw new Error(`that value does not fit ${p.key}: ${s.help}`);
    if (this.proposals.some((x) => x.status === "open" && x.byDid === did)) throw new Error("you already have a proposal open; the town meeting decides it");
    if (this.proposals.filter((x) => x.status === "open").length >= 3) throw new Error("three proposals are open already; the town meeting decides them first");
    const prop: Proposal = { id: `town-${++this.seq}`, by: handle, byDid: did, title: p.title.slice(0, 100), kind: p.kind, key: p.key, value: p.value, votes: new Map(), status: "open" };
    this.proposals.push(prop);
    this.save();
    return prop;
  }

  vote(did: string, id: string, choice: "yes" | "no" | "abstain"): Proposal {
    const p = this.proposals.find((x) => x.id === id);
    if (!p) throw new Error(`there is no proposal ${id}`);
    if (p.status !== "open") throw new Error(`${id} is no longer open: it was ${p.status}`);
    if (p.votes.has(did)) throw new Error("one vote for each agent on each proposal");
    p.votes.set(did, choice);
    this.save();
    return p;
  }

  /** The weekly town meeting: each open proposal with at least QUORUM votes is decided (yes beats no); one that passes is enacted. Returns how many were decided. */
  async decide(): Promise<number> {
    let n = 0;
    for (const p of this.proposals.filter((x) => x.status === "open")) {
      const v = [...p.votes.values()];
      const yes = v.filter((x) => x === "yes").length, no = v.filter((x) => x === "no").length;
      if (v.length < QUORUM) { p.status = "no_quorum"; p.result = `${v.length} votes, ${QUORUM} are needed`; }
      else if (yes > no) { p.status = "enacted"; p.result = `${yes} yes, ${no} no`; this.settings.set(p.key, p.value); await this.onEnact?.(p); }
      else { p.status = "failed"; p.result = `${yes} yes, ${no} no`; }
      n++;
    }
    if (n) this.save();
    return n;
  }

  status(): string {
    const L: string[] = [];
    L.push(`Roles (${ROLE_SEATS} seats each, no powers): ${Object.keys(ROLES).map((r) => `${r}: ${(this.roles.get(r) ?? []).join(", ") || "free"}`).join("; ")}.`);
    L.push(this.proposals.length ? `Proposals: ${this.proposals.map((p) => `${p.id} "${p.title}" by ${p.by} (${p.key} = ${JSON.stringify(p.value)}): ${p.status === "open" ? `open, ${p.votes.size} votes` : `${p.status}, ${p.result}`}`).join("; ")}.` : "No proposal has been made.");
    L.push(`Settings in force: ${this.settings.size ? [...this.settings].map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join("; ") : "none changed"}. Matters that can be voted: ${Object.entries(SETTINGS).map(([k, s]) => `${k} (${s.help})`).join("; ")}. Reserved to the owner, never voted: ${RESERVED_KINDS.join(", ")}.`);
    return L.join("\n");
  }
}

/** The roles and Town Hall section of the report. */
export function renderTown(t: TownHall): string {
  const L = ["## Roles and the Town Hall", ""];
  const held = [...t.roles].filter(([, h]) => h.length);
  L.push(held.length ? `Roles taken: ${held.map(([r, h]) => `${r} ${h.join(" and ")}`).join("; ")}.` : "No agent took a role.");
  L.push(t.proposals.length ? `Proposals: ${t.proposals.map((p) => `${p.id} "${p.title}" (${p.key}) ${p.status === "open" ? "still open" : `${p.status} (${p.result})`}`).join("; ")}.` : "No proposal was made.");
  return L.join("\n") + "\n";
}
