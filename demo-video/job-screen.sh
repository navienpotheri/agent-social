#!/usr/bin/env bash
# Opens the demo screen in Ubuntu: the story on the left, the signed log and the credits live on the right.
# Run:  bash ~/agent-social/demo-video/job-screen.sh     then, in the left pane, type:  play JOB
S=demo
tmux kill-session -t $S 2>/dev/null
tmux new-session -d -s $S -n story
tmux set -t $S status off
tmux set -t $S pane-border-style 'fg=colour240'
tmux set -t $S pane-active-border-style 'fg=colour240'
tmux split-window -h -p 30 -t $S:0
tmux send-keys -t $S:0.1 "bash -c 'source ~/agent-social/demo-video/job-panels.sh; panel_log'" Enter
tmux split-window -v -p 28 -t $S:0.1
tmux send-keys -t $S:0.2 "bash -c 'source ~/agent-social/demo-video/job-panels.sh; panel_money'" Enter
tmux send-keys -t $S:0.0 "source ~/agent-social/demo-video/job.sh" Enter
tmux select-pane -t $S:0.0
tmux attach -t $S
