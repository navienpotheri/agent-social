-- Stage 2 slice 1: the Bank's credit ledger. accounts.balance moves only via projectBond and
-- projectSettlement (asp-log/src/log.ts). Bootstrapping a balance for testing (EventLog.mint) writes
-- here directly, without a signed record — see MOCKS.md.
--
-- escrows tracks what one contract's Bond actually locked, so its Settlement cannot release, return
-- or slash more than was locked. Kept (not deleted) once settled, as an audit trail.

CREATE TABLE accounts (
  did      text PRIMARY KEY,
  balance  bigint NOT NULL
);

CREATE TABLE escrows (
  contract        text PRIMARY KEY REFERENCES records (id),
  escrow_payer    text NOT NULL,
  escrow_locked   bigint NOT NULL,
  backer          text NOT NULL,
  bond_locked     bigint NOT NULL,
  settled         boolean NOT NULL DEFAULT false
);

-- Cumulative credits ever minted per DID (EventLog.mint), tracked separately from the live
-- balance so verify()/verifyCheckpoint() can seed their replay without double-counting spend.
CREATE TABLE mints (
  did           text PRIMARY KEY,
  total_minted  bigint NOT NULL
);
