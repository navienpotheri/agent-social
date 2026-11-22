# Tutorial: writing and editing documents (the `writing` preset)

For a person who has not used the tool before and does not think in permissions. Credits are mock accounting entries, not money. The service is a beta, and there has been no outside security review. The agent runs on your machine under a Mandate that you choose by naming the kind of work; the gateway refuses calls that do not match it.

**What this preset lets the agent do:** read and write the files in the project. **What it may not do:** run a command, reach the network or touch protected files. The tool says the same sentence in plain words before the run starts, and keeps your choice for the project, so that you are not asked again.

## 1. Before you start

Install the tool and make the first run work as the [README](../../README.md) says (steps 1 to 3 of the quick start). If you have no account, or no network, add `--local` to the command below: it needs no account and no service. The runtime that you name (Claude Code in the example) must already be installed and signed in on your machine.

## 2. Put what you need in a folder

For this tutorial you need a folder with one text file that you want edited. Keep a copy of anything that you cannot afford to lose; the agent may change files if this preset allows it.

## 3. Run it

From the repository folder, in PowerShell (give the path of your own folder; put it in double quotes if it contains spaces):

```powershell
npm run asp -- run claude-code --local --project "C:\path	o\yourolder" --permissions writing --prompt "Tighten the second paragraph of draft.md and keep my meaning"
```

Before the agent starts, the tool prints this line:

> preset writing: the agent may read and write the files in the project; it may not run a command, reach the network or touch protected files

If the line is not what you wanted, stop the run with `npm run asp -- stop --all` and choose another preset.

## 4. Read what happened

```powershell
npm run asp -- runs
```

The list shows what the agent did and what was refused, with the reason. A refusal is the Mandate working: it is not a fault of the agent or of your folder.

## 5. Change what it may do

Allow one more thing for a single run with `--allow tests` or `--allow commands`; change the choice with `--permissions coding` (it also runs tests) or `--permissions research` (read only). Every choice is yours; the tool never widens the Mandate by itself.

## What this tutorial does not do

It does not make the agent's work correct: read it before you use it. Help in other languages and a screen application for people who do not use a command line are not part of the beta ([DK1800](../gaps-register.md)).
