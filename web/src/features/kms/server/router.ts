import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { throwIfNoProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import {
  createTRPCRouter,
  protectedProjectProcedure,
  type ProjectAuthedContext,
} from "@/src/server/api/trpc";
import { env } from "@/src/env.mjs";
import { kmsGet, kmsPost, kmsPatch, kmsDelete } from "./kmsClient";
import {
  listOrgSecrets,
  putOrgSecret,
  deleteOrgSecret,
} from "./secretsAdapter";
import {
  CreateKmsSecretInput,
  UpdateKmsSecretInput,
  DeleteKmsSecretInput,
  CreateKmsKeyInput,
  UpdateKmsKeyInput,
  DeleteKmsKeyInput,
  EncryptInput,
  DecryptInput,
  type KmsSecret,
} from "../types";

/**
 * The `:org` path segment for the unified Hanzo Cloud KMS secrets surface
 * (`/v1/kms/orgs/:org/secrets`) is simply the console's CURRENT org. The cloud
 * guard namespaces every record under /orgs/:org and enforces the caller may
 * only touch its own org (or any org for a global admin); the console's service
 * bearer carries that identity, and this org — already membership-checked by
 * protectedProjectProcedure — selects the tenant namespace. One source of truth
 * for tenancy: the session's validated org.
 */
function resolveKmsOrg(ctx: {
  session: ProjectAuthedContext["session"];
}): string {
  return ctx.session.orgId;
}

/**
 * LEGACY (Infisical). Resolve the KMS workspace/project ID for the current org,
 * used only by the CMEK encryption-keys + environments surfaces that the unified
 * KMS does not yet expose (see the Encryption Keys / Environments sections).
 *
 * Multi-tenant: each org can store its own KMS project ID in
 * Organization.metadata.kmsProjectId.  Falls back to the global
 * KMS_PROJECT_ID env var (used in dev / single-tenant deploys).
 */
function resolveKmsProjectId(ctx: {
  session: ProjectAuthedContext["session"];
}): string {
  // 1. Try org-specific KMS project from session metadata
  const org = ctx.session.user.organizations.find(
    (o) => o.id === ctx.session.orgId,
  );
  const orgKmsId =
    org?.metadata && typeof org.metadata === "object"
      ? (org.metadata as Record<string, unknown>).kmsProjectId
      : undefined;
  if (typeof orgKmsId === "string" && orgKmsId.length > 0) {
    return orgKmsId;
  }

  // 2. Fall back to global env var (dev / single-tenant)
  const globalId = env.KMS_PROJECT_ID;
  if (globalId) {
    return globalId;
  }

  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "KMS is not configured for this organization. " +
      "Set kmsProjectId in org metadata or KMS_PROJECT_ID env var.",
  });
}

export const kmsRouter = createTRPCRouter({
  // ── Secrets (unified Hanzo Cloud KMS: /v1/kms/orgs/:org/secrets) ──
  //
  // Backed by the embedded luxfi/kms SecretStore via cloud/clients/kmssvc, NOT
  // the legacy Infisical /v3/secrets API. Shape mapping + transport live in ONE
  // place — ./secretsAdapter — so these procedures only carry authz + the org
  // namespace; create and update are the same upsert on the unified store.

  listSecrets: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        environment: z.string(),
        secretPath: z.string().default("/"),
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "kmsSecrets:read",
      });

      try {
        return await listOrgSecrets(
          resolveKmsOrg(ctx),
          input.environment,
          input.secretPath,
        );
      } catch {
        // KMS not configured for this org / unreachable → honest empty state.
        return { secrets: [] as KmsSecret[] };
      }
    }),

  createSecret: protectedProjectProcedure
    .input(CreateKmsSecretInput)
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "kmsSecrets:CUD",
      });

      await putOrgSecret(
        resolveKmsOrg(ctx),
        input.environment,
        input.secretPath,
        input.secretName,
        input.secretValue,
      );
      return { stored: true };
    }),

  updateSecret: protectedProjectProcedure
    .input(UpdateKmsSecretInput)
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "kmsSecrets:CUD",
      });

      await putOrgSecret(
        resolveKmsOrg(ctx),
        input.environment,
        input.secretPath,
        input.secretName,
        input.secretValue,
      );
      return { stored: true };
    }),

  deleteSecret: protectedProjectProcedure
    .input(DeleteKmsSecretInput)
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "kmsSecrets:CUD",
      });

      await deleteOrgSecret(
        resolveKmsOrg(ctx),
        input.environment,
        input.secretPath,
        input.secretName,
      );
      return { deleted: true };
    }),

  // ── Environments ─────────────────────────────────────────────────
  //
  // LEGACY (Infisical /api/v1/workspace/.../environments). The unified KMS
  // models an env as a free-form label on each secret (no environment registry
  // to enumerate), so there is no unified endpoint to migrate this to. Left on
  // the legacy path; degrades to an empty list (the SecretsTable then offers the
  // dev/staging/prod defaults). Revisit if/when the unified KMS grows an env
  // registry.

  listEnvironments: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "kmsSecrets:read",
      });

      try {
        return await kmsGet<{ environments: unknown[] }>(
          `/api/v1/workspace/${resolveKmsProjectId(ctx)}/environments`,
        );
      } catch {
        return { environments: [] as unknown[] };
      }
    }),

  // ── Encryption Keys (CMEK) ──────────────────────────────────────
  //
  // LEGACY (Infisical /api/v1/kms/keys + /encrypt + /decrypt). The unified
  // Hanzo Cloud KMS exposes only org-scoped SECRETS today (list/read/upsert/
  // delete); it does not yet expose customer-managed encryption keys or the
  // encrypt/decrypt oracle. Left on the legacy path unchanged; reads degrade to
  // an empty list. Migrate once the unified KMS surfaces a CMEK API.

  listKeys: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "kmsKeys:read",
      });

      try {
        return await kmsGet<{ keys: unknown[] }>("/api/v1/kms/keys", {
          projectId: resolveKmsProjectId(ctx),
        });
      } catch {
        return { keys: [] as unknown[] };
      }
    }),

  createKey: protectedProjectProcedure
    .input(CreateKmsKeyInput)
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "kmsKeys:CUD",
      });

      return kmsPost("/api/v1/kms/keys", {
        projectId: resolveKmsProjectId(ctx),
        name: input.name,
        description: input.description,
        encryptionAlgorithm: input.encryptionAlgorithm,
        keyUsage: input.keyUsage,
      });
    }),

  updateKey: protectedProjectProcedure
    .input(UpdateKmsKeyInput)
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "kmsKeys:CUD",
      });

      return kmsPatch(`/api/v1/kms/keys/${encodeURIComponent(input.keyId)}`, {
        name: input.name,
        description: input.description,
        isDisabled: input.isDisabled,
      });
    }),

  deleteKey: protectedProjectProcedure
    .input(DeleteKmsKeyInput)
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "kmsKeys:CUD",
      });

      return kmsDelete(`/api/v1/kms/keys/${encodeURIComponent(input.keyId)}`);
    }),

  encrypt: protectedProjectProcedure
    .input(EncryptInput)
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "kmsKeys:read",
      });

      return kmsPost<{ ciphertext: string }>(
        `/api/v1/kms/keys/${encodeURIComponent(input.keyId)}/encrypt`,
        { plaintext: input.plaintext },
      );
    }),

  decrypt: protectedProjectProcedure
    .input(DecryptInput)
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "kmsKeys:read",
      });

      return kmsPost<{ plaintext: string }>(
        `/api/v1/kms/keys/${encodeURIComponent(input.keyId)}/decrypt`,
        { ciphertext: input.ciphertext },
      );
    }),
});
