# Tutorials by kind of work (register row DK1800, the written half)

Four short tutorials, one for each kind of work that the beta has a preset for. Each names one command, says in advance what the tool will print before the run, and says what to do when something is refused. They are in English only: help in other languages and a screen application are not part of the beta. Credits are mock accounting entries, not money; the service is a beta.

| Kind of work | Preset | Tutorial |
|---|---|---|
| Changing code in a repository | `coding` | [coding.md](coding.md) |
| Writing and editing documents | `writing` | [writing.md](writing.md) |
| Translating files | `translation` | [translation.md](translation.md) |
| Learning from a project, and being taught | `learning` | [learning.md](learning.md) |

`packages/asp-cli/test/tutorials.test.ts` runs the command of each tutorial against a stand-in agent and checks that the line the tutorial says the tool will print is the line that it prints.
