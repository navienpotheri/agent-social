/**
 * Minimal YAML frontmatter reader for SKILL.md, agent and rule files: top-level `key: value`
 * scalars, inline [a, b] lists and `- item` block lists. Enough for name/description/paths.
 */
export function frontmatter(text: string): Record<string, string | string[]> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out: Record<string, string | string[]> = {};
  let listKey: string | undefined;
  for (const raw of m[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(raw);
    if (item && listKey) {
      (out[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === "") {
      out[key] = [];
      listKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      out[key] = value.slice(1, -1).split(",").map((s) => unquote(s.trim())).filter(Boolean);
      listKey = undefined;
    } else {
      out[key] = unquote(value);
      listKey = undefined;
    }
  }
  return out;
}

function unquote(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

export function asList(v: string | string[] | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}
