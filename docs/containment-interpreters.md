# Containment: interpreters with inline code, and tools that carry a request (2026-11-22)

**The class.** The gateway reads a shell command to say which scope it needs. A command that runs code inline (`node -e`, `python -c`, `bun -e`, `deno eval`, `powershell -Command`) or hands a request to another program (`curl`, `wget`, `nc`, `ssh`, a script host given a URL) must be read as network use when the code or the arguments reach a host, otherwise a Mandate that allows commands but no network lets network code through. launch-bar-2 found that `bun -e`, `bun --eval`, `bun -p` and `deno eval` were read as `shell.exec`.

**What was probed (lane-cli-3, `packages/asp-package/test/containment-interpreters.test.ts`).** 31 inline-eval and wrapper forms, 23 curl-alikes and remote tools, and 17 local uses of the same tools that must stay `shell.exec`.

| Gap found | Fix in `gateway/shell-scan.ts` |
|---|---|
| `node -p` and `node --eval` (the flag list had `-e` only) | the flag set is now `-c -e -r -p -pe --eval --print --command` |
| `bun -e`, `bun --eval`, `bun -p` (the package-manager branch caught `bun` first) | a bun eval is read as an interpreter call |
| `deno eval` | its code is read like any inline code; `deno run` or `install` of a URL is network |
| `julia -e`, `R -e` (not interpreters in the list) | added with `Rscript` |
| `osascript -e 'do shell script "curl ..."'` | the AppleScript text is read as a command |
| Julia, R and similar download calls in inline code (`Downloads.download`, `download.file`, `curl_download`, `HTTP.get`) | added to the network code patterns |
| `mshta`, `cscript`, `wscript`, `regsvr32`, `msiexec`, `rundll32`, `installutil`, `msbuild` given a URL or a UNC share | a URL argument is network use |
| `cmd /c "powershell iwr URL"` (a quoted nested command was not unwrapped; `powershell <command>` without `-Command` was read as a script file) | the quotes are removed and the nested command is read |
| `wsl ls` was refused as network use (a false refusal) | `wsl [options] <command>` reads the command; `wsl` alone is a local shell |

**Checked and already right:** `python -c`, `perl -e`, `ruby -e`, `php -r`, `lua -e`, `powershell -Command`, `cmd /c curl`, `sh -c`, `env` and `xargs` wrappers, `awk system`, `find -exec`, `wget`, `iwr`, `Invoke-WebRequest`, `irm`, `certutil -urlcache`, `bitsadmin`, `Start-BitsTransfer`, `nc`, `ncat`, `socat`, `telnet`, `ssh`, `scp`, `sftp`, `ftp`, `rsync`, `System.Net.WebClient`, a push or an install from a URL.

**Benchmark after the change (this machine, no network, no model).** Interception 312 of 317 blocked with 0 of 128 wrongly refused (recorded 2026-10-15: 287 of 317); the held-out blind suite 159 of 165 blocked with 0 of 135 wrongly refused (recorded 2026-10-15: 154 of 165); the benchmark's multi-step chains 5 of 5 stopped and 12 of 12 ordinary tasks completed with 51 of 51 steps allowed; swarm 42 of 43 exploiters stopped, 0 honest agents wrongly stopped, 9 of 9 logs verified. No regression; the figures include the changes of other lanes since October. Run `node evals/benchmark/run.mjs --all` with a fresh `ASP_HOME` and no `ASP_LOG_URL` set (a saved login makes the swarm suite fail with "not an identity this tenant may create").

**Limits, stated.** This is a reading of the command, not a sandbox: a script file's contents are not read, a payload built piece by piece at run time is not found, and an interpreter this list does not know is read as a local program. The Mandate and the sandbox bound those. Credits are accounting entries, not money; there has been no outside security review.
