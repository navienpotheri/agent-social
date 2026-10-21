# Demo video prep for the Agent Social "governed agent run" recording (Git Bash).
# Run in the terminal you will record, BEFORE you start recording:   source demo-video/prep.sh
REPO="${REPO:-/c/Users/Navie/agent-social/.claude/worktrees/mystifying-sinoussi-fe1ea3}"
DEMO="/c/Users/Navie/demo-app"

# Colours for the recording (ANSI): green = allowed/ok/live, red = refused/failed, yellow = partial, cyan = identity.
G=$'\e[1;32m'; R=$'\e[1;31m'; Y=$'\e[33m'; C=$'\e[1;36m'; D=$'\e[2m'; Z=$'\e[0m'

# 1. A clean "asp" command, so the screen shows `asp ...` and not a long node path.
asp() {
  # "asp runs last" shows the newest session, so there is no id to type.
  if [ "$1" = "runs" ] && [ "$2" = "last" ]; then
    set -- runs "$(node "$REPO/packages/asp-cli/bin/asp.mjs" runs | awk 'NR==1{print $1}')"
  fi
  # "asp runtimes" prints very wide lines; for the video show just the table's first columns.
  if [ "$1" = "runtimes" ] && [ $# -eq 1 ]; then
    node "$REPO/packages/asp-cli/bin/asp.mjs" runtimes | head -7 | cut -c1-55       | sed -E "1s/.*/${C}&${Z}/; s/ live /${G} live ${Z}/; s/ stand-in /${Y} stand-in ${Z}/; s/ partial /${Y} partial ${Z}/"
    return
  fi
  # "asp status": keep the identity and state lines, drop the "Next:" hints (they add a long id and look like warnings).
  if [ "$1" = "status" ] && [ $# -eq 1 ]; then
    node "$REPO/packages/asp-cli/bin/asp.mjs" status | awk '/^Next:/{exit} {print}'       | sed -E "1s/.*/${C}&${Z}/; s/([1-9][0-9]* refused)/${R}\1${Z}/; s/(nothing)/${G}\1${Z}/"
    return
  fi
  # "asp run-log show" prints long model lines; for the video keep the start, the tool calls and the end.
  if [ "$1" = "run-log" ] && [ "$2" = "show" ] && [ $# -eq 2 ]; then
    node "$REPO/packages/asp-cli/bin/asp.mjs" run-log show | grep -E "run_start|tool_call|run_end" | cut -c1-135       | sed -E "s/ allowed / ${G}allowed${Z} /; s/REFUSED/${R}REFUSED${Z}/; s/(1 blocked)/${R}\1${Z}/"
    return
  fi
  if [ "$1" = "run-log" ] && [ "$2" = "verify" ]; then
    node "$REPO/packages/asp-cli/bin/asp.mjs" "$@" | sed -E "s/NOT ok/${R}NOT ok${Z}/; s/(run log )ok/\1${G}ok${Z}/"
    return
  fi
  if [ "$1" = "runs" ]; then
    node "$REPO/packages/asp-cli/bin/asp.mjs" "$@" | sed -E "s/([1-9][0-9]* refused)/${R}\1${Z}/; s/(refused  )(Bash.*)/\1${R}\2${Z}/"
    return
  fi
  node "$REPO/packages/asp-cli/bin/asp.mjs" "$@"
}
# "bench": the headline rows of the interception suite (our own 445 cases), for the video.
bench() {
  node "$REPO/evals/benchmark/run.mjs" 2>/dev/null | awk '/suite 2/{exit} NR==1{print; print ""} /^No governance/{print "[2m" $0; getline; print $0 "[0m"} /^Command denylist/{print "[33m" $0; getline; print $0 "[0m"} /^ASP gateway/{print "[1;32m" $0; getline; print $0 "[0m"}'
}
# "tamper": remove one entry from a copy of the newest run log and verify the copy.
tamper() { source "$REPO/demo-video/tamper.sh"; }

# 2. Reset the demo project to its starting state: one file, nothing else.
mkdir -p "$DEMO"
find "$DEMO" -mindepth 1 -maxdepth 1 ! -name app.js -exec rm -rf {} +
cat > "$DEMO/app.js" <<'EOF'
// Demo project for the Agent Social video. The agent edits this file.

function add(a, b) {
  return a + b;
}

module.exports = { add };
EOF

# 3. A clean, readable prompt.
PS1='\[\e[1;32m\]> \[\e[0m\]'
clear
printf 'Ready. Demo project: C:\\Users\\Navie\\demo-app\n'
