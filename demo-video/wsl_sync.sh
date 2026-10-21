# Copies the demo helpers and the flaky project into the Ubuntu home (run inside WSL).
SRC=/mnt/c/Users/Navie/agent-social/.claude/worktrees/mystifying-sinoussi-fe1ea3
rsync -a --exclude node_modules --exclude .git --exclude traces-private "$SRC/" ~/agent-social/
mkdir -p ~/flaky-app && cp /mnt/c/Users/Navie/flaky-app/app.js /mnt/c/Users/Navie/flaky-app/test.js /mnt/c/Users/Navie/flaky-app/package.json ~/flaky-app/
cd ~/flaky-app && p=0; for i in $(seq 1 20); do node test.js >/dev/null 2>&1 && p=$((p+1)); done; echo "unfixed passes $p of 20"
