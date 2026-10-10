-- Strikes: blocked attempts reported in an agent's Action records (docs/spec-deltas.md S23), kept as
-- dated entries so only recent ones weigh on the risk floor of the agent's next Bond (S28). Never a slash,
-- never a demotion.
ALTER TABLE reputations ADD COLUMN strike_log jsonb NOT NULL DEFAULT '[]';
