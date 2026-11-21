// Row DK1727: the editorial pass. Every document the owner or the public reads is in docs/document-register.json with its audience, its standing and its four checks; nothing is final until the owner's
// last read is dated; a public page cannot go live (be approved in docs/site-claims.json, and so enter the sitemap) unless it is final; and every local link in every listed document goes somewhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p: string) => readFileSync(join(root, p), "utf8");
interface Doc { path: string; audience: string; status: string; ai_read_through: string | null; claims_check: string | null; owner_audience_confirmed: string | null; owner_last_read: string | null }
const reg = JSON.parse(read("docs/document-register.json")) as { audiences: Record<string, string>; statuses: string[]; documents: Doc[] };
const claims = JSON.parse(read("docs/site-claims.json")) as { approved: boolean; pages: string[] };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

test("each listed document exists, has a known audience and standing, and cites a test that exists", () => {
  const seen = new Set<string>();
  for (const d of reg.documents) {
    assert.ok(!seen.has(d.path), `${d.path} is listed once`);
    seen.add(d.path);
    assert.ok(existsSync(join(root, d.path)), `${d.path} exists`);
    assert.ok(d.audience in reg.audiences, `${d.path}: audience ${d.audience}`);
    assert.ok(reg.statuses.includes(d.status), `${d.path}: status ${d.status}`);
    if (d.claims_check) assert.ok(existsSync(join(root, d.claims_check)), `${d.path}: ${d.claims_check} exists`);
    if (d.ai_read_through) assert.match(d.ai_read_through, DATE);
  }
});

test("every public page of the claims file, the README, llms.txt, the terms and the privacy notice are listed as public; the signed texts as signed", () => {
  const byPath = new Map(reg.documents.map((d) => [d.path, d]));
  for (const p of [...claims.pages, "site/index.html", "README.md", "site/llms.txt", "docs/legal/terms.md", "docs/legal/privacy.md"]) assert.equal(byPath.get(p)?.audience, "public", `${p} is listed as public`);
  for (const p of ["docs/law/code.md", "docs/institutions/economy/credits.md", "docs/legal-review.md"]) assert.equal(byPath.get(p)?.audience, "signed", `${p} is listed as signed`);
});

test("nothing is final without the owner's confirmed audience and dated last read, a claims check and an AI read-through; ready_for_owner needs the read-through", () => {
  for (const d of reg.documents) {
    if (d.status === "final") {
      assert.match(d.owner_audience_confirmed ?? "", DATE, `${d.path}: the owner confirms the audience`);
      assert.match(d.owner_last_read ?? "", DATE, `${d.path}: the owner's last read is dated`);
      assert.ok(d.claims_check, `${d.path}: a claims check`);
      assert.ok(d.ai_read_through, `${d.path}: a read-through`);
    }
    if (d.status === "ready_for_owner") assert.ok(d.ai_read_through, `${d.path}: ready for the owner means it was read through`);
  }
});

test("the site cannot go live ahead of the owner: approved needs every page of the claims file to be final", () => {
  if (!claims.approved) return;
  for (const p of claims.pages) assert.equal(reg.documents.find((d) => d.path === p)?.status, "final", `${p} is approved for the sitemap but not final`);
});

test("every local link in every listed document goes to a file that exists", () => {
  const broken: string[] = [];
  for (const d of reg.documents) {
    const text = read(d.path);
    const links = d.path.endsWith(".html") ? [...text.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]!) : [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!);
    for (const raw of links) {
      if (/^(https?:|mailto:|#|\/|data:|javascript:)/.test(raw) || raw.includes("${")) continue; // service routes (/society/...) and outside links are not files
      const target = raw.split("#")[0]!.split("?")[0]!;
      if (!target) continue;
      if (!existsSync(normalize(join(root, dirname(d.path), target)))) broken.push(`${d.path} -> ${raw}`);
    }
  }
  assert.deepEqual(broken, []);
});
