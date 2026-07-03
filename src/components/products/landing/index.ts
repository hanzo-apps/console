/**
 * ProductLanding kit — the reusable polished-landing system. A product composes a
 * `ProductLandingConfig` and renders `<ProductLanding config={…}>` to get the hero +
 * live metrics + interactive code samples + resources rail. See `embeddings/OverviewView`
 * for the exemplar; fan out to other products by supplying a config.
 */
export { ProductLanding } from './ProductLanding'
export { LandingMetrics } from './LandingMetrics'
export { CodeSamples } from './CodeSamples'
export { ResourceRail } from './ResourceRail'
export { LandingHero } from './LandingHero'
export { LandingCard, ActionRow, DeltaChip, openExternal } from './parts'
export { apexFromDocs, apiBaseFromDocs, landingDocsUrl, standardResources, supportMailto } from './logic'
export type {
  CodeLang,
  CodeSample,
  LandingAction,
  LandingMetric,
  ResourceLink,
  ProductLandingConfig,
} from './types'
