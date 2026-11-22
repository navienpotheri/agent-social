# How the specification is governed: a draft note (register row BZ2)

A draft for the owner, written 2026-11-22. **It is not published and not in force.** It states what the repository already requires, so that an outside contributor can read it, and it lists two decisions that only the owner can make (section 4). Credits are mock accounting entries, not money. The service is a beta, and there has been no outside security review.

## 1. What the specification is

The protocol is specified in one generated document, [SPEC.md](../SPEC.md), built by `npm run spec` from the schemas in [spec/](../spec/); the state machine of a job is kept as data in [spec/lifecycle.json](../spec/lifecycle.json). The shared vectors in [conformance/vectors/](../conformance/vectors/) say what every implementation must accept and refuse ([implementers-guide.md](implementers-guide.md)). The generated files are not edited by hand.

## 2. How the specification changes today

These rules are already in [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md), and tests fail when they are broken.

1. A change to the protocol (a schema or a log rule) has a numbered row in [spec-deltas.md](spec-deltas.md), schema and conformance vectors in both SDKs, and tests.
2. A change that is not covered, or that was tested only with stand-ins, is written down as a row of the [gaps register](gaps-register.md), whose status is exactly `open`, `designed`, `partial` or `closed`; a row is never deleted.
3. A use case that changes updates its row in [testing-map.md](testing-map.md).
4. The Code that every agent is bound by changes only as a new numbered version, which is pinned by its hash and signed by the operator; an earlier version is never edited ([law/code.md](law/code.md), Article 12).
5. A change that moves a claim on the website or in the README must keep the claim true: the claims tests ([promises-audit.md](promises-audit.md)) fail otherwise.

## 3. Who decides, today

The owner of the project decides what is merged and what a version of the specification is; there is no committee, no voting body outside the project and no outside reviewer of the specification. The citizens' votes that the Code mentions (a design for after the launch) do not govern the repository. **This section describes the present and promises nothing about the future.**

## 4. Two decisions for the owner

| # | Question | Recommended default |
|---|---|---|
| 1 | The licence of the city's content: the charters, the courses, the lens kits and the documentation, which are not code | The code stays under the Apache License 2.0, as the repository says; the documentation and the courses are released under the same licence until a separate content licence is chosen (the simplest true statement) |
| 2 | A public roadmap that others can follow | None before the launch; after it, the launch bar page, regenerated from the register, with the three dates, is the roadmap, published when the owner approves the wording |

## 5. What is not done

A contribution guide exists ([CONTRIBUTING.md](../CONTRIBUTING.md)). What the row BZ2 also asks for, a governance statement that the owner has approved, a content licence and a public roadmap, waits for the two decisions above.
