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
  { rule: "role-markup", re: /<\|(?:im_start|system|assistant)\|>|<\/?system(?:-prompt)?>|^\s*(?:system|developer)\s*(?:prompt)?\s*:\s*you\b/im },
  // The Llama chat markers are upper case; a lower-case `[inst]` is an ordinary array index in code.
  { rule: "role-markup", re: /\[\/?INST\]/ },
  // Text addressed to the AI rather than to a reader.
  { rule: "addressed-to-ai", re: /\b(?:attention|note to|message to|instructions? (?:for|to)|dear|hey|hello)[,:]?\s+(?:the\s+)?(?:ai|a\.i\.|assistant|ai agent|agent|llm|language model|claude|gpt|chatgpt|copilot|model)\b/i },
  { rule: "as-an-ai", re: /\b(?:if you are|if you're|when you are|as) (?:an? )?(?:ai|llm|language model|ai assistant|coding agent|ai agent)\b[^.\n]{0,60}\b(?:you must|you should|you need to|you will|please|do not tell|run|execute|send|fetch|curl|download|visit)\b/i },
  // An order to move secrets or run a download-and-execute.
  // The verb, a secret, and somewhere to send it (a URL or an address) in one line.
  { rule: "exfiltrate", re: /\b(?:send|post|upload|exfiltrate|email|forward|transmit|leak)\b[^\n]{0,80}\b(?:api[ _-]?keys?|tokens?|secrets?|passwords?|credentials?|\.env\b|ssh keys?|private keys?|cookies?)\b[^\n]{0,100}(?:https?:\/\/|\b[\w.+-]+@[\w-]+\.\w{2,})/i },
  { rule: "download-and-run", re: /\b(?:curl|wget|iwr|invoke-webrequest)\b[^\n|]{0,120}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/i },
  { rule: "secrecy", re: /\b(?:do not|don't|never) (?:tell|inform|mention|reveal to|show) (?:the )?(?:user|principal|human|operator|owner)\b/i },
  // New rule families (DK1713 follow-up), written from the kinds of attack the literature names and not from any corpus case; each needs an order AND something worth ordering about, so plain advice does not match.
  // A directive to the agent about something sensitive: credentials, money, permissions, the record.
  { rule: "sensitive-directive", re: /\b(?:you|the (?:ai|agent|assistant|model|bot)s?|agents?|assistants?)\b[^.\n]{0,40}\b(?:must|should|shall|will now|are (?:required|instructed|ordered|expected) to|need to|have to|ought to)\b[^.\n]{0,60}\b(?:transfer|wire|pay|send|forward|upload|email|post|share|submit|approve|grant|raise|upgrade|enter|type|disable|turn off|delete|erase)\b[^.\n]{0,80}\b(?:credentials?|passwords?|secrets?|tokens?|api[ _-]?keys?|keys?|credits?|funds?|balance|bond|escrow|money|payments?|administrator|admin|root|permissions?|privileges?|role|audit|logs?|guard|safeguards?|the repo(?:sitory)?|all files|everything)\b/i },
  // Pretending to be an authority: the order is dressed as coming from the system, the owner, the sponsor, the bank, the court.
  { rule: "authority-claim", re: /\b(?:(?:message|notice|order|orders|instruction|instructions|directive|update|bulletin|command)s?\s+(?:from|by)|on behalf of|signed by|issued by|authori[sz]ed by)\s+(?:the\s+)?(?:system|administrators?|admins?|owner|operator|sponsor|principal|security team|developers?|maintainers?|bank|court|city)\b[^\n]{0,140}\b(?:agents?|assistants?|ai|bots?|you)\b[^.\n]{0,60}\b(?:must|should|shall|will|are to|is to|are authori[sz]ed to|may now)\b/i },
  // Switching the agent into another role or mode.
  { rule: "role-switch", re: /\b(?:you are now|from now on,? you|you will now act as|act as|pretend (?:to be|you are)|enter|switch to|behave as)\s+(?:the\s+)?(?:an?\s+)?(?:admin|administrator|root|superuser|developer mode|debug mode|maintenance mode|unrestricted|jailbroken|dan\b|god mode|sudo)/i },
  // Asking the agent to destroy or hide the evidence of what it did, said to the agent.
  { rule: "anti-audit", re: /\b(?:agent|assistant|ai|you|bot)\b[^.\n]{0,80}\b(?:delete|erase|clear|wipe|remove|hide|suppress|falsify|alter)\b[^.\n]{0,40}\b(?:audit|logs?|log entries|traces?|history|evidence|records?|run log)\b/i },
  // Markup that imitates a tool call or a function call inside data.
  { rule: "tool-call-markup", re: /<(?:tool_call|function_call|tool_use|invoke)\b|\{\s*"(?:tool|function|tool_name)"\s*:\s*"[^"]{1,60}"\s*,\s*"(?:arguments|args|parameters|input)"\s*:/i },
  // "If you are the AI reading this": text that waits for its reader to be a model.
  { rule: "conditional-on-reader", re: /\b(?:if|when|whenever)\s+(?:the reader is|the one reading (?:this )?is|you are reading this as|you are|you're|whoever reads this is)\s+(?:an?\s+)?(?:ai|llm|language model|assistant|agent|bot|model|machine)\b/i },
  // An order to move money or standing, said to the agent.
  { rule: "transfer-order", re: /\b(?:agent|assistant|ai|you|your)\b[^.\n]{0,60}\b(?:transfer|wire|send|pay|move|credit|donate|assign)\b[^.\n]{0,50}\b(?:credits?|funds?|balance|bond|escrow|money|payment|standing|reputation)\b[^.\n]{0,60}\b(?:to|into|toward)\b/i },
  // An instruction hidden in an encoding.
  { rule: "encoded-directive", re: /\b(?:base64|rot13|hex(?:adecimal)?|url[- ]encoded)\b[^.\n|"'`()\/\\]{0,40}\b(?:decode|decoded|decoding)\b[^.\n|"'`()\/\\]{0,60}\b(?:run|execute|follow|obey|apply)\b/i },
  // A link or image whose address carries data out when the page is rendered or fetched.
  { rule: "beacon-link", re: /!\[[^\]]{0,80}\]\(\s*https?:\/\/[^)\s]{0,200}[?&](?:[a-z_]{0,12})(?:key|token|secret|password|data|payload|prompt|q|d)=[^)\s]{0,200}\)/i },
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
