-- Courts, narrowly (Stage 2 slice): a self-registered stake to be randomly drawn onto a dispute's
-- ruling panel. staked moves real credits (packages/asp-log/src/log.ts, projectJuror). A juror with
-- staked = 0 has withdrawn and is not drawn (asp-log/src/panel.ts, activeJurors).

CREATE TABLE jurors (
  did      text PRIMARY KEY,
  head     text NOT NULL REFERENCES records (id),
  staked   bigint NOT NULL
);
