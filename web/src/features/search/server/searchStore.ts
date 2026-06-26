/**
 * Search store — Hanzo's canonical SQLite-backed document search store.
 *
 * One data layer, one way: indexed documents live in SQLite (Base/Hanzo store),
 * co-located with the console DB on the same durable PVC — NOT an external
 * managed search service. This mirrors the Vector store exactly (lazy singleton
 * connection, `projectId`-scoped rows, pure storage + ranking math here, a thin
 * tRPC router on top), so the two products are built the one same way.
 *
 * It is self-contained and dependency-free:
 *   - crawl  : Node's global `fetch` + a tiny HTML→text/links extractor.
 *   - rank   : a real lexical IR engine — BM25 for full-text/hybrid, a TF-IDF
 *              vector-space cosine for "vector" mode. No embedding service.
 *   - chat   : extractive RAG — grounded answers stitched from the best-matching
 *              passages in the project's own indexed documents, with sources.
 *
 * Uses Node's built-in `node:sqlite` (Node >= 22.5): no native module to
 * compile, nothing extra to ship in the image.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  type SearchIndex,
  type SearchResult,
  type SearchStats,
  type SearchApiKey,
  type SearchMode,
} from "../types";

// ── Connection (lazy singleton, HMR-safe) ─────────────────────────────

// Resolve the SQLite file from the environment (documented in env.mjs) so this
// module has no dependency on the app's env graph and stays trivially
// unit-testable. Resolution order mirrors the Vector store:
//   1. HANZO_SEARCH_DB_PATH — explicit override.
//   2. Co-locate next to the console's own SQLite DB (DATABASE_URL=file:…) so it
//      lands on the same durable PVC in prod with zero extra config.
//   3. <cwd>/data/search.db — local dev fallback.
export function resolveDbPath(): string {
  if (process.env.HANZO_SEARCH_DB_PATH) return process.env.HANZO_SEARCH_DB_PATH;
  const url = process.env.DATABASE_URL;
  if (url?.startsWith("file:")) {
    const appDb = path.resolve(url.slice("file:".length));
    return path.join(path.dirname(appDb), "search.db");
  }
  return path.join(process.cwd(), "data", "search.db");
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
    CREATE TABLE IF NOT EXISTS search_indexes (
      project_id      TEXT NOT NULL,
      name            TEXT NOT NULL,
      url             TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      last_indexed_at TEXT,
      PRIMARY KEY (project_id, name)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_documents (
      project_id TEXT NOT NULL,
      index_name TEXT NOT NULL,
      id         TEXT NOT NULL,
      url        TEXT NOT NULL,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, index_name, id),
      FOREIGN KEY (project_id, index_name)
        REFERENCES search_indexes (project_id, name) ON DELETE CASCADE
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_keys (
      project_id       TEXT PRIMARY KEY,
      publishable_key  TEXT NOT NULL,
      admin_key        TEXT NOT NULL,
      created_at       TEXT NOT NULL
    )
  `);
  // Aggregated daily counters power the stats panels (searches/sessions per day)
  // without storing every event — one row per (project, kind, day).
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_events (
      project_id TEXT    NOT NULL,
      kind       TEXT    NOT NULL,
      day        TEXT    NOT NULL,
      count      INTEGER NOT NULL,
      PRIMARY KEY (project_id, kind, day)
    )
  `);
  return db;
}

const globalForSearch = globalThis as unknown as {
  __hanzoSearchDb?: DatabaseSync;
};

function db(): DatabaseSync {
  if (!globalForSearch.__hanzoSearchDb) {
    globalForSearch.__hanzoSearchDb = init(resolveDbPath());
  }
  return globalForSearch.__hanzoSearchDb;
}

// ── Errors ────────────────────────────────────────────────────────────

export class SearchStoreError extends Error {
  constructor(
    public code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST",
    message: string,
  ) {
    super(message);
    this.name = "SearchStoreError";
  }
}

// ── Text / tokenization ───────────────────────────────────────────────

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "for",
  "is",
  "are",
  "was",
  "were",
  "be",
  "as",
  "at",
  "by",
  "it",
  "this",
  "that",
  "with",
  "from",
  "you",
  "your",
  "we",
  "our",
  "they",
  "their",
  "he",
  "she",
  "his",
  "her",
  "its",
  "can",
  "will",
  "if",
  "so",
  "no",
  "not",
  "do",
  "does",
]);

function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(/[a-z0-9]+/g)) {
    const t = m[0];
    if (t.length >= 2 && !STOPWORDS.has(t)) out.push(t);
  }
  return out;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, code: string) => {
    const key = code.toLowerCase();
    if (ENTITIES[key] !== undefined) return ENTITIES[key]!;
    if (key.startsWith("#x")) return cp(parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return cp(parseInt(key.slice(1), 10));
    return full;
  });
}
const cp = (n: number): string =>
  Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";

/** Strip a full HTML document down to { title, text } — no DOM, no deps. */
function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities(
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "",
  ).trim();
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  return { title, text };
}

/** Same-origin links discovered in an HTML page, normalized + de-duped. */
function extractLinks(html: string, base: URL): string[] {
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1]!, base);
      if (u.origin !== base.origin) continue;
      if (!/^https?:$/.test(u.protocol)) continue;
      u.hash = "";
      const key = u.toString();
      if (!seen.has(key)) seen.add(key);
    } catch {
      // skip malformed hrefs
    }
  }
  return [...seen];
}

/** Same-origin links with their anchor text — used by the scrape preview. */
function extractLinksWithText(
  html: string,
  base: URL,
): Array<{ url: string; title: string }> {
  const out: Array<{ url: string; title: string }> = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(
    /<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    try {
      const u = new URL(m[1]!, base);
      if (u.origin !== base.origin || !/^https?:$/.test(u.protocol)) continue;
      u.hash = "";
      const url = u.toString();
      if (seen.has(url)) continue;
      seen.add(url);
      const text = decodeEntities(m[2]!.replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
      out.push({ url, title: text || u.pathname || url });
    } catch {
      // skip malformed hrefs
    }
  }
  return out;
}

async function fetchPage(
  url: string,
  timeoutMs: number,
): Promise<{ html: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "HanzoSearchBot/1.0", Accept: "text/html" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html") && ct !== "") return null;
    return { html: await res.text() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type CrawledDoc = {
  id: string;
  url: string;
  title: string;
  content: string;
};

/**
 * Crawl `startUrl` breadth-first, same-origin only, into a bounded set of
 * documents. Bounded by `maxPages` and per-fetch `timeoutMs` so a `createIndex`
 * mutation always returns promptly. Returns the extracted documents (pure of
 * storage — the store persists them).
 */
export async function crawl(
  startUrl: string,
  opts: { maxPages?: number; timeoutMs?: number } = {},
): Promise<CrawledDoc[]> {
  const maxPages = opts.maxPages ?? 12;
  const timeoutMs = opts.timeoutMs ?? 7000;
  let start: URL;
  try {
    start = new URL(startUrl);
  } catch {
    throw new SearchStoreError("BAD_REQUEST", `Invalid URL: ${startUrl}`);
  }

  const queue: string[] = [start.toString()];
  const visited = new Set<string>();
  const docs: CrawledDoc[] = [];

  while (queue.length > 0 && docs.length < maxPages) {
    // Fetch up to `maxPages - docs.length` URLs from the frontier in parallel.
    const batch = queue.splice(0, Math.max(1, maxPages - docs.length));
    const fetched = await Promise.all(
      batch.map(async (u) => {
        if (visited.has(u)) return null;
        visited.add(u);
        const page = await fetchPage(u, timeoutMs);
        return page ? { url: u, html: page.html } : null;
      }),
    );
    for (const f of fetched) {
      if (!f) continue;
      const { title, text } = htmlToText(f.html);
      if (text.length > 0) {
        docs.push({
          id: f.url,
          url: f.url,
          title: title || f.url,
          content: text.slice(0, 200_000),
        });
      }
      if (docs.length >= maxPages) break;
      for (const link of extractLinks(f.html, start)) {
        if (!visited.has(link) && !queue.includes(link)) queue.push(link);
      }
    }
  }
  return docs;
}

/**
 * Preview what a crawl of `startUrl` would index: fetch the entry page and list
 * the same-origin pages discovered on it (with anchor text as title). Reads
 * nothing from / writes nothing to the store — a pure look-ahead.
 */
export async function preview(
  startUrl: string,
  opts: { max?: number; timeoutMs?: number } = {},
): Promise<{ pages: Array<{ url: string; title: string }> }> {
  let start: URL;
  try {
    start = new URL(startUrl);
  } catch {
    throw new SearchStoreError("BAD_REQUEST", `Invalid URL: ${startUrl}`);
  }
  const page = await fetchPage(start.toString(), opts.timeoutMs ?? 7000);
  if (!page) return { pages: [] };
  const { title } = htmlToText(page.html);
  const pages = [
    { url: start.toString(), title: title || start.toString() },
    ...extractLinksWithText(page.html, start).filter(
      (l) => l.url !== start.toString(),
    ),
  ].slice(0, opts.max ?? 25);
  return { pages };
}

// ── Ranking (BM25 + TF-IDF vector-space cosine) ───────────────────────

type DocRow = { id: string; url: string; title: string; content: string };

type Scored = {
  doc: DocRow;
  tokens: string[];
  tf: Map<string, number>;
  score: number;
};

const K1 = 1.5;
const B = 0.75;

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/** Rank `docs` against `query` using the requested IR model. Scores are
 * normalized to (0, 1] relative to the best match so the UI can show a %. */
function rank(
  docs: DocRow[],
  query: string,
  mode: SearchMode,
  limit: number,
): SearchResult[] {
  const qTerms = tokenize(query);
  if (qTerms.length === 0 || docs.length === 0) return [];
  const qSet = new Set(qTerms);

  // Corpus statistics for BM25 / IDF.
  const prepared = docs.map((doc) => {
    const titleTokens = tokenize(doc.title);
    const bodyTokens = tokenize(doc.content);
    // Hybrid weights the title by repeating its terms; full-text/vector use body.
    const tokens =
      mode === "hybrid"
        ? [...titleTokens, ...titleTokens, ...bodyTokens]
        : bodyTokens;
    return { doc, tokens, tf: termFreq(tokens), score: 0 } as Scored;
  });
  const N = prepared.length;
  const avgdl = prepared.reduce((s, p) => s + p.tokens.length, 0) / N || 1;
  const df = new Map<string, number>();
  for (const term of qSet) {
    let d = 0;
    for (const p of prepared) if (p.tf.has(term)) d++;
    df.set(term, d);
  }
  const idf = (term: string): number => {
    const d = df.get(term) ?? 0;
    return Math.log(1 + (N - d + 0.5) / (d + 0.5));
  };

  if (mode === "vector") {
    // Vector-space model: cosine between the query and each doc as TF-IDF
    // vectors over the query terms. A real (lexical) vector retrieval.
    const qVec = new Map<string, number>();
    for (const t of qTerms) qVec.set(t, (qVec.get(t) ?? 0) + 1);
    for (const [t, c] of qVec) qVec.set(t, c * idf(t));
    const qNorm =
      Math.sqrt([...qVec.values()].reduce((s, v) => s + v * v, 0)) || 1;
    for (const p of prepared) {
      let dot = 0;
      let dNorm = 0;
      for (const term of qSet) {
        const w = (p.tf.get(term) ?? 0) * idf(term);
        if (w === 0) continue;
        dot += w * (qVec.get(term) ?? 0);
        dNorm += w * w;
      }
      p.score = dot / (qNorm * (Math.sqrt(dNorm) || 1));
    }
  } else {
    // BM25 for full-text and hybrid.
    for (const p of prepared) {
      const dl = p.tokens.length;
      let s = 0;
      for (const term of qSet) {
        const tf = p.tf.get(term) ?? 0;
        if (tf === 0) continue;
        s +=
          idf(term) *
          ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (dl / avgdl))));
      }
      p.score = s;
    }
  }

  const hits = prepared
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);
  if (hits.length === 0) return [];
  const max = hits[0]!.score || 1;
  return hits.slice(0, limit).map((p) => ({
    title: p.doc.title || undefined,
    url: p.doc.url || undefined,
    content: p.doc.content.slice(0, 400),
    score: Math.min(1, p.score / max),
    highlights: highlight(p.doc.content, qSet),
  }));
}

/** Up to two best sentences from `content` containing the query terms. */
function highlight(content: string, qSet: Set<string>): string[] {
  const sentences = content.split(/(?<=[.!?])\s+/);
  const scored = sentences
    .map((s) => {
      const toks = tokenize(s);
      const hitCount = toks.filter((t) => qSet.has(t)).length;
      return { s: s.trim(), hitCount };
    })
    .filter((x) => x.hitCount > 0 && x.s.length > 0)
    .sort((a, b) => b.hitCount - a.hitCount);
  return scored
    .slice(0, 2)
    .map((x) => (x.s.length > 240 ? x.s.slice(0, 240) + "…" : x.s));
}

// ── Row mapping ───────────────────────────────────────────────────────

function toIndex(r: {
  name: string;
  created_at: string;
  last_indexed_at: string | null;
  doc_count: number;
}): SearchIndex {
  return {
    name: r.name,
    docCount: r.doc_count,
    lastIndexedAt: r.last_indexed_at,
    createdAt: r.created_at,
  };
}

const INDEX_SELECT = `
  SELECT i.name, i.created_at, i.last_indexed_at,
         COUNT(d.id) AS doc_count
  FROM search_indexes i
  LEFT JOIN search_documents d
    ON d.project_id = i.project_id AND d.index_name = i.name
  WHERE i.project_id = ?
`;

function genKey(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString("hex")}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Public API ────────────────────────────────────────────────────────

export const searchStore = {
  // ── Documents (pure: storage only, no network — testable) ───────────

  /** Replace an index's documents with `docs` (used by crawl + reindex). */
  putDocuments(input: {
    projectId: string;
    indexName: string;
    docs: CrawledDoc[];
  }): { count: number } {
    const conn = db();
    const del = conn.prepare(
      "DELETE FROM search_documents WHERE project_id = ? AND index_name = ?",
    );
    const ins = conn.prepare(
      `INSERT INTO search_documents (project_id, index_name, id, url, title, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, index_name, id)
       DO UPDATE SET url = excluded.url, title = excluded.title, content = excluded.content`,
    );
    const now = new Date().toISOString();
    conn.exec("BEGIN");
    try {
      // Ensure the index row exists so the FK holds even if documents are put
      // before a crawl registers it (real createIndex registers it first; this
      // keeps the storage layer self-contained). Never clobbers an existing url.
      conn
        .prepare(
          `INSERT OR IGNORE INTO search_indexes (project_id, name, url, created_at)
           VALUES (?, ?, '', ?)`,
        )
        .run(input.projectId, input.indexName, now);
      del.run(input.projectId, input.indexName);
      for (const d of input.docs) {
        ins.run(
          input.projectId,
          input.indexName,
          d.id,
          d.url,
          d.title,
          d.content,
          now,
        );
      }
      conn
        .prepare(
          "UPDATE search_indexes SET last_indexed_at = ? WHERE project_id = ? AND name = ?",
        )
        .run(now, input.projectId, input.indexName);
      conn.exec("COMMIT");
    } catch (e) {
      conn.exec("ROLLBACK");
      throw e;
    }
    return { count: input.docs.length };
  },

  // ── Indexes ─────────────────────────────────────────────────────────

  listIndexes(projectId: string): SearchIndex[] {
    const rows = db()
      .prepare(`${INDEX_SELECT} GROUP BY i.name ORDER BY i.created_at DESC`)
      .all(projectId) as unknown as Array<Parameters<typeof toIndex>[0]>;
    return rows.map(toIndex);
  },

  getIndex(projectId: string, name: string): SearchIndex | null {
    const row = db()
      .prepare(`${INDEX_SELECT} AND i.name = ? GROUP BY i.name`)
      .get(projectId, name) as unknown as
      | Parameters<typeof toIndex>[0]
      | undefined;
    return row ? toIndex(row) : null;
  },

  /** Create an index and crawl `url` into it. Throws CONFLICT if it exists. */
  async createIndex(input: {
    projectId: string;
    storeName: string;
    url: string;
  }): Promise<{ index: SearchIndex }> {
    const exists = db()
      .prepare("SELECT 1 FROM search_indexes WHERE project_id = ? AND name = ?")
      .get(input.projectId, input.storeName);
    if (exists) {
      throw new SearchStoreError(
        "CONFLICT",
        `Index "${input.storeName}" already exists`,
      );
    }
    db()
      .prepare(
        `INSERT INTO search_indexes (project_id, name, url, created_at, last_indexed_at)
         VALUES (?, ?, ?, ?, NULL)`,
      )
      .run(
        input.projectId,
        input.storeName,
        input.url,
        new Date().toISOString(),
      );

    const docs = await crawl(input.url);
    this.putDocuments({
      projectId: input.projectId,
      indexName: input.storeName,
      docs,
    });
    const index = this.getIndex(input.projectId, input.storeName);
    if (!index)
      throw new SearchStoreError("NOT_FOUND", "Index vanished after create");
    return { index };
  },

  /** Re-crawl an existing index's source URL. */
  async reindex(input: {
    projectId: string;
    storeName: string;
  }): Promise<{ success: boolean }> {
    const row = db()
      .prepare(
        "SELECT url FROM search_indexes WHERE project_id = ? AND name = ?",
      )
      .get(input.projectId, input.storeName) as { url: string } | undefined;
    if (!row)
      throw new SearchStoreError(
        "NOT_FOUND",
        `Index "${input.storeName}" not found`,
      );
    const docs = await crawl(row.url);
    this.putDocuments({
      projectId: input.projectId,
      indexName: input.storeName,
      docs,
    });
    return { success: true };
  },

  deleteIndex(projectId: string, storeName: string): { success: boolean } {
    const res = db()
      .prepare("DELETE FROM search_indexes WHERE project_id = ? AND name = ?")
      .run(projectId, storeName);
    if (res.changes === 0) {
      throw new SearchStoreError("NOT_FOUND", `Index "${storeName}" not found`);
    }
    return { success: true };
  },

  // ── Query / Chat ────────────────────────────────────────────────────

  /** Lexical search across all of a project's indexed documents. */
  query(input: {
    projectId: string;
    query: string;
    mode: SearchMode;
    limit: number;
  }): { results: SearchResult[] } {
    const docs = db()
      .prepare(
        "SELECT id, url, title, content FROM search_documents WHERE project_id = ?",
      )
      .all(input.projectId) as unknown as DocRow[];
    const results = rank(docs, input.query, input.mode, input.limit);
    this.recordEvent(input.projectId, "search");
    return { results };
  },

  /** Extractive RAG: a grounded answer stitched from the best matching
   * passages in the project's own documents, plus the contributing sources. */
  chat(input: { projectId: string; query: string }): {
    response: string;
    sources: Array<{ url: string; title: string }>;
  } {
    const docs = db()
      .prepare(
        "SELECT id, url, title, content FROM search_documents WHERE project_id = ?",
      )
      .all(input.projectId) as unknown as DocRow[];
    const top = rank(docs, input.query, "hybrid", 4);
    this.recordEvent(input.projectId, "session");
    if (top.length === 0) {
      return {
        response:
          "I couldn't find anything about that in your indexed documents. Try indexing the relevant site, or rephrase the question.",
        sources: [],
      };
    }
    const passages = top
      .flatMap((r) =>
        r.highlights && r.highlights.length ? r.highlights : [r.content],
      )
      .slice(0, 4);
    const response = `Based on your indexed documents:\n\n${passages
      .map((p) => `• ${p}`)
      .join("\n")}`;
    const sources: Array<{ url: string; title: string }> = [];
    const seen = new Set<string>();
    for (const r of top) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      sources.push({ url: r.url, title: r.title ?? r.url });
    }
    return { response, sources };
  },

  // ── API keys ────────────────────────────────────────────────────────

  /** Get (lazily creating) the project's publishable + admin search keys. */
  getKeys(projectId: string): SearchApiKey {
    const row = db()
      .prepare(
        "SELECT publishable_key, admin_key FROM search_keys WHERE project_id = ?",
      )
      .get(projectId) as
      | { publishable_key: string; admin_key: string }
      | undefined;
    if (row) {
      return { publishableKey: row.publishable_key, adminKey: row.admin_key };
    }
    const keys: SearchApiKey = {
      publishableKey: genKey("pk"),
      adminKey: genKey("sk"),
    };
    db()
      .prepare(
        `INSERT INTO search_keys (project_id, publishable_key, admin_key, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (project_id) DO NOTHING`,
      )
      .run(
        projectId,
        keys.publishableKey,
        keys.adminKey,
        new Date().toISOString(),
      );
    return this.getKeys(projectId);
  },

  /** Rotate one of the project's keys. */
  regenerateKey(input: {
    projectId: string;
    keyType: "publishable" | "admin";
  }): SearchApiKey {
    this.getKeys(input.projectId); // ensure a row exists
    const column =
      input.keyType === "publishable" ? "publishable_key" : "admin_key";
    const value = genKey(input.keyType === "publishable" ? "pk" : "sk");
    db()
      .prepare(`UPDATE search_keys SET ${column} = ? WHERE project_id = ?`)
      .run(value, input.projectId);
    return this.getKeys(input.projectId);
  },

  // ── Stats ───────────────────────────────────────────────────────────

  recordEvent(projectId: string, kind: "search" | "session"): void {
    db()
      .prepare(
        `INSERT INTO search_events (project_id, kind, day, count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT (project_id, kind, day) DO UPDATE SET count = count + 1`,
      )
      .run(projectId, kind, today());
  },

  stats(projectId: string): SearchStats {
    const docs = db()
      .prepare(
        "SELECT COUNT(*) AS n FROM search_documents WHERE project_id = ?",
      )
      .get(projectId) as { n: number };
    const totals = db()
      .prepare(
        "SELECT kind, SUM(count) AS n FROM search_events WHERE project_id = ? GROUP BY kind",
      )
      .all(projectId) as unknown as Array<{ kind: string; n: number }>;
    const byKind = new Map(totals.map((t) => [t.kind, t.n]));
    const perDay = db()
      .prepare(
        `SELECT day, SUM(count) AS n FROM search_events
         WHERE project_id = ? AND kind = 'search'
         GROUP BY day ORDER BY day DESC LIMIT 30`,
      )
      .all(projectId) as unknown as Array<{ day: string; n: number }>;
    return {
      totalDocuments: docs.n,
      totalSearches: byKind.get("search") ?? 0,
      totalSessions: byKind.get("session") ?? 0,
      searchesPerDay: perDay
        .map((r) => ({ date: r.day, count: r.n }))
        .reverse(),
    };
  },
};
