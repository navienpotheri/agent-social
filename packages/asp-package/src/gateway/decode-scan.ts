/**
 * Decoded views of a shell command (register rows DK352, BM22 follow-up). The shell scanner reads plain words, so a command whose network use is written as base64, hex, percent-encoding, printf escapes, rot13
 * or reversed text read as local work. This reads the same command again after each of those encodings is undone, and the gateway takes the strictest scope any view shows; and a command that DECODES text and
 * then EXECUTES it (a decoder piped to a shell or an interpreter, or eval of a decoded value) cannot be read at all, so it is treated as network use, which a Mandate without the network refuses.
 * It is not a guarantee: an encoding it does not know, a payload split across calls, or one built piece by piece at run time is not found; the Mandate and the sandbox bound those.
 */

const PRINTABLE = /^[\x09\x0a\x0d\x20-\x7e]+$/;
const looksText = (s: string): boolean => s.length >= 4 && PRINTABLE.test(s);

function b64(s: string): string | undefined {
  try { const out = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1"); return looksText(out) ? out : undefined; } catch { return undefined; }
}
const rot13 = (s: string) => s.replace(/[a-z]/gi, (c) => { const base = c <= "Z" ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base); });

/** The command with each encoded piece replaced by what it decodes to (a view per kind of encoding that changed something). */
export function decodedViews(cmd: string): string[] {
  const views = new Set<string>();
  // base64 runs of 16 or more characters that decode to printable text
  let v = cmd.replace(/[A-Za-z0-9+/_-]{16,}={0,2}/g, (m) => b64(m) ?? m);
  if (v !== cmd) views.add(v);
  // hex runs: 0x... or a plain even run of 16 or more hex digits
  v = cmd.replace(/(?:0x)?((?:[0-9a-fA-F]{2}){8,})/g, (m, h: string) => { const t = Buffer.from(h, "hex").toString("latin1"); return looksText(t) ? t : m; });
  if (v !== cmd) views.add(v);
  // \xNN and \NNN escapes (printf, $'...')
  v = cmd.replace(/\\x([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\\([0-7]{3})/g, (_m, o: string) => String.fromCharCode(parseInt(o, 8)));
  if (v !== cmd) views.add(v);
  // percent-encoding
  try { v = cmd.replace(/(?:%[0-9a-fA-F]{2}){2,}/g, (m) => decodeURIComponent(m)); if (v !== cmd) views.add(v); } catch { /* not valid percent-encoding */ }
  // rot13 and reversed text, only when the command itself says it is undoing one (tr over the alphabet, rev)
  if (/\btr\b[^|;\n]*A-Za-z[^|;\n]*N-ZA-Mn-za-m/.test(cmd)) views.add(rot13(cmd));
  if (REV.test(cmd)) views.add([...cmd].reverse().join(""));
  // a quoted string reversed or rot13-ed inside the command is read too, when the whole command is not itself the payload
  for (const m of cmd.matchAll(/(["'])([^"']{8,})\1/g)) { const r = [...m[2]].reverse().join(""); if (/\b(curl|wget|nc|ssh|scp)\b/.test(r)) views.add(cmd.replace(m[2], r)); const x = rot13(m[2]); if (/\b(curl|wget|http|ssh|scp)\b/.test(x)) views.add(cmd.replace(m[2], x)); }
  return [...views];
}

/** `rev` as a command of its own, not a word inside another (git rev-parse). */
const REV = /(?:^|[|;&(]\s*)rev\s*(?:$|[|;&)<])/;
const DECODER = /\b(base64\s+(-d|--decode|-D)|xxd\s+-r|openssl\s+(enc|base64)\s[^|;\n]*-d|printf\s+['"]?[^|;\n]*\\x|python3?\s+-c\s+['"][^'"]*(b64decode|unhexlify|decode)|tr\s+[^|;\n]*N-ZA-Mn-za-m|gunzip|zcat|uudecode)/i;
const EXEC = /\|\s*(sudo\s+)?(sh|bash|zsh|dash|ksh|python3?|node|perl|ruby|php|source|\.)(\s|$)|\beval\b|\bsource\s+<\(|\b(sh|bash|zsh|dash)\s+-c\s+["']?\$\(|\bbash\s+<\(|\bsh\s+<\(|`[^`]*`\s*$/i;

/** True when the command decodes text and then runs it: what it runs cannot be read here. */
export function decodesAndExecutes(cmd: string): boolean {
  if (!DECODER.test(cmd) && !REV.test(cmd)) return false;
  return EXEC.test(cmd);
}
