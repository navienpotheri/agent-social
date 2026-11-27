/**
 * The exact form of the answer a course's engine reads, stated once for everyone: the practice object a sitting agent receives from course_enrol, the card-effect prompts and the refusal of a wrong-form answer all use it (from 2026-11-25; earlier sitting
 * scores had the form hidden and are not comparable). `formProblem` is the cheap shape check made before a sitting is used up.
 */
import type { CourseCard } from "../lens-courses/index.ts";

/** The form of the answer the engine will read, given to every arm: a sitting agent learns it from the practice tasks and the engine's first refusal, and a model should not be scored zero for guessing a field name. */
export function formHint(card: CourseCard): string {
  if (card.generator.engine === "evolving-evals") return 'Form: {"grader": {"kind": "code"}, "graders": [{"id": "g1", "kind": "absent", "pattern": "<regular expression>"}, {"id": "g2", "kind": "present", "pattern": "<regex>"}, {"id": "g3", "kind": "number_over", "output_pattern": "<regex with one capture group>", "input_pattern": "<regex with one capture group>"}, {"id": "g4", "kind": "same_as_input", "output_pattern": "<regex with one capture group>", "input_pattern": "<regex with one capture group>"}]}. At most 12 graders, each pattern at most 80 characters, no nested quantifiers and no lookaround; a grader flags (fails) a bad output; "kind" inside "graders" is one of absent, present, number_over, same_as_input.';
  if (card.artifact.kind === "lesson") return 'Form: {"lessons": ["when <feature>=<value> and <feature>=<value> then <action>", ...]}: a JSON object with a list of at most six STRINGS, each exactly that form (features, values and actions as they appear in the runbook and the tasks; no reason, no brackets and no extra words in the line; a rule about a name or a one-off is refused).';
  return `Form: ${card.artifact.description}. Use the exact field names the practice tasks show.`;
}

/** What is wrong with the SHAPE of an answer (before any held-out item is drawn), or undefined: a wrong shape is refused and does not use up a sitting. */
export function formProblem(card: CourseCard, artifact: unknown): string | undefined {
  const o = artifact as Record<string, unknown> | null;
  if (card.generator.engine === "evolving-evals") {
    if (!o || typeof o !== "object" || !Array.isArray(o.graders)) return "the answer is an object with a list called graders";
    if (!(o.grader && typeof o.grader === "object" && (o.grader as { kind?: unknown }).kind === "code")) return 'the answer says "grader": {"kind": "code"}';
    if ((o.graders as Array<Record<string, unknown>>).some((g) => !g || typeof g.id !== "string" || typeof g.kind !== "string")) return 'every grader has an "id" and a "kind" (absent, present, number_over or same_as_input)';
    return undefined;
  }
  if (card.artifact.kind === "lesson") { if (!o || typeof o !== "object" || !Array.isArray(o.lessons) || (o.lessons as unknown[]).some((t) => typeof t !== "string")) return 'the answer is an object with a list called lessons of strings'; }
  return undefined;
}
