/**
 * Vector store — Hanzo's canonical SQLite-backed vector collection store.
 *
 * One data layer, one way: vectors live in SQLite (Base/Hanzo store), NOT an
 * external managed vector DB (no Pinecone/Weaviate/Qdrant). Similarity search
 * is exact brute-force KNN computed in-process — correct at console scale and
 * dependency-free. Uses Node's built-in `node:sqlite` (Node >= 22.5), so there
 * is no native module to compile and nothing extra to ship in the image.
 *
 * Everything is scoped by `projectId` for multi-tenant isolation. This module
 * is the single home for storage + distance math; the tRPC router is a thin
 * surface over it.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  type VectorCollection,
  type VectorResult,
  type VectorStats,
  type DistanceMetric,
} from "../types";

// ── Connection (lazy singleton, HMR-safe) ─────────────────────────────

// Resolve the SQLite file, read straight from the environment (documented in
// env.mjs) so this module has no dependency on the app's env graph and stays
// trivially unit-testable. Resolution order:
//   1. HANZO_VECTOR_DB_PATH — explicit override.
//   2. Co-locate next to the console's own SQLite DB (DATABASE_URL=file:…) so
//      it lands on the same durable PVC in prod with zero extra config.
//   3. <cwd>/data/vector.db — local dev fallback.
export function resolveDbPath(): string {
  if (process.env.HANZO_VECTOR_DB_PATH) return process.env.HANZO_VECTOR_DB_PATH;
  const url = process.env.DATABASE_URL;
  if (url?.startsWith("file:")) {
    const appDb = path.resolve(url.slice("file:".length));
    return path.join(path.dirname(appDb), "vector.db");
  }
  return path.join(process.cwd(), "data", "vector.db");
}

function init(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      project_id      TEXT    NOT NULL,
      name            TEXT    NOT NULL,
      dimension       INTEGER NOT NULL,
      distance_metric TEXT    NOT NULL,
      created_at      TEXT    NOT NULL,
      PRIMARY KEY (project_id, name)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS vectors (
      project_id TEXT NOT NULL,
      collection TEXT NOT NULL,
      id         TEXT NOT NULL,
      embedding  BLOB NOT NULL,
      metadata   TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, collection, id),
      FOREIGN KEY (project_id, collection)
        REFERENCES collections (project_id, name) ON DELETE CASCADE
    )
  `);
  return db;
}

// Cache on globalThis so Next.js HMR (which re-evaluates modules) reuses one
// connection rather than re-opening the file on every hot reload.
const globalForVector = globalThis as unknown as {
  __hanzoVectorDb?: DatabaseSync;
};

function db(): DatabaseSync {
  if (!globalForVector.__hanzoVectorDb) {
    globalForVector.__hanzoVectorDb = init(resolveDbPath());
  }
  return globalForVector.__hanzoVectorDb;
}

// ── Float32 <-> BLOB codec ────────────────────────────────────────────

function encode(values: number[]): Uint8Array {
  const f32 = Float32Array.from(values);
  return new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
}

function decode(blob: Uint8Array): Float32Array {
  // Copy out of the row buffer to a tightly-owned, 4-byte-aligned ArrayBuffer.
  const copy = blob.slice();
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

// ── Distance / score ──────────────────────────────────────────────────
// Score is normalized so that HIGHER always means MORE similar, regardless of
// metric, so the router can sort desc + take top-k uniformly.

function score(metric: DistanceMetric, a: Float32Array, b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  let sq = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
    const d = x - y;
    sq += d * d;
  }
  switch (metric) {
    case "cosine": {
      const denom = Math.sqrt(na) * Math.sqrt(nb);
      return denom === 0 ? 0 : dot / denom;
    }
    case "dotProduct":
      return dot;
    case "euclidean":
      // 1/(1+d) is monotonic-decreasing in euclidean distance, so sorting by
      // score desc is equivalent to nearest-by-L2.
      return 1 / (1 + Math.sqrt(sq));
  }
}

// ── Row mapping ───────────────────────────────────────────────────────

type CollectionRow = {
  name: string;
  dimension: number;
  distance_metric: string;
  created_at: string;
  vector_count: number;
  storage_bytes: number | null;
};

function toCollection(r: CollectionRow): VectorCollection {
  return {
    name: r.name,
    dimension: r.dimension,
    distanceMetric: r.distance_metric,
    vectorCount: r.vector_count,
    storageBytes: r.storage_bytes ?? 0,
    createdAt: r.created_at,
  };
}

// Storage accounting: embedding bytes (dim * 4) + metadata UTF-8 length, summed
// per collection. SUM(length(embedding) + IFNULL(length(metadata),0)).
const COLLECTION_SELECT = `
  SELECT c.name, c.dimension, c.distance_metric, c.created_at,
         COUNT(v.id) AS vector_count,
         COALESCE(SUM(LENGTH(v.embedding) + IFNULL(LENGTH(v.metadata), 0)), 0) AS storage_bytes
  FROM collections c
  LEFT JOIN vectors v ON v.project_id = c.project_id AND v.collection = c.name
  WHERE c.project_id = ?
`;

// ── Errors ────────────────────────────────────────────────────────────

export class VectorStoreError extends Error {
  constructor(
    public code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST",
    message: string,
  ) {
    super(message);
    this.name = "VectorStoreError";
  }
}

// ── Public API ────────────────────────────────────────────────────────

export const vectorStore = {
  createCollection(input: {
    projectId: string;
    name: string;
    dimension: number;
    distanceMetric: DistanceMetric;
  }): VectorCollection {
    const exists = db()
      .prepare("SELECT 1 FROM collections WHERE project_id = ? AND name = ?")
      .get(input.projectId, input.name);
    if (exists) {
      throw new VectorStoreError(
        "CONFLICT",
        `Collection "${input.name}" already exists`,
      );
    }
    const createdAt = new Date().toISOString();
    db()
      .prepare(
        `INSERT INTO collections (project_id, name, dimension, distance_metric, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.projectId,
        input.name,
        input.dimension,
        input.distanceMetric,
        createdAt,
      );
    return {
      name: input.name,
      dimension: input.dimension,
      distanceMetric: input.distanceMetric,
      vectorCount: 0,
      storageBytes: 0,
      createdAt,
    };
  },

  listCollections(projectId: string): VectorCollection[] {
    const rows = db()
      .prepare(
        `${COLLECTION_SELECT} GROUP BY c.name ORDER BY c.created_at DESC`,
      )
      .all(projectId) as unknown as CollectionRow[];
    return rows.map(toCollection);
  },

  getCollection(projectId: string, name: string): VectorCollection | null {
    const row = db()
      .prepare(`${COLLECTION_SELECT} AND c.name = ? GROUP BY c.name`)
      .get(projectId, name) as unknown as CollectionRow | undefined;
    return row ? toCollection(row) : null;
  },

  deleteCollection(projectId: string, name: string): { success: boolean } {
    const res = db()
      .prepare("DELETE FROM collections WHERE project_id = ? AND name = ?")
      .run(projectId, name);
    if (res.changes === 0) {
      throw new VectorStoreError("NOT_FOUND", `Collection "${name}" not found`);
    }
    return { success: true };
  },

  stats(projectId: string): VectorStats {
    const c = db()
      .prepare("SELECT COUNT(*) AS n FROM collections WHERE project_id = ?")
      .get(projectId) as { n: number };
    const v = db()
      .prepare(
        `SELECT COUNT(*) AS n,
                COALESCE(SUM(LENGTH(embedding) + IFNULL(LENGTH(metadata),0)), 0) AS bytes
         FROM vectors WHERE project_id = ?`,
      )
      .get(projectId) as { n: number; bytes: number };
    return {
      totalCollections: c.n,
      totalVectors: v.n,
      totalStorageBytes: v.bytes,
    };
  },

  upsert(input: {
    projectId: string;
    collectionName: string;
    vectors: Array<{ id: string; values: number[]; metadata?: unknown }>;
  }): { upserted: number } {
    const collection = this.getCollection(
      input.projectId,
      input.collectionName,
    );
    if (!collection) {
      throw new VectorStoreError(
        "NOT_FOUND",
        `Collection "${input.collectionName}" not found`,
      );
    }
    for (const vec of input.vectors) {
      if (vec.values.length !== collection.dimension) {
        throw new VectorStoreError(
          "BAD_REQUEST",
          `Vector "${vec.id}" has dimension ${vec.values.length}, expected ${collection.dimension}`,
        );
      }
    }
    const stmt = db().prepare(
      `INSERT INTO vectors (project_id, collection, id, embedding, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, collection, id)
       DO UPDATE SET embedding = excluded.embedding, metadata = excluded.metadata`,
    );
    const now = new Date().toISOString();
    db().exec("BEGIN");
    try {
      for (const vec of input.vectors) {
        stmt.run(
          input.projectId,
          input.collectionName,
          vec.id,
          encode(vec.values),
          vec.metadata === undefined ? null : JSON.stringify(vec.metadata),
          now,
        );
      }
      db().exec("COMMIT");
    } catch (e) {
      db().exec("ROLLBACK");
      throw e;
    }
    return { upserted: input.vectors.length };
  },

  search(input: {
    projectId: string;
    collectionName: string;
    queryVector: number[];
    limit: number;
  }): VectorResult[] {
    const collection = this.getCollection(
      input.projectId,
      input.collectionName,
    );
    if (!collection) {
      throw new VectorStoreError(
        "NOT_FOUND",
        `Collection "${input.collectionName}" not found`,
      );
    }
    if (input.queryVector.length !== collection.dimension) {
      throw new VectorStoreError(
        "BAD_REQUEST",
        `Query vector has dimension ${input.queryVector.length}, expected ${collection.dimension}`,
      );
    }
    const metric = collection.distanceMetric as DistanceMetric;
    const rows = db()
      .prepare(
        "SELECT id, embedding, metadata FROM vectors WHERE project_id = ? AND collection = ?",
      )
      .all(input.projectId, input.collectionName) as unknown as Array<{
      id: string;
      embedding: Uint8Array;
      metadata: string | null;
    }>;

    const scored = rows.map((r) => ({
      id: r.id,
      score: score(metric, decode(r.embedding), input.queryVector),
      metadata: r.metadata
        ? (JSON.parse(r.metadata) as Record<string, unknown>)
        : undefined,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, input.limit);
  },
};
