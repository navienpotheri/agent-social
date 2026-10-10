import { EventLog } from "./log.ts";
import { PostgresStore } from "./postgres.ts";
import type { LogHandle } from "./server.ts";

/** A log kept in Postgres (migrated on open): what the log service uses in production. */
export async function postgresHandle(config: string): Promise<LogHandle & { close(): Promise<void> }> {
  const store = new PostgresStore(config);
  await store.migrate();
  const log = new EventLog(store);
  return {
    log,
    append: (record) => log.append(record),
    mint: (did, amount) => log.mint(did, amount),
    importRecords: (items, expect) => log.importRecords(items, expect),
    close: () => store.close(),
  };
}
