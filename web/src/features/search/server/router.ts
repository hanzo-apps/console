import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import { searchStore, preview, SearchStoreError } from "./searchStore";
import {
  CreateIndexInput,
  DeleteIndexInput,
  ReindexInput,
  SearchQueryInput,
  ChatQueryInput,
  ScrapePreviewInput,
  RegenerateKeyInput,
} from "../types";

/** Map the store's domain errors onto tRPC codes (mirrors the Vector router). */
function toTRPC(e: unknown): never {
  if (e instanceof SearchStoreError) {
    throw new TRPCError({ code: e.code, message: e.message });
  }
  throw e;
}

export const searchRouter = createTRPCRouter({
  // ── Stats ─────────────────────────────────────────────────────────

  stats: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ input }) => searchStore.stats(input.projectId)),

  // ── Indexes ───────────────────────────────────────────────────────

  listIndexes: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ input }) => ({
      indexes: searchStore.listIndexes(input.projectId),
    })),

  createIndex: protectedProjectProcedure
    .input(CreateIndexInput)
    .mutation(async ({ input }) => {
      try {
        return await searchStore.createIndex(input);
      } catch (e) {
        return toTRPC(e);
      }
    }),

  deleteIndex: protectedProjectProcedure
    .input(DeleteIndexInput)
    .mutation(({ input }) => {
      try {
        return searchStore.deleteIndex(input.projectId, input.storeName);
      } catch (e) {
        return toTRPC(e);
      }
    }),

  reindex: protectedProjectProcedure
    .input(ReindexInput)
    .mutation(async ({ input }) => {
      try {
        return await searchStore.reindex(input);
      } catch (e) {
        return toTRPC(e);
      }
    }),

  // ── Search ────────────────────────────────────────────────────────

  query: protectedProjectProcedure
    .input(SearchQueryInput)
    .query(({ input }) => {
      try {
        return searchStore.query(input);
      } catch (e) {
        return toTRPC(e);
      }
    }),

  // ── Chat (RAG) ────────────────────────────────────────────────────

  chat: protectedProjectProcedure
    .input(ChatQueryInput)
    .mutation(({ input }) => {
      try {
        return searchStore.chat(input);
      } catch (e) {
        return toTRPC(e);
      }
    }),

  // ── API Keys ──────────────────────────────────────────────────────

  getKeys: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ input }) => searchStore.getKeys(input.projectId)),

  regenerateKey: protectedProjectProcedure
    .input(RegenerateKeyInput)
    .mutation(({ input }) => {
      try {
        return searchStore.regenerateKey(input);
      } catch (e) {
        return toTRPC(e);
      }
    }),

  // ── Scrape Preview ────────────────────────────────────────────────

  scrapePreview: protectedProjectProcedure
    .input(ScrapePreviewInput)
    .mutation(async ({ input }) => {
      try {
        return await preview(input.url);
      } catch (e) {
        return toTRPC(e);
      }
    }),
});
