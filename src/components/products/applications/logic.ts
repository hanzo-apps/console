/**
 * Application domain logic — pure, no UI.
 *
 * Ported from ApplicationListPage.newApplication(): the new-application template
 * (template/namespace/parameters/status) and the deploy lifecycle predicate.
 */
import type { Application } from '~/lib/api'

const randomSuffix = () => Math.random().toString(36).slice(2, 8)

/** A fresh application, mirroring ApplicationListPage.newApplication(). */
export function newApplication(owner: string): Application {
  const suffix = randomSuffix()
  return {
    owner,
    name: `application_${suffix}`,
    displayName: `New Application - ${suffix}`,
    description: '',
    template: '',
    namespace: `hanzo-cloud-app-${suffix}`,
    parameters: '',
    status: 'Not Deployed',
  }
}

export const STATUS_OPTIONS = ['Not Deployed', 'Pending', 'Running', 'Failed'] as const

/** True when the app has not been deployed yet (deploy is the action). */
export const isUndeployed = (a: Application) => (a.status ?? 'Not Deployed') === 'Not Deployed'
