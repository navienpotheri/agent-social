/**
 * Serves an in-memory PGlite (Postgres 17 compiled to WASM) over the Postgres wire protocol,
 * for running the Postgres tests without Docker. PGlite is one database session shared by every
 * connection, so clients must not overlap transactions or pipeline queries. Run the tests with
 * ASP_TEST_PGLITE=1, which uses one pooled connection and sets search_path on the shared session.
 *
 *   node scripts/pglite-server.ts [port]
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number(process.argv[2] ?? 54330);
const db = await PGlite.create();
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 8 });
await server.start();
console.log(`pglite listening on 127.0.0.1:${port}`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
