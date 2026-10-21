sed 's/tmux attach -t $S//' ~/agent-social/demo-video/job-screen.sh > /tmp/js_detached.sh
tmux resize-window -t demo -x 200 -y 52 2>/dev/null
bash /tmp/js_detached.sh
tmux resize-window -t demo -x 200 -y 52
sleep 4
tmux send-keys -t demo:0.0 "play A" Enter
sleep 22
for p in 0 1 2; do echo "======== pane $p"; tmux capture-pane -p -t demo:0.$p | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-120 | grep -v '^$' | head -28; done
tmux kill-session -t demo
