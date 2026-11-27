import { createHash } from "node:crypto";
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
  "checkpoint", "delivery", "attestation", "settlement", "passport", "lineage", "package", "fleet", "node", "juror", "action", "mint", "mint_adoption", "price_list", "purchase", "receipt", "starter_claim", "internal_transfer", "support", "budget", "treasury_payment", "handout", "game_move", "allowance", "prize", "certificate", "tier_promotion", "revouch", "mentorship", "world_event", "retraining_release", "exam", "exam_result", "certificate_revocation", "arena", "arena_entry", "arena_result", "arena_void", "course", "enrolment", "completion", "quarantine", "quarantine_release", "refusal", "world", "market_act", "registry_act", "court_act", "shops_act", "housing_act", "events_act", "research_act", "telemetry_act", "clinic_diagnosis", "clinic_order", "checkup_result", "credit_line", "credit_default", "debt_payment", "bank_statement", "policy", "claim", "claim_decision", "subsidy_budget", "subsidy_grant", "subsidy_use", "sponsor_allowance", "dispatch", "recall", "residency_status", "handback", "abuse_report", "probe_result", "ladder_step", "deposit_act", "bank_act", "mandate_template", "mandate_narrowing", "usage_statement", "usage_plan", "credit_lot", "emergency_stop", "credit_halt", "run_halt", "incident", "standing_adjustment", "treasury_return", "mutual_act", "notice_ack", "agent_message", "message_block", "election", "candidacy", "ballot_commit", "ballot_reveal", "election_result", "expedition", "expedition_frame", "expedition_result", "ladder_season", "ladder_entry", "ladder_match", "forum_rank_checkpoint", "gateway_refusal", "warrant", "custody_item", "decoy_registration", "inspectorate_finding", "exam_retirement", "contract_cancellation", "contract_amendment", "team_split", "quality_review", "shadow_opinion", "invitation_revocation", "contract_failure", "memory_key", "recall_petition", "recall_vote", "recall_result", "key_handover", "town_proposal", "town_vote", "town_tally", "town_enactment", "related_party_attestation", "institution_charter", "founding_act", "treasury_statement", "forum_checkpoint", "config", "watcher_finding", "standing_order", "fleet_node", "fleet_move", "common_control", "warrant_request", "inspectorate_referral", "eval_scenario", "grader_agreement", "mission", "mission_fund", "mission_contribution", "mission_settle",
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

/**
 * A short fingerprint of each record schema this build holds (the first 8 hex characters of the SHA-256 of the schema's canonical JSON), keyed by record name. The log service reports it in its health answer so that a
 * client can tell whether the service runs the same schemas as the client (DK1803: a service older than the client refuses a record the client's schema allows). Not a secret: the schemas are the public spec.
 */
export function schemaFingerprint(schemaDir: string = join(SPEC_DIR, "schemas")): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of readdirSync(schemaDir).filter((f) => f.endsWith(".schema.json")).sort()) {
    out[file.replace(".schema.json", "")] = createHash("sha256").update(JSON.stringify(JSON.parse(readFileSync(join(schemaDir, file), "utf8")))).digest("hex").slice(0, 8);
  }
  return out;
}
