#!/usr/bin/env bash
# The restore drill (launch gate #13, docs/operator-runbook.md): proves that the newest nightly backup can be restored and that the log in it verifies, without touching the live database.
#
# What it does, on the server, as root:
#   1. takes the newest database backup in /var/backups/asp (asp-YYYYMMDD-HHMM.sql.gz),
#   2. restores it into a scratch database called asp_drill (it refuses to run if that name is anywhere near the live one),
#   3. starts a throwaway copy of the service on 127.0.0.1:18787 with its own token file (nothing is shared with the live service),
#   4. runs `asp log verify` against it: every record's hash and signature, and the chain,
#   5. prints the record count and head so you can compare them with the live service's, and then removes everything it made.
#
# It changes nothing that the live service uses. Run it once now, record the output in docs/live-run-checklist.md, and again after any change to the backup job.
#
#   sudo bash restore-drill.sh [backup-file]
set -euo pipefail

APP=${APP:-/opt/asp}
ETC=${ETC:-/etc/asp}
BACKUPS=${BACKUPS:-/var/backups/asp}
SCRATCH_DB=asp_drill
PORT=18787
[ "$(id -u)" = 0 ] || { echo "run as root: sudo bash $0" >&2; exit 2; }
[ "$SCRATCH_DB" != "asp" ] || { echo "refusing: the scratch database must not be the live one" >&2; exit 2; }

FILE=${1:-$(ls -1t "$BACKUPS"/asp-[0-9]*.sql.gz 2>/dev/null | head -1 || true)}
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "no backup found in $BACKUPS (the nightly job is /usr/local/bin/asp-backup)" >&2; exit 1; }
echo "==> restoring $FILE ($(date -u -r "$FILE" +%Y-%m-%dT%H:%M:%SZ), $(du -h "$FILE" | cut -f1)) into the scratch database $SCRATCH_DB"

WORK=$(mktemp -d /tmp/asp-drill.XXXXXX)
PID=""
cleanup() {
  [ -n "$PID" ] && kill "$PID" 2>/dev/null || true
  sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS $SCRATCH_DB" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

sudo -u postgres psql -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $SCRATCH_DB" -c "CREATE DATABASE $SCRATCH_DB"
# The dump was made from the live database (named asp, owned by the asp role): load it into the scratch one.
gunzip -c "$FILE" | sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$SCRATCH_DB" >/dev/null
echo "    restored"

TOKENS="$WORK/tokens.json"
TOKEN=$(node "$APP/packages/asp-cli/bin/asp.mjs" serve token --tokens "$TOKENS" --tenant drill --role admin | tail -1)
# The scratch database is reached as the same role as the live one, with the live URL's password: only the database name changes.
LIVE_URL=$(grep -E '^DATABASE_URL=' "$ETC/asp.env" | head -1 | cut -d= -f2-)
case "$LIVE_URL" in */asp) ;; *) echo "unexpected DATABASE_URL in $ETC/asp.env (it should end in /asp)" >&2; exit 1;; esac
SCRATCH_URL="${LIVE_URL%/asp}/$SCRATCH_DB"
echo "==> starting a throwaway service on 127.0.0.1:$PORT"
node "$APP/packages/asp-cli/bin/asp.mjs" serve --db "$SCRATCH_URL" --tokens "$TOKENS" --host 127.0.0.1 --port "$PORT" >"$WORK/service.log" 2>&1 &
PID=$!
for _ in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  kill -0 "$PID" 2>/dev/null || { echo "the throwaway service exited:" >&2; cat "$WORK/service.log" >&2; exit 1; }
  sleep 0.5
done

echo "==> verifying the restored log"
OUT=$(ASP_LOG_URL="http://127.0.0.1:$PORT" ASP_LOG_TOKEN="$TOKEN" node "$APP/packages/asp-cli/bin/asp.mjs" log verify) || { echo "$OUT" >&2; echo "DRILL FAILED: the restored log does not verify" >&2; exit 1; }
echo "    $OUT"
echo
echo "DRILL PASSED. Compare the record count and head above with the live service (run as the operator):"
echo "    ASP_LOG_URL=https://<domain> ASP_LOG_TOKEN=<admin token> asp log verify"
echo "The live service will be ahead of the backup by what was written since $(date -u -r "$FILE" +%Y-%m-%dT%H:%MZ); the restored head must be one the live log passed through."
