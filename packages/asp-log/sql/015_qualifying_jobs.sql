-- Qualifying jobs (docs/spec-deltas.md S161, credits.md 5.4): the part of accepted_jobs that counts toward standing, and the recent eligible jobs the counterparty cap reads.
-- Rows written before this migration keep accepted_jobs but start with 0 qualifying jobs (the conservative choice).
ALTER TABLE reputations ADD COLUMN qualifying_jobs integer NOT NULL DEFAULT 0;
ALTER TABLE reputations ADD COLUMN recent_jobs jsonb NOT NULL DEFAULT '[]'::jsonb;
