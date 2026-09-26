-- Fleets and delegated node keys.

-- A key is granted either by a passport (the person's own keys) or by a Node record (a delegated node key).
ALTER TABLE keys RENAME COLUMN passport TO granted_by;
ALTER TABLE keys
  ADD COLUMN kind text NOT NULL DEFAULT 'passport' CHECK (kind IN ('passport', 'node')),
  ADD COLUMN expires_at text,                           -- node keys only
  ADD COLUMN mandate text REFERENCES records (id);      -- node keys working under a Mandate
CREATE INDEX keys_mandate_idx ON keys (mandate) WHERE mandate IS NOT NULL;

ALTER TABLE passports ADD COLUMN fleet text;
CREATE INDEX passports_fleet_idx ON passports (fleet) WHERE fleet IS NOT NULL;

-- Projection: the latest declaration per fleet.
CREATE TABLE fleets (
  did         text PRIMARY KEY,
  head        text NOT NULL REFERENCES records (id),
  org         text NOT NULL,
  name        text NOT NULL,
  max_members integer
);
