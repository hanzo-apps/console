import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";
import { withMiddlewares } from "@/src/features/public-api/server/withMiddlewares";
import { env } from "@/src/env.mjs";
import { prisma } from "@hanzo/console/src/db";
import { redis } from "@hanzo/console/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";
import { hasEntitlementBasedOnPlan } from "@/src/features/entitlements/server/hasEntitlement";
import {
  CreateBlobStorageIntegrationRequest,
  toInternalExportSource,
  toPublicExportSource,
  type BlobStorageIntegrationResponseType,
} from "@/src/features/public-api/types/blob-storage-integrations";
import {
  ConsoleNotFoundError,
  UnauthorizedError,
  ForbiddenError,
} from "@hanzo/console";
import { encrypt } from "@hanzo/console/encryption";
import { assertLegacyBlobExportSourceAllowed } from "@/src/features/blobstorage-integration/server/assertLegacyBlobExportSourceAllowed";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { upsertBlobStorageIntegration } from "@/src/features/blobstorage-integration/service";
import {
  AnalyticsIntegrationExportSource,
  ObservationFieldGroupFull,
  isLegacyBlobExportAllowed,
} from "@hanzo/console";

export default withMiddlewares({
  GET: handleGetBlobStorageIntegrations,
  PUT: handleUpsertBlobStorageIntegration,
});

async function handleGetBlobStorageIntegrations(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // CHECK AUTH
  const authCheck = await new ApiAuthService(
    prisma,
    redis,
  ).verifyAuthHeaderAndReturnScope(req.headers.authorization);
  if (!authCheck.validKey) {
    throw new UnauthorizedError(authCheck.error ?? "Unauthorized");
  }

  // Check if using an organization API key
  if (
    authCheck.scope.accessLevel !== "organization" ||
    !authCheck.scope.orgId
  ) {
    throw new ForbiddenError(
      "Organization-scoped API key required for this operation.",
    );
  }

  // Check scheduled-blob-exports entitlement
  if (
    !hasEntitlementBasedOnPlan({
      plan: authCheck.scope.plan,
      entitlement: "scheduled-blob-exports",
    })
  ) {
    throw new ForbiddenError(
      "scheduled-blob-exports entitlement required for this feature.",
    );
  }

  // Get all projects for the organization
  const projects = await prisma.project.findMany({
    where: { orgId: authCheck.scope.orgId },
    select: { id: true },
  });

  // Get all blob storage integrations for these projects
  const integrations = await prisma.blobStorageIntegration.findMany({
    where: {
      projectId: { in: projects.map((p) => p.id) },
    },
  });

  // Transform to API response format, exclude secretAccessKey
  const responseData: BlobStorageIntegrationResponseType[] = integrations.map(
    (integration) => ({
      id: integration.projectId, // Using projectId as ID since it's the primary key
      projectId: integration.projectId,
      type: integration.type,
      bucketName: integration.bucketName,
      endpoint: integration.endpoint,
      region: integration.region,
      accessKeyId: integration.accessKeyId,
      prefix: integration.prefix,
      exportFrequency: integration.exportFrequency,
      enabled: integration.enabled,
      forcePathStyle: integration.forcePathStyle,
      fileType: integration.fileType,
      exportMode: integration.exportMode,
      exportStartDate: integration.exportStartDate,
      nextSyncAt: integration.nextSyncAt,
      lastSyncAt: integration.lastSyncAt,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    }),
  );

  return res.status(200).json({
    data: responseData,
  });
}

async function handleUpsertBlobStorageIntegration(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // CHECK AUTH
  const authCheck = await new ApiAuthService(
    prisma,
    redis,
  ).verifyAuthHeaderAndReturnScope(req.headers.authorization);
  if (!authCheck.validKey) {
    throw new UnauthorizedError(authCheck.error ?? "Unauthorized");
  }

  // Check if using an organization API key
  if (
    authCheck.scope.accessLevel !== "organization" ||
    !authCheck.scope.orgId
  ) {
    throw new ForbiddenError(
      "Organization-scoped API key required for this operation.",
    );
  }

  // Check scheduled-blob-exports entitlement
  if (
    !hasEntitlementBasedOnPlan({
      plan: authCheck.scope.plan,
      entitlement: "scheduled-blob-exports",
    })
  ) {
    throw new ForbiddenError(
      "scheduled-blob-exports entitlement required for this feature.",
    );
  }

  // Validate request body
  const validatedData = CreateBlobStorageIntegrationRequest.parse(req.body);

  const isCloud = Boolean(env.NEXT_PUBLIC_HANZO_CLOUD_REGION);

  // Check if the project exists and belongs to the organization
  const project = await prisma.project.findUnique({
    where: { id: validatedData.projectId },
    select: { id: true, orgId: true, createdAt: true },
  });
  if (!project || project.orgId !== authCheck.scope.orgId) {
    throw new ConsoleNotFoundError("Project not found");
  }

  // Prepare data for database
  const dbData = {
    projectId: validatedData.projectId,
    type: validatedData.type,
    bucketName: validatedData.bucketName,
    endpoint: validatedData.endpoint || null,
    region: validatedData.region,
    accessKeyId: validatedData.accessKeyId || null,
    secretAccessKey: validatedData.secretAccessKey
      ? encrypt(validatedData.secretAccessKey)
      : null,
    prefix: validatedData.prefix,
    exportFrequency: validatedData.exportFrequency,
    enabled: validatedData.enabled,
    forcePathStyle: validatedData.forcePathStyle,
    fileType: validatedData.fileType,
    exportMode: validatedData.exportMode,
    exportStartDate: validatedData.exportStartDate || null,
  };

  if (validatedData.exportSource) {
    assertLegacyBlobExportSourceAllowed({
      project,
      nextInternalExportSource: toInternalExportSource(
        validatedData.exportSource,
      ),
      isCloud,
    });
  }

  await auditLog({
    action: "update",
    resourceType: "blobStorageIntegration",
    resourceId: validatedData.projectId,
    apiKeyId: authCheck.scope.apiKeyId,
    orgId: authCheck.scope.orgId,
  });

  const integration = await upsertBlobStorageIntegration({
    prisma,
    projectId: validatedData.projectId,
    // When exportSource is absent and the project is post-cutoff Cloud, have
    // the service substitute EVENTS on CREATE inside its own transaction —
    // eliminating the TOCTOU window that a pre-flight findUnique would create.
    forceEventsOnCreate:
      validatedData.exportSource == null &&
      !isLegacyBlobExportAllowed(project.createdAt, isCloud),
    data: {
      type: validatedData.type,
      bucketName: validatedData.bucketName,
      endpoint: validatedData.endpoint || null,
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId || null,
      secretAccessKey: validatedData.secretAccessKey ?? null,
      prefix: validatedData.prefix,
      exportFrequency: validatedData.exportFrequency,
      enabled: validatedData.enabled,
      forcePathStyle: validatedData.forcePathStyle,
      fileType: validatedData.fileType,
      exportMode: validatedData.exportMode,
      exportStartDate: validatedData.exportStartDate ?? null,
      compressed: validatedData.compressed,
      exportSource:
        validatedData.exportSource != null
          ? toInternalExportSource(validatedData.exportSource)
          : undefined,
      exportFieldGroups: validatedData.exportFieldGroups ?? undefined,
    },
  });

  // Transform to API response format, exclude secretAccessKey
  const responseData: BlobStorageIntegrationResponseType = {
    id: integration.projectId, // Using projectId as ID since it's the primary key
    projectId: integration.projectId,
    type: integration.type,
    bucketName: integration.bucketName,
    endpoint: integration.endpoint,
    region: integration.region,
    accessKeyId: integration.accessKeyId,
    prefix: integration.prefix,
    exportFrequency: integration.exportFrequency,
    enabled: integration.enabled,
    forcePathStyle: integration.forcePathStyle,
    fileType: integration.fileType,
    exportMode: integration.exportMode,
    exportStartDate: integration.exportStartDate,
    compressed: integration.compressed,
    exportSource: toPublicExportSource(integration.exportSource),
    exportFieldGroups:
      integration.exportSource ===
      AnalyticsIntegrationExportSource.TRACES_OBSERVATIONS
        ? null
        : (integration.exportFieldGroups as ObservationFieldGroupFull[]),
    nextSyncAt: integration.nextSyncAt,
    lastSyncAt: integration.lastSyncAt,
    lastError: integration.lastError,
    lastErrorAt: integration.lastErrorAt,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  };

  return res.status(200).json(responseData);
}
