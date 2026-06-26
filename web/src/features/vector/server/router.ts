import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import { vectorStore, VectorStoreError } from "./vectorStore";
import {
  CreateCollectionInput,
  DeleteCollectionInput,
  UpsertVectorsInput,
  VectorSearchInput,
} from "../types";

/** Map the store's domain errors onto tRPC codes. */
function toTRPC(e: unknown): never {
  if (e instanceof VectorStoreError) {
    throw new TRPCError({ code: e.code, message: e.message });
  }
  throw e;
}

export const vectorRouter = createTRPCRouter({
  // ── Stats ─────────────────────────────────────────────────────────

  stats: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ input }) => vectorStore.stats(input.projectId)),

  // ── Collections ───────────────────────────────────────────────────

  listCollections: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ input }) => ({
      collections: vectorStore.listCollections(input.projectId),
    })),

  createCollection: protectedProjectProcedure
    .input(CreateCollectionInput)
    .mutation(({ input }) => {
      try {
        return { collection: vectorStore.createCollection(input) };
      } catch (e) {
        return toTRPC(e);
      }
    }),

  deleteCollection: protectedProjectProcedure
    .input(DeleteCollectionInput)
    .mutation(({ input }) => {
      try {
        return vectorStore.deleteCollection(input.projectId, input.name);
      } catch (e) {
        return toTRPC(e);
      }
    }),

  // ── Vectors ───────────────────────────────────────────────────────

  upsert: protectedProjectProcedure
    .input(UpsertVectorsInput)
    .mutation(({ input }) => {
      try {
        return vectorStore.upsert(input);
      } catch (e) {
        return toTRPC(e);
      }
    }),

  search: protectedProjectProcedure
    .input(VectorSearchInput)
    .query(({ input }) => {
      try {
        return { results: vectorStore.search(input) };
      } catch (e) {
        return toTRPC(e);
      }
    }),
});
