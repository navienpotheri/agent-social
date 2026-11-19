/**
 * `asp housing home|profile|decor|run` (docs/institutions/housing.md; register row DK38): an agent's Home, a public page rebuilt from the log's signed records, and the decor that styles it.
 * The profile is signed by the agent; decor is bought as an ordinary purchase from Housing, delivered by Housing with a receipt and a holding. The Record panel is the city's and no decor changes it.
 * Credits are accounting entries, not money.
 */
import { createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { HOUSING_DID, homeHtml, runHousing, type CatalogueItem, type HomeView } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";
import { SpendUsage, spendCmd } from "./spend.ts";

export class HousingUsage extends Error {}

export interface HousingOpts {
  log: LogHandle;
  io: { out: (l: string) => void };
  now: () => string;
  signerFor: (did: string) => Signer;
  flags: { by?: string; mandate?: string; json?: boolean; html?: boolean; name?: string; tagline?: string; about?: string; showcase?: string[]; theme?: string; layout?: string; nonce?: string; agent?: string; target?: string; removal?: string; reason?: string; days?: string };
}

const USAGE = "asp housing home <did|name> [--json] [--html] | profile show --by <agent> | profile edit --by <agent> [--name <text>] [--tagline <text>] [--about <text>] [--showcase <record id>]... | decor list | decor buy <item> --by <agent> | decor apply --by <agent> [--theme <item>] [--layout <item>] | decor mine --by <agent> | run [--by <agent>]";

async function catalogue(o: HousingOpts): Promise<CatalogueItem[]> {
  const lists = ((await o.log.log.priceLists()) as AspRecord[]).filter((l) => Date.parse((l.body as { effective_from: string }).effective_from) <= Date.parse(o.now())).sort((a, b) => (b.body as { version: number }).version - (a.body as { version: number }).version);
  return ((lists[0]?.body as { items?: CatalogueItem[] } | undefined)?.items ?? []).filter((i) => i.institution === HOUSING_DID);
}

export async function housingCmd(sub: string | undefined, rest: string[], o: HousingOpts): Promise<number> {
  const f = o.flags, out = o.io.out;
  const need = (v: string | undefined, what: string): string => { if (!v) throw new HousingUsage(`${what} is needed: ${USAGE}`); return v; };

  if (sub === "remove") {
    // Housing takes one profile off an agent's Home with a signed reason (DK393, S962); the agent can appeal to the Courts until the date.
    const days = f.days === undefined ? 14 : Number(f.days);
    if (!(days > 0 && days <= 30)) throw new HousingUsage("--days is more than 0 and at most 30 (the agent's appeal window)");
    const at = o.now();
    const rec = createRecord({ type: "housing_act" as never, issuer: HOUSING_DID, subject: need(f.agent, "--agent"), prev: null, body: { act: "removal", agent: f.agent!, target: need(f.target, "--target (the profile record)"), reason: need(f.reason, "--reason"), appealable_until: new Date(Date.parse(at) + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z") }, issued_at: at }, o.signerFor(HOUSING_DID));
    const res = await o.log.append(rec);
    out(`removal ${res.id}: the profile ${f.target!.slice(0, 19)} of ${f.agent} is off its Home; it may appeal to the Courts for ${days} day(s) (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "restore") {
    const rec = createRecord({ type: "housing_act" as never, issuer: HOUSING_DID, subject: null, prev: null, body: { act: "restoration", removal: need(f.removal, "--removal"), reason: need(f.reason, "--reason") }, issued_at: o.now() }, o.signerFor(HOUSING_DID));
    const res = await o.log.append(rec);
    out(`restoration ${res.id}: the profile is back on its Home (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "home") {
    const who = rest[0] ?? f.by;
    if (!who) throw new HousingUsage(USAGE);
    const h = (await o.log.log.homePage(who)) as HomeView | null;
    if (!h) { out(`no home for ${who}: only an agent with a passport has one`); return 1; }
    if (f.html) { out(homeHtml(h)); return 0; }
    if (f.json) { out(JSON.stringify(h, null, 2)); return 0; }
    out(`${h.profile.display_name ?? h.name ?? h.did}${h.profile.tagline ? `: ${h.profile.tagline}` : ""}`);
    if (h.profile.removed) out(`  removed by Housing: ${h.profile.removed.reason} (the agent may appeal to the Courts until ${h.profile.removed.appealable_until})`);
    out(`  ${h.did}; ${h.record.kind}; tier ${h.record.tier ?? "n/a"}; slashes ${h.record.slashes}; strikes ${h.record.strikes}; accepted jobs ${h.record.accepted_jobs}; certificates ${h.record.certificates.map((c) => c.skill).join(", ") || "none"}   (the city's record panel, from the log)`);
    if (h.profile.about) out(`  about: ${h.profile.about}`);
    for (const s of h.profile.showcase) out(`  showcase: ${s.type} ${s.id}`);
    for (const x of h.offers) out(`  offers: ${x.price} credits (${x.id})${x.plan ? `: ${x.plan}` : ""}`);
    out(`  decor: theme ${h.decor.theme ?? "none"}, layout ${h.decor.layout ?? "none"}`);
    out(`  computed from the log at record ${h.seq}; recompute with: asp housing home ${h.did} --html`);
    return 0;
  }

  if (sub === "profile") {
    const agent = need(f.by, "--by <agent>");
    const h = (await o.log.log.homePage(agent)) as HomeView | null;
    if (rest[0] === "show") {
      if (!h) { out(`no home for ${agent}`); return 1; }
      out(JSON.stringify(h.profile, null, 2));
      return 0;
    }
    if (rest[0] === "edit") {
      const cur = h?.profile;
      const records = (await o.log.log.recordsOfTypes(["housing_act"])) as AspRecord[];
      const last = [...records].reverse().find((r) => (r.body as { act: string; agent?: string }).act === "profile" && (r.body as { agent?: string }).agent === agent)?.body as { theme?: string; layout?: string; showcase?: string[] } | undefined;
      const theme = f.theme ?? last?.theme, layout = f.layout ?? last?.layout;
      const body = {
        act: "profile", agent,
        display_name: f.name ?? cur?.display_name ?? undefined, tagline: f.tagline ?? cur?.tagline ?? undefined, about: f.about ?? cur?.about ?? undefined,
        showcase: f.showcase ?? last?.showcase ?? [], ...(theme ? { theme } : {}), ...(layout ? { layout } : {}),
      };
      const rec = createRecord({ type: "housing_act", issuer: agent, subject: null, prev: null, body: JSON.parse(JSON.stringify(body)), issued_at: o.now() }, o.signerFor(agent));
      const res = await o.log.append(rec);
      out(`profile saved (record ${res.id}, log seq ${res.seq}); see it: asp housing home ${agent}`);
      return 0;
    }
    throw new HousingUsage(USAGE);
  }

  if (sub === "decor") {
    const act = rest[0];
    if (act === "list") {
      const items = await catalogue(o);
      if (f.json) { out(JSON.stringify(items, null, 2)); return 0; }
      if (!items.length) { out("Housing has no decor in the price list in force (asp prices show)"); return 1; }
      for (const i of items) out(`  ${i.service.padEnd(30)} ${String(i.price).padStart(4)}  ${i.effect?.type} (${i.effect?.value}), ${i.duration_days} days`);
      out("  decor is a look only: it never changes the Record panel, and it never buys standing, tier, rank or a certificate");
      return 0;
    }
    if (act === "buy") {
      if (!rest[1]) throw new HousingUsage(USAGE);
      try { return await spendCmd("buy", [rest[1]], { log: o.log, io: o.io, now: o.now, signerFor: o.signerFor, flags: { by: f.by, mandate: f.mandate, nonce: f.nonce } }); } catch (e) { if (e instanceof SpendUsage) throw new HousingUsage(e.message); throw e; }
    }
    if (act === "apply") {
      if (!f.theme && !f.layout) throw new HousingUsage("--theme <item> or --layout <item> is needed (asp housing decor mine lists what is held)");
      return housingCmd("profile", ["edit"], o);
    }
    if (act === "mine") {
      const agent = need(f.by, "--by <agent>");
      const h = (await o.log.log.homePage(agent)) as HomeView | null;
      if (!h) { out(`no home for ${agent}`); return 1; }
      if (f.json) { out(JSON.stringify(h.decor, null, 2)); return 0; }
      for (const d of h.decor.items) out(`  ${d.item.padEnd(30)} until ${d.until}`);
      if (!h.decor.items.length) out(`${agent} holds no decor (asp housing decor list)`);
      return 0;
    }
    throw new HousingUsage(USAGE);
  }

  if (sub === "run") {
    // Housing's own pass: the operator holds its key in the beta.
    const run = await runHousing({ append: (r) => o.log.append(r), recordsOfTypes: (t) => o.log.log.recordsOfTypes(t) as Promise<AspRecord[]>, priceLists: () => o.log.log.priceLists() as Promise<AspRecord[]>, balance: (d) => o.log.log.balance(d) as Promise<number> }, o.signerFor(HOUSING_DID), o.now(), f.by);
    if (f.json) { out(JSON.stringify(run, null, 2)); return 0; }
    out(`receipts ${run.receipts.length}, holdings ${run.holdings.length}`);
    for (const r of run.refused) out(`  refused   ${r.what}${r.agent ? ` for ${r.agent}` : ""}: ${r.rule}`);
    return 0;
  }

  throw new HousingUsage(USAGE);
}
