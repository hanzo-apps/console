/**
 * Native product-overview specs — the per-product CONTENT for the one shared
 * `NativeOverview` shell (overview/NativeOverview.tsx). Every product that doesn't
 * own a bespoke admin surface renders that shell from a spec here, so the console
 * has ONE native overview pattern (DRY) and ZERO external link-outs: a product the
 * console doesn't yet deep-manage still gets a real in-console page — header,
 * health, key facts, primary actions, and INLINE docs — instead of bouncing the
 * user to another domain.
 *
 * A spec is pure data (no GUI), so it is unit-testable and the shell stays
 * presentational. Everything degrades honestly: a product with no live health
 * source omits the health band; resource cards with no backend read "—"; the doc
 * sections are written here (rendered in-console), with the docs SITE offered only
 * as a secondary reference, never as the way to "use the product".
 */

/** A real, server-backed health/inventory source for the overview's status band. */
export type HealthSource =
  /** Probe the platform apps inventory for this operator service name (real health). */
  | { kind: 'platform-app'; service: string }
  /** No live health source on this deployment — the band is omitted (honest). */
  | { kind: 'none' }

/** One key fact / metric card. A `null` value renders an honest em dash. */
export type OverviewFact = {
  label: string
  /** Static value when known at author time (e.g. a protocol/standard); else null. */
  value?: string | null
  hint?: string
}

/** A primary action on the overview header (native route or a real console action). */
export type OverviewAction = {
  label: string
  /** In-console route to push (e.g. '/iam'); the ONLY navigation an action does. */
  to: string
  /** Lucide icon name to resolve in the shell (kept as a string so the spec is data). */
  icon?: 'arrow' | 'book' | 'plus' | 'settings' | 'terminal' | 'key' | 'shield'
  /** Lower-emphasis (chromeless) vs. the filled primary. */
  secondary?: boolean
}

/** One inline documentation section — rendered IN the console, not linked out. */
export type DocSection = {
  heading: string
  body: string
  /** Optional fixed-width snippet (CLI / endpoint / config) shown below the body. */
  code?: string
}

/** The full native-overview content for one product. */
export type OverviewSpec = {
  /** A one-paragraph "what this is", richer than the catalog's one-liner. */
  summary: string
  /** Live health source (real signal) or `none`. */
  health: HealthSource
  /** Key facts / metric cards (real where a backend exists, honest "—" otherwise). */
  facts: OverviewFact[]
  /** Header actions (native routes only). */
  actions: OverviewAction[]
  /** Inline documentation sections (the "use it from here" content). */
  docs: DocSection[]
}

/**
 * Per-product overview content. Keyed by catalog id. Products NOT listed here fall
 * back to a spec derived from the catalog entry alone (`defaultSpec`), so adding a
 * product never leaves a blank page.
 */
export const OVERVIEW_SPECS: Record<string, OverviewSpec> = {
  // ── Network ────────────────────────────────────────────────────────────────
  gateway: {
    summary:
      'The unified, authenticated, and metered API gateway. Every Hanzo Cloud API — models, embeddings, search, your own services — is fronted by the gateway at api.hanzo.ai/v1, which validates the IAM token, enforces per-org rate limits and quotas, and meters usage into billing. One surface, one credential, one bill.',
    health: { kind: 'platform-app', service: 'gateway' },
    facts: [
      { label: 'Base URL', value: 'api.hanzo.ai/v1' },
      { label: 'Auth', value: 'IAM bearer / sk- key' },
      { label: 'Surface', value: '/v1 — chat, embeddings, models' },
    ],
    actions: [
      { label: 'Create API key', to: '/api-keys', icon: 'key' },
      { label: 'View models', to: '/models', icon: 'arrow', secondary: true },
    ],
    docs: [
      {
        heading: 'Authenticate',
        body: 'Mint a Cloud API key on the API Keys page, then send it as a bearer token. The same key works for every product behind the gateway.',
        code: 'curl https://api.hanzo.ai/v1/models \\\n  -H "Authorization: Bearer $HANZO_API_KEY"',
      },
      {
        heading: 'Call a model',
        body: 'The gateway serves the standard chat-completions request shape. Point your SDK at api.hanzo.ai/v1 as its base URL and send the key as a bearer token.',
        code: 'POST https://api.hanzo.ai/v1/chat/completions\n{ "model": "zen-1", "messages": [{ "role": "user", "content": "hi" }] }',
      },
      {
        heading: 'Limits & metering',
        body: 'Rate limits and quotas are enforced per org and reported on the Cost page. A 429 means you hit a rate limit; a 402 means the org needs credit.',
      },
    ],
  },
  dns: {
    summary:
      'Managed authoritative DNS for your domains. Hanzo DNS hosts your zones on a global anycast network and takes record changes from this console or the API, so a record you add is answered from wherever the query arrives.',
    health: { kind: 'platform-app', service: 'dns' },
    facts: [
      { label: 'Record types', value: 'A · AAAA · CNAME · TXT · MX · SRV' },
      { label: 'Zones', value: null, hint: 'Connect the DNS service to list zones' },
      { label: 'Anycast', value: 'Global' },
    ],
    actions: [{ label: 'Open API reference', to: '/api', icon: 'book', secondary: true }],
    docs: [
      {
        heading: 'Host a zone',
        body: 'Create a zone for your domain, then point your registrar at the Hanzo nameservers. Records you add resolve from the global anycast network.',
        code: 'POST /v1/dns/zones { "domain": "example.com" }',
      },
      {
        heading: 'Manage records',
        body: 'Add, update, and delete records through the API or this console. Changes are authoritative the moment they are accepted.',
        code: 'POST /v1/dns/zones/example.com/records\n{ "type": "A", "name": "@", "value": "203.0.113.10", "ttl": 300 }',
      },
    ],
  },
  cdn: {
    summary:
      'Global content delivery and edge caching. Hanzo CDN keeps your static assets and API responses close to the people asking for them, honors your cache-control headers, and purges on demand — so requests are answered at the edge instead of travelling back to your origin.',
    health: { kind: 'platform-app', service: 'cdn' },
    facts: [
      { label: 'Edge locations', value: 'Global' },
      { label: 'Cache control', value: 'Origin headers honored' },
      { label: 'Purge', value: 'On-demand / by tag' },
    ],
    actions: [{ label: 'Configure at the edge', to: '/edge', icon: 'arrow', secondary: true }],
    docs: [
      {
        heading: 'Put a domain behind the CDN',
        body: 'Point a hostname at the CDN and set your origin. Responses are cached per their cache-control headers and served from the nearest edge.',
      },
      {
        heading: 'Purge cached content',
        body: 'Invalidate by path or by surrogate-key tag when you ship new content; the edge re-fetches from origin on the next request.',
        code: 'POST /v1/cdn/purge { "tags": ["release-2026-06-30"] }',
      },
    ],
  },

  // ── Security ───────────────────────────────────────────────────────────────
  mpc: {
    summary:
      'Threshold signing and multi-party computation. Hanzo MPC splits a private key into shares held by independent parties; a signature is produced only when a threshold of them cooperate, so no single machine ever holds the whole key. It backs custody, validator signing, and policy-gated approvals.',
    health: { kind: 'platform-app', service: 'mpc' },
    facts: [
      { label: 'Scheme', value: 'Threshold (t-of-n)' },
      { label: 'Key shares', value: 'Never reconstructed' },
      { label: 'Curves', value: 'secp256k1 · ed25519' },
    ],
    actions: [
      { label: 'Manage keys in KMS', to: '/kms', icon: 'key' },
      { label: 'Zero Trust policies', to: '/zero-trust', icon: 'shield', secondary: true },
    ],
    docs: [
      {
        heading: 'How threshold signing works',
        body: 'A key is generated as n shares with a signing threshold t. Producing a signature requires t parties to each contribute — the full private key is never assembled on any host.',
      },
      {
        heading: 'Request a signature',
        body: 'Submit a signing request referencing a key id; the coordinator gathers the threshold of partial signatures and returns the combined signature.',
        code: 'POST /v1/mpc/sign { "keyId": "...", "digest": "0x..." }',
      },
    ],
  },

  // ── Dev ──────────────────────────────────────────────────────────────────
  cli: {
    summary:
      'The hanzo command-line interface — Hanzo Cloud from a terminal or a CI job. Authenticate once, then deploy services, stream logs, manage keys and secrets, and call any product API from a script.',
    health: { kind: 'none' },
    facts: [
      { label: 'Install', value: 'curl hanzo.sh | sh' },
      { label: 'Auth', value: 'hanzo login' },
      { label: 'Scope', value: 'Every product API' },
    ],
    actions: [
      { label: 'Create API key', to: '/api-keys', icon: 'key' },
      { label: 'Deploy projects', to: '/projects', icon: 'arrow', secondary: true },
    ],
    docs: [
      {
        heading: 'Install',
        body: 'Install the CLI with the one-line installer, then sign in. The CLI uses the same IAM session as this console.',
        code: 'curl -fsSL https://hanzo.sh | sh\nhanzo login',
      },
      {
        heading: 'Deploy from source',
        body: 'From a repo, deploy a service to your cluster. The CLI builds via the CI/CD pipeline and the operator reconciles the release.',
        code: 'hanzo deploy --env main',
      },
      {
        heading: 'Stream logs',
        body: 'Tail logs for a running service across your clusters.',
        code: 'hanzo logs <service> --follow',
      },
    ],
  },
  sdks: {
    summary:
      'Official SDKs for Python, TypeScript, Go, and Rust. Each one wraps api.hanzo.ai/v1 — auth, retries, streaming, and typed responses — so a call reads the way your language reads.',
    health: { kind: 'none' },
    facts: [
      { label: 'Languages', value: 'Python · TS · Go · Rust' },
      { label: 'Base URL', value: 'api.hanzo.ai/v1' },
      { label: 'Request shape', value: 'Standard /v1 chat completions' },
    ],
    actions: [
      { label: 'Create API key', to: '/api-keys', icon: 'key' },
      { label: 'API reference', to: '/api', icon: 'book', secondary: true },
    ],
    docs: [
      {
        heading: 'Install',
        body: 'Add the SDK for your language. Set HANZO_API_KEY in the environment and the client picks it up.',
        code: 'pip install hanzoai      # Python\nnpm install @hanzo/sdk    # TypeScript',
      },
      {
        heading: 'First call',
        body: 'Clients default to api.hanzo.ai/v1. The gateway serves the standard chat-completions shape at that URL, so an SDK you already use can be pointed at it instead.',
        code: 'from hanzoai import Hanzo\nHanzo().chat.completions.create(model="zen-1", messages=[...])',
      },
    ],
  },
  api: {
    summary:
      'The REST API reference for every Hanzo Cloud service. One OpenAPI-described surface at api.hanzo.ai/v1 — models, embeddings, search, IAM, KMS, deploys, and more — all behind one IAM-validated credential.',
    health: { kind: 'platform-app', service: 'gateway' },
    facts: [
      { label: 'Base URL', value: 'api.hanzo.ai/v1' },
      { label: 'Spec', value: 'OpenAPI 3' },
      { label: 'Auth', value: 'Bearer (IAM / sk-)' },
    ],
    actions: [
      { label: 'Create API key', to: '/api-keys', icon: 'key' },
      { label: 'Try in Playground', to: '/playground', icon: 'arrow', secondary: true },
    ],
    docs: [
      {
        heading: 'Versioning',
        body: 'The API is versioned at /v1 and stays backward-compatible within the version. There is one surface — no per-product hosts.',
      },
      {
        heading: 'Authentication',
        body: 'Every request carries an Authorization: Bearer header — an IAM user token or an sk- Cloud API key minted on the API Keys page.',
        code: 'Authorization: Bearer sk-...',
      },
    ],
  },
  ide: {
    summary:
      'The Hanzo AI development environment — a browser and desktop IDE wired to Hanzo models, your repos, and your cloud. Edit, run, and ship with the assistant in the loop and your cloud credentials already present.',
    health: { kind: 'none' },
    facts: [
      { label: 'Targets', value: 'Browser · Desktop' },
      { label: 'Models', value: 'Zen + your routes' },
      { label: 'Auth', value: 'Your IAM session' },
    ],
    actions: [{ label: 'Open Playground', to: '/playground', icon: 'arrow', secondary: true }],
    docs: [
      {
        heading: 'What it is',
        body: 'An AI-native IDE that connects to your Hanzo Cloud account, so the models, keys, and deploy targets you manage here are available while you code.',
      },
    ],
  },
  desktop: {
    summary:
      'The Hanzo desktop app — the console, assistant, and developer tools as a native application, signed in to your IAM session with local file and tool access.',
    health: { kind: 'none' },
    facts: [
      { label: 'Platforms', value: 'macOS · Linux · Windows' },
      { label: 'Auth', value: 'Your IAM session' },
    ],
    actions: [{ label: 'Open Chat', to: '/chat', icon: 'arrow', secondary: true }],
    docs: [
      {
        heading: 'What it is',
        body: 'A native wrapper around the Hanzo console and assistant with local tool access, signed in to the same account you use here.',
      },
    ],
  },
  registry: {
    summary:
      'Container images and build artifacts for your services, published to ghcr.io/hanzoai by the CI/CD pipeline. Every deployable service ships as a semver-tagged image the operator pulls and reconciles onto your clusters.',
    health: { kind: 'none' },
    facts: [
      { label: 'Registry', value: 'ghcr.io/hanzoai' },
      { label: 'Tags', value: 'Semver only' },
      { label: 'Built by', value: 'Self-hosted CI' },
    ],
    actions: [
      { label: 'View builds', to: '/builds', icon: 'arrow' },
      { label: 'Releases', to: '/releases', icon: 'arrow', secondary: true },
    ],
    docs: [
      {
        heading: 'How images are built',
        body: 'A push to a service repo triggers the self-hosted CI, which builds a semver-tagged image and publishes it to the registry. Floating tags never reach a cluster.',
      },
      {
        heading: 'Deploying an image',
        body: 'The operator deploys the tag declared in your universe manifests. Bump the declared tag and the operator reconciles the new image.',
      },
    ],
  },

  // ── Observe ──────────────────────────────────────────────────────────────
  metrics: {
    summary:
      'Product metrics, events, and sessions. Hanzo Metrics captures user and system events into a queryable analytics store, so you can track funnels, retention, and feature usage alongside your AI workloads.',
    health: { kind: 'platform-app', service: 'insights' },
    facts: [
      { label: 'Captures', value: 'Events · sessions' },
      { label: 'Query', value: 'SQL / API' },
      { label: 'Retention', value: null, hint: 'Per plan' },
    ],
    actions: [
      { label: 'Open Dashboards', to: '/dashboards', icon: 'arrow' },
      { label: 'AI Metrics', to: '/ai-metrics', icon: 'arrow', secondary: true },
    ],
    docs: [
      {
        heading: 'Send events',
        body: 'Instrument your app with the Insights SDK or POST events to the ingest endpoint; they become queryable immediately.',
        code: 'POST /v1/insights/events { "event": "signup", "props": { ... } }',
      },
    ],
  },

  // ── Apps ─────────────────────────────────────────────────────────────────
  crawl: {
    summary:
      'Crawl and extract the web for your agents. Hanzo Crawl fetches pages, renders JavaScript, and returns clean, structured content (markdown, text, or JSON) — the retrieval front-end for RAG and agent workflows.',
    health: { kind: 'platform-app', service: 'crawl' },
    facts: [
      { label: 'Output', value: 'Markdown · text · JSON' },
      { label: 'Rendering', value: 'JS-aware' },
      { label: 'Auth', value: 'Bearer (IAM / sk-)' },
    ],
    actions: [
      { label: 'Create API key', to: '/api-keys', icon: 'key' },
      { label: 'Store results in Vector', to: '/vector', icon: 'arrow', secondary: true },
    ],
    docs: [
      {
        heading: 'Crawl a URL',
        body: 'Submit a URL and get back clean, structured content ready to embed or feed to a model. JavaScript pages are rendered first.',
        code: 'POST https://api.hanzo.ai/v1/crawl { "url": "https://example.com" }',
      },
      {
        heading: 'Pipe into RAG',
        body: 'Crawl output drops straight into an embeddings collection — crawl, embed, then search over the indexed content.',
      },
    ],
  },
  studio: {
    summary:
      'Build AI apps and pipelines visually. Hanzo Studio is a node-based canvas: wire models, tools, and data into a flow, run it, then publish the flow as an endpoint you can call.',
    health: { kind: 'platform-app', service: 'studio' },
    facts: [
      { label: 'Builder', value: 'Visual flows' },
      { label: 'Publishes', value: 'Runnable endpoints' },
      { label: 'Models', value: 'Zen + your routes' },
    ],
    actions: [
      { label: 'Configure models', to: '/models', icon: 'arrow' },
      { label: 'Browse agents', to: '/agents', icon: 'arrow', secondary: true },
    ],
    docs: [
      {
        heading: 'Compose a flow',
        body: 'Drag model, tool, and data nodes onto the canvas and wire them together. The flow runs against the same models and keys you manage here.',
      },
      {
        heading: 'Publish as an endpoint',
        body: 'Publish a finished flow to get a callable endpoint behind the gateway, metered like any other API.',
      },
    ],
  },
  console: {
    summary:
      'The cloud console — this application. One place to see, manage, and bill every Hanzo Cloud product: AI, compute, data, network, security, deploys, observability, and more, all scoped to your organization.',
    health: { kind: 'platform-app', service: 'console' },
    facts: [
      { label: 'Products', value: 'All of Hanzo Cloud' },
      { label: 'Scope', value: 'Your organization' },
      { label: 'Auth', value: 'Hanzo IAM (OIDC)' },
    ],
    actions: [
      { label: 'Go to Overview', to: '/', icon: 'arrow' },
      { label: 'Settings', to: '/settings', icon: 'settings', secondary: true },
    ],
    docs: [
      {
        heading: 'You are here',
        body: 'This is the console. Use the sidebar to open any product, the org switcher to change scope, and the command palette (Cmd+K) to jump anywhere.',
      },
    ],
  },
}
