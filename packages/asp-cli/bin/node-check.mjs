// Plain JavaScript on purpose: this file has to load on any Node, so an old one gets a clear message instead of "Unknown file extension .ts".
// asp runs its TypeScript source directly, which needs Node 22.18 or newer (the same as "engines" in package.json).
export const MIN_NODE = [22, 18];

/** The message to show when this Node is too old, or undefined when it is fine. */
export function nodeTooOld(version) {
  const [major, minor] = String(version).replace(/^v/, "").split(".").map(Number);
  if (major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1])) return undefined;
  return `asp needs Node ${MIN_NODE.join(".")} or newer, and this is Node ${String(version).replace(/^v/, "")}.\n` +
    "  Install a current Node from https://nodejs.org (the LTS or Current release), open a new terminal, and run the command again.\n" +
    "  Check with: node --version";
}
