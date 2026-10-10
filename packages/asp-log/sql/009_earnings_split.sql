-- The performer's passport earnings_split (permille the agent keeps), snapshotted when the Bond is posted
-- so a sponsor cannot change the split after the work is done. NULL means no split.
ALTER TABLE escrows ADD COLUMN agent_permille integer;
