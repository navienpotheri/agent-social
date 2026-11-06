import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { didOf, randomSeed, signerFromSeed, type AspRecord, type Signer } from "@agent-social/asp-core";
import { EventLog, GENESIS_LOG_HASH, MemoryStore, nextLogHash, type AppendResult, type LogHandle, type MemoryState } from "@agent-social/asp-log";
import { RemoteLog } from "./remote.ts";
import { isSealed, NEEDS_PASSPHRASE, open, passphraseFrom, seal, type Sealed } from "./at-rest.ts";

/** The local ASP home: keys and the local event log. ASP_HOME overrides ~/.asp. */
export function aspHome(override?: string): string {
  return override ?? process.env.ASP_HOME ?? join(homedir(), ".asp");
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_");

/**
 * Keys on disk, one JSON file per key: {kid, seed_hex}, or {kid, sealed} when the person set a passphrase (ASP_KEY_PASSPHRASE; see at-rest.ts). A plain key keeps working
 * after a passphrase is set and is sealed by `asp keys protect`. Still not the OS keychain (MOCKS #10).
 */
export class Keystore {
  readonly dir: string;
  private passphrase: () => string | undefined;

  constructor(home: string, passphrase: () => string | undefined = () => passphraseFrom()) {
    this.dir = join(home, "keys");
    this.passphrase = passphrase;
  }

  private file(kid: string): string { return join(this.dir, `${slug(kid)}.json`); }

  /** Writes a key file whole under a temporary name, then renames it, so a crash never leaves half a key. */
  private put(kid: string, body: { kid: string; seed_hex?: string; sealed?: Sealed }): void {
    mkdirSync(this.dir, { recursive: true });
    const f = this.file(kid);
    writeFileSync(`${f}.part`, JSON.stringify(body, null, 2), { mode: 0o600 });
    renameSync(`${f}.part`, f);
  }

  private store(kid: string, seedHex: string): void {
    const pass = this.passphrase();
    this.put(kid, pass ? { kid, sealed: seal(seedHex, pass) } : { kid, seed_hex: seedHex });
  }

  /** Reads a key file, opening it with the passphrase when it is sealed. */
  private read(file: string): { kid: string; seed_hex: string } {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { kid: string; seed_hex?: string; sealed?: unknown };
    if (isSealed(raw.sealed)) {
      const pass = this.passphrase();
      if (!pass) throw new Error(`the key ${raw.kid} ${NEEDS_PASSPHRASE}`);
      return { kid: raw.kid, seed_hex: open(raw.sealed, pass) };
    }
    return { kid: raw.kid, seed_hex: raw.seed_hex as string };
  }

  /** How many key files are plain and how many are sealed. */
  status(): { plain: number; sealed: number } {
    let plain = 0, sealed = 0;
    if (existsSync(this.dir)) for (const f of readdirSync(this.dir)) {
      if (!f.endsWith(".json")) continue;
      try { if (isSealed((JSON.parse(readFileSync(join(this.dir, f), "utf8")) as { sealed?: unknown }).sealed)) sealed++; else plain++; } catch { /* not a key file */ }
    }
    return { plain, sealed };
  }

  /** Seals every plain key file under the passphrase; how many were sealed. */
  protect(passphrase: string): number {
    let n = 0;
    if (existsSync(this.dir)) for (const f of readdirSync(this.dir)) {
      if (!f.endsWith(".json")) continue;
      const raw = JSON.parse(readFileSync(join(this.dir, f), "utf8")) as { kid: string; seed_hex?: string; sealed?: unknown };
      if (isSealed(raw.sealed) || typeof raw.seed_hex !== "string") continue;
      this.put(raw.kid, { kid: raw.kid, sealed: seal(raw.seed_hex, passphrase) });
      n++;
    }
    return n;
  }

  /** Turns every sealed key file back into a plain one (the passphrase must be right); how many. */
  unprotect(passphrase: string): number {
    let n = 0;
    if (existsSync(this.dir)) for (const f of readdirSync(this.dir)) {
      if (!f.endsWith(".json")) continue;
      const raw = JSON.parse(readFileSync(join(this.dir, f), "utf8")) as { kid: string; sealed?: unknown };
      if (!isSealed(raw.sealed)) continue;
      this.put(raw.kid, { kid: raw.kid, seed_hex: open(raw.sealed, passphrase) });
      n++;
    }
    return n;
  }

  create(kid: string): Signer & { publicKey: Uint8Array } {
    return this.createFromSeed(kid, randomSeed());
  }

  /** For a did:key identity, where the DID must be derived from the key before its kid is known. */
  createFromSeed(kid: string, seed: Uint8Array): Signer & { publicKey: Uint8Array } {
    if (this.find(kid)) throw new Error(`key ${kid} already exists`);
    const signer = signerFromSeed(kid, seed);
    mkdirSync(this.dir, { recursive: true });
    this.store(kid, Buffer.from(signer.seed).toString("hex"));
    return signer;
  }

  find(kid: string): (Signer & { publicKey: Uint8Array }) | undefined {
    const file = this.file(kid);
    if (!existsSync(file)) return undefined;
    const { seed_hex } = this.read(file);
    return signerFromSeed(kid, Buffer.from(seed_hex, "hex"));
  }

  /** Every key held for a DID (not its node keys), as stored: for a backup. */
  entriesFor(did: string): { kid: string; seed_hex: string }[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ f, kid: (JSON.parse(readFileSync(join(this.dir, f), "utf8")) as { kid: string }).kid }))
      .filter((e) => didOf(e.kid) === did && !e.kid.includes("#node-"))
      .map((e) => this.read(join(this.dir, e.f)))
      .sort((a, b) => a.kid.localeCompare(b.kid));
  }

  /** Puts a key back from a backup; false when a key with that name is already here (nothing is overwritten). */
  importEntry(entry: { kid: string; seed_hex: string }): boolean {
    if (this.find(entry.kid)) return false;
    this.store(entry.kid, entry.seed_hex);
    return true;
  }

  /** The first key held for a DID (keys are named <did>#key-N). */
  forDid(did: string): (Signer & { publicKey: Uint8Array }) | undefined {
    if (!existsSync(this.dir)) return undefined;
    const kids = readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf8")).kid as string)
      .filter((kid) => didOf(kid) === did && !kid.includes("#node-"))
      .sort();
    return kids.length ? this.find(kids[0]) : undefined;
  }
}

/** A snapshot of a local log's state (docs/spec-deltas.md S49): load it instead of replaying every record on open. */
interface Snapshot {
  version: 1;
  seq: number;
  logHash: string;
  /** How many lines of mints.ndjson were already in the state. */
  mintLines: number;
  state: MemoryState;
}

/** Records between automatic snapshots; ASP_SNAPSHOT_EVERY overrides (0 turns them off). */
const snapshotEvery = (env: NodeJS.ProcessEnv): number => {
  const n = Number(env.ASP_SNAPSHOT_EVERY);
  return Number.isInteger(n) && n >= 0 ? n : 1000;
};

/**
 * The local event log: an EventLog over a MemoryStore, persisted as NDJSON lines {appendedAt, record}.
 *
 * Opening replays (and so re-verifies) every record, unless a snapshot is present and consistent: then the state is loaded
 * from it and only the records after it are replayed. A snapshot is trusted only as far as the log itself vouches for it:
 * its seq and log hash must equal the hash chain recomputed from the ids in log.ndjson (cheap; no signatures), and its records
 * are re-verified by `log verify`. `LocalLog.openFull` and `asp log verify --full` replay from genesis without it, so the
 * state a snapshot carries can be audited at any time.
 */
export class LocalLog implements LogHandle {
  readonly log: EventLog;
  private readonly file: string;
  private readonly mintsFile: string;
  private readonly store: MemoryStore;
  private readonly home: string;
  /** Records replayed on open after the snapshot (or all of them with none). */
  replayed = 0;
  /** How this log was opened: from a snapshot or by replaying everything. */
  openedFrom: "snapshot" | "replay" = "replay";

  private constructor(home: string, store: MemoryStore, log: EventLog) {
    this.home = home;
    this.file = join(home, "log.ndjson");
    this.mintsFile = join(home, "mints.ndjson");
    this.store = store;
    this.log = log;
  }

  static async open(home: string, env: NodeJS.ProcessEnv = process.env): Promise<LocalLog> {
    return LocalLog.load(home, true, env);
  }

  /** Replays the whole log from genesis, ignoring any snapshot. */
  static async openFull(home: string): Promise<LocalLog> {
    return LocalLog.load(home, false, {});
  }

  private static async load(home: string, useSnapshot: boolean, env: NodeJS.ProcessEnv): Promise<LocalLog> {
    mkdirSync(home, { recursive: true });
    const file = join(home, "log.ndjson");
    const mintsFile = join(home, "mints.ndjson");
    const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { appendedAt: string; record: AspRecord }) : [];
    const mintLines = existsSync(mintsFile) ? readFileSync(mintsFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { did: string; amount: number }) : [];

    const store = new MemoryStore();
    const log = new EventLog(store);
    let from = 0; // lines already in the state
    let mintsDone = 0;
    let openedFrom: "snapshot" | "replay" = "replay";
    const snapFile = join(home, "snapshot.json");
    if (useSnapshot && existsSync(snapFile)) {
      try {
        const snap = JSON.parse(readFileSync(snapFile, "utf8")) as Snapshot;
        let h = GENESIS_LOG_HASH;
        if (snap.version === 1 && snap.seq <= lines.length && snap.mintLines <= mintLines.length) {
          for (let i = 0; i < snap.seq; i++) h = nextLogHash(h, lines[i].record.id);
          if (h === snap.logHash) {
            store.importState(snap.state);
            from = snap.seq;
            mintsDone = snap.mintLines;
            openedFrom = "snapshot";
          }
        }
      } catch { /* an unreadable or inconsistent snapshot is ignored: the full replay below is always correct */ }
    }
    // EventLog.mint (MOCKS.md #13) is deliberately not a signed record, so it isn't in log.ndjson; mints go in first, before the
    // records, because a Bond or Settlement may depend on a balance that a mint granted before it.
    for (const m of mintLines.slice(mintsDone)) await log.mint(m.did, m.amount);
    for (const l of lines.slice(from)) await log.appendAt(l.record, l.appendedAt);

    const local = new LocalLog(home, store, log);
    local.replayed = lines.length - from;
    local.openedFrom = openedFrom;
    const every = snapshotEvery(env);
    if (useSnapshot && every > 0 && local.replayed >= every) local.writeSnapshot(lines.length, mintLines.length);
    return local;
  }

  /** Writes a snapshot of the current state (atomically) so the next open can skip replaying what it holds. */
  async snapshot(): Promise<{ seq: number; bytes: number }> {
    const lines = existsSync(this.file) ? readFileSync(this.file, "utf8").split("\n").filter((l) => l.trim()).length : 0;
    const mints = existsSync(this.mintsFile) ? readFileSync(this.mintsFile, "utf8").split("\n").filter((l) => l.trim()).length : 0;
    return this.writeSnapshot(lines, mints);
  }

  private writeSnapshot(seq: number, mintLines: number): { seq: number; bytes: number } {
    const state = this.store.exportState();
    const snap: Snapshot = { version: 1, seq, logHash: state.head.logHash, mintLines, state };
    const text = JSON.stringify(snap);
    const tmp = join(this.home, "snapshot.json.tmp");
    writeFileSync(tmp, text);
    renameSync(tmp, join(this.home, "snapshot.json"));
    return { seq, bytes: Buffer.byteLength(text) };
  }

  /** This log's whole state as JSON, for comparing two logs (see `asp log verify --full`). */
  exportState(): MemoryState { return this.store.exportState(); }

  async append(record: AspRecord): Promise<AppendResult> {
    const appendedAt = new Date().toISOString();
    const res = await this.log.appendAt(record, appendedAt);
    if (!res.duplicate) appendFileSync(this.file, JSON.stringify({ appendedAt, record }) + "\n");
    return res;
  }

  /** Replays another operator's export (EventLog.importRecords) and persists the records that were new, so they survive the next `open`. */
  async importRecords(items: { seq: number; record: AspRecord; appendedAt: string }[], expect?: { seq: number; logHash: string }) {
    const before = (await this.log.head()).seq;
    const res = await this.log.importRecords(items, expect);
    for (const it of [...items].sort((a, b) => a.seq - b.seq)) {
      if (it.seq > before) appendFileSync(this.file, JSON.stringify({ appendedAt: it.appendedAt, record: it.record }) + "\n");
    }
    return res;
  }

  /** Grants credits (EventLog.mint) and persists the grant so it survives the next `open`. */
  async mint(did: string, amount: number): Promise<number> {
    const balance = await this.log.mint(did, amount);
    appendFileSync(this.mintsFile, JSON.stringify({ did, amount }) + "\n");
    return balance;
  }
}

/**
 * The log this run uses: the ASP log service when ASP_LOG_URL is set (with ASP_LOG_TOKEN as the bearer token), else the
 * local file log in `home`. Keys stay local either way; only signed records go over the wire.
 */
export async function openLog(home: string, env: NodeJS.ProcessEnv = process.env): Promise<LogHandle> {
  if (env.ASP_LOG_URL) return new RemoteLog(env.ASP_LOG_URL, env.ASP_LOG_TOKEN);
  return LocalLog.open(home, env);
}
