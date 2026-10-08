-- Whistleblower reports (docs/spec-deltas.md S39): a third party reports a running contract; a drawn panel rules.
-- A report is a standalone Attestation; this row tracks its deposit and outcome. An upheld report forces the
-- contract's Settlement to full fault (escrow.forced_fault).
CREATE TABLE reports (
  id        text PRIMARY KEY REFERENCES records (id),
  contract  text NOT NULL REFERENCES records (id),
  reporter  text NOT NULL,
  accused   text NOT NULL,
  deposit   bigint NOT NULL,
  status    text NOT NULL
);
ALTER TABLE escrows ADD COLUMN forced_fault boolean NOT NULL DEFAULT false;
