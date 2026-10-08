export { AspError, type AspErrorCode } from "./errors.ts";
export { canonicalize, canonicalBytes } from "./canonical.ts";
export { b64urlDecode, b64urlEncode, publicKeyFromSeed, randomSeed, sha256Id, signBytes, verifyBytes } from "./crypto.ts";
export { didKeyFromPublicKey, isDidKeyFor, publicKeyFromDidKey } from "./didkey.ts";
export { didWebUrl, fetchDidWebKeys, passportKeysNotPublished, type FetchLike } from "./didweb.ts";
export {
  RECORD_TYPES, SchemaSet, SPEC_DIR, defaultSchemas, fullType, shortType, type RecordType,
} from "./schema.ts";
export {
  cosign, createRecord, didOf, resolverFromPassports, signerFromSeed, signingBytes, staticResolver,
  unsignedView, verifyRecord,
  type AspRecord, type KeyResolver, type RecordDraft, type Signature, type Signer,
} from "./record.ts";
export { Job, LIFECYCLE, type JobOptions, type JobSnapshot, type JobState } from "./lifecycle.ts";
