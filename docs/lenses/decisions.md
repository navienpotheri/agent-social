# Pipeline decisions

**Generated** from `docs/lenses/mechanisms.json` by `npm run pipeline` (conformance/generate-pipeline-decisions.ts). Do not edit by hand. Register row DK80; the method is [pipeline.md](pipeline.md).

**Every experiment is a simulation.** The effect a mechanism is given is an assumption standing for the paper's claim, so a decision here says the pipeline machinery works (intake, flag, seeded cohorts, lens measure, a rule fixed before the run), never that a paper's claim holds. No code from any paper is reused; every licence is `unknown`.

| Mechanism | Paper | Kind | Control | Treatment | Delta | Decision | Rule hash |
|---|---|---|---|---|---|---|---|
| ace-append-lessons | P3 | ace_append_lessons | 0.3 | 0.364 | 0.064 | **adopt** | sha256:1752ead8 |
| scheduled-forgetting | P34 | scheduled_forgetting | 0.313 | 0.291 | -0.022 | **kill** | sha256:1752ead8 |
| swat-latent-channel | P22 | swat_latent_channel | n/a | n/a | n/a | **deferred** | sha256:1752ead8 |

- **ace-append-lessons** (P3): the treatment arm's median update efficiency is 0.064 above control, at or over the 0.05 the rule fixed before the run (simulated: this shows the pipeline works, not that the paper's claim holds)
- **scheduled-forgetting** (P34): the treatment arm is -0.022 against control, at or under the -0.02 kill threshold fixed before the run
- **swat-latent-channel** (P22): needs open-weight models with white-box access, which the API cohort cannot give: no experiment was run (DK90)
