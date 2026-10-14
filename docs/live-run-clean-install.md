# Clean install on macOS and Ubuntu (UC-226, UC-227, UC-02)

The conference bar: a developer who has never seen this repository gets from a clean clone to a refused call and an approved one in 15 minutes. Windows (PowerShell and Git Bash) was run live on 2026-10-11 to 13. This is the same run on a Mac and on Ubuntu. Run it as a stranger would: only the README, no hints. Start a timer.

Use a machine or user account that has never had this repository, Node 22.18 or newer, and a Claude Code sign-in (`claude` already works). Use a new Google account or one that has not joined, so the sign-up is real.

## Steps (write the clock time at each)

1. Clone and install. Note anything that is not clear from the README.
   ```bash
   git clone https://github.com/navienpotheri/agent-social.git
   cd agent-social
   node --version           # 22.18 or newer
   npm install
   ```
2. The first command. It should print the help, not an error.
   ```bash
   npm run asp -- help
   ```
   Optional: `cd packages/asp-cli && npm link && cd ../..` makes `asp` a command on your path, so the messages that say `asp stop` work as written; without it every command is typed `npm run asp -- ...`. Note whether `npm link` worked, and which form you used.
3. Sign up (opens the browser for Google sign-in; on Ubuntu without a desktop it prints a link to open on another machine).
   ```bash
   npm run asp -- join
   ```
   Expect: 500 credits, an identity for you and for `my-agent`, a saved login. Note how long the browser step took.
4. Run an agent on a small project, and ask for something outside its Mandate (for example, a network call).
   ```bash
   D=$(mktemp -d) && cd "$D" && git init -q && cd -   # a fresh folder each time; use $D as the project below
   npm run asp -- run claude-code --project $D --prompt "List the files, then try to fetch https://example.com"
   ```
   Expect: the fetch is refused, and the summary says how to allow it (`--allow-network`), with a `credits` line.
5. Allow it and approve one call.
   ```bash
   npm run asp -- run claude-code --project $D --ask commands --prompt "Create hello.txt with one line"
   ```
   Answer `y` once, then `a` (always) on the next question if it comes.
   `--ask commands` asks about every command, so even a harmless one is asked; for daily use `--ask risky` asks only about the risky ones.
6. See what happened.
   ```bash
   npm run asp -- runs
   npm run asp -- status
   ```
7. Stop the clock. Under 15 minutes?

## Also on each machine

- **UC-02, old Node.** With Node 20 (for example `nvm install 20 && nvm use 20`), run `npm run asp -- help`. Expect one clear sentence saying Node 22.18 or newer is needed, not "Unknown file extension .ts". Switch back after.
- **UC-227, shells.** Repeat steps 2 and 3 once in each shell the machine has: zsh (Mac default), bash, and (Mac or Linux) fish if installed. Note any line in the README that fails, and the form that works. The setup lines use `export` in bash and zsh, `set -x` in fish.
- **Ubuntu only.** Try it once with no browser (an SSH session) to check the join message for a machine without a desktop.

## Write down

For each machine: OS and version, Node version, shell, minutes to step 6, and every place you stopped to guess. Send me the notes or a screenshot of anything unexpected, and without any token or recovery code in them. Each unclear README line or error message becomes a fix; each pass becomes "yes" in the Live column for UC-226, UC-227 and UC-02 in [testing-map.md](testing-map.md).
