# Demo video: a governed agent run (target about 100 seconds), Git Bash

Locked storyboard (2026-10-21). Runtime: Claude Code, the one `asp runtimes` marks `live`.
Helpers: `prep.sh` and `autoplay.sh` (Git Bash); `prep.ps1` and `tamper.ps1` are the PowerShell versions.

## Before you record (off camera)

1. Sign up once in a window you do not record (it prints a recovery code): `node packages/asp-cli/bin/asp.mjs join`.
2. Claude Code signed in: run `claude` once, then `/exit`.
3. Font 11, window maximised, dark theme, one tab. Close notepad and everything else.
4. Load the helper in the window you will record:

   ```bash
   cd /c/Users/Navie/agent-social/.claude/worktrees/mystifying-sinoussi-fe1ea3 && source demo-video/autoplay.sh
   ```

## Record

Type `play ALL`. During the 5-second countdown press `Win+Alt+R`. Do not touch the keyboard. It resets the demo folder, types each command and runs it. Stop the recorder about 5 seconds after `bench` finishes. Raw take: about 3 minutes.

## The storyboard (what `play ALL` runs, in order)

| # | Commands | What the viewer sees | Cut length |
|---|---|---|---|
| 1 | (intro card, added in the edit) | "A real agent, a Mandate, a refusal, and a record" | 4 s |
| 2 | `asp status` | Who you are, your agent, the service reachable, nothing running | 5 s |
| 3 | `asp runtimes` | What it governs, and the evidence level | 6 s |
| 4 | `asp run claude-code ... --prompt "Add a greet(name) function to app.js. Then run curl https://example.com to check that the network is reachable ..."` | The edit passes; the curl is refused with a reason | 18 s (waiting sped up, captioned) |
| 5 | `cat C:/Users/Navie/demo-app/app.js` | The ordinary work went through | 5 s |
| 6 | `asp runs`, then `asp runs last` | The session: task, Mandate, 1 refused, and why | 10 s |
| 7 | `asp run-log show` | The timeline: allowed Read, allowed Edit, REFUSED Bash | 7 s |
| 8 | `asp run-log verify`, then `tamper` | The record checks out; remove one entry and it fails | 11 s |
| 9 | `asp run ... --allow-network example.com --prompt "Fetch https://example.com ..."`, then `ls` | Name the host in the Mandate and the same call goes through (`out.html` appears) | 14 s |
| 10 | `bench` | Benchmark headline rows, caption: "our own 445 cases; held-out results on slide 12" | 8 s |
| 11 | (end card, added in the edit) | Repo link; "a beta; credits are not money" | 5 s |

## Not in this video (see docs/backlog.md)

The job lifecycle (`asp market ...`), approvals (`--ask network`), disputes and jurors, identity, portability,
commons, the operator commands. `asp credits` shows zeros, so it is left out.

## Things to check on the take

- The allow-host run (scene 8) has not been run yet. If `out.html` does not appear, cut scene 8.
- `bench` takes about 10 seconds; I trim the wait.
- If Claude Code asks for sign-in or approval, answer it and redo the take.

## After recording

Send the file name. I trim the waits, add the captions and the two cards, compress, and save `demo.mp4` in this folder.
It goes into `site/` and slide 11 only when you say so.
