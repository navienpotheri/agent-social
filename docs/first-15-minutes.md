# The stranger's first 15 minutes: a literal walk of the README quickstart (rows T2, U16 and the U-rows)

Walked on 2026-11-22 by launch-bar-2 on the owner's Windows 11 machine, in Git Bash, in a fresh clone (`git clone` of this repository into a temporary folder, not from GitHub), with a throwaway ASP home. Credits are mock accounting entries, not money. The service is a beta. This is one machine and one walker who knows the project: it is evidence of where a stranger would stall, not a trial with strangers (U16 still needs that).

## Timings

| Step | What was typed | Time | Result |
|---|---|---|---|
| Clone | `git clone` | 5 s | works |
| Install | `npm install` | 10 s (46 packages) | works; no build step |
| Home screen | `npm run asp -- help` | 4 s | five lines that say what to do first |
| Runtimes | `npm run asp -- runtimes` | 4 s | table with the evidence of each runtime |
| Status | `npm run asp -- status` | 4.6 s | "You have not joined yet. Next: asp join" |
| Run before join | `npm run asp -- run claude-code ...` | 4.9 s | "error: you have not joined yet: run asp join first" (clear) |
| Join | `npm run asp -- join` | waited 40 s, then stopped | prints a sign-in address and waits up to 10 minutes for a browser; not completed here (no Google sign-in on a walk) |
| First run, local | `npm run asp -- run claude-code --local ...` | 28.7 s | worked with the installed Claude Code: a session summary, 0 calls refused, 15 tokens, the run log path |

Total to a first governed run without joining: about one minute of waiting, plus the reading.

## Where a stranger would stall or be confused, and what was done

| # | Stall or confusion | Fix | Status |
|---|---|---|---|
| 1 | The quickstart's step 2 needs a browser, a Google account and the hosted service. With none of them the terminal waits ten minutes and the README offers no way round. The `--local` route (no account, no service) is not mentioned in the quickstart. | README step 2 now names `--local` as the route without a browser, account or network. | fixed (wording) |
| 2 | Every command takes about three to four seconds to start (the runner reads TypeScript). A stranger may think it hung. | README says so in one sentence. A faster start is a code matter. | fixed: the README says so, and the program prints "asp: starting (loading the program takes a few seconds)" on a terminal after 1.5 s (lane-cli-3; no faster route without a build step) |
| 3 | `asp join --help` prints the whole reference, not the help for `join`. | Not a wording matter. | fixed by lane-cli-3: `asp <command> --help` prints that command's help |
| 4 | The README example path `/path/to/repo` is a Unix path; on Windows a stranger must guess the form. | README gives the Windows form and says to quote a path with spaces. | fixed (wording) |
| 5 | The first run prints "may read files; no network". On Windows the gateway reads calls; it does not block network traffic (see [README](../README.md), the Gateway line). The line reads as a block. | Wording is code output. | fixed by lane-cli-3: the first-run text now says "the gateway refuses calls that reach the network" |
| 6 | The first run prints five lines before the model answers, including a data line. It is accurate and a newcomer will skim it. | None; the lines are the disclosure. | left |
| 7 | The clone came from this repository, not from GitHub, so the public URL, a proxy or an authentication prompt were not tried. | A walk from the GitHub address on a second machine. | open (owner or a worker) |
| 8 | The walk ran the real `claude` program, which used the machine's own Claude sign-in for a 15-token call. A stranger needs Claude Code installed and signed in first; the README table lists the runtime but the quickstart does not say so. | README step 3 already says to run a runtime; installing and signing in to it is the stranger's step. | open: one sentence for the quickstart after the owner confirms the wording |

## What was not walked

The Google sign-in and the recovery code (needs a person), a multi-gigabyte repository and a laptop sleep (row T2, the runbook's item 6), a second machine, and any browser other than none. The walk made one request to the hosted service: the sign-up challenge printed by `asp join`, which creates no identity until a browser completes it.
