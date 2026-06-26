/**
 * ZAP-native data layer barrel — the drop-in replacement for `~/lib/api`.
 *
 * A product module migrates from REST to ZAP-native by swapping ONE import:
 * `from '~/lib/api'` → `from '~/lib/zap'`. The exported names and signatures
 * are identical (ProviderApi, ApiError, Provider), so the view components need
 * zero changes — the only difference is the wire: binary ZAP over a WebSocket
 * (zapCall) instead of JSON-over-HTTP (fetch). See providers.ts / client.ts.
 *
 * ApiError and the domain types are shared with the REST layer (one definition,
 * reused) — only the transport (the *Api objects) is ZAP-native here.
 */
export { ApiError } from '~/lib/api/client'
export type { Provider, ListParams } from '~/lib/api/types'

// ProviderApi is the ZAP twin, exported under the REST name so call sites that
// `import { ProviderApi } from '~/lib/zap'` get the ZAP transport unchanged.
export { ProviderApiZap as ProviderApi } from './providers'

export { zapCall, closeZap, zapUrl, ZAP_PATH } from './client'
