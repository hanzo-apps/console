import { z } from "zod/v4";
import { BlobStorageIntegrationType, BlobStorageIntegrationFileType, BlobStorageExportMode } from "@hanzo/shared";

export const blobStorageIntegrationFormSchemaBase = z.object({
  type: z.enum(BlobStorageIntegrationType),
  bucketName: z.string().min(1, { message: "Bucket name is required" }),
  endpoint: z.url().optional().nullable(),
  region: z.string().default("auto"),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().nullable().optional(),
  prefix: z
    .string()
    .refine((value) => !value || value === "" || value.endsWith("/"), {
      message: "Prefix must end with a forward slash (/)",
    })
    .optional()
    .or(z.literal("")),
  exportFrequency: z.enum(["every_20_minutes", "hourly", "daily", "weekly"]),
  enabled: z.boolean(),
  forcePathStyle: z.boolean(),
  fileType: z.enum(BlobStorageIntegrationFileType).default(BlobStorageIntegrationFileType.JSONL),
  exportMode: z.enum(BlobStorageExportMode).default(BlobStorageExportMode.FULL_HISTORY),
  exportStartDate: z.coerce.date().optional().nullable(),
});

export type BlobStorageIntegrationFormSchema = z.infer<typeof blobStorageIntegrationFormSchema>;
