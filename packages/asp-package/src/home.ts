import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { didOf, randomSeed, signerFromSeed, type AspRecord, type Signer } from "@agent-social/asp-core";
import { EventLog, MemoryStore, type AppendResult } from "@agent-social/asp-log";

/** The local ASP home: keys and the local event log. ASP_HOME overrides ~/.asp. */
export function aspHome(override?: string): string {
  return override ?? process.env.ASP_HOME ?? join(homedir(), ".asp");
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_");

/**
 * Keys on disk, one JSON file per key: {kid, seed_hex}.
 * Mocked custody (MOCKS.md #10): plaintext files; should move to the OS keychain or an HSM.
 */
export class Keystore {
  readonly dir: string;

  constructor(home: string) {
    this.dir = join(home, "keys");
  }

  create(kid: string): Signer & { publicKey: Uint8Array } {
    return this.createFromSeed(kid, randomSeed());
  }

  /** For a did:key identity, where the DID must be derived from the key before its kid is known. */
  createFromSeed(kid: string, seed: Uint8Array): Signer & { publicKey: Uint8Array } {
    if (this.find(kid)) throw new Error(`key ${kid} already exists`);
    const signer = signerFromSeed(kid, seed);
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${slug(kid)}.json`), JSON.stringify({ kid, seed_hex: Buffer.from(signer.seed).toString("hex") }, null, 2), { mode: 0o600 });
    return signer;
  }

  find(kid: string): (Signer & { publicKey: Uint8Array }) | undefined {
    const file = join(this.dir, `${slug(kid)}.json`);
    if (!existsSync(file)) return undefined;
    const { seed_hex } = JSON.parse(readFileSync(file, "utf8"));
    return signerFromSeed(kid, Buffer.from(seed_hex, "hex"));
  }

  /** The first key held for a DID (keys are named <did>#key-N). */
  forDid(did: string): (Signer & { publicKey: Uint8Array }) | undefined {
    if (!existsSync(this.dir)) return undefined;
    const kids = readdirSync(this.dir)
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf8")).kid as string)
      .filter((kid) => didOf(kid) === did && !kid.includes("#node-"))
      .sort();
    return kids.length ? this.find(kids[0]) : undefined;
  }
}

/**
 * The local event log: an EventLog over a MemoryStore, persisted as NDJSON lines {appendedAt, record}
 * and rebuilt by replaying (and so re-verifying) every line on open.
 */
export class LocalLog {
  readonly log: EventLog;
  private readonly file: string;
  private readonly mintsFile: string;

  private constructor(file: string, mintsFile: string, log: EventLog) {
    this.file = file;
    this.mintsFile = mintsFile;
    this.log = log;
  }

  static async open(home: string): Promise<LocalLog> {
    mkdirSync(home, { recursive: true });
    const file = join(home, "log.ndjson");
    const mintsFile = join(home, "mints.ndjson");
    const log = new EventLog(new MemoryStore());
    // EventLog.mint (MOCKS.md #13) is deliberately not a signed record, so it isn't in log.ndjson;
    // replay it from its own file first, before the log itself — a Bond or Settlement record in
    // log.ndjson may depend on a balance that a mint granted before it, so the balance must already
    // be there by the time that record replays.
    if (existsSync(mintsFile)) {
      for (const line of readFileSync(mintsFile, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const { did, amount } = JSON.parse(line);
        await log.mint(did, amount);
      }
    }
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const { appendedAt, record } = JSON.parse(line);
        await log.appendAt(record, appendedAt);
      }
    }
    return new LocalLog(file, mintsFile, log);
  }

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
