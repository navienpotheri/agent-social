-- Bond floor v2 (docs/spec-deltas.md S143): how many jobs a backer has had settled as accepted with nothing slashed, so the log can lower its minimum bond with a clean record.
ALTER TABLE reputations ADD COLUMN accepted_jobs integer NOT NULL DEFAULT 0;
