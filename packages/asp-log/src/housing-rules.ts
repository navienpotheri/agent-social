/**
 * The log's rules for Housing's records (housing.md 3 and 5; register row DK38; spec-delta S270): a decor `holding` (signed by Housing, the same checks as the Shops' holding) and a `profile` (signed by the agent).
 * State lives in markers written inside the append, so a refused record leaves none.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import { projectHolding } from "./shops-rules.ts";
import { HOUSING_DID, LAYOUT_PREFIX, PROFILE_LIMITS, THEME_PREFIX, textProblem } from "./housing.ts";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);

/** A record is the agent's own when it signed it, it is about it, or the agent is its holder or performer. */
const belongsTo = (r: AspRecord, did: string): boolean => {
  const b = r.body as { holder?: string; performer?: string; agent?: string };
  return r.issuer === did || r.subject === did || b.holder === did || b.performer === did || b.agent === did;
};

export async function projectHousingAct(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as Record<string, any>;
  if (r.prev !== null) throw rule("housing_act_not_chained", "a housing act starts its own chain (prev is null)");
  if (b.act === "holding") return projectHolding(tx, r, HOUSING_DID);

  // profile
  if (r.issuer !== b.agent) throw rule("profile_not_agents", "an agent signs its own profile");
  if (!(await tx.getPassport(b.agent))) throw rule("profile_no_passport", `${b.agent} has no passport in this log: only an agent with a passport has a home`);
  const bad = textProblem("display_name", b.display_name ?? "", PROFILE_LIMITS.display_name)
    ?? textProblem("tagline", b.tagline ?? "", PROFILE_LIMITS.tagline)
    ?? textProblem("about", b.about ?? "", Number.MAX_SAFE_INTEGER, PROFILE_LIMITS.about_bytes);
  if (bad) throw rule(bad.rule, bad.message);
  const showcase: string[] = b.showcase ?? [];
  if (showcase.length > PROFILE_LIMITS.showcase) throw rule("showcase_full", `a home has ${PROFILE_LIMITS.showcase} showcase slots; ${showcase.length} were named`);
  if (new Set(showcase).size !== showcase.length) throw rule("showcase_duplicate", "a record is shown once");
  for (const id of showcase) {
    const rec = await tx.getRecord(id);
    if (!rec) throw rule("showcase_unknown", `${id} is not a record in this log`);
    if (!belongsTo(rec.record, b.agent)) throw rule("showcase_not_own", `${id} is not the agent's own record: a showcase shows only what the agent did`);
  }
  const owns = async (service: string | undefined, prefix: string, what: string) => {
    if (service === undefined) return;
    if (!service.startsWith(prefix)) throw rule("profile_decor_wrong_kind", `${service} is not a ${what}`);
    const until = await tx.getMarker(`holding_active:${b.agent}|${service}`);
    if (!until || Date.parse(until) <= Date.parse(r.issued_at)) throw rule("profile_decor_not_owned", `${b.agent} does not hold ${service}: buy it first (asp housing decor buy ${service}), and wait for the delivery`);
  };
  await owns(b.theme, THEME_PREFIX, "theme");
  await owns(b.layout, LAYOUT_PREFIX, "layout");
  await tx.putMarker(`profile:${b.agent}`, r.id);
}
