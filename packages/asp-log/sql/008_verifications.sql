-- Outcome verification: the independent verifier's verdict on a Delivery, one per delivery, kept so the
-- acceptance guard (packages/asp-log/src/log.ts) can find it without re-scanning the job chain.

CREATE TABLE verifications (
  delivery  text PRIMARY KEY REFERENCES records (id),
  contract  text NOT NULL REFERENCES records (id),
  verifier  text NOT NULL,
  verdict   text NOT NULL
);
