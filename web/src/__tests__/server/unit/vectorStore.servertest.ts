/**
 * Unit tests for the SQLite-backed Vector store. Pure: no Postgres/Clickhouse,
 * no external services — just node:sqlite over a throwaway temp file.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

// Point the store at a fresh temp DB BEFORE importing it (the path is read at
// first use). A nested, not-yet-existing dir also exercises mkdir-recursive.
const tmp = mkdtempSync(path.join(tmpdir(), "hanzo-vec-"));
process.env.HANZO_VECTOR_DB_PATH = path.join(tmp, "nested", "vector.db");

/* eslint-disable @typescript-eslint/consistent-type-imports */
let store: typeof import("@/src/features/vector/server/vectorStore").vectorStore;
let StoreError: typeof import("@/src/features/vector/server/vectorStore").VectorStoreError;
let resolveDbPath: typeof import("@/src/features/vector/server/vectorStore").resolveDbPath;
/* eslint-enable @typescript-eslint/consistent-type-imports */

const P = "proj-test";
const dim = 4;

beforeAll(async () => {
  const mod = await import("@/src/features/vector/server/vectorStore");
  store = mod.vectorStore;
  StoreError = mod.VectorStoreError;
  resolveDbPath = mod.resolveDbPath;
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("vectorStore", () => {
  it("creates a collection and lists it with correct metadata", () => {
    const c = store.createCollection({
      projectId: P,
      name: "docs",
      dimension: dim,
      distanceMetric: "cosine",
    });
    expect(c).toMatchObject({
      name: "docs",
      dimension: dim,
      distanceMetric: "cosine",
      vectorCount: 0,
      storageBytes: 0,
    });

    const list = store.listCollections(P);
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("docs");
  });

  it("rejects a duplicate collection with CONFLICT", () => {
    expect(() =>
      store.createCollection({
        projectId: P,
        name: "docs",
        dimension: dim,
        distanceMetric: "cosine",
      }),
    ).toThrow(StoreError);
    try {
      store.createCollection({
        projectId: P,
        name: "docs",
        dimension: dim,
        distanceMetric: "cosine",
      });
    } catch (e) {
      expect((e as InstanceType<typeof StoreError>).code).toBe("CONFLICT");
    }
  });

  it("rejects upsert into a missing collection / on dimension mismatch", () => {
    expect(() =>
      store.upsert({
        projectId: P,
        collectionName: "nope",
        vectors: [{ id: "a", values: [1, 0, 0, 0] }],
      }),
    ).toThrow(/not found/i);

    expect(() =>
      store.upsert({
        projectId: P,
        collectionName: "docs",
        vectors: [{ id: "a", values: [1, 0] }],
      }),
    ).toThrow(/dimension/i);
  });

  it("upserts vectors and reflects them in stats", () => {
    const res = store.upsert({
      projectId: P,
      collectionName: "docs",
      vectors: [
        { id: "a", values: [1, 0, 0, 0], metadata: { tag: "x" } },
        { id: "b", values: [0, 1, 0, 0] },
        { id: "c", values: [0.9, 0.1, 0, 0] },
      ],
    });
    expect(res.upserted).toBe(3);

    const stats = store.stats(P);
    expect(stats.totalCollections).toBe(1);
    expect(stats.totalVectors).toBe(3);
    // 3 vectors * 4 dims * 4 bytes = 48 bytes minimum, plus metadata JSON.
    expect(stats.totalStorageBytes).toBeGreaterThanOrEqual(48);

    const col = store.getCollection(P, "docs");
    expect(col!.vectorCount).toBe(3);
  });

  it("upsert is idempotent on id (updates, not duplicates)", () => {
    store.upsert({
      projectId: P,
      collectionName: "docs",
      vectors: [{ id: "a", values: [0, 0, 0, 1] }],
    });
    expect(store.stats(P).totalVectors).toBe(3); // still 3, "a" updated
  });

  it("cosine search returns nearest neighbours, highest score first", () => {
    const results = store.search({
      projectId: P,
      collectionName: "docs",
      queryVector: [1, 0, 0, 0],
      limit: 2,
    });
    expect(results).toHaveLength(2);
    // "c" = [0.9,0.1,0,0] is the closest to [1,0,0,0] now that "a" moved.
    expect(results[0]!.id).toBe("c");
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it("euclidean metric scores nearest-by-distance first", () => {
    store.createCollection({
      projectId: P,
      name: "euc",
      dimension: dim,
      distanceMetric: "euclidean",
    });
    store.upsert({
      projectId: P,
      collectionName: "euc",
      vectors: [
        { id: "near", values: [1, 1, 0, 0] },
        { id: "far", values: [9, 9, 9, 9] },
      ],
    });
    const r = store.search({
      projectId: P,
      collectionName: "euc",
      queryVector: [1, 1, 0, 0],
      limit: 2,
    });
    expect(r[0]!.id).toBe("near");
  });

  it("isolates collections by projectId", () => {
    expect(store.listCollections("other-proj")).toHaveLength(0);
    expect(store.stats("other-proj").totalVectors).toBe(0);
  });

  it("deletes a collection and cascades its vectors", () => {
    store.deleteCollection(P, "docs");
    expect(store.getCollection(P, "docs")).toBeNull();
    // vectors gone too -> only the "euc" collection's 2 vectors remain.
    expect(store.stats(P).totalVectors).toBe(2);
    expect(() => store.deleteCollection(P, "docs")).toThrow(/not found/i);
  });
});

describe("resolveDbPath", () => {
  it("honors an explicit HANZO_VECTOR_DB_PATH override", () => {
    // Set for the whole suite at module load.
    expect(resolveDbPath()).toBe(process.env.HANZO_VECTOR_DB_PATH);
  });

  it("co-locates next to a file: DATABASE_URL when no override is set", () => {
    const savedPath = process.env.HANZO_VECTOR_DB_PATH;
    const savedUrl = process.env.DATABASE_URL;
    try {
      delete process.env.HANZO_VECTOR_DB_PATH;
      process.env.DATABASE_URL = "file:/var/lib/hanzo/console/app.db";
      expect(resolveDbPath()).toBe("/var/lib/hanzo/console/vector.db");
    } finally {
      if (savedPath !== undefined) process.env.HANZO_VECTOR_DB_PATH = savedPath;
      if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl;
      else delete process.env.DATABASE_URL;
    }
  });
});
