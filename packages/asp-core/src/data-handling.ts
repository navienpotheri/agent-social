/**
 * The job-data term of a contract (register row JO3; spec-delta S1569; docs/legal/job-data-handling-draft.md section 4): the optional `data_handling` object of the contract record, the default reading of an absent
 * field, and the validation the log applies. The schema fixes the shape (types and the two enums); what the schema cannot say sits here, so the log refuses it by name and both SDKs agree on it:
 * an unknown `term`, and a `retain_days` that does not fit its `retention`. Pure; credits and data are not touched. A term is a version: a new wording is a new `term` value.
 */
export const JOB_DATA_TERM = "asp.job-data/v1";
export const KNOWN_JOB_DATA_TERMS: readonly string[] = [JOB_DATA_TERM];
export const MAX_RETAIN_DAYS = 365;

export interface DataHandling {
  term?: string;
  commons_sharing?: boolean;
  retention?: "delete_at_settlement" | "retain_days";
  retain_days?: number;
  personal_data?: "none" | "included";
}
/** The reading of a contract's data handling with every default filled in: an absent field reads as the whole default, so the term applies to every contract, those made before the field existed included. */
export interface DataHandlingReading { term: string; commons_sharing: boolean; retention: "delete_at_settlement" | "retain_days"; retain_days: number | null; personal_data: "none" | "included" }

export function readDataHandling(d?: DataHandling | null): DataHandlingReading {
  return {
    term: d?.term ?? JOB_DATA_TERM,
    commons_sharing: d?.commons_sharing ?? false,
    retention: d?.retention ?? "delete_at_settlement",
    retain_days: d?.retain_days ?? null,
    personal_data: d?.personal_data ?? "none",
  };
}

/** The rule a data-handling object breaks, or null: `data_handling_unknown_term`, or `data_handling_retention_invalid` (retain_days without retention retain_days, outside 1 to 365, or missing when retention is retain_days). */
export function dataHandlingProblem(d?: DataHandling | null): { rule: "data_handling_unknown_term" | "data_handling_retention_invalid"; message: string } | null {
  if (!d) return null;
  if (d.term !== undefined && !KNOWN_JOB_DATA_TERMS.includes(d.term)) return { rule: "data_handling_unknown_term", message: `${JSON.stringify(d.term)} is not a job-data term this log knows (${KNOWN_JOB_DATA_TERMS.join(", ")}): a new wording is a new term, which a new version of the software adds` };
  const retention = d.retention ?? "delete_at_settlement";
  if (retention === "retain_days") {
    if (d.retain_days === undefined) return { rule: "data_handling_retention_invalid", message: "retention retain_days needs retain_days: the number of days after settlement the performer may keep its copies" };
  } else if (d.retain_days !== undefined) return { rule: "data_handling_retention_invalid", message: "retain_days is allowed only with retention retain_days" };
  if (d.retain_days !== undefined && !(Number.isInteger(d.retain_days) && d.retain_days >= 1 && d.retain_days <= MAX_RETAIN_DAYS)) return { rule: "data_handling_retention_invalid", message: `retain_days is a whole number of days from 1 to ${MAX_RETAIN_DAYS}, not ${d.retain_days}` };
  return null;
}
