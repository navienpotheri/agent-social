// Writes docs/cognition-collection.md from the category registry (DK79). Run: npm run cognition-disclosure
import { writeFileSync } from "node:fs";
import { cognitionDisclosure } from "../packages/asp-package/src/gateway/cognition-registry.ts";
writeFileSync(new URL("../docs/cognition-collection.md", import.meta.url), cognitionDisclosure());
