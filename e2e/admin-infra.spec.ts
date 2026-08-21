/**
 * Infrastructure admin board — render + interaction proof.
 *
 * Drives the REAL InfraModule (client + pure logic + the shared sortable DataTable)
 * against a mock of `/v1/admin/infra` seeded with the fleet's REAL shape: 58 nodes,
 * 295 volumes, 8 clusters, 132 detached, and 3 unreferenced/deletable volumes totalling
 * 500 GiB ≈ $50/mo. Nothing here is fabricated beyond the fixture — the assertions are
 * about what the board DOES with real numbers.
 *
 * Proves: the Overview totals render and the droplet-local-disk note is unmissable;
 * every tab renders; sorting a column genuinely REORDERS rows (the first row's text
 * changes); the `unreferenced` filter yields exactly 3; a NON-deletable volume shows no
 * delete control (it shows its blockedReason instead); and a deletable volume's confirm
 * states the name, the size in GiB, and the monthly cost being reclaimed.
 *
 * Screenshots every tab to e2e-shots/admin-infra-<tab>.png.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test admin-infra
 */
import { test, expect, type Route } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'
requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|integrations|auth\/refresh)(\/|$|\?)/

// ── the fixture: the fleet's REAL shape ───────────────────────────────────────

const CLUSTER_NAMES = ['hanzo-k8s', 'lux-k8s', 'zoo-k8s', 'bootnode-k8s', 'pars-k8s', 'ci-arc-k8s', 'edge-k8s', 'staging-k8s']

/** 8 clusters. `zebra-k8s` is deliberately absent — name sorting is proven on the real set. */
const clusters = CLUSTER_NAMES.map((name, i) => ({
  id: `c-${i + 1}`,
  name,
  region: ['nyc3', 'sfo3', 'ams3'][i % 3],
  version: '1.31.1-do.4',
  status: 'running',
  nodePools: 2 + (i % 3),
  nodes: [12, 10, 8, 7, 6, 6, 5, 4][i],
  pods: 120 - i * 9,
  pvs: 40 - i * 3,
  pvcs: 40 - i * 3,
  idlePVCs: i === 0 ? 6 : i === 1 ? 3 : 0,
  scanned: true,
  scanError: '',
  monthlyCents: [480000, 320000, 180000, 120000, 74000, 60000, 32000, 18000][i],
}))

/** 58 droplets across the 8 clusters; each carries 160 GiB of LOCAL disk (9,280 GiB total). */
const nodes = Array.from({ length: 58 }, (_, i) => ({
  id: 1000 + i,
  name: `pool-${String.fromCharCode(97 + (i % 8))}-${i + 1}`,
  cluster: CLUSTER_NAMES[i % 8],
  clusterId: `c-${(i % 8) + 1}`,
  region: ['nyc3', 'sfo3', 'ams3'][i % 3],
  status: 'active',
  sizeSlug: i % 5 === 0 ? 's-8vcpu-16gb' : 's-4vcpu-8gb',
  vcpus: i % 5 === 0 ? 8 : 4,
  memoryMiB: i % 5 === 0 ? 16384 : 8192,
  localDiskGiB: 160,
  monthlyCents: i % 5 === 0 ? 9600 : 4800,
  createdAt: '2026-01-04T10:00:00Z',
  privateIp: `10.0.${Math.floor(i / 256)}.${i % 256}`,
  publicIp: '',
  tags: ['k8s', `k8s:c-${(i % 8) + 1}`],
  ready: i !== 57,
  schedulable: i !== 56,
  pods: 4 + (i % 17),
  volumes: i % 3 === 0 ? 2 : 1,
}))

/**
 * 295 volumes: 163 attached, 129 detached-but-referenced (bound/released), and the 3
 * UNREFERENCED ones that are genuinely reclaimable (500 GiB ≈ $50/mo).
 * detachedVolumes = 132 = the 129 bound/released + the 3 unreferenced.
 */
const volumes = [
  ...Array.from({ length: 163 }, (_, i) => ({
    id: `v-att-${i}`,
    name: `pvc-attached-${String(i).padStart(3, '0')}`,
    region: 'nyc3',
    sizeGiB: 100,
    monthlyCents: 1000,
    state: 'attached',
    dropletIds: [1000 + (i % 58)],
    nodeName: nodes[i % 58].name,
    cluster: CLUSTER_NAMES[i % 8],
    clusterId: `c-${(i % 8) + 1}`,
    tagCluster: `c-${(i % 8) + 1}`,
    pv: `pv-att-${i}`,
    pvPhase: 'Bound',
    pvcNamespace: 'hanzo',
    pvcName: `data-${i}`,
    mountedBy: [`pod-${i}`],
    idle: false,
    createdAt: '2026-02-01T00:00:00Z',
    deletable: false,
    blockedReason: 'Attached to a droplet.',
  })),
  ...Array.from({ length: 118 }, (_, i) => ({
    id: `v-bound-${i}`,
    name: `pvc-bound-${String(i).padStart(3, '0')}`,
    region: 'sfo3',
    sizeGiB: 150,
    monthlyCents: 1500,
    state: 'bound',
    dropletIds: [],
    nodeName: '',
    cluster: CLUSTER_NAMES[i % 8],
    clusterId: `c-${(i % 8) + 1}`,
    tagCluster: `c-${(i % 8) + 1}`,
    pv: `pv-bound-${i}`,
    pvPhase: 'Bound',
    pvcNamespace: 'hanzo',
    pvcName: `idle-${i}`,
    mountedBy: [],
    idle: true,
    createdAt: '2026-02-01T00:00:00Z',
    deletable: false,
    blockedReason: 'Bound to PVC hanzo/idle — still claimed.',
  })),
  ...Array.from({ length: 11 }, (_, i) => ({
    id: `v-rel-${i}`,
    name: `pvc-released-${String(i).padStart(3, '0')}`,
    region: 'ams3',
    sizeGiB: 120,
    monthlyCents: 1200,
    state: 'released',
    dropletIds: [],
    nodeName: '',
    cluster: CLUSTER_NAMES[i % 8],
    clusterId: `c-${(i % 8) + 1}`,
    tagCluster: `c-${(i % 8) + 1}`,
    pv: `pv-rel-${i}`,
    pvPhase: 'Released',
    pvcNamespace: '',
    pvcName: '',
    mountedBy: [],
    idle: false,
    createdAt: '2026-01-15T00:00:00Z',
    deletable: false,
    blockedReason: 'PV is Released but not yet reclaimed — retain policy holds the data.',
  })),
  // The 3 genuinely reclaimable volumes: 500 GiB total, $50.00/mo total.
  {
    id: 'v-orphan-1', name: 'pvc-abandoned-alpha', region: 'nyc3', sizeGiB: 200, monthlyCents: 2000,
    state: 'unreferenced', dropletIds: [], nodeName: '', cluster: '', clusterId: '', tagCluster: 'c-1',
    pv: '', pvPhase: '', pvcNamespace: '', pvcName: '', mountedBy: [], idle: false,
    createdAt: '2025-11-02T00:00:00Z', deletable: true, blockedReason: '',
  },
  {
    id: 'v-orphan-2', name: 'pvc-abandoned-bravo', region: 'sfo3', sizeGiB: 200, monthlyCents: 2000,
    state: 'unreferenced', dropletIds: [], nodeName: '', cluster: '', clusterId: '', tagCluster: '',
    pv: '', pvPhase: '', pvcNamespace: '', pvcName: '', mountedBy: [], idle: false,
    createdAt: '2025-12-11T00:00:00Z', deletable: true, blockedReason: '',
  },
  {
    id: 'v-orphan-3', name: 'pvc-abandoned-charlie', region: 'ams3', sizeGiB: 100, monthlyCents: 1000,
    state: 'unreferenced', dropletIds: [], nodeName: '', cluster: '', clusterId: '', tagCluster: '',
    pv: '', pvPhase: '', pvcNamespace: '', pvcName: '', mountedBy: [], idle: false,
    createdAt: '2026-01-20T00:00:00Z', deletable: true, blockedReason: '',
  },
]

const loadBalancers = [
  { id: 'lb-1', name: 'edge-ingress', region: 'nyc3', status: 'active', ip: '143.198.10.1', sizeUnit: 3, monthlyCents: 3600, droplets: 12, cluster: 'hanzo-k8s' },
  { id: 'lb-2', name: 'api-gateway', region: 'sfo3', status: 'active', ip: '143.198.10.2', sizeUnit: 1, monthlyCents: 1200, droplets: 10, cluster: 'lux-k8s' },
  { id: 'lb-3', name: 'zoo-edge', region: 'ams3', status: 'new', ip: '', sizeUnit: 1, monthlyCents: 1200, droplets: 0, cluster: 'zoo-k8s' },
  { id: 'lb-4', name: 'bootnode-rpc', region: 'nyc3', status: 'active', ip: '143.198.10.4', sizeUnit: 1, monthlyCents: 1200, droplets: 7, cluster: 'bootnode-k8s' },
]

const findings = [
  { id: 'f-1', severity: 'critical', kind: 'unreferenced-volume', title: 'Three unreferenced volumes', detail: '500 GiB of block storage is referenced by no PV, PVC or droplet.', resource: 'pvc-abandoned-alpha, pvc-abandoned-bravo, pvc-abandoned-charlie', cluster: '', monthlyCents: 5000 },
  { id: 'f-2', severity: 'warn', kind: 'idle-pvc', title: 'Idle PVCs on hanzo-k8s', detail: 'Bound to a PVC but no pod mounts them.', resource: '6 PVCs', cluster: 'hanzo-k8s', monthlyCents: 9000 },
  { id: 'f-3', severity: 'warn', kind: 'released-pv', title: 'Released PVs retained', detail: 'Retain reclaim policy is holding the data.', resource: '11 PVs', cluster: 'lux-k8s', monthlyCents: 13200 },
  { id: 'f-4', severity: 'info', kind: 'cost-outlier', title: 'hanzo-k8s is 28% of fleet spend', detail: 'Largest single cluster by monthly cost.', resource: 'hanzo-k8s', cluster: 'hanzo-k8s', monthlyCents: 480000 },
]

const snapshot = {
  at: new Date().toISOString(),
  complete: true,
  incompleteReason: '',
  sources: [
    { name: 'digitalocean', ok: true, rows: 359, error: '', at: new Date().toISOString() },
    { name: 'hanzo-k8s', ok: true, rows: 40, error: '', at: new Date().toISOString() },
  ],
  totals: {
    clusters: 8, nodes: 58, volumes: 295, loadBalancers: 4,
    volumeGiB: 41200, attachedVolumes: 163, attachedGiB: 16300,
    detachedVolumes: 132, detachedGiB: 20120,
    unreferencedVolumes: 3, unreferencedGiB: 500,
    idlePVCs: 118, localDiskGiB: 9280,
  },
  cost: { dropletsMonthly: 1284000, volumesMonthly: 412000, loadBalancersMonthly: 7200, totalMonthly: 1703200, reclaimableMonthly: 5000 },
  clusters, nodes, volumes, loadBalancers, findings,
}

// ── the spec ──────────────────────────────────────────────────────────────────

/** Mock everything; `/v1/admin/infra` answers with the fixture, all else an empty envelope. */
async function mockFleet(page: import('@playwright/test').Page) {
  await page.route('**/*', async (route: Route) => {
    const req = route.request()
    if (req.resourceType() === 'document') return route.continue()
    const url = new URL(req.url())
    const path = url.pathname

    if (path === '/v1/admin/infra' && req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', msg: '', data: snapshot }) })
    }

    const sameOrigin = url.origin === new URL(BASE_URL).origin
    if (sameOrigin && !API_RE.test(path)) return route.continue()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }) })
  })
  await primeSession(page, { owner: 'admin', name: 'z', email: 'z@hanzo.ai', isAdmin: true })
}

/**
 * Open one tab by URL. This also proves the registry declares the `:tab` route — an
 * undeclared tab slug 404s (the v8.4.86 class of bug), which a click-only spec hides.
 * URL navigation is also unambiguous: the sidebar carries its own "Clusters" / "Nodes"
 * product entries, so a bare button match would be a coin flip.
 */
async function openTab(page: import('@playwright/test').Page, slug: string, tabLabel: string) {
  await page.goto(`${BASE_URL}/infra${slug ? `/${slug}` : ''}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Infrastructure').first()).toBeVisible({ timeout: 30_000 })
  // The module's own tab bar rendered this tab (and it is the selected one).
  await expect(page.getByRole('button', { name: tabLabel, exact: true }).last()).toBeVisible({ timeout: 15_000 })
}

test('infrastructure board renders the fleet, sorts, filters, and gates deletion', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true })
  await mockFleet(page)

  // ── Overview: the totals + the unmissable local-disk note ───────────────────
  await openTab(page, '', 'Overview')

  // Cost breakdown: total / droplets / block storage / load balancers / reclaimable.
  await expect(page.getByText('$17,032.00').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('$12,840.00').first()).toBeVisible()
  await expect(page.getByText('$4,120.00').first()).toBeVisible()
  await expect(page.getByText('$72.00').first()).toBeVisible()
  // The reclaimable card: the 3 unreferenced volumes ≈ $50/mo, 500 GiB.
  await expect(page.getByText('$50.00').first()).toBeVisible()
  await expect(page.getByText('3 unreferenced · 500 GiB').first()).toBeVisible()
  // Fleet counts.
  await expect(page.getByText('8 clusters · 58 nodes').first()).toBeVisible()
  await expect(page.getByText('295 volumes · 40.2 TiB').first()).toBeVisible()

  // THE distinction: droplet local disk is inside the droplet price, not block storage.
  await expect(page.getByText('Droplet local disk is included in the droplet price — it is never billed separately')).toBeVisible()
  await expect(page.getByText(/9,280 GiB of local disk is already inside the droplet number/)).toBeVisible()

  await page.screenshot({ path: join(SHOTS, 'admin-infra-overview.png'), fullPage: false })

  // ── Clusters: sorting a column genuinely REORDERS rows ──────────────────────
  await page.getByRole('button', { name: 'Clusters', exact: true }).first().click()
  await expect(page.getByText('hanzo-k8s').first()).toBeVisible({ timeout: 15_000 })

  // Default sort is Monthly desc → hanzo-k8s ($4,800.00) is first.
  const clusterRows = page.locator('.hz-row')
  await expect(clusterRows.first()).toContainText('hanzo-k8s')
  const beforeSort = (await clusterRows.first().innerText()).trim()

  // Click the "Cluster" header → sort by name ASC → bootnode-k8s is first (a different row).
  await page.getByLabel('Sort by Cluster').click()
  await expect(clusterRows.first()).toContainText('bootnode-k8s', { timeout: 10_000 })
  const afterAsc = (await clusterRows.first().innerText()).trim()
  expect(afterAsc).not.toBe(beforeSort) // the first row's text genuinely CHANGED

  // Click it again → DESC → zoo-k8s is first (the reverse end of the same column).
  await page.getByLabel('Sort by Cluster').click()
  await expect(clusterRows.first()).toContainText('zoo-k8s', { timeout: 10_000 })
  expect((await clusterRows.first().innerText()).trim()).not.toBe(afterAsc)

  await page.screenshot({ path: join(SHOTS, 'admin-infra-clusters.png'), fullPage: false })

  // ── Nodes: 58 droplets, sortable, with a cordon control ─────────────────────
  await page.getByRole('button', { name: 'Nodes', exact: true }).first().click()
  await expect(page.getByLabel('Sort by Node')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Cordon' }).first()).toBeVisible()

  // Sort by vCPU ascending → a 4-vCPU node leads; descending → an 8-vCPU node leads.
  const nodeRows = page.locator('.hz-row')
  await page.getByLabel('Sort by vCPU').click()
  await expect(nodeRows.first()).toContainText('s-4vcpu-8gb', { timeout: 10_000 })
  const nodeAsc = (await nodeRows.first().innerText()).trim()
  await page.getByLabel('Sort by vCPU').click()
  await expect(nodeRows.first()).toContainText('s-8vcpu-16gb', { timeout: 10_000 })
  expect((await nodeRows.first().innerText()).trim()).not.toBe(nodeAsc)

  await page.screenshot({ path: join(SHOTS, 'admin-infra-nodes.png'), fullPage: false })

  // ── Volumes: the unreferenced filter yields EXACTLY 3 ───────────────────────
  await page.getByRole('button', { name: 'Volumes', exact: true }).first().click()
  await expect(page.getByText('295').first()).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Unreferenced', exact: true }).click()
  const volumeRows = page.locator('.hz-row')
  await expect(volumeRows).toHaveCount(3, { timeout: 10_000 })
  await expect(page.getByText('pvc-abandoned-alpha')).toBeVisible()
  await expect(page.getByText('pvc-abandoned-bravo')).toBeVisible()
  await expect(page.getByText('pvc-abandoned-charlie')).toBeVisible()

  await page.screenshot({ path: join(SHOTS, 'admin-infra-volumes.png'), fullPage: false })

  // A DELETABLE volume: the confirm states name + GiB + the monthly cost reclaimed.
  await page.getByText('pvc-abandoned-alpha').first().click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
  const confirmText = page.getByText(/Delete volume “pvc-abandoned-alpha”/)
  await expect(confirmText).toBeVisible()
  await expect(confirmText).toContainText('200 GiB')
  await expect(confirmText).toContainText('$20.00/month')
  await expect(confirmText).toContainText('A snapshot is taken first')
  await expect(page.getByRole('button', { name: 'Delete pvc-abandoned-alpha' })).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'admin-infra-volume-delete.png'), fullPage: false })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 })

  // A NON-deletable volume: NO delete control anywhere — the blocked reason instead.
  await page.getByRole('button', { name: 'Attached', exact: true }).click()
  await expect(page.getByText('pvc-attached-000').first()).toBeVisible({ timeout: 10_000 })
  await page.getByText('pvc-attached-000').first().click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('This volume cannot be deleted')).toBeVisible()
  await expect(page.getByText('Attached to a droplet.').first()).toBeVisible()
  // The gate, asserted negatively: no delete button, no confirm text, no snapshot toggle.
  await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0)
  await expect(page.getByText(/Delete volume “/)).toHaveCount(0)
  await expect(page.getByText('Take a snapshot first')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 })

  // ── Load balancers ──────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Load balancers', exact: true }).first().click()
  await expect(page.getByText('edge-ingress').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('$36.00').first()).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'admin-infra-load-balancers.png'), fullPage: false })

  // ── Audit: findings grouped by severity, with cost impact ───────────────────
  await page.getByRole('button', { name: 'Audit', exact: true }).first().click()
  await expect(page.getByText('Three unreferenced volumes').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('critical · 1').first()).toBeVisible()
  await expect(page.getByText('warn · 2').first()).toBeVisible()
  await expect(page.getByText('info · 1').first()).toBeVisible()
  // Group cost impact: the two warns sum to $222.00/mo (9000 + 13200 cents).
  await expect(page.getByText('$222.00/mo').first()).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'admin-infra-audit.png'), fullPage: false })
})
