/**
 * Agent-authored offerings (register row DK1723): an agent proposes a course through the Town Hall (a `town_proposal` of kind `course`, the key `academy.course.<id>`, the value the course's title, skill, level and lessons), the
 * society votes, and a passed proposal's enactment lets the Registrar countersign the course the agent signed as its instructor, with the author's share. In between sits a SAFETY REVIEW: every lesson goes through the lesson
 * gate's checks (the invariant floor and hidden characters), and a course that fails does not go live whatever the vote. `reviewOffering` is that review; `mayGoLive` is the one question the Registrar's countersign asks (the vote
 * enacted AND the review passed AND the course is the one that was voted on and signed by its proposer); `offeringStatus` says where each course proposal stands, with the author credited from the record. The log enforces the same
 * checks on the course record (DK1608, S1554). Credits are accounting entries, not money. Pure: records in, a status out.
 */
import type { AspRecord } from "@agent-social/asp-core";
import { lessonProblems, type Rejection } from "./lesson-gate.ts";

export interface OfferingLesson { id: string; text: string }
export interface OfferingValue { title: string; skill: string; level: number; lessons: OfferingLesson[] }
export interface OfferingReview { passed: boolean; problems: { lesson: string; rule: Rejection["rule"]; reason: string }[] }

/** The safety review: every lesson through the gate's checks. At least one lesson is needed; a lesson with no text, a hidden character or a line against the protocol's invariants fails the course. */
export function reviewOffering(v: Partial<OfferingValue>): OfferingReview {
  const problems: OfferingReview["problems"] = [];
  const lessons = v.lessons ?? [];
  if (!lessons.length) problems.push({ lesson: "(none)", rule: "empty", reason: "a course has at least one lesson" });
  for (const l of lessons) for (const p of lessonProblems(l.text)) problems.push({ lesson: l.id, rule: p.rule, reason: p.reason });
  return { passed: problems.length === 0, problems };
}

export interface OfferingStatus {
  proposal: string; author: string; courseId: string; title: string;
  state: "voting" | "failed" | "passed" | "enacted";
  review: OfferingReview;
  /** The course record that went live from this proposal, when there is one: signed by the proposer as instructor, countersigned by the Registrar, with the author's share. */
  course: { id: string; instructor: string; authorSharePermille: number; countersigned: boolean } | null;
  live: boolean;
  authorCredited: boolean;
  why: string;
}
interface P { id: string; by: string; kind: string; key: string; value: unknown; state: "upcoming" | "open" | "closed" | "passed" | "failed" | "enacted" }

/** Whether a course may go live (the Registrar's countersign asks this): the proposal was enacted, its review passed, and the course is the one voted on. */
export function mayGoLive(p: Pick<P, "state" | "kind" | "key">, review: OfferingReview, courseId: string): { ok: boolean; why: string } {
  if (p.kind !== "course") return { ok: false, why: "the proposal is not about a course" };
  if (p.key !== `academy.course.${courseId}`) return { ok: false, why: `the vote was about ${p.key}, not this course` };
  if (p.state !== "enacted") return { ok: false, why: `the proposal is ${p.state}: a course goes live only once its enactment is signed` };
  if (!review.passed) return { ok: false, why: `the safety review failed (${review.problems.map((x) => `${x.lesson}: ${x.rule}`).join("; ")}): a course that fails it does not go live whatever the vote` };
  return { ok: true, why: "enacted, and the safety review passed" };
}

/** Where each course proposal stands, and the course that went live from it. `proposals` are the Town Hall view's; `courses` are the log's `course` records. The proposer is the author and is credited from the course record's instructor and share. */
export function offeringStatus(proposals: readonly (P & { proposer?: string })[], courses: readonly AspRecord[]): OfferingStatus[] {
  const out: OfferingStatus[] = [];
  for (const p of proposals) {
    if (p.kind !== "course" || !p.key.startsWith("academy.course.")) continue;
    const courseId = p.key.slice("academy.course.".length);
    const v = p.value as Partial<OfferingValue>;
    const review = reviewOffering(v);
    const rec = courses.find((c) => (c.body as { course?: string }).course === courseId);
    const cb = rec?.body as { author_share_permille?: number } | undefined;
    const countersigned = !!rec && (rec.cosigs?.length ?? 0) > 0;
    const go = mayGoLive(p, review, courseId);
    const sameAuthor = !!rec && rec.issuer === (p.proposer ?? p.by);
    const live = !!rec && go.ok && sameAuthor && countersigned;
    out.push({
      proposal: p.id, author: p.proposer ?? p.by, courseId, title: String(v.title ?? courseId), state: p.state === "failed" ? "failed" : p.state === "enacted" ? "enacted" : p.state === "passed" ? "passed" : "voting", review,
      course: rec ? { id: rec.id, instructor: rec.issuer, authorSharePermille: cb?.author_share_permille ?? 0, countersigned } : null,
      live, authorCredited: live,
      why: live ? "live in the Academy, credited to its author" : rec && !sameAuthor ? "the course record is signed by someone other than the proposer: it is not this offering" : rec && !go.ok ? `a course record exists but it may not go live: ${go.why}` : go.ok ? "enacted and reviewed: waiting for the instructor's signature and the Registrar's countersign" : go.why,
    });
  }
  return out;
}
