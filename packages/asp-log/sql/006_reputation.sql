-- Deterrence (docs/backlog.md "Making a slash actually matter"): a DID's reputation, derived from
-- its Settlement history, never independently signed (same trust pattern as probations). tier
-- starts at the Passport's own declared tier and is demoted by one (floor 0) per slash as a Bond's
-- backer; slash_count sizes the next Bond's minimum via projectBond's risk floor.

CREATE TABLE reputations (
  did          text PRIMARY KEY,
  tier         integer NOT NULL,
  slash_count  integer NOT NULL DEFAULT 0
);
