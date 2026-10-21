# Rehearsal helper (WSL/Ubuntu): runs the real agent (Codex on OpenRouter) under a priced contract through the gateway. Isolated local log.
set -u
REPO="${REPO:-$HOME/agent-social}"
export ASP_HOME="$(mktemp -d)"
asp() { node "$REPO/packages/asp-cli/bin/asp.mjs" "$@"; }
id() { grep -o 'sha256:[0-9a-f]*' | head -1; }
YOU=did:web:example.com:users:you; CODER=did:web:example.com:agents:coder; BANK=did:web:example.com:bank; VER=did:web:example.com:verifier
for d in $YOU $BANK $VER; do asp identity new --kind human --did $d >/dev/null; done
asp identity new --kind agent --did $CODER --sponsor $YOU >/dev/null
asp credits grant --to $YOU --amount 3000 >/dev/null; asp credits grant --to $CODER --amount 400 >/dev/null
INTENT=$(asp market intent --by $YOU --purpose "Fix the flaky test" --criteria "the test passes 50 times in a row" --budget 1000 --deadline 2026-12-01T00:00:00Z --verifier $VER | id)
OFFER=$(asp market offer --by $CODER --intent $INTENT --price 1000 --plan "fix the race" --eta 2026-11-01T00:00:00Z | id)
JOB=$(asp market contract --principal $YOU --performer $CODER --bank $BANK --intent $INTENT --offer $OFFER | id)
asp market bond --contract $JOB --backer $CODER --amount 200 --escrow-payer $YOU --escrow-amount 1000 | head -2
asp market mandate --contract $JOB --principal $YOU --performer $CODER --scopes repo.read --scopes repo.write --scopes shell.exec --scopes tests.run | head -1 | cut -c1-100
export OPENROUTER_API_KEY="$(cat ~/.asp-openrouter-key)"
asp gateway --contract $JOB --by $CODER --openai-upstream https://openrouter.ai/api/v1 --openai-key-env OPENROUTER_API_KEY -- node "$REPO/demo-video/codex-task.mjs" "${PROMPT:-The test in this project is flaky.}" 2>&1 | sed -u "s/$OPENROUTER_API_KEY/[key]/g"
echo "ASP_HOME=$ASP_HOME JOB=$JOB"
