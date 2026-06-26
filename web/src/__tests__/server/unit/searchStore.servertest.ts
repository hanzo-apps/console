/**
 * Unit tests for the SQLite-backed Search store. Pure: no Postgres/Clickhouse,
 * no external services, no network — just node:sqlite over a throwaway temp
 * file. The crawler (network) is exercised separately; here we put documents
 * directly and assert the storage + IR ranking + keys + stats behaviour.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

// Point the store at a fresh temp DB BEFORE importing it (the path is read at
// first use). A nested, not-yet-existing dir also exercises mkdir-recursive.
const tmp = mkdtempSync(path.join(tmpdir(), "hanzo-search-"));
process.env.HANZO_SEARCH_DB_PATH = path.join(tmp, "nested", "search.db");

/* eslint-disable @typescript-eslint/consistent-type-imports */
let store: typeof import("@/src/features/search/server/searchStore").searchStore;
let StoreError: typeof import("@/src/features/search/server/searchStore").SearchStoreError;
let resolveDbPath: typeof import("@/src/features/search/server/searchStore").resolveDbPath;
/* eslint-enable @typescript-eslint/consistent-type-imports */

const P = "proj-test";

beforeAll(async () => {
  const mod = await import("@/src/features/search/server/searchStore");
  store = mod.searchStore;
  StoreError = mod.SearchStoreError;
  resolveDbPath = mod.resolveDbPath;
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const docs = [
  {
    id: "https://docs.example.com/vector",
    url: "https://docs.example.com/vector",
    title: "Vector search guide",
    content:
      "The vector store performs nearest neighbour search over embeddings. Cosine similarity ranks the closest vectors first.",
  },
  {
    id: "https://docs.example.com/billing",
    url: "https://docs.example.com/billing",
    title: "Billing and invoices",
    content:
      "Billing covers balance, usage and invoices. Payment is collected monthly. Nothing here mentions search at all.",
  },
  {
    id: "https://docs.example.com/search",
    url: "https://docs.example.com/search",
    title: "Full text search",
    content:
      "Full text search indexes documents and ranks them with BM25. Hybrid search blends keyword and vector retrieval.",
  },
];

describe("searchStore", () => {
  it("puts documents into an index and lists it with a doc count", () => {
    const res = store.putDocuments({ projectId: P, indexName: "docs", docs });
    expect(res.count).toBe(3);

    const list = store.listIndexes(P);
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("docs");
    expect(list[0]!.docCount).toBe(3);
    expect(list[0]!.lastIndexedAt).not.toBeNull();
  });

  it("putDocuments replaces (re-index), never duplicates", () => {
    store.putDocuments({ projectId: P, indexName: "docs", docs });
    expect(store.listIndexes(P)[0]!.docCount).toBe(3);
  });

  it("full-text query ranks the most relevant document first", () => {
    const { results } = store.query({
      projectId: P,
      query: "vector nearest neighbour search",
      mode: "fulltext",
      limit: 10,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.url).toBe("https://docs.example.com/vector");
    // Scores are normalized into (0, 1].
    expect(results[0]!.score).toBeGreaterThan(0);
    expect(results[0]!.score).toBeLessThanOrEqual(1);
    expect(results[0]!.score).toBeGreaterThanOrEqual(
      results[results.length - 1]!.score,
    );
  });

  it("vector-space (cosine) mode also retrieves and ranks", () => {
    const { results } = store.query({
      projectId: P,
      query: "bm25 keyword retrieval",
      mode: "vector",
      limit: 10,
    });
    expect(results[0]!.url).toBe("https://docs.example.com/search");
  });

  it("returns highlights containing the query terms", () => {
    const { results } = store.query({
      projectId: P,
      query: "invoices",
      mode: "hybrid",
      limit: 5,
    });
    expect(results[0]!.url).toBe("https://docs.example.com/billing");
    expect(results[0]!.highlights?.join(" ").toLowerCase()).toContain(
      "invoices",
    );
  });

  it("query with no lexical overlap returns no results (honest empty)", () => {
    const { results } = store.query({
      projectId: P,
      query: "kubernetes helm chart",
      mode: "hybrid",
      limit: 5,
    });
    expect(results).toHaveLength(0);
  });

  it("chat returns a grounded answer with sources from the indexed docs", () => {
    const { response, sources } = store.chat({
      projectId: P,
      query: "how does vector search rank results",
    });
    expect(response.toLowerCase()).toContain("vector");
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0]!.url).toContain("https://docs.example.com");
  });

  it("chat is honest when nothing matches", () => {
    const { response, sources } = store.chat({
      projectId: P,
      query: "terraform provider azure",
    });
    expect(sources).toHaveLength(0);
    expect(response.toLowerCase()).toContain("couldn't find");
  });

  it("lazily mints stable per-project keys and rotates on demand", () => {
    const k1 = store.getKeys(P);
    expect(k1.publishableKey).toMatch(/^pk_/);
    expect(k1.adminKey).toMatch(/^sk_/);
    // Stable across reads.
    expect(store.getKeys(P)).toEqual(k1);
    // Rotate only the requested key.
    const k2 = store.regenerateKey({ projectId: P, keyType: "admin" });
    expect(k2.publishableKey).toBe(k1.publishableKey);
    expect(k2.adminKey).not.toBe(k1.adminKey);
  });

  it("reflects documents and recorded events in stats", () => {
    const stats = store.stats(P);
    expect(stats.totalDocuments).toBe(3);
    // The queries + chats above recorded search/session events for today.
    expect(stats.totalSearches).toBeGreaterThan(0);
    expect(stats.totalSessions).toBeGreaterThan(0);
    expect(stats.searchesPerDay.length).toBeGreaterThan(0);
  });

  it("isolates indexes and documents by projectId", () => {
    expect(store.listIndexes("other-proj")).toHaveLength(0);
    expect(
      store.query({
        projectId: "other-proj",
        query: "vector",
        mode: "hybrid",
        limit: 5,
      }).results,
    ).toHaveLength(0);
    expect(store.stats("other-proj").totalDocuments).toBe(0);
  });

  it("deletes an index and cascades its documents", () => {
    store.deleteIndex(P, "docs");
    expect(store.getIndex(P, "docs")).toBeNull();
    expect(store.stats(P).totalDocuments).toBe(0);
    expect(() => store.deleteIndex(P, "docs")).toThrow(/not found/i);
  });

  it("surfaces a CONFLICT-typed error class for the router to map", () => {
    const e = new StoreError("CONFLICT", "exists");
    expect(e).toBeInstanceOf(StoreError);
    expect(e.code).toBe("CONFLICT");
  });
});

describe("resolveDbPath", () => {
  it("honors an explicit HANZO_SEARCH_DB_PATH override", () => {
    expect(resolveDbPath()).toBe(process.env.HANZO_SEARCH_DB_PATH);
  });

  it("co-locates next to a file: DATABASE_URL when no override is set", () => {
    const savedPath = process.env.HANZO_SEARCH_DB_PATH;
    const savedUrl = process.env.DATABASE_URL;
    try {
      delete process.env.HANZO_SEARCH_DB_PATH;
      process.env.DATABASE_URL = "file:/var/lib/hanzo/console/app.db";
      expect(resolveDbPath()).toBe("/var/lib/hanzo/console/search.db");
    } finally {
      if (savedPath !== undefined) process.env.HANZO_SEARCH_DB_PATH = savedPath;
      if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl;
      else delete process.env.DATABASE_URL;
    }
  });
});
