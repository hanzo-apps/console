/**
 * Unified Hanzo Cloud KMS — the ONE secrets data-access adapter.
 *
 * This is the single place the console maps between its (Infisical-shaped)
 * secret model and the unified KMS REST contract at `/v1/kms/orgs/:org/secrets`
 * (cloud/clients/kmssvc, backed by clients/kms → embedded luxfi/kms). The tRPC
 * secrets procedures call THESE functions and nothing else; no request/response
 * mapping for secrets lives anywhere but here (decomplect: transport + shape
 * mapping in one module, so hooks + components stay unchanged).
 *
 * Wire contract (cloud/clients/kmssvc/kmssvc.go):
 *
 *   GET    /v1/kms/orgs/:org/secrets      ?env=&path=  → { secrets: SecretMeta[], total }
 *   GET    /v1/kms/orgs/:org/secrets/*    ?env=        → { name, env, value }
 *   POST   /v1/kms/orgs/:org/secrets      {path,name,env,value} → { stored, name, env }
 *   DELETE /v1/kms/orgs/:org/secrets/*    ?env=        → { deleted, name, env }
 *
 * SecretMeta = { name, path, env, scheme }, where `path` is the FULL store path
 * (`/orgs/:org[/subpath]`). The list carries METADATA ONLY; a secret's value is
 * read one at a time. To preserve the console's raw-list UX (values shown and
 * revealed inline — exactly what the legacy /v3/secrets/raw returned) the list
 * fans out a per-secret value read. N is a tenant's secret count at one path —
 * small for an admin surface — and the reads are issued concurrently.
 *
 * Fields the unified KMS does NOT model — comment, version, created/updated
 * timestamps, personal-vs-shared type — are mapped to stable defaults so the
 * KmsSecret shape the UI consumes is preserved (see mapSecret). A comment typed
 * in the UI is therefore not persisted: the unified secretPutRequest has no
 * comment field.
 *
 * Auth + transport are the KMS feature's existing bearer mechanism (kmsClient:
 * `Authorization: Bearer`) against the ONE cloud auth boundary (SanitizeIdentity)
 * — no new token flow. Org scoping: :org is the console's current org, folded
 * into the URL by the caller (router.resolveKmsOrg); the cloud guard namespaces
 * every record under /orgs/:org so one org can never address another's.
 */
import { kmsGet, kmsPost, kmsDelete } from "./kmsClient";
import { type KmsSecret } from "../types";

/** Metadata row returned by the unified KMS list endpoint. */
type SecretMeta = { name: string; path: string; env: string; scheme: string };

/** Value payload returned by the unified KMS single-secret read. */
type SecretValue = { name: string; env: string; value: string };

/** The env the cloud KMS uses when a request omits ?env= (kmssvc defaultEnv). */
const DEFAULT_ENV = "default";

function normEnv(environment: string): string {
  const e = environment.trim();
  return e === "" ? DEFAULT_ENV : e;
}

/**
 * Normalize an Infisical secretPath ("/", "/ci", "ci/") to a clean cloud KMS
 * subpath ("" for the org root, "ci" otherwise). The cloud POST body's `path`
 * is a subpath relative to the org root; "" means the root.
 */
function subpath(secretPath: string): string {
  return secretPath
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("/");
}

/**
 * Strip the `/orgs/:org` prefix a list SecretMeta carries so the value read
 * addresses the same record with a subpath relative to the org root. Handles
 * both flat and (should the store ever list recursively) nested results.
 */
function relSubpath(org: string, metaPath: string): string {
  const prefix = `/orgs/${org}`;
  let p = metaPath;
  if (p === prefix) p = "";
  else if (p.startsWith(`${prefix}/`)) p = p.slice(prefix.length + 1);
  return subpath(p);
}

/** Base URL for an org's secrets collection. */
function collection(org: string): string {
  return `/v1/kms/orgs/${encodeURIComponent(org)}/secrets`;
}

/**
 * URL for one secret: the trailing wildcard is the subpath + name, each segment
 * URL-encoded but the "/" separators preserved (they are path structure the
 * cloud route matches). `cleanSub` is an already-normalized subpath ("" = root).
 */
function secretUrl(org: string, cleanSub: string, name: string): string {
  const segs = cleanSub === "" ? [] : cleanSub.split("/");
  const encoded = [...segs, name].map(encodeURIComponent);
  return `${collection(org)}/${encoded.join("/")}`;
}

/** Map a unified-KMS (meta, value) pair to the console's KmsSecret shape. */
function mapSecret(rel: string, meta: SecretMeta, value: string): KmsSecret {
  return {
    id: rel === "" ? meta.name : `${rel}/${meta.name}`,
    version: 1,
    secretKey: meta.name,
    secretValue: value,
    secretComment: undefined,
    environment: meta.env,
    type: "shared",
    createdAt: "",
    updatedAt: "",
  };
}

/**
 * List an org's secrets at a path/env, with each value read and inlined so the
 * console's secret browser renders exactly as it did against /v3/secrets/raw.
 */
export async function listOrgSecrets(
  org: string,
  environment: string,
  secretPath: string,
): Promise<{ secrets: KmsSecret[] }> {
  const e = normEnv(environment);
  const { secrets: metas } = await kmsGet<{ secrets: SecretMeta[] }>(
    collection(org),
    { env: e, path: subpath(secretPath) || undefined },
  );
  const secrets = await Promise.all(
    (metas ?? []).map(async (m) => {
      const rel = relSubpath(org, m.path);
      // Best-effort value read: a per-secret failure shows the key with an empty
      // value rather than dropping it or failing the whole list.
      let value = "";
      try {
        const read = await kmsGet<SecretValue>(secretUrl(org, rel, m.name), {
          env: m.env,
        });
        value = read.value ?? "";
      } catch {
        value = "";
      }
      return mapSecret(rel, m, value);
    }),
  );
  return { secrets };
}

/**
 * Upsert (seal + store) one secret. Create and update are the SAME operation on
 * the unified KMS (last-writer-wins), so both console mutations route here.
 */
export async function putOrgSecret(
  org: string,
  environment: string,
  secretPath: string,
  name: string,
  value: string,
): Promise<void> {
  await kmsPost(collection(org), {
    path: subpath(secretPath),
    name,
    env: normEnv(environment),
    value,
  });
}

/** Delete one secret at (subpath, name, env). */
export async function deleteOrgSecret(
  org: string,
  environment: string,
  secretPath: string,
  name: string,
): Promise<void> {
  await kmsDelete(secretUrl(org, subpath(secretPath), name), {
    env: normEnv(environment),
  });
}
