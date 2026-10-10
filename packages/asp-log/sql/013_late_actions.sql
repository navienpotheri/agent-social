-- Late Actions (docs/spec-deltas.md S80, S81): how many a job has taken, so the log can cap them.
ALTER TABLE mandates ADD COLUMN late_actions integer NOT NULL DEFAULT 0;
