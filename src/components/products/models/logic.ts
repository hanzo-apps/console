/**
 * Model-route domain logic — pure, no UI.
 *
 * Ported from ModelRouteListPage.newModelRoute() / ModelRouteEditPage: the
 * new-route template. A model route is keyed by owner/modelName, so a fresh one
 * starts with an empty modelName the user fills in (the create form is the only
 * place modelName is editable).
 */
import type { ModelRoute } from '~/lib/api'

const randomSuffix = () => Math.random().toString(36).slice(2, 8)

/** A fresh model route, mirroring ModelRouteListPage.newModelRoute(). */
export function newModelRoute(owner: string): ModelRoute {
  return {
    owner,
    name: `route_${randomSuffix()}`,
    modelName: '',
    provider: '',
    upstream: '',
    ownedBy: '',
    fallback1Provider: '',
    fallback1Upstream: '',
    fallback2Provider: '',
    fallback2Upstream: '',
    premium: false,
    hidden: false,
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    enabled: true,
  }
}
