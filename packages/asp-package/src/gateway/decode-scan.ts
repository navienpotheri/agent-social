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
  // base64 of UTF-16LE text: what PowerShell's -EncodedCommand carries (and [Text.Encoding]::Unicode.GetString): every other byte is zero, which the latin1 reading above rejects.
  v = cmd.replace(/[A-Za-z0-9+/]{16,}={0,2}/g, (m) => { try { const t = Buffer.from(m, "base64").toString("utf16le"); return t.length >= 4 && PRINTABLE.test(t) ? t : m; } catch { return m; } });
  if (v !== cmd) views.add(v);
  // PowerShell escapes a character with a backtick (i`wr is iwr) and joins strings with + ('cu'+'rl' is curl): read the command with both undone
  const noTicks = cmd.replace(/`(?![nrtabfv0$"'`\\s])/g, "");
  let joined = noTicks;
  for (let i = 0; i < 6; i++) { const next = joined.replace(/(["'])([^"'\n]*)\1\s*\+\s*(["'])([^"'\n]*)\3/g, (_m, _q1, a: string, _q3, b: string) => `"${a}${b}"`); if (next === joined) break; joined = next; }
  joined = joined.replace(/&\s*\(\s*["']([\w.-]+)["']\s*\)/g, "$1");
  if (joined !== cmd) views.add(joined);
  // a nested encoding: the views are read through once more, so base64 inside hex, or base64 twice, is undone
  for (const view of [...views]) for (const inner of innerViews(view)) views.add(inner);
  // `powershell ...` started from a shell tool: the command it carries is read as if it had been typed in PowerShell, and so are the views of it (a plain `powershell Invoke-WebRequest ...` was read as local work)
  for (const view of [cmd, ...views]) { const u = unwrapPowerShell(view); if (u && u !== view) views.add(u); }
  return [...views];
}

/** The command a `powershell` or `pwsh` invocation carries: its own switches and the quotes around the command are removed. */
export function unwrapPowerShell(cmd: string): string | undefined {
  const m = /^\s*(?:&\s*)?(?:"?[A-Za-z]:[^"\s]*[\/])?(?:powershell|pwsh)(?:\.exe)?"?\s+([\s\S]*)$/i.exec(cmd);
  if (!m) return undefined;
  let rest = m[1];
  for (let i = 0; i < 12; i++) {
    const next = rest.replace(/^\s*-(?:NoProfile|NoLogo|NonInteractive|NoExit|Command|c|ExecutionPolicy|ep|WindowStyle|w|File|f|EncodedCommand|enc|ec|e)\b(?:\s+(?:Bypass|Unrestricted|RemoteSigned|AllSigned|Restricted|Hidden|Minimized|Normal))?/i, "");
    if (next === rest) break;
    rest = next;
  }
  rest = rest.trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
  return rest || undefined;
}

/** One more level of the simple encodings (base64, hex, UTF-16 base64) on a view that was already decoded once. */
function innerViews(cmd: string): string[] {
  const out: string[] = [];
  const a = cmd.replace(/[A-Za-z0-9+/_-]{16,}={0,2}/g, (m) => b64(m) ?? m); if (a !== cmd) out.push(a);
  const h = cmd.replace(/(?:0x)?((?:[0-9a-fA-F]{2}){8,})/g, (m, x: string) => { const t = Buffer.from(x, "hex").toString("latin1"); return looksText(t) ? t : m; }); if (h !== cmd) out.push(h);
  return out;
}

/** `rev` as a command of its own, not a word inside another (git rev-parse). */
const REV = /(?:^|[|;&(]\s*)rev\s*(?:$|[|;&)<])/;
const DECODER = /\b(base64\s+(-d|--decode|-D)|FromBase64String|Buffer\.from\([^)]*base64|atob\s*\(|b64decode|certutil\s+(-\w+\s+)*-decode|\bpack\s*\(\s*["']H|(?:zlib\.)?decompress|xxd\s+-r|openssl\s+(enc|base64)\s[^|;\n]*-d|printf\s+['"]?[^|;\n]*\\x|python3?\s+-c\s+['"][^'"]*(b64decode|unhexlify|decode)|tr\s+[^|;\n]*N-ZA-Mn-za-m|gunzip|zcat|uudecode)/i;
const EXEC = /\|\s*(sudo\s+)?(sh|bash|zsh|dash|ksh|python3?|node|perl|ruby|php|source|\.|iex|Invoke-Expression|powershell|pwsh)(\s|$)|\beval\b|\bexec\s*\(|\b(iex|Invoke-Expression)\b|(?:&&|;|&)\s*\S+\.(?:cmd|bat|exe|ps1)\b|\bsource\s+<\(|\b(sh|bash|zsh|dash)\s+-c\s+["']?\$\(|\bbash\s+<\(|\bsh\s+<\(|`[^`]*`\s*$/i;

/** True when the command decodes text and then runs it: what it runs cannot be read here. */
export function decodesAndExecutes(cmd: string): boolean {
  // PowerShell's -EncodedCommand runs what it carries: its text is read as a view, and a payload that cannot be read as text is treated as unreadable execution.
  if (/\b(?:powershell|pwsh)(?:\.exe)?\b[^|;\n]*\s-e(?:nc(?:odedcommand)?|c)?\s+[A-Za-z0-9+/=]{8,}/i.test(cmd)) { const m = /\s-e(?:nc(?:odedcommand)?|c)?\s+([A-Za-z0-9+/=]{8,})/i.exec(cmd); if (m) { try { const t = Buffer.from(m[1], "base64").toString("utf16le"); if (!(t.length >= 2 && PRINTABLE.test(t))) return true; } catch { return true; } } }
  if (!DECODER.test(cmd) && !REV.test(cmd)) return false;
  return EXEC.test(cmd);
}
