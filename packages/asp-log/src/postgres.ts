import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pg from "pg";
import type {
  ChainRow, KeyRow, LogHead, LogTx, PassportRow, Store, StoredRecord,
} from "./store.ts";

const SQL_DIR = fileURLToPath(new URL("../sql/", import.meta.url));

type Queryable = pg.Pool | pg.PoolClient;

/** Applies sql/*.sql files that have not run yet, in name order, each in its own transaction. */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(readFileSync(join(SQL_DIR, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  return applied;
}

interface RecordRow { seq: string; id: string; chain: string; log_hash: string; envelope: StoredRecord["record"] }

const toStored = (r: RecordRow): StoredRecord => ({
  seq: Number(r.seq), id: r.id, chain: r.chain, logHash: r.log_hash, record: r.envelope,
});

const RECORD_COLS = "seq, id, chain, log_hash, envelope";

async function getRecord(q: Queryable, id: string) {
  const { rows } = await q.query<RecordRow>(`SELECT ${RECORD_COLS} FROM records WHERE id = $1`, [id]);
  return rows[0] && toStored(rows[0]);
}

async function getChain(q: Queryable, root: string): Promise<ChainRow | undefined> {
  const { rows } = await q.query("SELECT * FROM chains WHERE root = $1", [root]);
  const c = rows[0];
  return c && {
    root: c.root, kind: c.kind, head: c.head, length: c.length,
    lastIssuedAt: c.last_issued_at, state: c.state, snapshot: c.snapshot,
  };
}

const toKey = (k: any): KeyRow => ({ kid: k.kid, did: k.did, publicKey: k.public_key, passport: k.passport, revokedAt: k.revoked_at });

export class PostgresStore implements Store {
  readonly pool: pg.Pool;

  constructor(config: string | pg.PoolConfig) {
    this.pool = new pg.Pool(typeof config === "string" ? { connectionString: config } : config);
  }

  migrate() { return migrate(this.pool); }

  async transaction<T>(fn: (tx: LogTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Lock the log head first: appends run one at a time.
      await client.query("SELECT seq FROM log_head FOR UPDATE");
      const result = await fn(new PgTx(client));
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async logHead(): Promise<LogHead> {
    const { rows } = await this.pool.query("SELECT seq, log_hash FROM log_head");
    return { seq: Number(rows[0].seq), logHash: rows[0].log_hash };
  }
  getRecord(id: string) { return getRecord(this.pool, id); }
  getChain(root: string) { return getChain(this.pool, root); }
  async chainRecords(root: string) {
    const { rows } = await this.pool.query<RecordRow>(`SELECT ${RECORD_COLS} FROM records WHERE chain = $1 ORDER BY seq`, [root]);
    return rows.map(toStored);
  }
  async since(afterSeq: number, limit: number) {
    const { rows } = await this.pool.query<RecordRow>(
      `SELECT ${RECORD_COLS} FROM records WHERE seq > $1 ORDER BY seq LIMIT $2`, [afterSeq, limit]);
    return rows.map(toStored);
  }
  close() { return this.pool.end(); }
}

class PgTx implements LogTx {
  private readonly c: pg.PoolClient;

  constructor(c: pg.PoolClient) {
    this.c = c;
  }

  async logHead(): Promise<LogHead> {
    const { rows } = await this.c.query("SELECT seq, log_hash FROM log_head");
    return { seq: Number(rows[0].seq), logHash: rows[0].log_hash };
  }
  getRecord(id: string) { return getRecord(this.c, id); }
  getChain(root: string) { return getChain(this.c, root); }
  async getKey(kid: string) {
    const { rows } = await this.c.query("SELECT * FROM keys WHERE kid = $1", [kid]);
    return rows[0] && toKey(rows[0]);
  }
  async keysForDid(did: string) {
    const { rows } = await this.c.query("SELECT * FROM keys WHERE did = $1", [did]);
    return rows.map(toKey);
  }
  async getPassport(did: string): Promise<PassportRow | undefined> {
    const { rows } = await this.c.query("SELECT did, head, sponsor FROM passports WHERE did = $1", [did]);
    return rows[0];
  }

  async insertRecord(row: StoredRecord) {
    const r = row.record;
    await this.c.query(
      `INSERT INTO records (seq, id, type, issuer, actor, subject, prev, chain, issued_at, envelope, log_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [row.seq, row.id, r.type, r.issuer, r.actor, r.subject, r.prev, row.chain, r.issued_at, JSON.stringify(r), row.logHash],
    );
  }
  async putChain(row: ChainRow) {
    await this.c.query(
      `INSERT INTO chains (root, kind, head, length, last_issued_at, state, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (root) DO UPDATE SET head = $3, length = $4, last_issued_at = $5, state = $6, snapshot = $7`,
      [row.root, row.kind, row.head, row.length, row.lastIssuedAt, row.state, row.snapshot && JSON.stringify(row.snapshot)],
    );
  }
  async putKey(row: KeyRow) {
    await this.c.query(
      `INSERT INTO keys (kid, did, public_key, passport, revoked_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (kid) DO UPDATE SET public_key = $3, passport = $4, revoked_at = $5`,
      [row.kid, row.did, row.publicKey, row.passport, row.revokedAt],
    );
  }
  async putPassport(row: PassportRow) {
    await this.c.query(
      `INSERT INTO passports (did, head, sponsor) VALUES ($1, $2, $3)
       ON CONFLICT (did) DO UPDATE SET head = $2, sponsor = $3`,
      [row.did, row.head, row.sponsor],
    );
  }
  async setLogHead(head: LogHead) {
    await this.c.query("UPDATE log_head SET seq = $1, log_hash = $2", [head.seq, head.logHash]);
  }
}
