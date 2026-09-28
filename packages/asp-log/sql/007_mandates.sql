-- Runtime -> protocol compliance bridge: a contract's current Mandate scopes, kept per-contract so
-- checkAction (packages/asp-log/src/log.ts) can check a live Action report against it without
-- re-scanning the whole job chain (same reasoning as escrows).

CREATE TABLE mandates (
  contract  text PRIMARY KEY REFERENCES records (id),
  scopes    text[] NOT NULL
);
