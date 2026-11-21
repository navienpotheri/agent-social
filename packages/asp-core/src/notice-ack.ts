/**
 * The signed acknowledgement of a notice (register row US8; spec-delta S1591; docs/consent-record-spec.md): a person records that they read the statement of their data (or the privacy notice or the terms), by the hash of
 * the exact text they read. The schema fixes the shape; what it leaves to the rules sits here so the log refuses it by name and both SDKs agree: an unknown notice and a hash that is not 64 lowercase hexadecimal characters.
 * Pure. The wrong-issuer rule needs the sponsor of the agent, so it lives in the log.
 */
export const KNOWN_NOTICES: readonly string[] = ["asp.my-data/v1", "asp.privacy/v1", "asp.terms/v1"];
const HASH = /^[0-9a-f]{64}$/;

export function noticeAckProblem(b: { notice?: unknown; statement_sha256?: unknown }): { rule: "notice_ack_unknown_notice" | "notice_ack_bad_hash"; message: string } | null {
  if (typeof b.notice !== "string" || !KNOWN_NOTICES.includes(b.notice)) return { rule: "notice_ack_unknown_notice", message: `${JSON.stringify(b.notice)} is not a notice this log knows (${KNOWN_NOTICES.join(", ")})` };
  if (typeof b.statement_sha256 !== "string" || !HASH.test(b.statement_sha256)) return { rule: "notice_ack_bad_hash", message: "statement_sha256 is the SHA-256 of the text that was read: 64 lowercase hexadecimal characters" };
  return null;
}
