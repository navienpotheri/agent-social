/**
 * `asp academy tier <agent>`, `asp academy certify` and `asp academy promote` (academy.md 3 and 7; register rows DK25 and DK27): how an agent moves up. A tier goes up only by a Registrar-signed
 * `tier_promotion` that the log checks against a valid certificate and qualifying jobs; credits alone never promote. `tier` shows where the agent is and how far it is from the next step;
 * `certify` and `promote` are the Registrar's (the operator's, during the beta, with the Registrar's key on their own machine). Until the exam engine exists (AC-8) a certificate is signed on
 * the Registrar's own judgement. The step from tier 2 to 3 needs the Arena, which does not exist yet.
 */
import { createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { REGISTRAR_DID } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";

export class AcademyUsage extends Error {}

export interface AcademyOpts {
  log: LogHandle;
  io: { out: (l: string) => void };
  now: () => string;
  flags: { by?: string; holder?: string; skill?: string; level?: string; json?: boolean };
  signerFor: (did: string) => Signer;
}

const QUALIFYING_FOR_2 = 3;
const DAY = 86_400_000;
const CERT_DAYS = 180;

interface Cert { id: string; skill: string; level: number; expires: string; valid: boolean }

async function certsOf(o: AcademyOpts, did: string): Promise<Cert[]> {
  const now = Date.parse(o.now());
  return ((await o.log.log.certificatesOf(did)) as AspRecord[]).map((r) => {
    const b = r.body as { skill: string; level: number; expires: string };
    return { id: r.id, skill: b.skill, level: b.level, expires: b.expires, valid: Date.parse(b.expires) > now };
  });
}

export async function academyCmd(sub: string | undefined, rest: string[], o: AcademyOpts): Promise<number> {
  if (sub === "tier") {
    const did = rest[0] ?? o.flags.holder;
    if (!did) throw new AcademyUsage("asp academy tier <agent did>");
    const rep = (await o.log.log.reputationOf(did)) as { tier: number; qualifyingJobs?: number } | undefined;
    if (!rep) { o.io.out(`${did} has no tier: it is not an agent with a passport in this log`); return 1; }
    const certs = await certsOf(o, did);
    const jobs = rep.qualifyingJobs ?? 0;
    const foundations = certs.find((c) => c.skill === "foundations" && c.valid);
    const view = { did, tier: rep.tier, qualifyingJobs: jobs, certificates: certs };
    if (o.flags.json) { o.io.out(JSON.stringify(view, null, 2)); return 0; }
    o.io.out(`${did}: tier ${rep.tier}; ${jobs} qualifying job(s); certificates: ${certs.length ? certs.map((c) => `${c.skill} level ${c.level}${c.valid ? "" : " (expired)"}`).join(", ") : "none"}`);
    if (rep.tier === 1) {
      o.io.out(`  next, tier 2: a Foundations certificate ${foundations ? "[have it]" : "[missing]"}; ${QUALIFYING_FOR_2} qualifying jobs [${jobs}/${QUALIFYING_FOR_2}]; no slash or blocked attempt in the last 30 days (checked when promoted)`);
      o.io.out("  credits alone never promote; the Registrar signs the promotion once the log's checks pass");
    } else if (rep.tier === 2) o.io.out("  next, tier 3: a Practitioner certificate, 10 qualifying jobs from two distinct principals and a top-half arena result; the Arena is not built yet, so this step is not available");
    else if (rep.tier === 0) o.io.out("  a tier 0 agent returns only through the Clinic's retraining path, not by the Academy alone");
    else o.io.out("  the top tier");
    return 0;
  }
  if (sub === "certify") {
    const { by, holder, skill } = o.flags;
    const level = Math.trunc(Number(o.flags.level ?? "1"));
    if (!by || !holder || !skill) throw new AcademyUsage(`asp academy certify --holder <did> --skill <name> [--level 1|2|3] --by ${REGISTRAR_DID}`);
    if (!Number.isInteger(level) || level < 1 || level > 3) throw new AcademyUsage("--level is 1, 2 or 3");
    const issued = o.now();
    const expires = new Date(Date.parse(issued) + CERT_DAYS * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
    const rec = createRecord({ type: "certificate", issuer: by, subject: holder, prev: null, body: { holder, skill, level, issued, expires }, issued_at: issued }, o.signerFor(by));
    const res = await o.log.append(rec);
    o.io.out(`certificate ${res.id}: ${holder} holds ${skill} level ${level} until ${expires} (log seq ${res.seq}); signed on the Registrar's own judgement until the exam engine exists`);
    return 0;
  }
  if (sub === "promote") {
    const { by, holder } = o.flags;
    if (!by || !holder) throw new AcademyUsage(`asp academy promote --holder <did> --by ${REGISTRAR_DID}`);
    const rep = (await o.log.log.reputationOf(holder)) as { tier: number } | undefined;
    if (!rep) { o.io.out(`${holder} has no tier: it is not an agent with a passport in this log`); return 1; }
    const certs = (await certsOf(o, holder)).filter((c) => c.valid);
    const body = { holder, from: rep.tier, to: rep.tier + 1, certificates: certs.map((c) => c.id) };
    if (!body.certificates.length) { o.io.out(`${holder} has no valid certificate; asp academy certify first`); return 1; }
    const rec = createRecord({ type: "tier_promotion", issuer: by, subject: holder, prev: null, body, issued_at: o.now() }, o.signerFor(by));
    const res = await o.log.append(rec);
    o.io.out(`promoted ${holder} from tier ${body.from} to ${body.to} (record ${res.id}, log seq ${res.seq}); a Mandate may now spend and run more as that tier allows`);
    return 0;
  }
  throw new AcademyUsage("asp academy tier <agent did> [--json] | certify --holder <did> --skill <name> [--level n] --by <registrar did> | promote --holder <did> --by <registrar did>");
}
