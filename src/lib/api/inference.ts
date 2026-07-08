/**
 * Inference serving API — the org's deployed model-serving endpoints.
 *
 * ONE real source: the cloud ML service `GET /v1/ml/models` (cloud `clients/ml`),
 * the org's KServe `InferenceService` inventory. It is reached through the console's
 * OWN same-origin `/v1/ml/*` rewrite → the hardened `/v1` user-bearer proxy
 * (`next.config.mjs` maps the `ml` head; `proxy-allow.ts` admits it), which mints a
 * short-lived user token so cloud resolves the org from the Bearer owner claim and
 * lands the request in the PER-ORG namespace `ml-<org>`. A cookie-only call 403s, so
 * the browser never holds a cloud credential and cannot widen scope.
 *
 * The payload is BARE JSON (`{ items: [{ name, createdAt, status }] }`, NOT the
 * casibase `{status,msg,data}` envelope — see cloud `clients/ml/ml.go` `view()`), so
 * it goes through the REST layer (`restGet`). A fresh org whose tenant namespace does
 * not exist yet gets an honest empty list; a 403/404 is surfaced as an honest state by
 * the caller — never fabricated endpoints.
 */
import { originV1Url, restGet, restPost } from './client'

/** One deployed InferenceService as `/v1/ml/models` returns it (list view — no spec). */
export type RawMlEndpoint = {
  name?: string
  createdAt?: string
  /** The live KServe `InferenceService.status` (conditions/url/address/…), or absent. */
  status?: Record<string, unknown>
}

type MlListResponse = { items?: RawMlEndpoint[] }

export const InferenceApi = {
  /**
   * The org's deployed serving endpoints (KServe InferenceServices). Throws
   * `ApiError` when the ML route isn't mounted/authorized on this deployment (the
   * caller renders an honest state); an org with none gets `[]`.
   */
  listEndpoints: async (): Promise<RawMlEndpoint[]> => {
    const res = await restGet<MlListResponse>(originV1Url('ml/models'))
    return res?.items ?? []
  },

  /**
   * Deploy a serving endpoint — a real `POST /v1/ml/models` create of a KServe
   * `InferenceService`. `spec` is the InferenceService spec (e.g.
   * `{ predictor: { model: { modelFormat: { name }, storageUri } } }`); the backend
   * validates it against the cluster CRD and returns the created object or a real
   * error (surfaced honestly — never a fake success).
   */
  deployEndpoint: (body: { name: string; spec: Record<string, unknown>; labels?: Record<string, string> }): Promise<unknown> =>
    restPost<unknown>(originV1Url('ml/models'), body),
}
