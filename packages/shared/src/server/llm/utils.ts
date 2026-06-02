import { z } from "zod";

import { decrypt } from "../../encryption";
import { LLMAdapter } from "./types";

const ExtraHeaderSchema = z.record(z.string(), z.string());

export function decryptAndParseExtraHeaders(extraHeaders: string | null | undefined) {
  if (!extraHeaders) return;

  return ExtraHeaderSchema.parse(JSON.parse(decrypt(extraHeaders)));
}
