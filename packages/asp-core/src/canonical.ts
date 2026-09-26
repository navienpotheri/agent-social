import { AspError } from "./errors.ts";

/**
 * RFC 8785 (JCS) canonical JSON, restricted to the ASP profile:
 * numbers must be safe integers, strings must be well-formed Unicode.
 * The same value always yields the same bytes, in every SDK.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new AspError("NON_INTEGER_NUMBER", `number ${value} is not a safe integer`);
      }
      return Object.is(value, -0) ? "0" : String(value);
    case "string":
      if (!value.isWellFormed()) {
        throw new AspError("SCHEMA_INVALID", "string contains a lone surrogate");
      }
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
      // Default sort compares UTF-16 code units, which is what JCS requires.
      const keys = Object.keys(value as object).sort();
      const parts = keys.map((k) => {
        const v = (value as Record<string, unknown>)[k];
        if (v === undefined) throw new AspError("SCHEMA_INVALID", `key "${k}" is undefined`);
        return `${canonicalize(k)}:${canonicalize(v)}`;
      });
      return `{${parts.join(",")}}`;
    }
    default:
      throw new AspError("SCHEMA_INVALID", `cannot canonicalize a ${typeof value}`);
  }
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}
