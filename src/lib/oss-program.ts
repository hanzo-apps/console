/**
 * The Hanzo Cloud open-source revenue-share program — the economic core of an
 * OSS cloud anyone can run and contribute to. When a product runs in the cloud,
 * a share of the revenue it generates is distributed to the open-source
 * developers who built it, computed from each deployment's software bill of
 * materials (SBOM) and settled on-chain in HUSD on the Hanzo EVM.
 *
 * ONE source of truth for the program's terms — referenced by the product
 * interstitials (discover screens) and the billing/wallet surfaces, so the
 * numbers and asset are stated identically everywhere.
 */
export const OSS_PROGRAM = {
  /** Percent of a product's cloud revenue distributed to its OSS contributors. */
  revenueSharePct: 25,
  /** Settlement asset for payouts — Hanzo USD stablecoin on the Hanzo EVM. */
  payoutAsset: 'HUSD',
  /** What the per-product split is computed from. */
  basis: "each deployment's software bill of materials (SBOM)",
  /** The live OSS-dividends program dashboard (register a wallet, see earnings). */
  dividendsUrl: 'https://hanzo.ai/open-source/dividends',
} as const

/** GitHub URL for a catalog entry's source repo (e.g. 'hanzoai/vector'). */
export const githubUrl = (repo: string): string => `https://github.com/${repo}`

/** Canonical docs site (per-product deep links can be added as they're published). */
export const DOCS_URL = 'https://docs.hanzo.ai'
