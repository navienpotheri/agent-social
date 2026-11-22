// docs/deploy/backup-offsite.sh encrypts the day's backup files with age to a PUBLIC key and copies them to the bucket with rclone. It is tested here with stand-in `age` and `rclone` programs (so that it runs on any machine
// that has bash), and, where the real `age`, `age-keygen` and `rclone` are installed, with a real round trip: a generated key pair, encryption, a copy to a local rclone remote, decryption and a byte-for-byte comparison.
// Held: the newest two dumps and the newest two file archives within 26 hours are the ones copied; a failing step makes the script exit non-zero and say which; the temporary files are removed on success and on failure;
// the script refuses a recipient file that holds a private key; and no key and no configuration content appears in any output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const root = new URL("../../../", import.meta.url);
const script = decodeURIComponent(new URL("docs/deploy/backup-offsite.sh", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const text = readFileSync(script, "utf8");
const bash = spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" });
const HAVE_BASH = bash.status === 0 && bash.stdout.trim() === "ok";
const posix = (p: string) => p.replace(/\\/g, "/");
const RECIPIENT = "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
const SECRET_CONFIG = "FAKE-SERVICE-ACCOUNT-KEY-CONTENT-DO-NOT-PRINT";
const PRIVATE = "AGE-SECRET-KEY-1FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE";

const STUB_AGE = `#!/usr/bin/env bash
# a stand-in for age: records the recipient and the umask, and "encrypts" by prefixing a header (reversible, never used as a cipher)
out=""; rec=""; in=""
while [ $# -gt 0 ]; do case "$1" in -r) rec="$2"; shift 2;; -o) out="$2"; shift 2;; *) in="$1"; shift;; esac; done
echo "age -r $rec umask=$(umask)" >> "$STUB_LOG"
[ -n "\${AGE_FAIL:-}" ] && { echo "age: failed" >&2; exit 1; }
{ echo "STUB-AGE-HEADER $rec"; cat "$in"; } > "$out"
`;
const STUB_RCLONE = `#!/usr/bin/env bash
# a stand-in for rclone: copyto copies to a local directory, lsf lists it; RCLONE_FAIL makes the copy fail
[ "$1" = "--config" ] && { echo "rclone config=$2 $3 args" >> "$STUB_LOG"; shift 2; } || echo "rclone no-config" >> "$STUB_LOG"
verb="$1"; shift
dest_dir() { echo "\${1#backup:}" | sed "s|^[^/]*/||"; }
case "$verb" in
  copyto) [ -n "\${RCLONE_FAIL:-}" ] && { echo "rclone: copy failed" >&2; exit 1; }; mkdir -p "$STUB_REMOTE/asp-backups"; cp "$1" "$STUB_REMOTE/asp-backups/$(basename "$2")";;
  lsf) ls -1 "$STUB_REMOTE/asp-backups" 2>/dev/null;;
  *) echo "unexpected rclone verb $verb" >&2; exit 2;;
esac
`;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "asp-offsite-"));
  const bin = join(dir, "bin"), backups = join(dir, "backups"), etc = join(dir, "etc"), remote = join(dir, "remote"), tmp = join(dir, "tmp");
  for (const d of [bin, backups, etc, remote, tmp]) mkdirSync(d);
  writeFileSync(join(bin, "age"), STUB_AGE); writeFileSync(join(bin, "rclone"), STUB_RCLONE);
  chmodSync(join(bin, "age"), 0o755); chmodSync(join(bin, "rclone"), 0o755);
  writeFileSync(join(etc, "age-recipient.txt"), RECIPIENT + "\n");
  writeFileSync(join(etc, "rclone.conf"), `[backup]\ntype = google cloud storage\nservice_account_file = ${SECRET_CONFIG}\nbucket_policy_only = true\n`);
  const log = join(dir, "log.txt");
  writeFileSync(log, "");
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
  const put = (name: string, h: number, body = name + " content\n") => { const p = join(backups, name); writeFileSync(p, body); utimesSync(p, hoursAgo(h), hoursAgo(h)); return p; };
  const env = (extra: Record<string, string> = {}) => ({
    ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, ETC_BACKUP: posix(etc), BACKUPS: posix(backups), TMPDIR: posix(tmp), STUB_LOG: posix(log), STUB_REMOTE: posix(remote),
    DEST: "backup:bucket-name/asp-backups", CONFIG: posix(join(etc, "rclone.conf")), RECIPIENT_FILE: posix(join(etc, "age-recipient.txt")), ...extra,
  });
  const run = (extra: Record<string, string> = {}) => spawnSync("bash", [posix(script)], { env: env(extra), encoding: "utf8", timeout: 60_000 });
  return { dir, bin, backups, etc, remote, tmp, log, put, run, env };
}
const noTemp = (tmp: string) => assert.deepEqual(readdirSync(tmp), [], "the temporary directory is removed");
const noSecrets = (out: string) => { assert.ok(!out.includes(SECRET_CONFIG), "no configuration content in the output"); assert.ok(!out.includes("AGE-SECRET-KEY"), "no private key in the output"); };

test("the script is strict, encrypts to a public key only, copies with rclone, removes its temporary files in a trap, and never reads or prints a secret", () => {
  assert.match(text, /^set -euo pipefail$/m);
  assert.match(text, /^umask 077$/m);
  assert.match(text, /trap 'rm -rf "\$TMP"' EXIT/);
  assert.match(text, /age -r "\$RECIPIENT" -o /);
  assert.match(text, /rclone --config "\$CONFIG" copyto /);
  assert.doesNotMatch(text, /age -d|--decrypt|-i "|\bcrypt\b|passphrase/, "nothing decrypts, and rclone crypt is not used");
  assert.doesNotMatch(text, /\bcat "\$CONFIG"|\bcat "\$RECIPIENT_FILE"|echo "\$RECIPIENT"|key\.json/, "no secret is read to the output");
  assert.match(text, /AGE-SECRET-KEY/, "it refuses a private key in the recipient file");
  assert.match(text, /26/);
});

test("the newest two dumps and the newest two archives within 26 hours are encrypted and copied; older files and a third are not; one line for each file", { skip: !HAVE_BASH && "bash is not available" }, () => {
  const s = setup();
  s.put("asp-20261120-0217.sql.gz", 3); s.put("asp-20261121-0217.sql.gz", 2); s.put("asp-20261119-0217.sql.gz", 4);
  s.put("asp-files-20261121-0217.tgz", 2); s.put("asp-files-20261120-0217.tgz", 3); s.put("asp-files-20261119-0217.tgz", 5);
  s.put("asp-20261101-0217.sql.gz", 200); s.put("asp-files-20261101-0217.tgz", 200); s.put("unrelated.txt", 1);
  const r = s.run();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.filter((l) => l.startsWith("ok ")).length, 4, "one line for each of four files");
  assert.match(lines[lines.length - 1]!, /^offsite: 4 file\(s\) encrypted and copied$/);
  assert.deepEqual(readdirSync(join(s.remote, "asp-backups")).sort(), ["asp-20261120-0217.sql.gz.age", "asp-20261121-0217.sql.gz.age", "asp-files-20261120-0217.tgz.age", "asp-files-20261121-0217.tgz.age"]);
  const log = readFileSync(s.log, "utf8");
  assert.equal([...log.matchAll(new RegExp(`age -r ${RECIPIENT} umask=0077`, "g"))].length, 4, "age is called with the public key, under umask 077");
  assert.match(log, /rclone config=.*rclone\.conf copyto/);
  noTemp(s.tmp); noSecrets(r.stdout + r.stderr);
});

test("a failing copy, a failing encryption, a copy that is not listed afterwards, and no recent dump each make the script exit non-zero and say which step, and leave no temporary file", { skip: !HAVE_BASH && "bash is not available" }, () => {
  const s = setup();
  s.put("asp-20261121-0217.sql.gz", 2); s.put("asp-files-20261121-0217.tgz", 2);
  const copy = s.run({ RCLONE_FAIL: "1" });
  assert.notEqual(copy.status, 0);
  assert.match(copy.stderr, /offsite backup FAILED: could not copy asp-.*\.age to backup:bucket-name\/asp-backups/);
  noTemp(s.tmp); noSecrets(copy.stdout + copy.stderr);
  const enc = s.run({ AGE_FAIL: "1" });
  assert.notEqual(enc.status, 0);
  assert.match(enc.stderr, /offsite backup FAILED: could not encrypt/);
  noTemp(s.tmp);
  // A stand-in rclone that copies nothing and lists nothing: the copy "succeeds" but the file is not there.
  writeFileSync(join(s.bin, "rclone"), `#!/usr/bin/env bash\n[ "$1" = "--config" ] && shift 2\ncase "$1" in copyto) exit 0;; lsf) exit 0;; esac\n`);
  const missing = s.run();
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /is not listed in backup:bucket-name\/asp-backups after the copy/);
  noTemp(s.tmp);
  const t = setup();
  t.put("asp-20261101-0217.sql.gz", 200); t.put("asp-files-20261101-0217.tgz", 200);
  const stale = t.run();
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /no database dump newer than 26 hours/);
  const u = setup();
  u.put("asp-20261121-0217.sql.gz", 2);
  const noArchive = u.run();
  assert.notEqual(noArchive.status, 0);
  assert.match(noArchive.stderr, /no file archive newer than 26 hours/);
  noTemp(t.tmp); noTemp(u.tmp);
});

test("the script refuses a recipient file that holds a private key, a missing recipient and a missing configuration, and prints none of the secret", { skip: !HAVE_BASH && "bash is not available" }, () => {
  const s = setup();
  s.put("asp-20261121-0217.sql.gz", 2); s.put("asp-files-20261121-0217.tgz", 2);
  writeFileSync(join(s.etc, "age-recipient.txt"), PRIVATE + "\n");
  const priv = s.run();
  assert.notEqual(priv.status, 0);
  assert.match(priv.stderr, /holds a PRIVATE key/);
  assert.ok(!(priv.stdout + priv.stderr).includes(PRIVATE), "the private key is not echoed");
  writeFileSync(join(s.etc, "age-recipient.txt"), "# no key here\n");
  assert.match(s.run().stderr, /has no public key/);
  const nofile = s.run({ RECIPIENT_FILE: posix(join(s.etc, "missing.txt")) });
  assert.match(nofile.stderr, /no recipient file/);
  writeFileSync(join(s.etc, "age-recipient.txt"), RECIPIENT + "\n");
  const noconf = s.run({ CONFIG: posix(join(s.etc, "missing.conf")) });
  assert.notEqual(noconf.status, 0);
  assert.match(noconf.stderr, /no rclone configuration/);
  noSecrets(priv.stdout + priv.stderr + noconf.stdout + noconf.stderr);
});

const real = HAVE_BASH ? ["age", "age-keygen", "rclone"].every((c) => spawnSync("bash", ["-c", `command -v ${c}`]).status === 0) : false;
test("with the real age and rclone: a generated key pair, encrypt, copy to a local remote, decrypt with the private key, byte-equal; a failing copy exits non-zero; no key in any output", { skip: !real && "age, age-keygen and rclone are not installed on this machine (the stand-in tests above ran; this one did not)" }, () => {
  const s = setup();
  const kp = spawnSync("bash", ["-c", `age-keygen -o "${posix(join(s.dir, "id.txt"))}" 2>&1`], { encoding: "utf8" });
  assert.equal(kp.status, 0, kp.stdout);
  const pub = /(age1[0-9a-z]+)/.exec(kp.stdout)![1]!;
  writeFileSync(join(s.etc, "age-recipient.txt"), pub + "\n");
  // A real rclone with a local remote named backup.
  const conf = join(s.etc, "rclone.conf");
  writeFileSync(conf, `[backup]\ntype = local\n`);
  const bodies: Record<string, Buffer> = {};
  for (const [n, h] of [["asp-20261121-0217.sql.gz", 2], ["asp-files-20261121-0217.tgz", 2]] as const) { const body = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7 + n.length) % 256)); bodies[n] = body; s.put(n, h, ""); writeFileSync(join(s.backups, n), body); utimesSync(join(s.backups, n), new Date(Date.now() - h * 3_600_000), new Date(Date.now() - h * 3_600_000)); }
  const bucketDir = posix(join(s.dir, "bucket"));
  const env = { PATH: process.env.PATH!, DEST: `backup:${bucketDir}/asp-backups` };
  const r = spawnSync("bash", [posix(script)], { env: { ...process.env, ...s.env(), ...env, PATH: process.env.PATH! }, encoding: "utf8", timeout: 120_000 });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  noSecrets(r.stdout + r.stderr); assert.ok(!(r.stdout + r.stderr).includes(readFileSync(join(s.dir, "id.txt"), "utf8").split("\n").find((l) => l.startsWith("AGE-SECRET-KEY"))!));
  for (const [n, body] of Object.entries(bodies)) {
    const enc = join(s.dir, "bucket", "asp-backups", `${n}.age`);
    assert.ok(existsSync(enc), `${n}.age is in the bucket`);
    assert.notDeepEqual(readFileSync(enc), body, "it is not the plaintext");
    const out = join(s.dir, `dec-${n}`);
    const d = spawnSync("bash", ["-c", `age -d -i "${posix(join(s.dir, "id.txt"))}" -o "${posix(out)}" "${posix(enc)}"`], { encoding: "utf8" });
    assert.equal(d.status, 0, d.stderr);
    assert.deepEqual(readFileSync(out), body, `${n} decrypts to the same bytes`);
  }
  noTemp(s.tmp);
  // A destination that cannot be written makes the script fail.
  const bad = spawnSync("bash", [posix(script)], { env: { ...process.env, ...s.env(), DEST: "backup:/proc/definitely/not/writable/asp-backups" }, encoding: "utf8", timeout: 120_000 });
  assert.notEqual(bad.status, 0);
});

test("the documents give the age route, not a passphrase on the server: the facts of the bucket, the five numbered steps in the plan and the walkthrough, the hook in the setup script, and the drill that refuses an encrypted file", () => {
  const plan = readFileSync(new URL("docs/deployment-plan.md", root), "utf8");
  const walk = readFileSync(new URL("docs/deployment-walkthrough.md", root), "utf8");
  const ops = readFileSync(new URL("docs/owner-setup-operations.md", root), "utf8");
  const setup = readFileSync(new URL("docs/deploy/setup-server.sh", root), "utf8");
  const drill = readFileSync(new URL("docs/deploy/restore-drill.sh", root), "utf8");
  for (const [name, d] of [["plan", plan], ["walkthrough", walk], ["operations", ops]] as const) {
    for (const frag of ["gs://agent-social-511217-asp-backups", "ASIA-SOUTH2", "asp-backup-writer@agent-social-511217.iam.gserviceaccount.com", "aspBackupWriter", "/etc/asp-backup/key.json", "/etc/asp-backup/age-recipient.txt", "never on the server", "one boot disk"]) if (name !== "operations" || frag !== "one boot disk") assert.ok(d.includes(frag), `${name}: ${frag}`);
    assert.doesNotMatch(d, /rclone's `crypt`|rclone crypt|passphrase that is stored with the read credential/, `${name}: no passphrase on the server`);
    assert.doesNotMatch(d, /snapshot of the boot disk and of the data disk|open the boot disk, the data disk/, `${name}: the server has one disk`);
  }
  for (const d of [plan, walk]) {
    for (const cmd of ["age-keygen -o asp-backup-key.txt", "sudo apt-get update && sudo apt-get install -y age rclone", "service_account_file = /etc/asp-backup/key.json", "bucket_policy_only = true", "sudo install -m 755 /tmp/backup-offsite.sh /usr/local/bin/asp-backup-offsite", "sudo grep -q asp-backup-offsite /usr/local/bin/asp-backup", "sudo /usr/local/bin/asp-backup", "age -d -i asp-key.txt", "sudo bash /tmp/restore-drill.sh /tmp/asp-YYYYMMDD-HHMM.sql.gz", "DRILL PASSED"]) assert.ok(d.includes(cmd), cmd);
    for (let n = 1; n <= 5; n++) assert.ok(d.includes(`**${n}. `), `numbered step ${n}`);
  }
  assert.match(setup, /if \[ -x \/usr\/local\/bin\/asp-backup-offsite \]; then \/usr\/local\/bin\/asp-backup-offsite; fi/, "the setup script keeps the hook when it rewrites asp-backup");
  assert.match(drill, /\*\.age\) echo "refusing an encrypted file/);
  assert.match(plan, /DK1804/);
  assert.match(readFileSync(new URL("docs/gaps-register.md", root), "utf8"), /^\| DK1804 \|/m);
});

test("the restore drill refuses an encrypted file before it touches anything", { skip: !HAVE_BASH && "bash is not available" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-drill-"));
  const f = join(dir, "asp-20261121-0217.sql.gz.age"); writeFileSync(f, "x");
  const drillPath = decodeURIComponent(new URL("docs/deploy/restore-drill.sh", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  const r = spawnSync("bash", ["-c", `id() { echo 0; }; export -f id; bash "${posix(drillPath)}" "${posix(f)}"`], { encoding: "utf8", timeout: 30_000 });
  assert.equal(r.status, 2, r.stderr + r.stdout);
  assert.match(r.stderr, /refusing an encrypted file/);
  assert.match(r.stderr, /private key must never be on the server/);
});
