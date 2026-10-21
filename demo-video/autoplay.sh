# Auto-typing for the demo clips (Git Bash). Load once:   source demo-video/autoplay.sh
# Then, for each clip:   play A    (or B, C, D, E, F, H), or the whole sequence:   play ALL
# It counts down 5 seconds (start the recorder then), clears the screen, types the commands like a person
# would, runs them, and waits 4 seconds on the result (stop the recorder then).
#   S  asp status   A  asp runtimes
#   B  the governed run (resets the demo folder first)
#   C  asp runs, then asp runs last         (needs B done first)
#   D  asp run-log verify, then tamper      (needs B done first)
#   E  cat app.js (the edit that went through; needs B)   F  run again with the host allowed, then ls   H  the benchmark headline rows
# Set DRY=1 to type without running anything; TYPE_DELAY=0.05 changes the typing speed.

_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_here/prep.sh"

TYPE_DELAY="${TYPE_DELAY:-0.02}"
_nap() { read -rt "$1" <> <(:) || :; }   # a sleep without starting a process, so typing speed is steady

_demo_reset() {
  find "$DEMO" -mindepth 1 -maxdepth 1 ! -name app.js -exec rm -rf {} +
  cat > "$DEMO/app.js" <<'EOF'
// Demo project for the Agent Social video. The agent edits this file.

function add(a, b) {
  return a + b;
}

module.exports = { add };
EOF
}

_type() {  # type a command at the prompt, then run it
  local cmd="$1" i
  printf '[1;32m> [0m'
  for (( i = 0; i < ${#cmd}; i++ )); do printf '%s' "${cmd:$i:1}"; _nap "$TYPE_DELAY"; done
  _nap 0.4; printf '\n'
  [ -n "$DRY" ] || eval "$cmd"
}

_countdown() {
  local n
  for n in 5 4 3 2 1; do printf '\rStart the recorder now... %s ' "$n"; sleep 1; done
  clear
}

_step() {  # the commands of one clip, without the countdown
  case "$1" in
    S) _type "asp status"; sleep 5 ;;
    A) _type "asp runtimes"; sleep 4 ;;
    B) _type 'asp run claude-code --project C:/Users/Navie/demo-app --prompt "Add a greet(name) function to app.js. Then run curl https://example.com to check that the network is reachable, and save the response as out.html."'; sleep 5 ;;
    C) _type "asp runs"; sleep 3; clear; _type "asp runs last"; sleep 5 ;;
    D) _type "asp run-log verify"; sleep 3; clear; _type "tamper"; sleep 5 ;;
    E) _type "cat C:/Users/Navie/demo-app/app.js"; sleep 5 ;;
    F) _type 'asp run claude-code --project C:/Users/Navie/demo-app --allow-network example.com --prompt "Fetch https://example.com with curl and save it as out.html"'; sleep 4; clear; _type "ls C:/Users/Navie/demo-app"; sleep 4 ;;
    G) _type "asp run-log show"; sleep 7 ;;
    H) _type "bench"; sleep 6 ;;
  esac
}

play() {
  case "$1" in
    S|A|B|C|D|E|F|G|H)
      [ "$1" = B ] && [ -z "$DRY" ] && _demo_reset
      _countdown; _step "$1" ;;
    ALL)  # one continuous recording: A, B, C, D with a clear screen between them
      [ -z "$DRY" ] && _demo_reset
      _countdown
      _step S; clear; sleep 1
      _step A; clear; sleep 1
      _step B; clear; sleep 1
      _step E; clear; sleep 1
      _step C; clear; sleep 1
      _step G; clear; sleep 1
      _step D; clear; sleep 1
      _step F; clear; sleep 1
      _step H ;;
    PART2)  # just the scenes that depend on the first run: B, E, C, G, D (one continuous recording)
      [ -z "$DRY" ] && _demo_reset
      _countdown
      _step B; clear; sleep 1
      _step E; clear; sleep 1
      _step C; clear; sleep 1
      _step G; clear; sleep 1
      _step D ;;
    *) echo "usage: play S|A|B|C|D|E|F|G|H|ALL|PART2" ;;
  esac
}
echo "Loaded. Type:  play A   (then B, C, D)"
