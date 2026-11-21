/**
 * `asp bank mentor offer | accept | show` (register row DK1220; spec-delta S1452; bank-insurer.md 13.1; owner decision DK392-MENTOR): a mentorship is a record the protege signs and the mentor countersigns, so that the
 * mentor can guarantee the protege's first credit line in place of a sponsor. Two people with two keys on two machines cannot sign one record at once, so it is two steps: the protege makes an offer (a file holding the
 * record with the protege's signature only; it is not in the log and means nothing yet), and the mentor reads the terms, checks that they are the mentor named in it, countersigns it with its own key and appends it. The log
 * applies its rules to the result (a mentor of tier 2 or above with no slash for 90 days and a different sponsor; at most three proteges; not an agent mentoring itself), and a refusal is passed on as it is. Credits are
 * accounting entries, not money.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cosign, createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import type { LogHandle } from "@agent-social/asp-package";

export class MentorUsage extends Error {}

export interface MentorOpts {
  log: LogHandle;
  io: { out: (l: string) => void; err: (l: string) => void };
  now: () => string;
  signerFor: (did: string) => Signer;
  flags: { protege?: string; mentor?: string; note?: string; file?: string; out?: string; agent?: string; by?: string };
}

const MENTORSHIP = "asp.mentorship/v0.2";
const NOTE_MAX = 300;

/** The mentorships in the log that name an agent, as protege or mentor. */
export async function mentorshipsOf(log: LogHandle, did?: string): Promise<{ id: string; mentor: string; protege: string; note?: string; at: string }[]> {
  const out: { id: string; mentor: string; protege: string; note?: string; at: string }[] = [];
  for (let after = 0; ;) {
    const page = await log.log.since(after, 500);
    if (!page.length) break;
    for (const s of page) {
      after = s.seq;
      if (s.record.type !== MENTORSHIP) continue;
      const b = s.record.body as { mentor: string; protege: string; note?: string };
      if (!did || b.mentor === did || b.protege === did) out.push({ id: s.id, mentor: b.mentor, protege: b.protege, ...(b.note ? { note: b.note } : {}), at: s.record.issued_at });
    }
  }
  return out;
}

export async function mentorCmd(action: string | undefined, o: MentorOpts): Promise<number> {
  const f = o.flags;
  if (action === "offer") {
    const protege = f.protege ?? f.by;
    if (!protege || !f.mentor) throw new MentorUsage("asp bank mentor offer --protege <your agent did> --mentor <the mentor's did> [--note <why, up to 300 characters>] [--out <file>]");
    if (protege === f.mentor) throw new MentorUsage("an agent does not mentor itself: name another agent as --mentor");
    if (f.note !== undefined && (f.note.length === 0 || f.note.length > NOTE_MAX)) throw new MentorUsage(`--note is 1 to ${NOTE_MAX} characters`);
    const existing = await mentorshipsOf(o.log, protege);
    const has = existing.find((m) => m.protege === protege);
    if (has) throw new MentorUsage(`${protege} already has a mentorship (${has.id}, mentor ${has.mentor}): a mentorship is one for each protege`);
    const rec = createRecord({ type: "mentorship" as never, issuer: protege, subject: protege, prev: null, body: { mentor: f.mentor, protege, ...(f.note ? { note: f.note } : {}) }, issued_at: o.now() }, o.signerFor(protege));
    const text = JSON.stringify(rec, null, 2) + "\n";
    if (f.out) {
      writeFileSync(resolve(f.out), text);
      o.io.out(`offer ${rec.id}: ${protege} asks ${f.mentor} to mentor it; written to ${f.out}, signed by ${protege} only and not in the log. Give the file to the mentor, who runs: asp bank mentor accept --file ${f.out} --mentor ${f.mentor}`);
    } else {
      o.io.out(text.trimEnd());
      o.io.err(`offer ${rec.id}: signed by ${protege} only and not in the log. Save it to a file and give it to ${f.mentor}, who runs: asp bank mentor accept --file <file> --mentor ${f.mentor}`);
    }
    return 0;
  }
  if (action === "accept") {
    if (!f.file || !f.mentor) throw new MentorUsage("asp bank mentor accept --file <the protege's offer> --mentor <your did>");
    let rec: AspRecord;
    try { rec = JSON.parse(readFileSync(resolve(f.file), "utf8")) as AspRecord; } catch (e) { throw new MentorUsage(`${f.file} is not an offer file (${(e as Error).message})`); }
    const b = (rec?.body ?? {}) as { mentor?: string; protege?: string; note?: string };
    if (rec?.type !== MENTORSHIP || typeof b.mentor !== "string" || typeof b.protege !== "string") throw new MentorUsage(`${f.file} is not a mentorship offer: it is for a ${String(rec?.type)}, and this command countersigns only a mentorship`);
    if (rec.issuer !== b.protege) throw new MentorUsage(`the offer is signed by ${rec.issuer}, not by the protege ${b.protege}: only the protege makes the offer`);
    if (b.mentor !== f.mentor) throw new MentorUsage(`the offer names ${b.mentor} as the mentor, not ${f.mentor}: you do not countersign an offer made to someone else`);
    if ((rec.cosigs ?? []).length) throw new MentorUsage("the offer is already countersigned: append it with `asp log import`, or ask the protege for a fresh offer");
    const signed = cosign(rec, o.signerFor(f.mentor));
    const res = await o.log.append(signed);
    o.io.out(`mentorship ${res.id}: ${f.mentor} mentors ${b.protege}${b.note ? ` ("${b.note}")` : ""} (log seq ${res.seq}); the mentor may now guarantee its first credit line: asp bank line --contract <id> --agent ${b.protege} --guarantor ${f.mentor}`);
    return 0;
  }
  if (action === "show" || action === undefined) {
    if (!f.agent) throw new MentorUsage("asp bank mentor show --agent <did>  (asp bank mentor offer | accept make one)");
    const list = await mentorshipsOf(o.log, f.agent);
    if (!list.length) { o.io.out(`${f.agent}: no mentorship`); return 0; }
    for (const m of list) o.io.out(`${m.id}  mentor ${m.mentor}  protege ${m.protege}  ${m.at}${m.note ? `  "${m.note}"` : ""}`);
    return 0;
  }
  throw new MentorUsage("asp bank mentor offer | accept | show");
}
