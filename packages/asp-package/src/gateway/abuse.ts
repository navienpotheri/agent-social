/**
 * Harm to third parties through a network scope the Mandate legitimately grants (gap H1): brute force, scanning, flooding. The rate limit (rate.ts) bounds how fast; this
 * recognises what the traffic looks like and stops it, in two places:
 *  - the text of a shell command (`commandAbuse`): a password-guessing loop, a wordlist fed to a request tool, a port loop with nc or /dev/tcp;
 *  - the traffic through the egress proxy (`AbuseWatch`): many 401 and 403 answers from one host in a minute (guessing a login), and many different ports of one host in a
 *    minute (a port scan). A host that trips either is shut for the rest of the run.
 * The proxy reads the answers only of plain HTTP: an HTTPS tunnel is opaque without TLS interception (not planned), so the failed-auth detector sees HTTP only (left in H1).
 */
export interface AbuseLimits { authFailuresPerMinute: number; portsPerHostPerMinute: number; shutMs: number }
export const ABUSE_DEFAULTS: AbuseLimits = { authFailuresPerMinute: 10, portsPerHostPerMinute: 8, shutMs: 3_600_000 };

const WINDOW = 60_000;
const NET_TOOL = /\b(curl|wget|http|https|nc|ncat|netcat|telnet|ssh|sshpass|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b|\/dev\/tcp\//i;
const LOOP = /\b(while|until|for|xargs|parallel|foreach|ForEach-Object)\b|%\s*\{/i;
const WORDLIST = /\b(rockyou|wordlist|SecLists|darkweb2017|10k-most-common|common-passwords)\b|\b(passwords?|pass(wd)?s?|creds?|usernames?|users)\.(txt|lst)\b|\.lst\b/i;
const CREDENTIAL = /(?:^|[\s&?'"{(])(-u\s+\S+|--user\s+\S+|-d\s+\S*(?:pass|pwd)\S*|--data\S*\s+\S*(?:pass|pwd)\S*|(?:pass(?:word)?|passwd|pwd|pin|otp)\s*=)/i;
const REQUEST_TOOL = /\b(curl|wget|http|ssh|sshpass|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|telnet)\b/i;
const PORT_TOOL = /(\bnc\b|\bncat\b|\bnetcat\b|\/dev\/tcp\/|\btelnet\b)/i;

/** Why a shell command reads as brute force or a scan, or undefined. Text in, text out; the gateway refuses the call and counts a strike. */
export function commandAbuse(command: string): string | undefined {
  if (!NET_TOOL.test(command)) return undefined;
  const loop = LOOP.test(command);
  if (WORDLIST.test(command)) return "it feeds a password or username list to a network tool, which reads as guessing credentials (brute force)";
  if (loop && CREDENTIAL.test(command) && REQUEST_TOOL.test(command)) return "it tries credentials in a loop, which reads as guessing a login (brute force)";
  if (loop && PORT_TOOL.test(command) && (/\s-\w*z\w*\b|\/dev\/tcp\//.test(command) || /\d+\s*\.\.\s*\d+|\bseq\b/.test(command))) return "it probes a range of ports in a loop, which reads as a port scan";
  return undefined;
}

export class AbuseWatch {
  private auth = new Map<string, number[]>();
  private ports = new Map<string, Map<number, number>>();
  private shut = new Map<string, { reason: string; until: number }>();
  private limits: AbuseLimits;
  private now: () => number;
  constructor(limits: AbuseLimits = ABUSE_DEFAULTS, now: () => number = Date.now) { this.limits = limits; this.now = now; }

  /** Why this host is shut, or undefined. */
  closed(host: string): string | undefined {
    const s = this.shut.get(host);
    if (!s) return undefined;
    if (s.until < this.now()) { this.shut.delete(host); return undefined; }
    return s.reason;
  }

  /** A new connection to host:port. Returns the reason when this is the one that makes it a scan. */
  connection(host: string, port: number): string | undefined {
    const t = this.now();
    const m = this.ports.get(host) ?? (this.ports.set(host, new Map()), this.ports.get(host)!);
    for (const [p, at] of m) if (at <= t - WINDOW) m.delete(p);
    m.set(port, t);
    if (m.size > this.limits.portsPerHostPerMinute) return this.close(host, `${m.size} different ports of ${host} were tried in a minute, which reads as a port scan`);
    return undefined;
  }

  /** An answer from host. Returns the reason when this is the one that makes it look like guessing a login. */
  response(host: string, status: number): string | undefined {
    if (status !== 401 && status !== 403) return undefined;
    const t = this.now();
    const list = (this.auth.get(host) ?? []).filter((x) => x > t - WINDOW);
    list.push(t);
    this.auth.set(host, list);
    if (list.length >= this.limits.authFailuresPerMinute) return this.close(host, `${host} answered ${list.length} requests with 401 or 403 in a minute, which reads as guessing a login (brute force)`);
    return undefined;
  }

  private close(host: string, reason: string): string {
    this.shut.set(host, { reason, until: this.now() + this.limits.shutMs });
    return reason;
  }
}
