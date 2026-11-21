# Live checks for the CLI, accounts and operations lane (two hours, no real model agent)

For the owner, on a clean machine and on the server. Each check is one script in [scripts/live/](../scripts/live/) plus the steps only a person can do; each script prints PASS or FAIL for every step, writes a report file (`live-check-<name>-<date>.log`, with anything that looks like a token or key removed), and ends with a block to paste into [live-run-checklist.md](live-run-checklist.md). They need **no real model agent**: a tiny stand-in model and agent are used where a run is needed. Credits are accounting entries, not money.

The scripts are plain Node (22.18 or newer), so the same command runs on Windows, macOS and Linux. `--yes` runs a script without the human steps (a dry run: the report says which steps nobody did). Every script was run locally on 2026-11-21 against a real `asp serve` (see "What was already run" at the end); what is left for you is what needs your Google account, your server and your hands.

**Before you start (10 minutes).** On the machine you will use, a fresh clone and `npm install`:

```
git clone https://github.com/navienpotheri/agent-social && cd agent-social && npm install
node packages/asp-cli/bin/asp.mjs --version
```

A second Google account that is not your main one, a phone for the alerts, and the server's SSH.

## The order, with the time each takes

| # | Check | Where | Rows it settles | Time |
|---|---|---|---|---|
| 1 | Clean machine | Mac, a clean Linux machine, Windows | T1, T2, U16 | 10 min each |
| 2 | Sign-up, join, recovery, export, close | your machine, the live site | U1, U9, E9, DK546 (live part) | 25 min |
| 3 | The gateway with a stand-in agent | your machine | T2, E5, E16, E2 | 10 min |
| 4 | Restore drill | the server | GV6 (restore), DK293 | 15 min |
| 5 | Production flags and limits | your machine against the live site, and the server | O2, T12 | 10 min |
| 6 | Monitor, alerts and the status page | your machine and the server, your phone | DK1341 | 25 min |

About two hours with the Mac and Linux rounds of check 1. Do 4, 5 and 6 on the server in one sitting. Do 2 before 3 if you want 3 to run against the live site (`--hosted`).

---

## 1. Clean machine (T1, T2, U16)

```
node scripts/live/01-clean-machine.mjs
```

It checks, by itself: node is new enough (and says so in words on an old node), `asp` alone shows where to start, `asp help` and `asp help all` print, `asp status` and `asp runs` work with nothing set up, an unknown command says what to type, an identity can be made from a folder that is not a git repository and has spaces in its path, and a folder with 2,000 files does not hang `asp init`.

Then it asks you for two things only a person can do:

1. **Ctrl-C in the middle of a session.** In a second terminal start `node scripts/live/03-gateway-stand-in.mjs --slow 60`; press Ctrl-C while it waits. Run `node packages/asp-cli/bin/asp.mjs run-log show` on the newest run folder: it says how the run ended and `run-log verify` passes. Nothing is half written.
2. **The laptop goes to sleep.** Start the same with `--slow 120`, close the lid for a minute, open it. It finishes or fails in words, and `run-log verify` passes.

On a Mac, also run it once with an older node if you have one (for example `nvm use 20`): it must tell you to install node 22.18 or newer, not print a stack trace.

**Pass:** every PASS, both human steps answered `y`, on each machine. Paste each report block into live-run-checklist.md under the date and the machine.

## 2. Sign-up, join, recovery, export, close (U1, U9, E9)

```
node scripts/live/02-signup-join.mjs --service https://<domain>
```

It uses a **temporary** ASP_HOME, so the sign-in is a stranger's: nothing saved from before. Use the **test Google account**.

1. It checks the site answers and that `/join` says credits are not money and asks for the adult-or-guardian declaration.
2. It runs `asp join` here. A browser opens: sign in, accept the declaration, choose a tenant name starting `live-`.
3. It checks `asp account show` and `asp status`.
4. **You:** claim the starter credits (`asp account starter --did <your agent's did>`).
5. It makes a machine token and proves it works.
6. **You:** run `asp join --recover --service <url>` and sign in with the same Google account. It then checks the **old machine token no longer works** and the new login does.
7. It runs `asp account export` and checks the folder has the person's data and no token, key or recovery code.
8. **You (E9):** after running check 3 against this tenant, set the mail address (`asp mail address set <the Google address>`) and run `asp mail watch --once --send`. One end-of-job mail arrives with the run summary and no secret. Run check 3 with `--kill` and an alert mail arrives at once.
9. **You (U9):** `asp account close --confirm <tenant>`. It exports first and prints a receipt. The script then checks the closed tenant's token is refused.
10. **You, on the server:** `sudo -u asp node /opt/asp/packages/asp-cli/bin/asp.mjs serve usage --tokens /var/lib/asp/tokens.json` lists the tenant as closed with a retain-until date.

**Pass:** all PASS; the two mails arrived; the receipt has a date.

## 3. The gateway with a stand-in agent (T2, E5, E16, E2)

```
node scripts/live/03-gateway-stand-in.mjs --kill
```

A throwaway log, a tiny model provider and a stand-in agent, under a real Mandate that allows `repo.read` and nothing else. It checks: the agent exits 0; the allowed call is let through and `git push` is removed before the agent sees it; the refusal says which article it rests on; a run log is kept; **the fake key the agent sent is masked in the log**; `asp run-log verify` passes; `asp run-log show` reads the log to a person; and (`--kill`) repeated out-of-Mandate calls end the session. With `--hosted` it points you at the same checks against the live tenant from check 2, including fetching the run log by its owner only.

## 4. Restore drill (GV6, DK293)

On the server:

```
sudo bash /opt/asp/docs/deploy/restore-drill.sh
```

It restores the newest nightly dump into a scratch database, starts a throwaway copy of the service on port 18787, runs `asp log verify`, prints the record count and head, and removes everything it made. **Pass:** the last line is `DRILL PASSED`. Compare the record count and head with the live service (`curl -fsS https://<domain>/economy/supply?format=json` for the head). Paste the output into live-run-checklist.md with the backup file's name and date. If there is no backup yet, run `sudo /usr/local/bin/asp-backup` first.

## 5. Production flags and limits (O2, T12)

Make a throwaway tenant (`asp serve token --tokens /var/lib/asp/tokens.json --tenant drill-limits` on the server, or sign up with the test account), then from your machine:

```
node scripts/live/05-production-flags.mjs --service https://<domain> --token <that tenant's token>
```

On the server, add `--unit asp-log` so it reads the start line itself. It checks: the proof-of-work sign-up is refused for a person (Google is the only way: `--signup-require-google`); `/join` answers; an anonymous `/rpc` is refused; and, over 65 seconds each, that a tenant gets about **600 reads** and **120 writes** a minute (the burst on top) before 429s begin. Then it asks you to check the limits files exist on the server and that a restart does not reset them. **After:** raise tenants signed up before the limit was raised: `asp serve raise-limits --tokens /var/lib/asp/tokens.json --rate-limit 600`, and delete the throwaway tenant.

## 6. Monitor, alerts and the status page (DK1341)

```
node scripts/live/06-monitor-status.mjs --site https://<domain>
```

Before it: the setup script has been run (it installs `asp-monitor` and the `/status` page). It checks `/status` is the monitor's static page (not the service's), `/status.json` was written in the last 10 minutes, and the page carries the beta and no-outside-review lines. Then, with you at the server:

1. `sudo systemctl stop asp-log`; wait two minutes. The script checks `/status` still answers and says **Major outage**.
2. **You:** exactly ONE alert on your phone and ONE in your mail: `[Agent Social] DOWN: The service answers`. A second while it stays down is a failure.
3. **You:** write the incident on the page (the script prints the command); it appears within a minute.
4. `sudo systemctl start asp-log`; wait two minutes; the page is no longer an outage.
5. **You:** ONE `recovered` alert. Resolve the incident.
6. **You:** the outside ping (owner checklist OP-2 in [owner-questions-cli.md](owner-questions-cli.md)) also reported the outage you made.

**Pass:** all PASS, one alert each way, the outside ping fired. Until the outside ping is set up, the site must not say the service is "independently monitored".

---

## What was already run (2026-11-21, on the lead's Windows machine, a real `asp serve` for each, no model agent)

| Script | Result |
|---|---|
| 01 clean machine (`--yes`) | 8 steps passed; the run found that `asp --version` failed with "argument missing" (fixed, `first-minutes.test.ts`) and that `asp --help` printed the shebang on a CRLF checkout (fixed) |
| 03 gateway stand-in (`--kill`) | 8 steps passed |
| 05 production flags (`--local`, 65 s a phase) | 8 steps passed: 797 reads allowed of 1,168 (expected about 800), 159 writes of 1,208 (expected about 160); the limits state is kept and holds no raw address |
| 06 monitor and status page (`--local`) | 11 steps passed: one DOWN alert after two failed checks and not again, the status page and the alert mail present while the service was down, one RECOVERED alert |
| 02 sign-up and join | not run: needs a real Google account |
| 04 restore drill | not run: needs the server and a backup |

## What these checks do not cover

A real model agent acting (T15, T22, DK650, P21: postponed by the owner), the outside security review (SC1: after funding), a load test at 1,000 tenants (DK65: a goal, after launch), Windows and Mac installs by a stranger who is not you.
