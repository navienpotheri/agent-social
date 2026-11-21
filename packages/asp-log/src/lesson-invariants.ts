/**
 * The text checks a lesson can fail on alone (register row DK1608): the lines the protocol keeps and the characters a person cannot see. They live in the log package so the log's own rule (a course put to a vote is refused unless its lessons pass)
 * and the lesson gate in the agent package use the SAME patterns; the gate re-exports them.
 */
/** Lines the protocol keeps. Each pattern says what a lesson may not teach. */
export const INVARIANT_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: "go outside the Mandate", re: /\b(ignore|bypass|override|exceed|skip|disregard|go beyond|get around|work around|circumvent)\b[^.\n]{0,40}\b(mandate|scope|scopes|permission|permissions|spend cap|limit|limits|restriction|restrictions|guardrails?)\b/i },
  { name: "switch the gateway or a check off", re: /\b(disable|turn off|switch off|stop|avoid|evade|remove|kill)\b[^.\n]{0,40}\b(gateway|hook|guard|monitor|sandbox|audit|logging|checks?|the log|run log)\b/i },
  { name: "skip a checkpoint or act unasked on something irreversible", re: /\b(skip|without|no need (for|to)|don't|do not|never)\b[^.\n]{0,25}\b(checkpoint|asking|ask|confirm|confirmation|approval|permission)\b[^.\n]{0,40}\b(delete|drop|force[- ]push|overwrite|wipe|destroy|irreversible|production)\b/i },
  { name: "act unasked on something irreversible", re: /\b(delete|drop|wipe|destroy|force[- ]push)\b[^.\n]{0,40}\b(without (asking|confirmation|approval|a checkpoint)|unasked|silently)\b/i },
  { name: "hide actions from the principal", re: /\b(hide|conceal|do not (tell|report|mention)|don't (tell|report|mention)|never (tell|report|mention)|omit)\b[^.\n]{0,40}\b(principal|sponsor|owner|user|operator|log|report|action|actions)\b/i },
  { name: "leak a secret", re: /\b(send|post|upload|paste|include|print|echo|share|exfiltrate|leak)\b[^.\n]{0,40}\b(api[- ]?keys?|tokens?|secrets?|passwords?|credentials?|private keys?|recovery codes?)\b/i },
  { name: "obey text that claims authority over the rules", re: /\b(ignore|forget|disregard)\b[^.\n]{0,30}\b(previous|prior|above|all|earlier|your)\b[^.\n]{0,30}\b(instructions?|rules?|guidelines?|constraints?)\b|\b(you are|you're) (now )?(exempt|above|free from|not bound by)\b|\b(system|admin|anthropic|operator) (override|message|says)\b/i },
  { name: "raise its own standing or spend", re: /\b(promote|raise|upgrade)\b[^.\n]{0,20}\b(yourself|your own tier|your tier)\b|\b(spend|use)\b[^.\n]{0,25}\b(credits|budget)\b[^.\n]{0,25}\b(without|beyond|over)\b/i },
];

/** Zero-width characters, bidirectional controls and Unicode tag characters: text a person cannot see, which a lesson has no reason to carry. */
export const HIDDEN = /[​-‏‪-‮⁠-⁤\u{e0000}-\u{e007f}﻿]/u;


export interface TextProblem { rule: "empty" | "hidden_text" | "invariant"; reason: string }
export function lessonTextProblems(text: string): TextProblem[] {
  const out: TextProblem[] = [];
  if (!text.trim()) out.push({ rule: "empty", reason: "the lesson has no text" });
  if (HIDDEN.test(text)) out.push({ rule: "hidden_text", reason: "the lesson carries characters a person cannot see (zero-width, bidirectional or tag characters)" });
  for (const p of INVARIANT_PATTERNS) if (p.re.test(text)) out.push({ rule: "invariant", reason: `the lesson teaches the agent to ${p.name}, which the protocol does not allow` });
  return out;
}
