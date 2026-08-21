'use client'

/**
 * Applications — the org's REAL deployed apps on the live Hanzo PaaS. Thin route
 * adapter over `PaasApplications`, which drives the per-org `/v1/platform/*`
 * surface (projects → apps → deployments) through the `/v1` bearer proxy.
 *
 * This is the Compute "Applications" surface: real deployed apps with their
 * project, status, source, and live URL — NOT the IAM/OAuth "application"
 * registry (an identity concern), and NOT the apps-inventory board (that lives
 * under Status/Kubernetes). Per-org by construction: cloud resolves the org from
 * the Bearer owner, so a caller only sees their own apps.
 */
import { PaasApplications } from './paas/PaasApplications'

export function ApplicationsModule(props: { params: Record<string, string> }) {
  return <PaasApplications {...props} />
}

