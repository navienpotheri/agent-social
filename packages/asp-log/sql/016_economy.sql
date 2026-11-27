-- The credit economy, first slice (docs/institutions/economy/credits.md CR-2, CR-3, CR-5, CR-6; spec-delta S163).
-- NOT RUN against a database yet: written and typechecked only (docs/gaps-register.md DK67, DK68).

-- How much of each DID's minted total came from signed `mint` records (the rest is the old unsigned local mint).
ALTER TABLE mints ADD COLUMN signed_minted bigint NOT NULL DEFAULT 0;

-- Small keyed values the economy rules keep inside an append: the price-list head and a purchase's idempotency key.
CREATE TABLE markers (
  key    text PRIMARY KEY,
  value  text NOT NULL
);
