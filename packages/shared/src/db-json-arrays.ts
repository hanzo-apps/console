/**
 * Transparent JSON-array codec for SQLite (Hanzo Base).
 *
 * SQLite/Prisma has no scalar-list type, so the columns that were Postgres
 * `String[]`/`Int[]` are modelled as `String` and persisted as a JSON-encoded
 * array (e.g. `'["a","b"]'`, `'[]'`). To keep every read/write call site working
 * with real JavaScript arrays — exactly as the Postgres client behaved — this
 * module provides a single Prisma `$extends` query component that:
 *
 *   - on write (create/update/upsert/...): serializes an array supplied for one
 *     of these fields into its JSON string, and translates `{ set: [...] }`,
 *     `{ push: x }` list operations into the equivalent string value;
 *   - on read (find / create / update operations returning rows): parses the
 *     JSON string back into an array before the value reaches application code.
 *
 * This is the one and only place the array<->JSON translation lives; consumers
 * never serialize/parse these fields by hand. Registering a field here is the
 * sole source of truth for "this String column is really a list".
 */

import type { Prisma } from "@prisma/client";

/**
 * Map of Prisma model name -> the model's JSON-array fields (Prisma field
 * names, not the mapped column names). Derived 1:1 from the former `Type[]`
 * columns in schema.prisma.
 */
const JSON_ARRAY_FIELDS: Record<string, readonly string[]> = {
  User: ["featureFlags"],
  LlmApiKeys: ["customModels", "extraHeaderKeys"],
  LegacyPrismaTrace: ["tags"],
  AnnotationQueue: ["scoreConfigIds"],
  Comment: ["path", "rangeStart", "rangeEnd"],
  Prompt: ["tags", "labels"],
  EvalTemplate: ["vars"],
  JobConfiguration: ["timeScope"],
  BlobStorageIntegration: ["exportFieldGroups"],
  Trigger: ["eventActions"],
  Monitor: ["tags"],
};

const EMPTY_ARRAY_JSON = "[]";

function encodeArray(value: unknown): string {
  if (value == null) return EMPTY_ARRAY_JSON;
  if (typeof value === "string") {
    // Already serialized (or a raw filter value); leave as-is.
    return value;
  }
  return JSON.stringify(value);
}

function decodeArray(value: unknown): unknown {
  if (Array.isArray(value)) return value; // already decoded / never stored
  if (typeof value !== "string") return value;
  if (value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

/** Serialize array-valued inputs in a Prisma `data` payload for one model. */
function encodeWriteData(model: string, data: unknown): unknown {
  const fields = JSON_ARRAY_FIELDS[model];
  if (!fields || data == null || typeof data !== "object") return data;
  const obj = data as Record<string, unknown>;
  for (const field of fields) {
    if (!(field in obj)) continue;
    const v = obj[field];
    if (Array.isArray(v)) {
      obj[field] = encodeArray(v);
    } else if (v && typeof v === "object") {
      // Prisma list-update ops: { set: [...] } / { push: x } -> string value.
      const op = v as Record<string, unknown>;
      if ("set" in op) {
        obj[field] = encodeArray(op.set);
      } else if ("push" in op) {
        const pushed = Array.isArray(op.push) ? op.push : [op.push];
        obj[field] = encodeArray(pushed);
      }
    }
  }
  return data;
}

/** Recursively decode array-valued JSON columns on a returned row (or rows). */
function decodeResult(model: string, result: unknown): unknown {
  const fields = JSON_ARRAY_FIELDS[model];
  if (!fields || result == null) return result;
  if (Array.isArray(result)) {
    for (const row of result) decodeRow(fields, row);
  } else {
    decodeRow(fields, result);
  }
  return result;
}

function decodeRow(fields: readonly string[], row: unknown): void {
  if (row == null || typeof row !== "object") return;
  const obj = row as Record<string, unknown>;
  for (const field of fields) {
    if (field in obj) obj[field] = decodeArray(obj[field]);
  }
}

const WRITE_OPERATIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
]);

/**
 * Prisma `$extends` argument that installs the JSON-array codec across all
 * models and operations. Apply once in db.ts:
 *   `new PrismaClient(...).$extends(jsonArrayCodecExtension)`.
 */
export const jsonArrayCodecExtension: {
  name: string;
  query: {
    $allModels: {
      $allOperations: (params: {
        model: string;
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
      }) => Promise<unknown>;
    };
  };
} = {
  name: "sqliteJsonArrayCodec",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (model && WRITE_OPERATIONS.has(operation) && args && typeof args === "object") {
          const a = args as { data?: unknown };
          if ("data" in a) {
            if (Array.isArray(a.data)) {
              a.data = a.data.map((d) => encodeWriteData(model, d));
            } else {
              a.data = encodeWriteData(model, a.data);
            }
          }
        }
        const result = await query(args);
        return model ? decodeResult(model, result) : result;
      },
    },
  },
};

/** Exposed for targeted unit tests / manual use. */
export const __jsonArrayInternals = {
  JSON_ARRAY_FIELDS,
  encodeArray,
  decodeArray,
  encodeWriteData,
  decodeResult,
};

// Cast helper so callers can pass the extension to $extends without fighting
// Prisma's heavily-generic extension typings.
export const jsonArrayCodec = jsonArrayCodecExtension as unknown as Prisma.Extension;
