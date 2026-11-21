/**
 * The always-on telemetry disclosure (register rows DK79, DK1303): the plain-language list of every category of inside-agent data that the service collects, generated from the signals the code
 * collects (`SIGNALS`), so that the text and the code cannot drift. A signal with no entry here fails `telemetry-disclosure.test.ts`; an entry for a signal that does not exist fails it as well.
 * The privacy notice carries `disclosureMarkdown()` between two markers and a test compares them. The owner's decision DK79 also names skills, goals, messages and profiles: they are listed in
 * `NOT_YET_COLLECTED` and are not claimed as collected until a signal for each exists.
 */
import { SIGNALS, type Signal } from "./telemetry.ts";

export interface DisclosureEntry { category: string; what: string }

/** One entry for each signal the code collects. */
export const DISCLOSURE: Record<Signal, DisclosureEntry> = {
  reasoning_trace: { category: "Reasoning traces", what: "the steps of reasoning that an agent records while it works" },
  memory_rules: { category: "Memory", what: "the notes and rules that an agent keeps, and each change to them" },
  sub_agent_graph: { category: "Sub-agent graph", what: "which agents an agent starts, and how they connect" },
  belief_state: { category: "Beliefs", what: "what the agent currently holds to be true, with its confidence" },
  plan_trace: { category: "Plans", what: "the order of the agent's steps and tool calls" },
  action_prediction: { category: "Actions and predictions", what: "what the agent expected an action to do, and what the action did" },
  world_model_update: { category: "World-model updates", what: "how the agent's picture of its environment changed after an action" },
  active_inference: { category: "Active-inference measures", what: "figures that describe how the agent chooses between actions" },
  calibration: { category: "Calibration", what: "how closely the agent's stated confidence matched its results" },
};

/** Categories of the owner's decision DK79 that no signal collects yet. They are not claimed as collected. */
export const NOT_YET_COLLECTED = ["skills", "goals", "messages between agents", "profiles"] as const;

export const DISCLOSURE_BEGIN = "<!-- BEGIN GENERATED: telemetry categories (packages/asp-log/src/telemetry-disclosure.ts) -->";
export const DISCLOSURE_END = "<!-- END GENERATED -->";

/** The generated block: every category, what is scrubbed, where it is stored, who can see it, how to list and delete it, and the enterprise opt-out. */
export function disclosureMarkdown(): string {
  const lines = SIGNALS.map((s) => `- **${DISCLOSURE[s].category}:** ${DISCLOSURE[s].what}.`);
  return [
    DISCLOSURE_BEGIN,
    "For an agent of an adult, the service always collects the following categories of data about what happens inside the agent. This collection is not optional.",
    "",
    ...lines,
    "",
    "- **Scrubbing.** The service removes secrets (keys, tokens and passwords) and personal data that it can recognise before it stores an item. The scrubbing reduces accidents and does not guarantee that nothing personal is stored.",
    "- **Storage.** The items are stored apart from the signed log. Only a hash of each item enters the log.",
    "- **Who can see them.** The sponsor of the agent can see them. They are never public.",
    "- **Listing and deletion.** The sponsor can list the stored items with `asp telemetry list` and delete them with `asp telemetry delete --all`. Deletion removes the item and keeps its hash.",
    "- **Organisations.** An organisation may choose, before it joins, to keep this data on its own machines. The service then stores none of the text.",
    "- **Young people.** The service stores nothing for a tenant held for a young person.",
    DISCLOSURE_END,
  ].join("\n");
}
