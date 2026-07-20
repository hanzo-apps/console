/**
 * A typed sample of the console's CD view-models (what `lib/api/gitops` normalizes
 * cloud's `/v1/deploy` DTOs INTO) — the shape the pure folds are exercised against.
 *
 * It is NOT wired into the live map (the repo never fabricates data: a forbidden /
 * not-yet-routed read renders an honest state). It is the concrete fixture the pure
 * folds run over in `logic.test.ts`, and a ready reference for the folds + e2e.
 */
import type { Application, AppTree } from '~/lib/api/gitops'

/** Four applications mirroring the GitOps mockup (cloud/gateway/iam/o11y). */
export const FIXTURE_APPS: Application[] = [
  {
    name: 'cloud',
    namespace: 'hanzo',
    image: { repository: 'ghcr.io/hanzoai/cloud', tag: 'v1.800.1' },
    phase: 'Running',
    health: 'Unknown',
    sync: 'Unknown',
    replicas: 2,
    readyReplicas: 2,
    liveTag: 'v1.800.1',
    org: 'hanzo',
    message: '',
    revisions: ['v1.800.0', 'v1.799.15'],
    updatedAt: Date.parse('2026-07-14T05:00:00Z'),
  },
  {
    name: 'gateway',
    namespace: 'hanzo',
    image: { repository: 'ghcr.io/hanzoai/gateway', tag: 'v2.16.4' },
    phase: 'Running',
    health: 'Unknown',
    sync: 'Unknown',
    replicas: 2,
    readyReplicas: 2,
    liveTag: 'v2.16.4',
    org: 'hanzo',
    message: '',
    revisions: ['v2.16.3'],
    updatedAt: Date.parse('2026-07-13T22:00:00Z'),
  },
  {
    name: 'iam',
    namespace: 'hanzo',
    image: { repository: 'ghcr.io/hanzoai/iam', tag: 'v1.4.11' },
    phase: 'Running',
    health: 'Unknown',
    sync: 'Unknown',
    replicas: 2,
    readyReplicas: 1,
    liveTag: 'v1.4.10',
    org: 'hanzo',
    message: 'Rolling update in progress (1/2 updated)',
    revisions: ['v1.4.10', 'v1.4.9'],
    updatedAt: Date.parse('2026-07-14T15:30:00Z'),
  },
  {
    name: 'o11y',
    namespace: 'hanzo',
    image: { repository: 'ghcr.io/hanzoai/o11y', tag: 'v1.5.12' },
    phase: 'Running',
    health: 'Unknown',
    sync: 'Unknown',
    replicas: 1,
    readyReplicas: 1,
    liveTag: 'v1.5.12',
    org: 'hanzo',
    message: '',
    revisions: ['v1.5.11'],
    updatedAt: Date.parse('2026-07-11T12:00:00Z'),
  },
]

/** The owned-resource tree for the `cloud` app (Service CR → Deployment → RS → Pods + Service/Ingress). */
export const FIXTURE_TREE: AppTree = {
  nodes: [
    { ref: 'cr', group: 'hanzo.ai', version: 'v1', kind: 'Service', name: 'cloud', namespace: 'hanzo', health: 'Healthy', sync: 'Synced', phase: 'Running', replicas: 2, readyReplicas: 2, images: ['ghcr.io/hanzoai/cloud:v1.800.1'], ownerRefs: [], createdAt: 0 },
    { ref: 'dep', group: 'apps', version: 'v1', kind: 'Deployment', name: 'cloud', namespace: 'hanzo', health: 'Healthy', sync: 'Synced', phase: 'Running', replicas: 2, readyReplicas: 2, images: ['ghcr.io/hanzoai/cloud:v1.800.1'], ownerRefs: ['cr'], createdAt: 0 },
    { ref: 'rs', group: 'apps', version: 'v1', kind: 'ReplicaSet', name: 'cloud-6d8f', namespace: 'hanzo', health: 'Healthy', sync: 'Synced', phase: 'Running', replicas: 2, readyReplicas: 2, images: [], ownerRefs: ['dep'], createdAt: 0 },
    { ref: 'p1', group: '', version: 'v1', kind: 'Pod', name: 'cloud-6d8f-abc', namespace: 'hanzo', health: 'Healthy', sync: 'Unknown', phase: 'Running', replicas: 0, readyReplicas: 0, images: [], ownerRefs: ['rs'], createdAt: 0 },
    { ref: 'p2', group: '', version: 'v1', kind: 'Pod', name: 'cloud-6d8f-def', namespace: 'hanzo', health: 'Healthy', sync: 'Unknown', phase: 'Running', replicas: 0, readyReplicas: 0, images: [], ownerRefs: ['rs'], createdAt: 0 },
    { ref: 'svc', group: '', version: 'v1', kind: 'Service', name: 'cloud', namespace: 'hanzo', health: 'Healthy', sync: 'Synced', phase: '', replicas: 0, readyReplicas: 0, images: [], ownerRefs: ['cr'], createdAt: 0 },
    { ref: 'ing', group: 'networking.k8s.io', version: 'v1', kind: 'Ingress', name: 'cloud', namespace: 'hanzo', health: 'Healthy', sync: 'Synced', phase: '', replicas: 0, readyReplicas: 0, images: [], ownerRefs: ['cr'], createdAt: 0 },
  ],
  edges: [],
}
