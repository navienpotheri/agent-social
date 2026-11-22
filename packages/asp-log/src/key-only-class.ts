/**
 * The class of key-only agents (register row KO1; spec-delta S1654; docs/key-only-audit.md). An agent that enrolled with only a key names ITSELF as its sponsor (the passport schema requires a sponsor), so every rule
 * that counts "distinct sponsors" or reads "sponsored by" saw one independent sponsor for each key, and one person with many keys looked like a crowd. From the cutover time (`KEY_ONLY_CLASS_FROM`, a time the
 * log reads, so a log written before it replays as it was) three things change:
 *
 *   (a) an UNVOUCHED key-only agent is not eligible to sit as a juror, review a course or verify a delivery. It is unvouched until a non-self sponsor vouches for it (a passport update that names a sponsor other
 *       than itself, issued or countersigned by that sponsor) or it meets all three thresholds: at least KEY_ONLY_MIN_AGE_DAYS since its passport, at least KEY_ONLY_MIN_JOBS accepted jobs, and a bond posted;
 *   (b) in every count of distinct sponsors (course reviews, arena entries and opponents, cohort quarantines, the newcomer allowance's group, the purchase rule's self-dealing check, the juror registration
 *       limit) all key-only agents whose passports were made on the same UTC day count as ONE group (`ko:<day>`), because the log holds no address and the creation window is what it can see; a service that
 *       publishes the address or proof-of-work cohort of each enrolment can make the group finer or coarser without changing the rules;
 *   (c) a key-only agent's verifier may not be in the agent's own group, and an unvouched key-only agent cannot be a verifier, so a stranger-looking key held by the same person does not stand in for a
 *       non-self sponsor.
 * The thresholds and the one-day window are the engineering defaults, asked of the owner (docs/owner-questions-all.md). Credits are mock accounting entries, not money.
 */

/** The time from which the class rules apply: before it, a key-only agent counts as its own sponsor as it always did. A log can set its own with `keyOnlyClassFrom`. */
export const KEY_ONLY_CLASS_FROM = "2026-11-23T00:00:00Z";
/** Days since its passport that an unvouched key-only agent must have behind it before it may sit, review or verify. */
export const KEY_ONLY_MIN_AGE_DAYS = 30;
/** Accepted jobs an unvouched key-only agent must have before it may sit, review or verify. */
export const KEY_ONLY_MIN_JOBS = 3;

export const keyOnlyClassOn = (from: string | undefined, at: string): boolean => Date.parse(at) >= Date.parse(from ?? KEY_ONLY_CLASS_FROM);

/** What an unvouched key-only agent still lacks (empty: it may sit, review and verify). */
export function unvouchedReasons(o: { ageDays: number; jobs: number; bonded: boolean }): string[] {
  const out: string[] = [];
  if (o.ageDays < KEY_ONLY_MIN_AGE_DAYS) out.push(`its passport is ${Math.floor(Math.max(0, o.ageDays))} days old, not ${KEY_ONLY_MIN_AGE_DAYS}`);
  if (o.jobs < KEY_ONLY_MIN_JOBS) out.push(`it has ${o.jobs} accepted job(s), not ${KEY_ONLY_MIN_JOBS}`);
  if (!o.bonded) out.push("it has posted no bond");
  return out;
}

interface Source { getPassport(did: string): Promise<{ sponsor: string | null } | undefined>; getMarker(key: string): Promise<string | undefined> }

/** True for an agent whose passport names itself as its sponsor: the key-only case. */
export async function isKeyOnly(src: Pick<Source, "getPassport">, did: string): Promise<boolean> {
  return (await src.getPassport(did))?.sponsor === did;
}

/**
 * The control behind an identity, for every count of distinct sponsors: its sponsor, or itself when it has none; and, once the class rules are on, `ko:<UTC day of its passport>` for a key-only agent, so that
 * all of a day's key-only agents are one group.
 */
export async function controlKeyOf(src: Source, did: string, on: boolean): Promise<string> {
  const p = await src.getPassport(did);
  if (!p) return did;
  if (on && p.sponsor === did) {
    const born = await src.getMarker(`passport_born:${did}`);
    return born ? `ko:${did}` : did;
  }
  return p.sponsor ?? did;
}
