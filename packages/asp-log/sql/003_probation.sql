-- Decision D2: track the current probation window per DID (from lineage records carrying
-- probation_until). Nothing enforces it yet; this makes it queryable for when something does.

CREATE TABLE probations (
  did      text PRIMARY KEY,
  until    text NOT NULL,
  set_by   text NOT NULL REFERENCES records (id)
);
