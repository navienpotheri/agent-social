# Prototype of the job lifecycle for the deeper demo (not the recording script). Isolated local log, nothing touches your real account.
# Run:  bash demo-video/job_proto.sh
set -u
REPO="${REPO:-/c/Users/Navie/agent-social/.claude/worktrees/mystifying-sinoussi-fe1ea3}"
export ASP_HOME="$(mktemp -d)"
asp() { node "$REPO/packages/asp-cli/bin/asp.mjs" "$@"; }
id() { grep -o 'sha256:[0-9a-f]*' | head -1; }
YOU=did:web:example.com:users:you; CODER=did:web:example.com:agents:coder; BANK=did:web:example.com:bank

asp identity new --kind human --did $YOU | head -1
asp identity new --kind agent --did $CODER --sponsor $YOU | head -1
asp identity new --kind human --did $BANK | head -1
asp credits grant --to $YOU --amount 3000 | head -1
asp credits grant --to $CODER --amount 400 | head -1

echo "=== job 1: the work is delivered and verified"
INTENT=$(asp market intent --by $YOU --purpose "Fix the flaky test" --criteria "the test passes 50 times in a row" --budget 1000 --deadline 2026-12-01T00:00:00Z | tee /dev/stderr | id)
OFFER=$(asp market offer --by $CODER --intent $INTENT --price 1000 --plan "fix the race in the test setup" --eta 2026-11-01T00:00:00Z | tee /dev/stderr | id)
CONTRACT=$(asp market contract --principal $YOU --performer $CODER --bank $BANK --intent $INTENT --offer $OFFER | tee /dev/stderr | id)
asp market bond --contract $CONTRACT --backer $CODER --amount 200 --escrow-payer $YOU --escrow-amount 1000
asp credits | head -8
asp market mandate --contract $CONTRACT --principal $YOU --performer $CODER --scopes repo.read repo.write tests.run
asp market deliver --contract $CONTRACT --by $CODER --summary "Fixed the race: the test passes 50 of 50 runs" --claim "the test passes 50 of 50 runs::measured"
asp market verify --contract $CONTRACT --by $BANK --verdict confirmed --grade 0=measured
asp market accept --contract $CONTRACT --by $YOU
asp market settle --contract $CONTRACT --bank $BANK --basis accepted --escrow-released 1000 --bond-returned 200 --bond-slashed 0
asp credits balance $CODER
asp market show $CONTRACT | head -30
echo "ASP_HOME=$ASP_HOME CONTRACT=$CONTRACT"
