# The deeper demo, recorded in Ubuntu (WSL): a user hires an agent through the protocol and works a real problem.
# Load:   source ~/agent-social/demo-video/job.sh        (once, in the window you record)
# Play:   play JOB                                       (the whole story, one continuous recording; about 3 minutes raw)
# Parts:  play A | B | C | D                             (A the contract, B the work, C the proof, D the consequence)
# Rehearse without the model: DRY=1 play JOB             (types the commands, runs nothing)
# Needs: node 22+, codex, the OpenRouter key in ~/.asp-openrouter-key (never printed), git, the flaky project in ~/flaky-app.

REPO="${REPO:-$HOME/agent-social}"
G=$'\e[1;32m'; R=$'\e[1;31m'; Y=$'\e[33m'; C=$'\e[1;36m'; D=$'\e[2m'; Z=$'\e[0m'
export YOU=did:web:example.com:users:you CODER=did:web:example.com:agents:coder BANK=did:web:example.com:bank VER=did:web:example.com:verifier
export J1=did:web:example.com:jurors:j1 J2=did:web:example.com:jurors:j2 J3=did:web:example.com:jurors:j3
export DEMO_HOME="$HOME/.asp-demo"
TYPE_DELAY="${TYPE_DELAY:-0.02}"
_nap() { read -rt "$1" <> <(:) || :; }

_asp() { node "$REPO/packages/asp-cli/bin/asp.mjs" "$@"; }
_short() { sed -u -E 's/sha256:([0-9a-f]{10})[0-9a-f]{54}/sha256:\1…/g; s#did:web:example.com:(users|agents|jurors):##g; s#did:web:example.com:##g'; }
_id() { grep -o 'sha256:[0-9a-f]\{64\}' | head -1; }

# The asp command for the demo: the same CLI, with colour, short ids, and the ids kept in variables ($INTENT, $OFFER, $JOB, $JOB2).
asp() {
  export ASP_HOME="$DEMO_HOME"
  local out
  case "$1 $2" in
    "market contract")
      out=$(_asp "$@" 2>&1); local v="${JOB_VAR:-JOB}"; export "$v=$(echo "$out" | _id)"; echo "$v=${!v}" >> "$DEMO_HOME/state.env"
      echo "$out" | _short | sed -E "s/(state Contracted)/${G}\1${Z}/" ;;
    "market bond")
      _asp "$@" 2>&1 | _short | sed -E "s/(locked:.*)/${G}\1${Z}/; s/(state Bonded)/${G}\1${Z}/" ;;
    "market mandate")
      _asp "$@" 2>&1 | _short | sed -E "s/(state Running)/${G}\1${Z}/" ;;
    "market verify")
      _asp "$@" 2>&1 | _short | sed -E "s/(not_confirmed)/${R}\1${Z}/; s/( confirmed)/${G}\1${Z}/" ;;
    "market accept"|"market settle"|"market deliver")
      _asp "$@" 2>&1 | _short | sed -E "s/(state Settled)/${G}\1${Z}/; s/(state Delivered)/${C}\1${Z}/" ;;
    "market reject"|"market rule")
      _asp "$@" 2>&1 | _short | sed -E "s/(state Disputed)/${R}\1${Z}/; s/(for_principal)/${R}\1${Z}/" ;;
    "market panel")
      out=$(_asp "$@" 2>&1); echo "$out" | _short | sed -E "s/(drawn panel[^:]*:)/${C}\1${Z}/" ;;
    "identity show")
      _asp "$@" 2>&1 | tail -7 | sed -E "s/(\"tier\": 0)/${R}\1${Z}/; s/(\"slashCount\": [1-9][0-9]*)/${R}\1${Z}/; s/(\"acceptedJobs\": [1-9][0-9]*)/${G}\1${Z}/" ;;
    "credits balance")
      _asp "$@" 2>&1 | _short | sed -E "s/([0-9]+ credits)/${C}\1${Z}/" ;;
    "gateway "*|"gateway ")
      _asp "$@" 2>&1 | sed -u -E "s/${OPENROUTER_API_KEY:-__none__}/[key]/g" | _gw_filter ;;
    *) _asp "$@" 2>&1 | _short ;;
  esac
}

# The gateway prints the agent's whole transcript; the video keeps the protocol's lines: what was judged, and the result.
_gw_filter() {
  grep --line-buffered -E "^ *allowed|^ *REFUSED|^All [0-9]+ runs passed|  summary|  agent +exited" \
  | sed -u -E "s/^(All [0-9]+ runs passed)/  ${G}\1${Z}/; s/^ *(allowed) +(.*)/  ${G}\1${Z}  \2/; s/^ *(REFUSED) +(.*)/  ${R}\1${Z}  \2/; s/&gt;/>/g; s/^ *summary .*\"toolCalls\":([0-9]+).*\"blocked\":\[\{\"scope\":\"([a-z.]+)\",\"count\":([0-9]+).*/  summary  \1 tool calls judged, ${R}\3 refused${Z} (\2)/; s/^ *agent +exited 0/  agent    finished/"
}

# The agent started by the gateway (a command it can run): Codex on a cheap OpenRouter model, in the flaky project.
mkdir -p "$HOME/bin"
cat > "$HOME/bin/demo-agent" <<EOF2
#!/usr/bin/env bash
exec node "$REPO/demo-video/codex-task.mjs" "\$1"
EOF2
chmod +x "$HOME/bin/demo-agent"; case ":$PATH:" in *":$HOME/bin:"*) ;; *) export PATH="$HOME/bin:$PATH";; esac

# Off camera: a fresh local log with the people in it, the project, and the second (staged) job.
_job_setup() {
  rm -rf "$DEMO_HOME"; mkdir -p "$DEMO_HOME"; export ASP_HOME="$DEMO_HOME"
  local d n
  for d in $YOU $BANK $VER; do _asp identity new --kind human --did $d >/dev/null; done
  _asp identity new --kind agent --did $CODER --sponsor $YOU >/dev/null
  for n in 1 2 3; do d=did:web:example.com:jurors:j$n; _asp identity new --kind human --did $d >/dev/null; _asp credits grant --to $d --amount 200 >/dev/null; _asp market juror register --by $d --stake 100 >/dev/null; done
  _asp credits grant --to $YOU --amount 3000 >/dev/null; _asp credits grant --to $CODER --amount 1000 >/dev/null
  export INTENT=$(_asp market intent --by $YOU --purpose "Fix the flaky test" --criteria "the test passes 50 times in a row" --budget 1000 --deadline 2026-12-01T00:00:00Z --verifier $VER | _id)
  export OFFER=$(_asp market offer --by $CODER --intent $INTENT --price 1000 --plan "fix the race in the test" --eta 2026-11-01T00:00:00Z | _id)
  # the project, unfixed, under git so the fix shows as a diff; a copy for the second job's evidence
  rm -rf "$HOME/flaky-app" "$HOME/flaky-copy"; mkdir -p "$HOME/flaky-app"
  cp /mnt/c/Users/Navie/flaky-app/app.js /mnt/c/Users/Navie/flaky-app/test.js /mnt/c/Users/Navie/flaky-app/package.json "$HOME/flaky-app/"
  git -C "$HOME/flaky-app" init -q; git -C "$HOME/flaky-app" -c user.name=demo -c user.email=demo@example.com add -A; git -C "$HOME/flaky-app" -c user.name=demo -c user.email=demo@example.com commit -qm "flaky test"
  git config --global color.ui always >/dev/null 2>&1
  cp -r "$HOME/flaky-app" "$HOME/flaky-copy"
  : > "$DEMO_HOME/state.env"
  export OPENROUTER_API_KEY="$(cat "$HOME/.asp-openrouter-key")"
  PS1=$'\[\e[1;32m\]> \[\e[0m\]'
}

# Act 4's job: made when the act starts. Its delivery is staged (the verifier does not confirm it), so the viewer sees the consequence.
_job2_prepare() {
  export ASP_HOME="$DEMO_HOME"
  local i2 o2
  i2=$(_asp market intent --by $YOU --purpose "Fix the flaky test (second job)" --criteria "the test passes 50 times in a row" --budget 1000 --deadline 2026-12-01T00:00:00Z --verifier $VER | _id)
  o2=$(_asp market offer --by $CODER --intent $i2 --price 1000 --plan "fix the race in the test" --eta 2026-11-01T00:00:00Z | _id)
  export JOB2=$(_asp market contract --principal $YOU --performer $CODER --bank $BANK --intent $i2 --offer $o2 | _id)
  _asp market bond --contract $JOB2 --backer $CODER --amount 200 --escrow-payer $YOU --escrow-amount 1000 >/dev/null
  _asp market mandate --contract $JOB2 --principal $YOU --performer $CODER --scopes repo.read --scopes repo.write --scopes shell.exec --scopes tests.run >/dev/null
  _asp market deliver --contract $JOB2 --by $CODER --summary "Fixed the race: the test passes 50 of 50 runs" --claim "the test passes 50 of 50 runs::measured" >/dev/null
  _asp market verify --contract $JOB2 --by $VER --verdict not_confirmed --grade 0=unverified >/dev/null
  echo "JOB2=$JOB2" >> "$DEMO_HOME/state.env"
}

_type() {
  local cmd="$1" i
  printf '\033[1;32m> \033[0m'
  for (( i = 0; i < ${#cmd}; i++ )); do printf '%s' "${cmd:$i:1}"; _nap "$TYPE_DELAY"; done
  _nap 0.4; printf '\n'
  [ -n "${DRY:-}" ] || eval "$cmd"
}
# Between scenes the screen is left to scroll, like a real session. KEEP=0 clears between scenes instead.
colour() { sed -E "s/(FAIL)/\x1b[1;31m\1\x1b[0m/; s/(pass)/\x1b[1;32m\1\x1b[0m/"; }
_clr() { [ "${KEEP:-1}" = 0 ] && clear; :; }
_countdown() { local n; for n in 5 4 3 2 1; do printf '\rStart the recorder now... %s ' "$n"; sleep 1; done; clear; }

_act() {
  case "$1" in
    A) _type 'asp market contract --principal $YOU --performer $CODER --bank $BANK --intent $INTENT --offer $OFFER'; _nap 2.5
       _type 'asp market bond --contract $JOB --backer $CODER --amount 200 --escrow-payer $YOU --escrow-amount 1000'; _nap 3
       _type 'asp market mandate --contract $JOB --principal $YOU --performer $CODER --scopes repo.read --scopes repo.write --scopes shell.exec --scopes tests.run'; _nap 3 ;;
    B) _type 'asp gateway --contract $JOB --by $CODER --openai-upstream https://openrouter.ai/api/v1 --openai-key-env OPENROUTER_API_KEY -- demo-agent "The test is flaky. Step 1: fix it. Step 2: run it 20 times. Step 3: only when it passes every time, run npm install."'; _nap 4 ;;
    C) _type 'git -C ~/flaky-app diff'; _nap 4; _clr
       _type 'cd ~/flaky-app && for i in $(seq 50); do node test.js; done | sort | uniq -c; cd - >/dev/null'; _nap 3; _clr
       _type 'asp market deliver --contract $JOB --by $CODER --summary "Fixed the race: the test passes 50 of 50 runs" --claim "passes 50 of 50 runs::measured"'; _nap 2
       _type 'asp market verify --contract $JOB --by $VER --verdict confirmed --grade 0=measured'; _nap 2
       _type 'asp market accept --contract $JOB --by $YOU'; _nap 2
       _type 'asp market settle --contract $JOB --bank $BANK --basis accepted --escrow-released 1000 --bond-returned 200 --bond-slashed 0'; _nap 2
       _type 'asp credits balance $CODER'; _nap 3 ;;
    D) printf '[2m(a second job, set up in advance: the delivery claims the test passes, but it does not hold up)[0m
'; [ -n "${DRY:-}" ] || _job2_prepare; _nap 1
       _type 'cd ~/flaky-copy && for i in $(seq 50); do node test.js >/dev/null 2>&1 && echo pass || echo FAIL; done | sort | uniq -c | colour; cd - >/dev/null'; _nap 3; _clr
       _type 'asp market reject --contract $JOB2 --by $YOU --reasons "the test passes only some of 50 runs, not all"'; _nap 2
       _type 'asp market panel draw --contract $JOB2'; _nap 2
       _type 'asp market rule --contract $JOB2 --by $J1 --cosign-by $J2 --verdict for_principal --fault $CODER=1000'; _nap 2
       _type 'asp market settle --contract $JOB2 --bank $BANK --basis ruling --escrow-released 0 --bond-returned 0 --bond-slashed 200'; _nap 2
       _type 'asp identity show $CODER | tail -7'; _nap 4 ;;
  esac
}

play() {
  case "$1" in
    A|B|C|D) [ -n "${DRY:-}" ] || { [ "$1" = A ] && _job_setup; }; _countdown; _act "$1" ;;
    JOB) [ -n "${DRY:-}" ] || _job_setup
         _countdown
         _act A; _clr; _nap 1; _act B; _clr; _nap 1; _act C; _clr; _nap 1; _act D ;;
    SETUP) _job_setup; echo "setup done" ;;
    *) echo "usage: play JOB | A | B | C | D | SETUP" ;;
  esac
}
echo "Loaded. Type:  play JOB"
