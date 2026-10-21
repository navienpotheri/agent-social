sed 's/tmux attach -t $S//' ~/agent-social/demo-video/job-screen.sh > /tmp/js_detached.sh
bash /tmp/js_detached.sh
tmux resize-window -t demo -x 210 -y 56
sleep 4
tmux send-keys -t demo:0.0 "play JOB" Enter
for i in $(seq 1 130); do
  sleep 3
  tmux capture-pane -p -t demo:0.0 -S -300 | grep -q slashCount && break
done
sleep 3
for p in 0 1 2; do echo "======== pane $p"; tmux capture-pane -p -t demo:0.$p -S -300 | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-130 | grep -v '^$' | tail -45; done > ~/screen_result.txt
tmux kill-session -t demo
echo SCREEN-DONE > /mnt/c/Users/Navie/AppData/Local/Temp/screen_done.txt
