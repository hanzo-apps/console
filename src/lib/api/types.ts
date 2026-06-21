/**
 * Types for the unified Hanzo Cloud `/v1` backend resources.
 *
 * These mirror the Go models served by `hanzoai/cloud`. Fields are kept to the
 * surface the console reads/writes; the backend tolerates extra/missing keys, so
 * we model the meaningful ones and allow passthrough for the rest.
 */

/** Common ownership/identity fields on every casibase object. */
export type Owned = {
  owner: string
  name: string
  createdTime?: string
  displayName?: string
}

/** A model or storage provider (`/v1/*-provider`). */
export type Provider = Owned & {
  category: 'Model' | 'Storage' | 'Embedding' | 'Blockchain' | (string & {})
  type: string
  subType?: string
  clientId?: string
  clientSecret?: string
  apiKey?: string
  apiVersion?: string
  region?: string
  providerUrl?: string
  compatibleProvider?: string
  temperature?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  enableThinking?: boolean
  inputPricePerThousandTokens?: number
  outputPricePerThousandTokens?: number
  currency?: string
  state?: 'Active' | 'Inactive' | (string & {})
  isDefault?: boolean
  isRemote?: boolean
  // Passthrough for fields the editor doesn't surface but the backend round-trips.
  [key: string]: unknown
}

/** A model route (`/v1/*-model-route`). */
export type ModelRoute = Owned & {
  modelName?: string
  state?: string
  [key: string]: unknown
}

/** An application (`/v1/*-application`). */
export type Application = Owned & {
  category?: string
  state?: string
  isDefault?: boolean
  [key: string]: unknown
}

/** A knowledge store (`/v1/*-store`). */
export type Store = Owned & {
  storageProvider?: string
  modelProvider?: string
  embeddingProvider?: string
  state?: string
  isDefault?: boolean
  [key: string]: unknown
}

/** A chat session (`/v1/*-chat`). */
export type Chat = Owned & {
  type?: string
  user?: string
  store?: string
  messageCount?: number
  [key: string]: unknown
}

/** The signed-in account (`/v1/get-account`). */
export type Account = {
  owner: string
  name: string
  displayName?: string
  email?: string
  avatar?: string
  organization?: string
  isAdmin?: boolean
  accessToken?: string
  [key: string]: unknown
}

/** Standard list query parameters shared by every paged endpoint. */
export type ListParams = {
  owner?: string
  page?: number
  pageSize?: number
  field?: string
  value?: string
  sortField?: string
  sortOrder?: string
}

/** Map ListParams to the backend's query keys (`p` not `page`). */
export const listQuery = (p: ListParams = {}): Record<string, string | number | undefined> => ({
  owner: p.owner,
  p: p.page,
  pageSize: p.pageSize,
  field: p.field,
  value: p.value,
  sortField: p.sortField,
  sortOrder: p.sortOrder,
})
