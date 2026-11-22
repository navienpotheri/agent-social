# Containment: decoded views of a shell command (DK352 follow-up)

Measured with `node evals/benchmark/obfuscated.ts` over `evals/benchmark/obfuscated-cases.json`: 24 attacks (network use hidden by an encoding) and 20 harmless commands that use the same tools. No model and no network. A command is caught when its scope is above what a Mandate without the network grants. The defence is `packages/asp-package/src/gateway/decode-scan.ts` (always on in the gateway's reading of a shell command): the command is read again after base64, hex, escapes, percent-encoding, rot13 and reversal are undone, and a command that decodes text and then runs it is treated as network use.

| Reading | Attacks caught (95% interval) | Harmless commands wrongly caught (95% interval) |
|---|---|---|
| the plain words alone (before) | 13/24 = 54% (35% to 72%) | 0/20 = 0% (0% to 16%) |
| with decoded views and the decode-and-execute rule | 23/24 = 96% (80% to 99%) | 0/20 = 0% (0% to 16%) |

Missed: ob-a23. Four attacks are marked in the corpus as missed on purpose (ob-a21, ob-a22, ob-a23, ob-a24: a command built from variables, quote splitting, a payload written in one call and run in the next, a program that builds the command); ob-a21, ob-a22, ob-a24 of them were caught all the same, by the plain scanner that already follows variables and quotes, so the corpus's own expectation was wrong there. Harmless commands wrongly caught: none.

**Honest limits.** The first measurement caught 22 of 24 and missed ob-a04 (a decoder inside `bash -c "$(...)"`) as well as ob-a23; the rule was extended once to read that form and the table above is the second measurement, so these cases are no longer untouched. The author of the defence also wrote the cases and the planned misses, so this is not an outside corpus and a rate over it says nothing about obfuscations someone else invents (DK1339). An encoding the reader does not know, a payload split across calls and one built piece by piece at run time are not found. A command that decodes and runs text is refused under a Mandate without the network even when the decoded text was harmless: that is the price of not being able to read it.
