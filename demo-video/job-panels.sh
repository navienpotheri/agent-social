# The two side panels of the demo screen (run inside tmux, by job-screen.sh): the signed log of the jobs, and the credits.
REPO="${REPO:-$HOME/agent-social}"
export DEMO_HOME="${DEMO_HOME:-$HOME/.asp-demo}"
G=$'\e[1;32m'; R=$'\e[1;31m'; Y=$'\e[33m'; C=$'\e[1;36m'; D=$'\e[2m'; Z=$'\e[0m'
YOU=did:web:example.com:users:you; CODER=did:web:example.com:agents:coder; BANK=did:web:example.com:bank
_asp() { ASP_HOME="$DEMO_HOME" node "$REPO/packages/asp-cli/bin/asp.mjs" "$@" 2>&1; }
_short() { sed -E 's/sha256:([0-9a-f]{8})[0-9a-f]{56}/sha256:\1…/g; s#did:web:example.com:(users|agents|jurors):##g; s#did:web:example.com:##g'; }

# shorten the long lines so nothing wraps in the narrow side panels
_tight() { sed -E 's/^contract sha256:[0-9a-f]{8}.{1,3}: (state [A-Za-z]+), ([0-9]+) records/\1, \2 records/; s/escrow: ([0-9]+) locked from you, ([0-9]+) bond from coder, settled: (true|false)/escrow \1, bond \2, settled: \3/' | cut -c1-"$(( $(tput cols) - 1 ))"; }

# "the signed log": every record of the jobs, newest at the bottom, refreshed each second
panel_log() {
  while true; do
    local out="" j
    [ -f "$DEMO_HOME/state.env" ] && source "$DEMO_HOME/state.env"
    out+="${C}THE SIGNED LOG${Z}  ${D}signed and chained${Z}"$'\n\n'
    for j in JOB JOB2; do
      local id="${!j:-}"; [ -z "$id" ] && continue
      local label="job 1" body; [ "$j" = JOB2 ] && label="job 2"
      body="$(_asp market show "$id" | _short | _tight)"
      if echo "$body" | grep -q "state Settled"; then
        if [ "$j" = JOB2 ]; then
          label="${R}job 2  FAILED${Z}  ${D}rejected, bond slashed${Z}"
          body="$(echo "$body" | sed -E "s/state Settled/${R}state Settled by ruling${Z}/; s/settled: true/${R}bond slashed${Z}/")"
        else
          label="${G}job 1  ACCEPTED${Z}  ${D}paid, bond returned${Z}"
          body="$(echo "$body" | sed -E "s/state Settled/${G}state Settled${Z}/; s/settled: true/${G}paid${Z}/")"
        fi
      else
        label="${C}${label}${Z}"
        body="$(echo "$body" | sed -E "s/(state Disputed)/${R}\1${Z}/")"
      fi
      out+="${label}"$'\n'"${body}"$'\n\n'
    done
    [ -z "${JOB:-}" ] && [ -z "${JOB2:-}" ] && out+="${D}waiting for the first contract...${Z}"$'\n'
    printf '\033[H\033[2J%s' "$out"
    sleep 1
  done
}

# "credits": who holds what, and what is locked in the open jobs (a mock ledger, not money)
panel_money() {
  while true; do
    local out="${C}CREDITS${Z}  ${D}mock bank${Z}"$'\n\n'
    local d
    for d in $YOU $CODER; do
      local line; line=$(_asp credits balance $d | _short)
      [ -n "$line" ] && out+="$(echo "$line" | sed -E "s/([0-9]+ credits)/${G}\1${Z}/")"$'\n'
    done
    [ -f "$DEMO_HOME/state.env" ] && source "$DEMO_HOME/state.env"
    local j esc=0 bond=0
    for j in JOB JOB2; do
      local id="${!j:-}"; [ -z "$id" ] && continue
      local l; l=$(_asp market show "$id" | grep "escrow:")
      if echo "$l" | grep -q "settled: false"; then
        esc=$((esc + $(echo "$l" | grep -o '[0-9]* locked' | grep -o '[0-9]*' | head -1)))
        bond=$((bond + $(echo "$l" | grep -o '[0-9]* bond' | grep -o '[0-9]*' | head -1)))
      fi
    done
    out+=$'\n'"${Y}locked in open jobs${Z}: ${esc} escrow, ${bond} bond"$'\n'
    printf '\033[H\033[2J%s' "$out"
    sleep 1
  done
}
