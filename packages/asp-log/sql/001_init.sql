-- ASP event log, v1.
-- `records` is the append-only source of truth. Every other table is a projection
-- that can be rebuilt by replaying `records` in seq order.

CREATE TABLE records (
  seq         bigint PRIMARY KEY CHECK (seq > 0),        -- gapless global log position
  id          text NOT NULL UNIQUE,                      -- sha256 of the canonical unsigned record
  type        text NOT NULL,
  issuer      text NOT NULL,
  actor       text NOT NULL,
  subject     text,
  prev        text UNIQUE REFERENCES records (id),       -- UNIQUE: a record has at most one successor, so chains never fork
  chain       text NOT NULL REFERENCES records (id),     -- id of the chain's first record
  issued_at   timestamptz NOT NULL,
  envelope    jsonb NOT NULL,                            -- the full signed record
  log_hash    text NOT NULL,                             -- sha256(previous log_hash + "\n" + id)
  appended_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX records_chain_idx ON records (chain, seq);
CREATE INDEX records_issuer_idx ON records (issuer, seq);
CREATE INDEX records_subject_idx ON records (subject, seq);
CREATE INDEX records_type_idx ON records (type, seq);

CREATE FUNCTION asp_records_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'records is append-only (% rejected)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER records_no_update BEFORE UPDATE OR DELETE ON records
  FOR EACH ROW EXECUTE FUNCTION asp_records_append_only();
CREATE TRIGGER records_no_truncate BEFORE TRUNCATE ON records
  FOR EACH STATEMENT EXECUTE FUNCTION asp_records_append_only();

-- Single row holding the log head. Appends lock it FOR UPDATE, which serializes them.
CREATE TABLE log_head (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  seq       bigint NOT NULL,
  log_hash  text NOT NULL
);
INSERT INTO log_head (seq, log_hash)
  VALUES (0, 'sha256:0000000000000000000000000000000000000000000000000000000000000000');

-- Projection: one row per chain.
CREATE TABLE chains (
  root           text PRIMARY KEY REFERENCES records (id),
  kind           text NOT NULL,          -- short type of the root record; "contract" = a job
  head           text NOT NULL REFERENCES records (id),
  length         integer NOT NULL,
  last_issued_at text NOT NULL,
  state          text,                   -- job state, for job chains
  snapshot       jsonb                   -- Job snapshot, for job chains
);
CREATE INDEX chains_kind_state_idx ON chains (kind, state);

-- Projection: the registry's keys, from passport records.
CREATE TABLE keys (
  kid        text PRIMARY KEY,
  did        text NOT NULL,
  public_key text NOT NULL,
  passport   text NOT NULL REFERENCES records (id),
  revoked_at text
);
CREATE INDEX keys_did_idx ON keys (did);

-- Projection: the latest passport per DID.
CREATE TABLE passports (
  did     text PRIMARY KEY,
  head    text NOT NULL REFERENCES records (id),
  sponsor text
);
