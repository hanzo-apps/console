/**
 * GUI-free list of top-level product slugs — the prerender manifest for the
 * static export.
 *
 * WHY THIS EXISTS (and is a plain constant, not derived at build): the product
 * registry (`registry.tsx`) statically imports ~100 react-native-web GUI module
 * trees, which cannot be evaluated server-side. `output: 'export'` requires a
 * NON-EMPTY `generateStaticParams()` for every dynamic route, and that function
 * runs in the Node build — so it must NOT import the registry. This constant is the
 * registry's routable-id projection, kept GUI-free so `generateStaticParams` can
 * enumerate real product pages (`/ai`, `/models`, … and `/discover/<id>`) without
 * dragging the GUI into the server bundle.
 *
 * GRACEFUL DEGRADATION: this is a PRERENDER OPTIMIZATION, not a correctness gate.
 * A product URL not listed here is still fully served — the cloud binary's SPA
 * handler returns `index.html` for any unmatched path (webui.go) and the client
 * resolves it from the URL. Listing a slug here just gives it its own prerendered
 * HTML (so a hard load / soft client-nav resolves without a full reload). A newly
 * added product therefore works immediately; add its id here to prerender it.
 *
 * SOURCE OF TRUTH: extracted from `registry.tsx` catalog `id:` literals. When a
 * product is added/removed there, mirror it here (the console keeps working
 * either way — see above).
 */
export const PRODUCT_SLUGS: readonly string[] = [
  'agents', 'ai-metrics', 'alerts', 'annotation-queues', 'api', 'api-keys', 'applications',
  'attestations', 'audit', 'authz', 'base', 'billing', 'bot', 'builds', 'cdn', 'chat', 'cli',
  'clusters', 'console', 'containers', 'crawl', 'customers', 'dashboards', 'datasets', 'datastore',
  'desktop', 'dns', 'docdb', 'edge', 'embeddings', 'environments', 'evals', 'experiments',
  'finetuning', 'functions', 'gateway', 'gpus', 'hsm', 'iam', 'ide', 'indexer', 'inference',
  'integrations', 'inventory', 'kms', 'kubeflow', 'kubernetes', 'kv', 'load-balancer', 'logs',
  'machines', 'marketplace', 'memory', 'metrics', 'models', 'mpc', 'networks', 'nodes', 'o11y',
  'observations', 'oracles', 'orders', 'overview', 'pipelines', 'plans', 'playground', 'products',
  'profile', 'projects', 'promotions', 'prompts', 'providers', 'referrals', 'registry', 'releases',
  's3', 'score-configs', 'scores', 'sdks', 'search', 'secrets', 'service-mesh', 'sessions',
  'settings', 'settlement', 'sql', 'status', 'storefront', 'studio', 'tasks', 'team', 'tokens',
  'users', 'vector', 'vpc', 'wallet', 'zero-trust',
]
