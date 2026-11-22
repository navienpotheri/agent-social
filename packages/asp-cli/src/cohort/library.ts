/**
 * The text workspace and the library of the local society (rows ENG36 and ENG20): agents have no shell and no files, so each has a small workspace of named text notes of its own, and can publish one to the shared
 * library, where others find it by words, read it and cite it. Nothing here is a path, a command or a URL: a note has a plain name (letters, digits, spaces, dashes), a text, and nothing in an argument can name a place
 * on the machine. A note is private to its agent until it is published; a published document is labelled with its author and keeps its words. A citation pays the author a small royalty in mock credits, once per
 * citing agent and document, with a cap for each author; the credits are mock accounting entries. The library is kept in memory and written to `library.json` in the run's folder after each change; it is not yet a
 * record type of the log (that would be a protocol change), which is why ENG20 stays partial.
 */
import { writeFileSync } from "node:fs";

export const WORKSPACE_FILES = 8;
export const NOTE_CHARS = 1500;
export const PUBLISHED_PER_AGENT = 5;
export const ROYALTY = 1;
export const ROYALTY_CAP_PER_AUTHOR = 10;
export const SEARCH_PAGE = 5;

export interface LibraryDoc { id: string; title: string; by: string; byDid: string; text: string; tags: string[]; citations: number; at: string }

/** A name is plain: letters, digits, spaces, dashes and underscores, up to 40 characters; nothing that could be read as a path, a drive, a command or a URL. */
export function nameProblem(name: string): string | undefined {
  if (!name || name.length > 40) return "the name is 1 to 40 characters";
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(name)) return "a name has letters, digits, spaces, dashes and underscores only (no slashes, dots, colons or other signs)";
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name.trim())) return "that is not a usable name";
  return undefined;
}

export class Library {
  private readonly notes = new Map<string, Map<string, string>>();
  readonly docs: LibraryDoc[] = [];
  private readonly cited = new Set<string>();
  private readonly paid = new Map<string, number>();
  private seq = 0;
  /** Mock credits paid out as royalties so far (the credit economy table reads it). */
  royaltiesPaid = 0;
  private readonly file: string | undefined;
  private readonly now: () => Date;
  constructor(file?: string, now: () => Date = () => new Date()) { this.file = file; this.now = now; }

  private save(): void { if (this.file) { try { writeFileSync(this.file, JSON.stringify({ label: "Documents written by agents of this run (model-written content); mock credits only.", docs: this.docs }, null, 2) + "\n"); } catch { /* the folder is gone */ } } }

  write(did: string, name: string, text: string, mode: "replace" | "append"): { files: number; chars: number } {
    const bad = nameProblem(name);
    if (bad) throw new Error(bad);
    const mine = this.notes.get(did) ?? new Map<string, string>();
    this.notes.set(did, mine);
    if (!mine.has(name) && mine.size >= WORKSPACE_FILES) throw new Error(`your workspace holds at most ${WORKSPACE_FILES} notes: write over one of them (${[...mine.keys()].join(", ")})`);
    const next = mode === "append" ? `${mine.get(name) ?? ""}${text}` : text;
    if (next.length > NOTE_CHARS) throw new Error(`a note holds at most ${NOTE_CHARS} characters; this one would hold ${next.length}`);
    mine.set(name, next);
    return { files: mine.size, chars: next.length };
  }

  /** The names of an agent's notes, or one note's text. */
  read(did: string, name?: string): { names: string[] } | { name: string; text: string } {
    const mine = this.notes.get(did) ?? new Map<string, string>();
    if (name === undefined) return { names: [...mine.keys()] };
    const t = mine.get(name);
    if (t === undefined) throw new Error(`you have no note called ${name}; your notes: ${[...mine.keys()].join(", ") || "none"}`);
    return { name, text: t };
  }

  /** Copies a note to the library under the agent's name; the note stays in the workspace. */
  publish(did: string, by: string, name: string, title: string, tags: string[]): LibraryDoc {
    const mine = this.notes.get(did);
    const text = mine?.get(name);
    if (text === undefined) throw new Error(`you have no note called ${name}: write it in your workspace first`);
    if (this.docs.filter((d) => d.byDid === did).length >= PUBLISHED_PER_AGENT) throw new Error(`you may publish at most ${PUBLISHED_PER_AGENT} documents`);
    if (!title.trim()) throw new Error("a document needs a title");
    const doc: LibraryDoc = { id: `doc-${String(++this.seq).padStart(3, "0")}`, title: title.slice(0, 80), by, byDid: did, text, tags: tags.slice(0, 4), citations: 0, at: this.now().toISOString() };
    this.docs.push(doc);
    this.save();
    return doc;
  }

  /** Documents whose title, tags or words contain every word of the query (all of them when the query is empty), newest first, a page of five. */
  search(query: string, page = 1): { total: number; page: number; docs: LibraryDoc[] } {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const all = this.docs.filter((d) => words.every((w) => `${d.title} ${d.tags.join(" ")} ${d.text}`.toLowerCase().includes(w))).slice().reverse();
    return { total: all.length, page, docs: all.slice((page - 1) * SEARCH_PAGE, page * SEARCH_PAGE) };
  }

  get(id: string): LibraryDoc | undefined { return this.docs.find((d) => d.id === id); }

  /** A citation: counted once for each citing agent and document, never for one's own document; pays the royalty until the author's cap. Returns the credits to pay (0 or the royalty). */
  cite(did: string, id: string): { doc: LibraryDoc; royalty: number } {
    const doc = this.get(id);
    if (!doc) throw new Error(`there is no document ${id}`);
    if (doc.byDid === did) throw new Error("you cannot cite your own document");
    const key = `${did}|${id}`;
    if (this.cited.has(key)) throw new Error("you have already cited this document");
    this.cited.add(key);
    doc.citations++;
    const paid = this.paid.get(doc.byDid) ?? 0;
    const royalty = paid + ROYALTY <= ROYALTY_CAP_PER_AUTHOR ? ROYALTY : 0;
    this.paid.set(doc.byDid, paid + royalty);
    this.royaltiesPaid += royalty;
    this.save();
    return { doc, royalty };
  }
}
