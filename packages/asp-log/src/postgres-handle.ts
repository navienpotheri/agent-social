import { EventLog } from "./log.ts";
import { PostgresStore } from "./postgres.ts";
import type { LogHandle } from "./server.ts";

/** A log kept in Postgres (migrated on open): what the log service uses in production. */
export async function postgresHandle(config: string): Promise<LogHandle & { close(): Promise<void> }> {
  const store = new PostgresStore(config);
  await store.migrate();
  // ASP_BOND_FLOOR=v2 turns on the bond floor of S143 (default: the legacy rule); a log must be replayed with the rule it ran with.
  // ASP_OPERATOR_DID names the one DID whose signed `mint` records the log accepts (credits.md CR-2); ASP_OWNER_DID the owner who must co-sign a treasury_issuance. They are public DIDs,
  // not keys: the service never holds the operator's key, the operator signs on their own machine (`asp credits grant --by <operator did>`). A log must be replayed with the same DIDs.
  const log = new EventLog(store, { bondFloor: process.env.ASP_BOND_FLOOR === "v2" ? "v2" : "legacy", ...(process.env.ASP_BOND_FLOOR_FROM ? { bondFloorFrom: process.env.ASP_BOND_FLOOR_FROM } : {}), ...(process.env.ASP_OPERATOR_DID ? { operator: process.env.ASP_OPERATOR_DID } : {}), ...(process.env.ASP_OWNER_DID ? { owner: process.env.ASP_OWNER_DID } : {}) });
  return {
    log,
    append: (record) => log.append(record),
    mint: (did, amount) => log.mint(did, amount),
    importRecords: (items, expect) => log.importRecords(items, expect),
    close: () => store.close(),
  };
}
