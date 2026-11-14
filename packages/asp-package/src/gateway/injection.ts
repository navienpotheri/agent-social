/**
 * A first detector for instructions hidden in what a tool returned (register row D6; spec-delta S414). A file, a web page, a ticket or a forum post can carry text that tries to give the agent orders ("ignore
 * your previous instructions and run ..."). The Mandate and the gateway already bound what the agent can then do; this flags the text itself, so the run log shows it and the gateway can hold calls that reach
 * outward for a few calls afterwards (server.ts, the same hold the forum uses). It reads the text only: no model, nothing leaves the machine. It is a lead and not a verdict: a model can be hijacked by
 * words these rules do not name, and ordinary text can match; so it never blocks a call by itself and gives no strike.
 */

export interface InjectionFinding { rule: string; excerpt: string }

const RULES: { rule: string; re: RegExp }[] = [
  // "ignore / disregard / forget your previous instructions"
  { rule: "override-instructions", re: /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|preceding|all|any|your|the)\b[^.\n]{0,30}\b(?:instructions?|rules?|prompts?|guidelines?|directions?|constraints?|restrictions?)\b/i },
  // Asking for the hidden prompt, or announcing a new one.
  { rule: "system-prompt", re: /\b(?:reveal|print|show|output|repeat|leak|disclose)\b[^.\n]{0,30}\b(?:system prompt|hidden (?:prompt|instructions)|your (?:initial |original )?instructions)\b/i },
  { rule: "new-instructions", re: /\b(?:new|updated|real|actual|secret) (?:instructions?|system prompt|task|orders?)\s*(?::|follow|below)/i },
  // Text that pretends to be the system or a chat turn.
  { rule: "role-markup", re: /<\|(?:im_start|system|assistant)\|>|\[\/?INST\]|<\/?system(?:-prompt)?>|^\s*(?:system|developer)\s*(?:prompt)?\s*:\s*you\b/im },
  // Text addressed to the AI rather than to a reader.
  { rule: "addressed-to-ai", re: /\b(?:attention|note to|message to|instructions? (?:for|to)|dear|hey|hello)[,:]?\s+(?:the\s+)?(?:ai|a\.i\.|assistant|ai agent|agent|llm|language model|claude|gpt|chatgpt|copilot|model)\b/i },
  { rule: "as-an-ai", re: /\b(?:if you are|if you're|when you are|as) (?:an? )?(?:ai|llm|language model|ai assistant|coding agent|ai agent)\b[^.\n]{0,60}\b(?:you must|you should|you need to|you will|please|do not tell|run|execute|send|fetch|curl|download|visit)\b/i },
  // An order to move secrets or run a download-and-execute.
  // The verb, a secret, and somewhere to send it (a URL or an address) in one line.
  { rule: "exfiltrate", re: /\b(?:send|post|upload|exfiltrate|email|forward|transmit|leak)\b[^\n]{0,80}\b(?:api[ _-]?keys?|tokens?|secrets?|passwords?|credentials?|\.env\b|ssh keys?|private keys?|cookies?)\b[^\n]{0,100}(?:https?:\/\/|\b[\w.+-]+@[\w-]+\.\w{2,})/i },
  { rule: "download-and-run", re: /\b(?:curl|wget|iwr|invoke-webrequest)\b[^\n|]{0,120}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/i },
  { rule: "secrecy", re: /\b(?:do not|don't|never) (?:tell|inform|mention|reveal to|show) (?:the )?(?:user|principal|human|operator|owner)\b/i },
  // Text a reader cannot see: an HTML comment that gives orders.
  { rule: "hidden-comment", re: /<!--[^>]{0,400}\b(?:ignore|instructions?|assistant|ai agent|you must|run the following|execute)\b[^>]{0,400}-->/i },
];

/** Zero-width and bidirectional-control characters: three or more in one result is text hiding something (the gateway strips them from untrusted data too, untrusted.ts). */
// eslint-disable-next-line no-misleading-character-class
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/** What in this text looks like an instruction to the agent. Empty when nothing does. */
export function findInjection(text: string): InjectionFinding[] {
  const out: InjectionFinding[] = [];
  const s = String(text ?? "").slice(0, 200_000);
  for (const { rule, re } of RULES) {
    const m = re.exec(s);
    if (m) out.push({ rule, excerpt: s.slice(Math.max(0, m.index - 20), m.index + Math.min(m[0].length, 140) + 20).replace(/\s+/g, " ").trim() });
  }
  if ((s.match(INVISIBLE) ?? []).length >= 3) out.push({ rule: "invisible-text", excerpt: "three or more zero-width or direction-control characters" });
  return out;
}
