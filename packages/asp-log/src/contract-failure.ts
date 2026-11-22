/**
 * The rule for a job that failed in the middle (register row JO4; spec-delta S1703; owner question 35 with a conservative default): the principal may declare a failure once the contract's deadline and
 * FAILURE_GRACE_MS have passed with nothing delivered; the whole escrow then returns to the principal and FAILURE_SLASH_PERMILLE of the locked Bond goes to the principal as compensation. A job that failed through
 * no one's fault (a provider down) is a cancellation by consent (S1701), not a failure. Credits are accounting entries, not money.
 */
export const FAILURE_GRACE_MS = 24 * 60 * 60 * 1000;
export const FAILURE_SLASH_PERMILLE = 250;
/** What the Bank's settlement must slash for a failure: the stated share of the Bond that is locked, rounded down. */
export const failureSlash = (bondLocked: number): number => Math.floor((bondLocked * FAILURE_SLASH_PERMILLE) / 1000);
