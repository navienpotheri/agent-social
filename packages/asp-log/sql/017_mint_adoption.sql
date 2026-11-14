-- DK95: credits adopted from the old unsigned mint by a signed adoption record. The replay seeds the unsigned total as it was before any adoption.
ALTER TABLE mints ADD COLUMN adopted_minted bigint NOT NULL DEFAULT 0;
