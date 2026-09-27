import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ValidateFunction } from "ajv";
import { AspError } from "./errors.ts";

// ajv ships CommonJS; unwrap the default export under ESM.
const Ajv2020 = ((Ajv2020Module as any).default ?? Ajv2020Module) as typeof Ajv2020Module.default;
const addFormats = ((addFormatsModule as any).default ?? addFormatsModule) as typeof addFormatsModule.default;

export const SPEC_DIR = fileURLToPath(new URL("../../../spec/", import.meta.url));

/** Short record names ("mandate") that have a body schema. */
export const RECORD_TYPES = [
  "intent", "call", "proposal", "offer", "contract", "mandate", "bond",
  "checkpoint", "delivery", "attestation", "settlement", "passport", "lineage", "package", "fleet", "node", "juror",
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const TYPE_VERSION = "v0.2";

export function fullType(short: RecordType): string {
  return `asp.${short}/${TYPE_VERSION}`;
}

export function shortType(full: string): RecordType | undefined {
  const m = /^asp\.([a-z_]+)\/v0\.2$/.exec(full);
  if (!m) return undefined;
  return (RECORD_TYPES as readonly string[]).includes(m[1]) ? (m[1] as RecordType) : undefined;
}

export class SchemaSet {
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(schemaDir: string = join(SPEC_DIR, "schemas")) {
    const ajv = new Ajv2020({ allErrors: false, strict: true, strictRequired: false, strictTypes: false });
    addFormats(ajv);
    const names: string[] = [];
    for (const file of readdirSync(schemaDir).filter((f) => f.endsWith(".schema.json"))) {
      ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, file), "utf8")));
      names.push(file.replace(".schema.json", ""));
    }
    for (const name of names) {
      this.validators.set(name, ajv.getSchema(`urn:asp:v0.2:${name}`)!);
    }
  }

  has(name: string): boolean {
    return this.validators.has(name);
  }

  /** Throws SCHEMA_INVALID with the first failing path. */
  assert(name: string, instance: unknown): void {
    const validate = this.validators.get(name);
    if (!validate) throw new AspError("UNKNOWN_TYPE", `no schema named ${name}`);
    if (!validate(instance)) {
      const e = validate.errors![0];
      throw new AspError("SCHEMA_INVALID", `${name}${e.instancePath} ${e.message}`, e.instancePath || "/");
    }
  }

  isValid(name: string, instance: unknown): boolean {
    try {
      this.assert(name, instance);
      return true;
    } catch (e) {
      if (e instanceof AspError && e.code === "SCHEMA_INVALID") return false;
      throw e;
    }
  }
}

let defaultSet: SchemaSet | undefined;
export function defaultSchemas(): SchemaSet {
  defaultSet ??= new SchemaSet();
  return defaultSet;
}
