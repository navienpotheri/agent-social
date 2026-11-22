#!/usr/bin/env bash
# The offsite copy of the nightly backup (deployment step 3; docs/owner-setup-operations.md section 3).
#
# What it does, on the server, as root, after the nightly backup (it is called as the last line of /usr/local/bin/asp-backup):
#   1. takes the day's backup files in /var/backups/asp: the two newest database dumps (asp-YYYYMMDD-HHMM.sql.gz) and the two newest file archives (asp-files-YYYYMMDD-HHMM.tgz), each not older than 26 hours,
#   2. encrypts each one with `age` to the PUBLIC key in /etc/asp-backup/age-recipient.txt (the server holds only the public key; the private key is the owner's, in his password manager, and is never on the server),
#   3. lists the bucket ONCE, and skips a file whose name.age is already there (the credential can create and list objects but cannot delete, and overwriting an object needs delete: a file that is already there must
#      never be copied again, so a second night, or a test run before the nightly one, copies only what is new),
#   4. copies each new encrypted file (name.age) to the bucket with rclone, using the credential in /etc/asp-backup/rclone.conf, and checks that it is listed there,
#   5. removes its temporary files whatever happens, and exits non-zero if any step failed, naming the step on standard error.
# It prints one line for each file. It never prints the contents of a key or of the rclone configuration.
#
# Nothing here decrypts anything: a restore needs the private key and is done by the owner (docs/deploy/restore-drill.sh).
#
#   /usr/local/bin/asp-backup-offsite
#
# The paths and names below can be changed through the environment (the test does); the defaults are the server's.
set -euo pipefail
umask 077

ETC_BACKUP=${ETC_BACKUP:-/etc/asp-backup}
BACKUPS=${BACKUPS:-/var/backups/asp}
BUCKET=${BUCKET:-agent-social-511217-asp-backups}
DEST=${DEST:-backup:$BUCKET/asp-backups}
CONFIG=${CONFIG:-$ETC_BACKUP/rclone.conf}
RECIPIENT_FILE=${RECIPIENT_FILE:-$ETC_BACKUP/age-recipient.txt}
MAX_AGE_HOURS=${MAX_AGE_HOURS:-26}
KEEP=${KEEP:-2}

fail() { echo "offsite backup FAILED: $*" >&2; exit 1; }

command -v age >/dev/null 2>&1 || fail "age is not installed (apt install age)"
command -v rclone >/dev/null 2>&1 || fail "rclone is not installed (apt install rclone)"
[ -f "$RECIPIENT_FILE" ] || fail "no recipient file at $RECIPIENT_FILE (the PUBLIC key of the owner, one line starting age1)"
# The server must never hold the private key: refuse to run if the file holds one.
if grep -q 'AGE-SECRET-KEY' "$RECIPIENT_FILE"; then fail "$RECIPIENT_FILE holds a PRIVATE key: remove it from the server at once and use the public key (the line starting age1) instead"; fi
RECIPIENT=$(grep -E '^age1[0-9a-z]+$' "$RECIPIENT_FILE" | head -1 || true)
[ -n "$RECIPIENT" ] || fail "$RECIPIENT_FILE has no public key (a line that is only age1... )"
case "$DEST" in backup:*) [ -f "$CONFIG" ] || fail "no rclone configuration at $CONFIG";; esac
[ -d "$BACKUPS" ] || fail "$BACKUPS does not exist"

TMP=$(mktemp -d "${TMPDIR:-/tmp}/asp-offsite.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

# The newest $KEEP files of one kind that are not older than the limit, newest first.
newest() {
  find "$BACKUPS" -maxdepth 1 -type f -name "$1" -mmin "-$((MAX_AGE_HOURS * 60))" -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n "$KEEP" | cut -d' ' -f2-
}

FILES=()
while IFS= read -r f; do [ -n "$f" ] && FILES+=("$f"); done < <(newest 'asp-[0-9]*.sql.gz')
NDB=${#FILES[@]}
while IFS= read -r f; do [ -n "$f" ] && FILES+=("$f"); done < <(newest 'asp-files-*.tgz')
[ "$NDB" -gt 0 ] || fail "no database dump newer than $MAX_AGE_HOURS hours in $BACKUPS (last night's backup did not run, or the dump is missing)"
[ "${#FILES[@]}" -gt "$NDB" ] || fail "no file archive newer than $MAX_AGE_HOURS hours in $BACKUPS"

# What the bucket already holds, listed once. A destination that does not exist yet (the first run) lists as exit status 3 in rclone and counts as empty; any other failure is a failure.
if EXISTING=$(rclone --config "$CONFIG" lsf "$DEST" 2>/dev/null); then :; else
  rc=$?
  if [ "$rc" = 3 ]; then EXISTING=""; else fail "could not list $DEST (rclone exit status $rc)"; fi
fi

COUNT=0
SKIPPED=0
for f in "${FILES[@]}"; do
  name=$(basename "$f")
  if grep -Fxq "$name.age" <<<"$EXISTING"; then echo "skip $name.age already there"; SKIPPED=$((SKIPPED + 1)); continue; fi
  age -r "$RECIPIENT" -o "$TMP/$name.age" "$f" || fail "could not encrypt $name"
  [ -s "$TMP/$name.age" ] || fail "the encrypted copy of $name is empty"
  rclone --config "$CONFIG" copy --no-traverse "$TMP/$name.age" "$DEST" || fail "could not copy $name.age to $DEST"
  LISTING=$(rclone --config "$CONFIG" lsf "$DEST" 2>/dev/null) || fail "could not list $DEST after the copy"
  grep -Fxq "$name.age" <<<"$LISTING" || fail "$name.age is not listed in $DEST after the copy"
  echo "ok $name.age $(wc -c < "$TMP/$name.age" | tr -d ' ') bytes -> $DEST"
  rm -f "$TMP/$name.age"
  COUNT=$((COUNT + 1))
done
echo "offsite: $COUNT copied, $SKIPPED already there"
