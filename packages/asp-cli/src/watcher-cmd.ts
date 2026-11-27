/**
 * `asp watcher register | publish` (register row DK520, spec-delta S961): puts the society watcher and its collusion findings in the log, so the Clinic can cite a finding in a checkup order.
 * The watcher is a software process of the service with a key of its own (`watcher.key` in its folder). `register` writes its passport (a person-kind identity whose only key is that key), so the log can
 * check what it signs; `publish` appends a `watcher_finding` record for each collusion finding of its feed that is not in the log yet, signed with that key. A finding is a lead: it moves no credit and
 * changes no standing. Run on the service machine, against the service's log.
 */
import { createRecord } from "@agent-social/asp-core";
import { WATCHER_DID } from "@agent-social/asp-log";
import { SocietyWatcher, WATCHER_KID, verifyFinding, watcherFindingBody, type LogHandle } from "@agent-social/asp-package";

export class WatcherUsage extends Error {}

export interface WatcherOpts {
  log: LogHandle;
  io: { out: (l: string) => void; err: (l: string) => void };
  now: () => string;
  flags: { dir?: string; finding?: string };
}

export async function watcherCmd(sub: string | undefined, o: WatcherOpts): Promise<number> {
  if (sub !== "register" && sub !== "publish") throw new WatcherUsage("asp watcher register --watch-dir <dir> | publish --watch-dir <dir> [--finding <id>]");
  if (!o.flags.dir) throw new WatcherUsage(`asp watcher ${sub} --watch-dir <the watcher's folder: findings.json and watcher.key>`);
  const watcher = new SocietyWatcher({ log: { since: async () => [] }, dir: o.flags.dir });
  if (sub === "register") {
    if (await o.log.log.passport(WATCHER_DID)) { o.io.out(`${WATCHER_DID} is already registered in the log`); return 0; }
    const rec = createRecord({ type: "passport", issuer: WATCHER_DID, subject: WATCHER_DID, prev: null, body: { did: WATCHER_DID, kind: "human", keys: [{ id: WATCHER_KID, type: "Ed25519", public_key: watcher.publicKey }] }, issued_at: o.now() }, watcher.signer);
    const res = await o.log.append(rec);
    o.io.out(`watcher ${WATCHER_DID} registered (record ${res.id}, log seq ${res.seq}); its findings can now be put in the log`);
    return 0;
  }
  const want = o.flags.finding;
  const inLog = new Set(((await o.log.log.recordsOfTypes(["watcher_finding"])) as unknown as { body: { finding_id: string } }[]).map((r) => r.body.finding_id));
  let done = 0, known = 0;
  for (const f of watcher.list()) {
    if (want && f.id !== want && !f.id.startsWith(want) && !f.id.slice(7).startsWith(want)) continue;
    const body = watcherFindingBody(f);
    if (!body) { if (want) o.io.err(`  ${f.id}: a ${f.finding.kind} finding is not put in the log (only collusion findings are)`); continue; }
    if (!verifyFinding(f, watcher.publicKey)) { o.io.err(`  ${f.id}: the signature does not verify under the watcher's key; skipped`); continue; }
    if (inLog.has(f.id)) { known++; continue; }
    try {
      const res = await o.log.append(createRecord({ type: "watcher_finding" as never, issuer: WATCHER_DID, subject: null, prev: null, body, issued_at: o.now() }, watcher.signer));
      o.io.out(`finding ${f.id.slice(0, 19)} is in the log as ${res.id} (log seq ${res.seq}); the Clinic cites ${res.id}`);
      done++;
    } catch (e) {
      if ((e as { detail?: string }).detail === "watcher_finding_known") known++;
      else o.io.err(`  ${f.id}: not put in the log: ${(e as Error).message}`);
    }
  }
  o.io.out(`${done} finding(s) put in the log, ${known} already there`);
  return 0;
}
