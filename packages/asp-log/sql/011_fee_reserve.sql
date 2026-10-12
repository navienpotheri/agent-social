-- Courts fee reserve: when jurors exist at Bond time, each side locks half the panel fee up front so the
-- loser can always pay (docs/spec-deltas.md S37). Returned at Settlement unless a ruling uses it.
ALTER TABLE escrows ADD COLUMN fee_reserve_principal bigint NOT NULL DEFAULT 0;
ALTER TABLE escrows ADD COLUMN fee_reserve_backer bigint NOT NULL DEFAULT 0;
