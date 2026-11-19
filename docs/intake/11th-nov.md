# Intake of the owner's 11 Nov 2026 screenshot folder (the last scrape)

Status: proposal and notes, written by a side session on 2026-11-19. No register row, no scope row and no gaps-register edit is made here; the candidate ids DK810 to DK849 are proposals only. The images are the owner's private material and are neither copied nor quoted at length: every note is in my own words. Credits are mock accounting entries, not money; the service is a beta; no outside security review has happened; continual learning here means memory, skill and harness, never weights.

Folder read: `D by dt\agent social\11th NOv,2026` (49 PNG screenshots IMG_6464 to IMG_6510 plus one dated screenshot, and a 88 MB zip not opened), then `agent core concepts` (3 PNG plus a zip not opened) and `agent-social` (2 PNG). Notes below are in file-name order.

## PART 1. Per-item notes

### IMG_6464.PNG
- **What it is:** a post or article excerpt (dark theme, X-style), no author, title or date visible. Text only, the top of the piece is cropped.
- **Claim:** if an agent has no explicit state machine, it is at the mercy of the model's nondeterminism, deciding both which action to take and when its work is done. Agent state machines define explicit execution states, the events that move the agent between them, and the rules on transitions. They are used to control an agent's inner loop, manage workflows, and supervise work delegated across several agent sessions.
- **Mechanism:** a harness-level finite state machine around the model: the model proposes, the machine decides what is allowed next and when "done" is declared. Needs only a runtime that can hold state and veto transitions.
- **Evidence:** none (opinion).
- **For us:** yes. Protocol layer: Mandate and gateway. We already refuse calls outside a Mandate, but "done" and "what step may come next" are not part of a Mandate. Build: a Mandate *workflow clause* (allowed states and transitions, completion checked by a deterministic checker, not the model's say-so) that the gateway enforces, with the transition trail in the signed log. Hard: expressing real agent loops as a small state set without making the agent useless; the machine is only as good as its completion checker.

### IMG_6465.PNG (continues IMG_6464)
- **What it is:** the next section of the same article, headed "Why Agents Need State Machines"; no author or date visible.
- **Claim:** the usual agent loop (prompt, maybe call a tool, read result, repeat until the model decides it is finished) is fine inside one session, but fails when the agent must follow a set process, react to outside events, or work across sessions. Needs such as approval before an action, recovery from a failed tool call, and validation before reporting completion should be enforced by software, not left to prompts or skills that the model may or may not follow.
- **Mechanism:** move operational rules out of prompt text into code (approval gates, retry states, a validation state before "done"). Needs a runtime with durable state to resume across sessions.
- **Evidence:** none.
- **For us:** yes. Same as IMG_6464: Mandate and gateway, plus the Academy (a course on "rules as code, not prompt"). The sharper point is a measurable one: an agent whose rules live only in prompts versus one with a gateway-enforced approval state; a scripted adversary that ignores the prompt. Hard: our gateway sees tool calls, not the agent's internal state, so only externally visible transitions (approval, validation before completion claim) can be enforced.

### IMG_6466.PNG (continues IMG_6465)
- **What it is:** a phone screenshot of the same X article, titled "Agent State Machines..." (title cut off), section "Deterministic Scaffolding"; phone status bar shows 4:46. Engagement counts at the bottom (14 replies, 7 reposts, 93 likes, 200 bookmarks). Author name not visible.
- **Claim:** developers apply state machines at different levels of agent infrastructure; no single machine needs to control everything. Layers can cooperate: one machine governs the agent's inner loop, another supervises its work across sessions, a separate system decides whether the work meets its requirements. The author expects these deterministic layers to become standard as agents do longer, more consequential work.
- **Mechanism:** layered deterministic control (inner loop, cross-session supervisor, independent acceptance check). Needs durable state and an acceptance checker separate from the worker.
- **Evidence:** none; a popularity signal only (200 bookmarks).
- **For us:** yes. This is our own shape already: gateway (inner), signed log (cross-session record), Academy/Courts checker (independent acceptance). Build: name the three layers in the Mandate docs and add a "supervisor" role that resumes an agent across sessions from the log. Risk: layers add latency and a place for the checker to be gamed.
