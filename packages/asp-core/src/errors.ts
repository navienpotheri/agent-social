export type AspErrorCode =
  | "SCHEMA_INVALID"
  | "UNKNOWN_TYPE"
  | "BAD_ID"
  | "KID_NOT_ISSUER"
  | "UNKNOWN_KEY"
  | "BAD_SIGNATURE"
  | "BAD_ACTOR"
  | "NON_INTEGER_NUMBER"
  | "BAD_PREV"
  | "TIME_REVERSED"
  | "TERMINAL_STATE"
  | "ILLEGAL_TRANSITION"
  | "WRONG_ISSUER"
  | "GUARD_FAILED";

export class AspError extends Error {
  readonly code: AspErrorCode;
  /** For GUARD_FAILED: the guard name. For SCHEMA_INVALID: the failing path. */
  readonly detail?: string;

  constructor(code: AspErrorCode, message: string, detail?: string) {
    super(`${code}: ${message}`);
    this.name = "AspError";
    this.code = code;
    this.detail = detail;
  }
}
