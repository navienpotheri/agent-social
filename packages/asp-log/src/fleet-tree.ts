/**
 * The fleet tree (register row DK1372; spec-delta S1409; docs/enterprise-fleets.md): a fleet is the root, under it departments, teams and persona nodes, and members sit on nodes. Each node can carry a Mandate
 * (the fields of a Mandate without its contract), a monthly budget in credits and tokens, and an owner. The log keeps three rules:
 *  1. a node's Mandate may only NARROW its nearest ancestor's (and the fleet's template at the root): `mandateViolations` names what widens, at every level, on a new node, on an amendment (which must also still contain
 *     every mandated node under it) and when the fleet's template is amended;
 *  2. the budgets of the children of a node sum to no more than the node's own, field by field, where the node states the field;
 *  3. credits a member spends at the institutions count against its node and every node above it in the UTC month, and a purchase over any of those budgets is refused (`node_budget_exceeded`); model tokens from
 *     Actions are counted the same way and REPORTED (the gateway enforces them; the record shape is in docs/gateway-design.md).
 * A member joins a node by naming it on its passport (`node`) or is moved by a signed `fleet_move`. State lives in markers written inside the append, so a refused record leaves none.
 * Credits are accounting entries, not money.
 */
import { AspError, mandateViolations, type AspRecord } from "@agent-social/asp-core";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);

export const ROOT = "root";
/** The deepest a tree may go (root is level 1). */
export const MAX_TREE_DEPTH = 8;
export type NodeKind = "fleet" | "department" | "team" | "persona";
export interface Budget { credits?: number; tokens?: number }
export interface TreeNode { fleet: string; node: string; version: number; record: string; kind: NodeKind; name: string; parent: string | null; owner: string; persona?: string; budget?: Budget; mandate?: Record<string, unknown> }

/** Which kinds may sit under which: a persona is a leaf, a department sits under the fleet or another department, a team under the fleet, a department or a team. */
const MAY_HOLD: Record<NodeKind, NodeKind[]> = { fleet: ["department", "team", "persona"], department: ["department", "team", "persona"], team: ["team", "persona"], persona: [] };

const nodeKey = (fleet: string, node: string) => `fnode:${fleet}|${node}`;
const kidsKey = (fleet: string, node: string) => `fnode_kids:${fleet}|${node}`;
/** The UTC month a record falls in, the period of a node budget. */
export const monthOf = (at: string): string => at.slice(0, 7);

export async function readNode(tx: LogTx, fleet: string, node: string): Promise<TreeNode | undefined> {
  const raw = await tx.getMarker(nodeKey(fleet, node));
  return raw ? (JSON.parse(raw) as TreeNode) : undefined;
}
export async function childrenOf(tx: LogTx, fleet: string, node: string): Promise<TreeNode[]> {
  const ids = ((await tx.getMarker(kidsKey(fleet, node))) ?? "").split(",").filter(Boolean);
  return (await Promise.all(ids.map((id) => readNode(tx, fleet, id)))).filter((n): n is TreeNode => !!n);
}
/** The node and its ancestors, node first, root last (empty when the node is not declared). */
export async function chainOf(tx: LogTx, fleet: string, node: string): Promise<TreeNode[]> {
  const out: TreeNode[] = [];
  let at: string | null = node;
  while (at) {
    const n = await readNode(tx, fleet, at);
    if (!n) break;
    out.push(n);
    at = n.parent;
  }
  return out;
}
/** The Mandate in force at a node: its own, else the nearest ancestor's (each is within the one above it, so the nearest is the tightest). */
export async function effectiveMandate(tx: LogTx, fleet: string, node: string): Promise<{ node: string; mandate: Record<string, unknown> } | undefined> {
  for (const n of await chainOf(tx, fleet, node)) if (n.mandate) return { node: n.node, mandate: n.mandate };
  return undefined;
}
async function fleetTemplate(tx: LogTx, fleet: string): Promise<Record<string, unknown> | undefined> {
  const head = Number((await tx.getMarker(`mtemplate_head:${fleet}|`)) ?? 0);
  return head ? (JSON.parse((await tx.getMarker(`mtemplate:${fleet}||${head}`))!) as { mandate: Record<string, unknown> }).mandate : undefined;
}

/** The first mandated node under `node` (excluding it) whose Mandate goes beyond `ceiling`, with the fields. Nodes without a Mandate are looked through: they inherit the ceiling. */
export async function firstWideningBelow(tx: LogTx, fleet: string, node: string, ceiling: Record<string, unknown>): Promise<{ node: string; fields: string[] } | undefined> {
  for (const c of await childrenOf(tx, fleet, node)) {
    if (c.mandate) { const v = mandateViolations(ceiling, c.mandate); if (v.length) return { node: c.node, fields: v }; continue; }
    const deeper = await firstWideningBelow(tx, fleet, c.node, ceiling);
    if (deeper) return deeper;
  }
  return undefined;
}
/** When a fleet's template is amended, every mandated node under the root must still be within it. */
export async function checkTemplateAgainstTree(tx: LogTx, fleet: string, template: Record<string, unknown>): Promise<void> {
  const root = await readNode(tx, fleet, ROOT);
  if (!root) return;
  if (root.mandate) { const v = mandateViolations(template, root.mandate); if (v.length) throw rule("template_below_node", `the fleet's root Mandate goes beyond the amended template: ${v.join(", ")}`); return; }
  const w = await firstWideningBelow(tx, fleet, ROOT, template);
  if (w) throw rule("template_below_node", `node ${w.node} has a Mandate that would go beyond the amended template: ${w.fields.join(", ")}; narrow it first`);
}

const budgetFields = ["credits", "tokens"] as const;

/** A fleet node (S1409). */
export async function projectFleetNode(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as unknown as { fleet: string; node: string; version: number; kind: NodeKind; name: string; parent?: string; owner: string; persona?: string; budget?: Budget; mandate?: Record<string, unknown> };
  if (r.prev !== null) throw rule("fleet_node_not_chained", "a fleet node starts its own chain (prev is null)");
  const fleet = await tx.getFleet(b.fleet);
  if (!fleet) throw rule("fleet_node_fleet_unknown", `fleet ${b.fleet} is not declared`);
  if (r.issuer !== fleet.org) throw rule("fleet_node_wrong_issuer", `only the fleet's organisation (${fleet.org}) signs its tree`);
  if (!(await tx.getPassport(b.owner))) throw rule("fleet_node_owner_unknown", `${b.owner} has no passport in this log: the owner of a node is an identity the log knows`);
  const head = Number((await tx.getMarker(`fnode_head:${b.fleet}|${b.node}`)) ?? 0);
  if (b.version !== head + 1) throw rule("fleet_node_version", `the next version of node ${b.node} is ${head + 1}, not ${b.version}`);
  const before = head ? await readNode(tx, b.fleet, b.node) : undefined;
  if (before && (before.kind !== b.kind || before.parent !== (b.parent ?? null))) throw rule("fleet_node_immutable", `node ${b.node}'s kind and parent never change`);

  let parent: TreeNode | undefined;
  if (b.kind !== "fleet") {
    parent = await readNode(tx, b.fleet, b.parent!);
    if (!parent) throw rule("fleet_node_parent_unknown", `node ${b.parent} is not declared in ${b.fleet}: declare the parent first (the root is declared first)`);
    if (!MAY_HOLD[parent.kind].includes(b.kind)) throw rule("fleet_node_kind", `a ${parent.kind} node cannot hold a ${b.kind} node`);
    const depth = (await chainOf(tx, b.fleet, parent.node)).length + 1;
    if (depth > MAX_TREE_DEPTH) throw rule("fleet_node_too_deep", `a tree is at most ${MAX_TREE_DEPTH} levels deep`);
  }
  if (b.persona && b.kind !== "persona") throw rule("fleet_node_persona_kind", "only a persona node names a persona");

  // 1. the Mandate: within the nearest ancestor's (the fleet's template at the root), and the nodes below must stay within it
  if (b.mandate) {
    const ceiling = parent ? (await effectiveMandate(tx, b.fleet, parent.node))?.mandate ?? (await fleetTemplate(tx, b.fleet)) : await fleetTemplate(tx, b.fleet);
    if (ceiling) { const v = mandateViolations(ceiling, b.mandate); if (v.length) throw rule("node_mandate_widens", `node ${b.node}'s Mandate may only narrow ${parent ? `its parent's (${parent.node})` : "the fleet's template"}: ${v.join(", ")} go beyond it`); }
    if (before) { const w = await firstWideningBelow(tx, b.fleet, b.node, b.mandate); if (w) throw rule("node_mandate_below", `node ${w.node} under ${b.node} has a Mandate that would go beyond the amended one: ${w.fields.join(", ")}; narrow it first`); }
  }

  // 2. the budget: within the parent's left after its other children, and holding what the children already take
  const kids = before ? await childrenOf(tx, b.fleet, b.node) : [];
  for (const f of budgetFields) {
    const mine = b.budget?.[f];
    if (parent?.budget?.[f] !== undefined) {
      if (mine === undefined) throw rule("node_budget_needed", `${parent.node} states a ${f} budget, so node ${b.node} states its share of it`);
      const siblings = (await childrenOf(tx, b.fleet, parent.node)).filter((s) => s.node !== b.node).reduce((s, n) => s + (n.budget?.[f] ?? 0), 0);
      if (siblings + mine > parent.budget[f]!) throw rule("node_budget_exceeds_parent", `node ${b.node} asks ${mine} ${f}; ${parent.node} has ${parent.budget[f]} and its other children take ${siblings}`);
    }
    if (mine !== undefined) {
      const taken = kids.reduce((s, n) => s + (n.budget?.[f] ?? 0), 0);
      if (taken > mine) throw rule("node_budget_below_children", `node ${b.node}'s ${f} budget ${mine} is below the ${taken} its children take`);
    }
  }

  const row: TreeNode = { fleet: b.fleet, node: b.node, version: b.version, record: r.id, kind: b.kind, name: b.name, parent: b.parent ?? null, owner: b.owner, ...(b.persona ? { persona: b.persona } : {}), ...(b.budget ? { budget: b.budget } : {}), ...(b.mandate ? { mandate: b.mandate } : {}) };
  await tx.putMarker(nodeKey(b.fleet, b.node), JSON.stringify(row));
  await tx.putMarker(`fnode_head:${b.fleet}|${b.node}`, String(b.version));
  if (!before) {
    if (b.parent) await tx.putMarker(kidsKey(b.fleet, b.parent), [...((await tx.getMarker(kidsKey(b.fleet, b.parent))) ?? "").split(",").filter(Boolean), b.node].join(","));
    await tx.putMarker(`fnodes:${b.fleet}`, [...((await tx.getMarker(`fnodes:${b.fleet}`)) ?? "").split(",").filter(Boolean), b.node].join(","));
  }
}

async function bump(tx: LogTx, key: string, by: number): Promise<number> { const v = Number((await tx.getMarker(key)) ?? 0) + by; await tx.putMarker(key, String(v)); return v; }

/** A member joins a node (on its first passport in the fleet): the node must be declared, or be the root. A later passport may not change the node: that is a `fleet_move`. */
export async function noteMemberJoin(tx: LogTx, member: string, fleet: string, node: string | undefined, alreadyMember: boolean): Promise<void> {
  const current = await tx.getMarker(`fnode_of:${member}`);
  if (alreadyMember && current) {
    if (node !== undefined && node !== current) throw rule("node_use_fleet_move", `${member} is on node ${current}; a move to ${node} is a signed fleet_move, not a new passport`);
    return;
  }
  const to = node ?? ROOT;
  if (to !== ROOT && !(await readNode(tx, fleet, to))) throw rule("node_unknown", `node ${to} is not declared in ${fleet}`);
  if (to !== ROOT && (await readNode(tx, fleet, to))!.kind === "fleet") throw rule("node_unknown", "the root is not named");
  await tx.putMarker(`fnode_of:${member}`, to);
  await bump(tx, `fnode_n:${fleet}|${to}`, 1);
}

/** A member moves to another node (S1409): signed by the organisation, the owner of the node it moves to, or the member's own sponsor. */
export async function projectFleetMove(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as unknown as { fleet: string; member: string; to: string };
  if (r.prev !== null) throw rule("fleet_move_not_chained", "a fleet move starts its own chain (prev is null)");
  const fleet = await tx.getFleet(b.fleet);
  if (!fleet) throw rule("fleet_move_fleet_unknown", `fleet ${b.fleet} is not declared`);
  const pass = await tx.getPassport(b.member);
  if (!pass || pass.fleet !== b.fleet) throw rule("fleet_move_not_a_member", `${b.member} is not a member of ${b.fleet}`);
  const dest = b.to === ROOT ? undefined : await readNode(tx, b.fleet, b.to);
  if (b.to !== ROOT && !dest) throw rule("node_unknown", `node ${b.to} is not declared in ${b.fleet}`);
  const owner = dest?.owner ?? fleet.org;
  if (r.issuer !== fleet.org && r.issuer !== owner && r.issuer !== pass.sponsor) throw rule("fleet_move_wrong_issuer", `a move is signed by the organisation, the owner of the node it moves to (${owner}) or the member's sponsor`);
  const from = (await tx.getMarker(`fnode_of:${b.member}`)) ?? ROOT;
  if (from === b.to) throw rule("fleet_move_same_node", `${b.member} is on node ${from} already`);
  await bump(tx, `fnode_n:${b.fleet}|${from}`, -1);
  await bump(tx, `fnode_n:${b.fleet}|${b.to}`, 1);
  await tx.putMarker(`fnode_of:${b.member}`, b.to);
  await bump(tx, `fmoves:${b.fleet}`, 1);
}

/** The node a member sits on, with the Mandate in force there and the nodes above it. */
export async function nodeOfMember(tx: LogTx, member: string): Promise<{ fleet: string; node: string } | undefined> {
  const pass = await tx.getPassport(member);
  if (!pass?.fleet) return undefined;
  return { fleet: pass.fleet, node: (await tx.getMarker(`fnode_of:${member}`)) ?? ROOT };
}

/** The members whose node is this node or sits below it (S1423): who a node breaker halts. */
export async function subtreeMembers(tx: LogTx, fleet: string, node: string): Promise<string[]> {
  const out: string[] = [];
  for (const m of await tx.fleetMembers(fleet)) {
    const at = (await tx.getMarker(`fnode_of:${m.did}`)) ?? ROOT;
    if (node === ROOT || (await chainOf(tx, fleet, at)).some((n) => n.node === node) || at === node) out.push(m.did);
  }
  return out;
}

const spentKey = (fleet: string, node: string, month: string) => `nspent:${fleet}|${node}|${month}`;
const tokensKey = (fleet: string, node: string, month: string) => `ntokens:${fleet}|${node}|${month}`;

/** Credits a member spends at the institutions (S1409): the node and every node above it must have room in the UTC month; refused otherwise, recorded when it passes. */
export async function chargeNodeCredits(tx: LogTx, member: string, amount: number, at: string): Promise<void> {
  const at0 = await nodeOfMember(tx, member);
  if (!at0) return;
  const month = monthOf(at);
  const chain = await chainOf(tx, at0.fleet, at0.node);
  for (const n of chain) {
    const cap = n.budget?.credits;
    if (cap === undefined) continue;
    const spent = Number((await tx.getMarker(spentKey(at0.fleet, n.node, month))) ?? 0);
    if (spent + amount > cap) throw rule("node_budget_exceeded", `node ${n.node} (${n.name}) has a budget of ${cap} credits a month and ${spent} are spent in ${month}, so ${amount} more would be ${spent + amount}`);
  }
  for (const n of chain) await bump(tx, spentKey(at0.fleet, n.node, month), amount);
  // a member that sits on the root with no declared tree still counts at the root
  if (!chain.length) await bump(tx, spentKey(at0.fleet, ROOT, month), amount);
}

/** Tokens an Action reports (S1409): counted for the node and every node above it; never a refusal, because an Action reports what already happened. */
export async function noteNodeTokens(tx: LogTx, member: string, tokens: number, at: string): Promise<void> {
  if (tokens <= 0) return;
  const at0 = await nodeOfMember(tx, member);
  if (!at0) return;
  const month = monthOf(at);
  const chain = await chainOf(tx, at0.fleet, at0.node);
  for (const n of chain.length ? chain : [{ node: ROOT }]) await bump(tx, tokensKey(at0.fleet, n.node, month), tokens);
}

export interface NodeUsage { credits: { spent: number; budget: number | null; left: number | null }; tokens: { used: number; budget: number | null; over: boolean } }
export interface TreeView { fleet: string; month: string; nodes: (TreeNode & { members: number; subtreeMembers: number; depth: number; usage: NodeUsage; halt?: { id: string; reason: string; at: string } })[]; members: number; moves: number }

/** The tree of a fleet with member counts and usage, parents before children (S1409): what the dashboard and the journey view read. */
export async function readTree(tx: LogTx, fleet: string, month: string): Promise<TreeView | undefined> {
  if (!(await tx.getFleet(fleet))) return undefined;
  const ids = [ROOT, ...((await tx.getMarker(`fnodes:${fleet}`)) ?? "").split(",").filter(Boolean).filter((x) => x !== ROOT)];
  const nodes = new Map<string, TreeNode>();
  for (const id of ids) { const n = await readNode(tx, fleet, id); if (n) nodes.set(id, n); }
  const total = (await tx.fleetMembers(fleet)).length;
  const direct = new Map<string, number>();
  let assigned = 0;
  for (const id of nodes.keys()) if (id !== ROOT) { const c = Number((await tx.getMarker(`fnode_n:${fleet}|${id}`)) ?? 0); direct.set(id, c); assigned += c; }
  // members on the root are those not on another node, whether the root is declared or not
  direct.set(ROOT, total - assigned);
  const out: TreeView["nodes"] = [];
  const walk = async (id: string, depth: number): Promise<number> => {
    const n = nodes.get(id);
    const placeholder: TreeNode = { fleet, node: ROOT, version: 0, record: "", kind: "fleet", name: "(not declared)", parent: null, owner: "" };
    const row = n ?? placeholder;
    const idx = out.length;
    const spent = Number((await tx.getMarker(spentKey(fleet, id, month))) ?? 0), used = Number((await tx.getMarker(tokensKey(fleet, id, month))) ?? 0);
    const budget = row.budget?.credits ?? null, tb = row.budget?.tokens ?? null;
    const haltRaw = await tx.getMarker(`node_halt:${fleet}|${id}`);
    out.push({ ...row, ...(haltRaw ? { halt: JSON.parse(haltRaw) as { id: string; reason: string; at: string } } : {}), members: direct.get(id) ?? 0, subtreeMembers: 0, depth, usage: { credits: { spent, budget, left: budget === null ? null : Math.max(0, budget - spent) }, tokens: { used, budget: tb, over: tb !== null && used > tb } } });
    let sub = direct.get(id) ?? 0;
    for (const c of await childrenOf(tx, fleet, id)) sub += await walk(c.node, depth + 1);
    out[idx].subtreeMembers = sub;
    return sub;
  };
  await walk(ROOT, 0);
  return { fleet, month, nodes: out, members: total, moves: Number((await tx.getMarker(`fmoves:${fleet}`)) ?? 0) };
}
