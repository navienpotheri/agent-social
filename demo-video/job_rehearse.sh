# Rehearsal in WSL: runs the whole story with no countdown and instant typing, output to a file for checking.
source ~/agent-social/demo-video/job.sh >/dev/null
_countdown() { :; }
export TYPE_DELAY=0
_nap() { :; }
play JOB
