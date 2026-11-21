/**
 * `asp academy lens publish <course id | --all> --author <did> --reviewers <did,did> [--by <treasury did>] [--cosign-by <registrar did>] [--effective <time>]` (register row DK1400): the operator puts the lens catalogue
 * into a log without a script, in the two steps the log's own rules need.
 *
 *   1. the Treasury's next signed price list gains each card's item (`courseItem`: the card's price, the Treasury and burn parts of the Academy's standard split, the teacher's share). A new service takes effect after
 *      the notice (72 hours; `--effective` sets a later time); the command says when;
 *   2. once the item is in force, the course record: signed by the author, countersigned by the Registrar, with reviewers of two sponsors other than the author's (the log refuses anything else) and the hashes of the
 *      card's lesson and exercise definitions. Run the command again after the notice; a step already done is not done twice.
 *
 * The log decides whether each record stands and what it refuses is printed as it is. The reviews are named, not attached: the Registrar's check of the lessons and reviews in the commons is by hand (DK118). Credits are
 * accounting entries, not money.
 */
import { createHash } from "node:crypto";
import { cosign, createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { REGISTRAR_DID, TREASURY_DID } from "@agent-social/asp-log";
import { courseItem, courseService, loadCatalogue, type CourseCard } from "./catalogue.ts";
import { engineIds } from "./index.ts";
import { courseRecordFor } from "./sitting.ts";

export interface PublishIo {
  out: (l: string) => void;
  flags: Record<string, string | string[] | boolean | undefined>;
  log: any;
  now: () => string;
  signerFor: (did: string) => Signer;
}
export class PublishUsage extends Error {}

const sha = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");
type Item = { service: string; price: number; split: unknown } & Record<string, unknown>;
type ListBody = { version: number; effective_from: string; bounds_version?: number; job_tax_permille: number; items: Item[] };
const lbody = (r: AspRecord) => r.body as unknown as ListBody;
const flag = (o: PublishIo, k: string): string | undefined => { const v = o.flags[k]; return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined; };

export async function publishCmd(target: string | undefined, o: PublishIo): Promise<number> {
  const usage = "asp academy lens publish <course id> | --all --author <did> --reviewers <did,did> [--by <treasury did>] [--cosign-by <registrar did>] [--effective <time>]";
  const cat = loadCatalogue(engineIds());
  if (cat.problems.length) throw new PublishUsage(`the course catalogue has problems: ${cat.problems.join("; ")}`);
  const all = o.flags.all === true;
  if (!target && !all) throw new PublishUsage(usage);
  const cards: CourseCard[] = all ? cat.order.map((id) => cat.courses.find((c) => c.id === id)!) : cat.courses.filter((c) => c.id === target);
  if (!cards.length) throw new PublishUsage(`${target} is not a course in the catalogue (asp academy lens courses)`);
  const author = flag(o, "author"), reviewers = (flag(o, "reviewers") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!author) throw new PublishUsage(`${usage}: --author names the agent that signs the course`);
  if (reviewers.length < 2) throw new PublishUsage(`${usage}: --reviewers names at least two agents of other sponsors than the author's`);
  const treasury = flag(o, "by") ?? TREASURY_DID, registrar = flag(o, "cosign-by") ?? REGISTRAR_DID;
  const now = o.now();
  const lists = ((await o.log.log.priceLists()) as AspRecord[]).sort((a, b) => lbody(a).version - lbody(b).version);
  const inForce = [...lists].filter((l) => Date.parse(lbody(l).effective_from) <= Date.parse(now)).sort((a, b) => lbody(b).version - lbody(a).version)[0];
  const head = lists[lists.length - 1];
  let status = 0;
  // step 1: the items that are neither in force nor announced
  const known = (l: AspRecord | undefined, s: string) => !!l && lbody(l).items.some((i) => i.service === s);
  const missing = cards.filter((c) => !known(inForce, courseService(c)) && !known(head, courseService(c)));
  if (missing.length) {
    const before = head ? lbody(head) : undefined;
    const merged = new Map((before?.items ?? []).map((i) => [i.service, i]));
    for (const c of missing) merged.set(courseService(c), courseItem(c, author) as unknown as Item);
    const effective = flag(o, "effective") ?? new Date(Date.parse(now) + 72 * 3_600_000).toISOString().replace(/\.\d+Z$/, "Z");
    const body = { version: (before?.version ?? 0) + 1, effective_from: effective, bounds_version: before?.bounds_version ?? 1, job_tax_permille: before?.job_tax_permille ?? 20, items: [...merged.values()] };
    const rec = createRecord({ type: "price_list" as never, issuer: TREASURY_DID, subject: null, prev: head?.id ?? null, body: body as never, issued_at: now }, o.signerFor(treasury));
    try {
      const res = await o.log.append(rec);
      o.out(`price list version ${body.version} signed (record ${res.id}) with ${missing.map((c) => courseService(c)).join(", ")}; it takes effect ${effective}: run this command again then to publish the course records`);
    } catch (e) { o.out(`refused by the log: ${(e as Error).message}`); return 1; }
  }
  // step 2: the course records whose item is in force
  for (const c of cards) {
    const existing = await courseRecordFor(o.log.log, c);
    if (existing) { o.out(`${c.id}: already published (record ${existing.id})`); continue; }
    if (!known(inForce, courseService(c))) { if (!missing.includes(c)) o.out(`${c.id}: the price list item is announced but not yet in force; run this command again after it takes effect`); continue; }
    let rec = createRecord({
      type: "course" as never, issuer: author, subject: null, prev: null, issued_at: o.now(),
      body: { course: c.id, title: c.title, skill: c.generator.engine, level: 1, lessons: [sha(`${c.id}|${c.free_first_lesson}`)], exercises: sha(`${c.id}|${JSON.stringify(c.generator)}`), exercise_count: c.generator.practice + c.generator.heldout, price_service: courseService(c), author_share_permille: c.teacher.share_permille, reviews: reviewers.map((r) => sha(`review|${c.id}|${r}`)), reviewers } as never,
    }, o.signerFor(author));
    rec = cosign(rec, o.signerFor(registrar));
    try {
      const res = await o.log.append(rec);
      o.out(`${c.id}: published (record ${res.id}); learners sit it with asp academy lens sit ${c.id} --by <agent>`);
    } catch (e) { o.out(`${c.id}: refused by the log: ${(e as Error).message}`); status = 1; }
  }
  return status;
}
