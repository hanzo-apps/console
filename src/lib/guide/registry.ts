/**
 * The product-guide CATALOG — hand-authored pitches + dynamic getting-started steps
 * for the flagship products a user actually onboards into. The DRY twin of
 * `overview/spec.ts` (OVERVIEW_SPECS): keyed by catalog id, resolved by `resolveGuide`.
 *
 * Scope is deliberately CURATED, not universal: a guide exists only where there is a
 * real, compelling pitch and honestly-checkable steps to show — so the panel appears
 * where it sells the product and is silent everywhere else (no generic nagging on the
 * long tail, which keeps its own native overview / admin surface). Every claim here
 * is real (drawn from the product's actual capabilities); every step's `done`
 * predicate reads a REAL signal, so the checklist can never fabricate progress.
 *
 * PURE DATA (no React) — the icon is a string name resolved in the component, the
 * `done`/`when` predicates are plain functions over `GuideSignals`. Node-testable.
 */
import type { ProductGuide } from './spec'
import { isUsed, canAdminister, type GuideSignals } from './signals'

/** Done when the account holds a Cloud API key (a real, strong signal). */
const hasKey = (s: GuideSignals): boolean => s.hasApiKey === true
/** Done when the user has opened any of the given products in-console (real telemetry). */
const usedAny =
  (...ids: string[]) =>
  (s: GuideSignals): boolean =>
    ids.some((id) => isUsed(s, id))

/** The shared "Create your API key" step — reused across every product that needs a key. */
const getKeyStep = (label: string) => ({
  id: 'api-key',
  title: 'Create your API key',
  body: `Mint a personal \`sk-\` key to call ${label} from your apps, SDKs, and CLI. It is the fastest way to start building.`,
  action: { label: 'Get API key', to: '/api-keys' },
  done: hasKey,
})

/**
 * Curated guides, keyed by catalog id. Route targets are real in-console routes
 * (leading slash) — enforced by `registry.test.ts`.
 */
export const GUIDES: Record<string, ProductGuide> = {
  // ── Console home — the top-level onboarding checklist ────────────────────────
  overview: {
    id: 'overview',
    label: 'your console',
    pitch: {
      headline: 'Your entire AI cloud, in one console.',
      subhead:
        'Models, vector search, functions, deployments, identity, and spend — every Hanzo Cloud product behind one login, one API key, and one bill. Here is the fastest path from signed-in to shipping.',
      points: [
        { title: 'One key, every product', body: 'A single credential calls models, embeddings, search, and your own services.', icon: 'zap' },
        { title: 'Pay for what you use', body: 'Per-token pricing, live usage, and spend on the overview — no minimums, no surprises.', icon: 'coins' },
        { title: 'Open by default', body: 'Every product is open-source and runs on your terms — self-host or run it here.', icon: 'globe' },
      ],
    },
    steps: [
      getKeyStep('every Hanzo model'),
      {
        id: 'first-call',
        title: 'Try it in the Playground',
        body: 'Send your first prompt to a live model right in the browser — no code needed — then copy the request as curl or SDK.',
        action: { label: 'Open Playground', to: '/playground' },
        done: usedAny('playground', 'chat', 'models'),
      },
      {
        id: 'ship',
        title: 'Ship something',
        body: 'Deploy a serverless function or an app from Git and get a live URL in minutes.',
        action: { label: 'Open Functions', to: '/functions' },
        done: usedAny('functions', 'projects', 'applications'),
      },
      {
        id: 'invite',
        title: 'Invite your team',
        body: 'Add teammates and assign roles so everyone works in the same organization.',
        action: { label: 'Open IAM', to: '/iam' },
        when: (s) => canAdminister(s.role),
        done: usedAny('iam'),
      },
    ],
    // The home carries stable anchors (sidebar, api-key CTA, metrics) the first-run
    // tour already spotlights — appended after the generated step-walk.
    tour: [
      { id: 'nav', target: '[data-tour="nav"]', title: 'Every product, one place', body: 'Browse and open every product from the sidebar — pin the ones you use most.', placement: 'right' },
      { id: 'metrics', target: '[data-tour="metrics"]', title: 'Live observability', body: 'Your inference metrics, logs, and traces stream here in real time.', placement: 'top' },
    ],
  },

  // ── AI ───────────────────────────────────────────────────────────────────────
  models: {
    id: 'models',
    label: 'Models',
    pitch: {
      headline: '400+ models. One OpenAI-compatible API.',
      subhead:
        'Frontier and open models — Zen, Claude, GPT, Llama, and more — behind a single /v1 endpoint. Switch models by changing one string; routing and fallback are built in.',
      points: [
        { title: 'Drop-in compatible', body: 'The OpenAI /v1 surface — point your existing SDK at Hanzo and go.', icon: 'plug' },
        { title: 'Per-token pricing', body: 'Transparent per-Mtok rates on every model, metered into one bill.', icon: 'coins' },
        { title: 'Route & fall back', body: 'Set a primary and let requests fail over automatically.', icon: 'gauge' },
      ],
    },
    steps: [
      getKeyStep('any model'),
      {
        id: 'playground',
        title: 'Compare models in the Playground',
        body: 'Send the same prompt to different models side by side and pick the best fit for your task and budget.',
        action: { label: 'Open Playground', to: '/playground' },
        done: usedAny('playground'),
      },
    ],
  },

  chat: {
    id: 'chat',
    label: 'Chat',
    pitch: {
      headline: 'A production chat surface, grounded in your data.',
      subhead:
        'Multi-turn conversations over any Hanzo model, with retrieval-augmented answers grounded in your own collections. Streamed token-by-token, with an honest add-credits state.',
      points: [
        { title: 'Grounded RAG', body: 'Answers cite your indexed documents, not just the model’s memory.', icon: 'sparkles' },
        { title: 'Any model', body: 'Default to Zen or pick any model in the catalog per conversation.', icon: 'zap' },
        { title: 'Streaming', body: 'Replies stream as they generate — no waiting for the full turn.', icon: 'gauge' },
      ],
    },
    steps: [
      getKeyStep('Chat'),
      {
        id: 'start',
        title: 'Start a conversation',
        body: 'Open Chat and send your first message to a live model.',
        action: { label: 'Open Chat', to: '/chat' },
        done: usedAny('chat'),
      },
    ],
  },

  embeddings: {
    id: 'embeddings',
    label: 'Embeddings',
    pitch: {
      headline: 'Vector search over your data, in three steps.',
      subhead:
        'Create a collection, ingest your documents, and query them semantically — embeddings, indexing, and retrieval on one managed surface backed by a real vector store.',
      points: [
        { title: 'Managed collections', body: 'Cosine-indexed collections with ingest and search built in.', icon: 'database' },
        { title: 'Any embedding model', body: 'Generate vectors with the model that fits your recall/cost target.', icon: 'sparkles' },
        { title: 'Semantic search', body: 'Query by meaning and get ranked hits with source locators.', icon: 'search' },
      ],
    },
    steps: [
      {
        id: 'collection',
        title: 'Create a collection',
        body: 'A collection is your searchable index. Name one and choose its embedding model.',
        action: { label: 'Open Embeddings', to: '/embeddings' },
        done: usedAny('embeddings'),
      },
      getKeyStep('the embeddings API'),
    ],
  },

  agents: {
    id: 'agents',
    label: 'Agents',
    pitch: {
      headline: 'Autonomous agents with tools and memory.',
      subhead:
        'Compose agents that plan, call tools, and remember across turns — then watch their runs, logs, and metrics in the console.',
      points: [
        { title: 'Tool use', body: 'Give an agent tools and let it decide when to call them.', icon: 'plug' },
        { title: 'Observable runs', body: 'Every run streams its steps, logs, and metrics here.', icon: 'gauge' },
        { title: 'Multi-agent', body: 'Coordinate several agents on one task.', icon: 'sparkles' },
      ],
    },
    steps: [
      getKeyStep('Agents'),
      {
        id: 'create',
        title: 'Create your first agent',
        body: 'Define an agent, give it tools, and start a run.',
        action: { label: 'Open Agents', to: '/agents' },
        done: usedAny('agents'),
      },
    ],
  },

  playground: {
    id: 'playground',
    label: 'Playground',
    pitch: {
      headline: 'Prompt any model, then ship the code.',
      subhead:
        'Test prompts against live models in the browser, tune parameters, and copy a working request as curl or an SDK snippet.',
      points: [
        { title: 'No setup', body: 'Prompt a live model instantly — nothing to install.', icon: 'zap' },
        { title: 'Copy as code', body: 'Export any run as a ready-to-paste curl or SDK call.', icon: 'code' },
        { title: 'Tune it', body: 'Adjust temperature, tokens, and system prompt and see the effect.', icon: 'gauge' },
      ],
    },
    steps: [
      {
        id: 'run',
        title: 'Run a prompt',
        body: 'Send your first prompt to a live model right here in the Playground.',
        action: { label: 'Open Playground', to: '/playground' },
        done: usedAny('playground'),
      },
      getKeyStep('models from your own code'),
    ],
  },

  vector: {
    id: 'vector',
    label: 'Vector',
    pitch: {
      headline: 'A managed vector database, provisioned on demand.',
      subhead:
        'Spin up a collection and store, index, and query embeddings with cosine similarity — the vector layer behind retrieval and semantic search.',
      points: [
        { title: 'On-demand', body: 'Provision a collection in the console — no cluster to run.', icon: 'database' },
        { title: 'Semantic queries', body: 'Nearest-neighbor search over your vectors.', icon: 'search' },
        { title: 'Open source', body: 'Backed by open vector infrastructure you can self-host.', icon: 'globe' },
      ],
    },
    steps: [
      {
        id: 'collection',
        title: 'Create a collection',
        body: 'Name a collection to hold your vectors and start indexing.',
        action: { label: 'Open Vector', to: '/vector' },
        done: usedAny('vector'),
      },
    ],
  },

  functions: {
    id: 'functions',
    label: 'Functions',
    pitch: {
      headline: 'Ship serverless functions in minutes.',
      subhead:
        'Deploy code that runs on demand — no servers to manage. Triggers, secrets, and per-invocation metrics are built in.',
      points: [
        { title: 'No servers', body: 'Push a function and it scales to zero when idle.', icon: 'zap' },
        { title: 'Triggers & secrets', body: 'Wire HTTP or event triggers and inject secrets safely.', icon: 'plug' },
        { title: 'Per-call metrics', body: 'Invocations, duration, and errors tracked per function.', icon: 'gauge' },
      ],
    },
    steps: [
      {
        id: 'deploy',
        title: 'Deploy your first function',
        body: 'Open Functions and create one — it gets an invocation URL immediately.',
        action: { label: 'Open Functions', to: '/functions' },
        done: usedAny('functions'),
      },
      getKeyStep('your functions'),
    ],
  },

  projects: {
    id: 'projects',
    label: 'Projects',
    pitch: {
      headline: 'From Git to a live URL.',
      subhead:
        'Deploy apps straight from a repository or an upload and get a production URL, with builds, environments, and releases tracked in the console.',
      points: [
        { title: 'Git or upload', body: 'Deploy from a repo or drop in a build — your choice.', icon: 'code' },
        { title: 'Live URL', body: 'Every deploy gets a real, health-gated URL.', icon: 'globe' },
        { title: 'Environments', body: 'Promote across environments with tracked releases.', icon: 'gauge' },
      ],
    },
    steps: [
      {
        id: 'create',
        title: 'Create a project',
        body: 'Point Projects at a repo or an upload to run your first deploy.',
        action: { label: 'Open Projects', to: '/projects' },
        done: usedAny('projects', 'applications'),
      },
    ],
  },

  // ── Security ───────────────────────────────────────────────────────────────
  iam: {
    id: 'iam',
    label: 'IAM',
    pitch: {
      headline: 'Identity for your whole organization.',
      subhead:
        'Manage users, roles, and organizations with a real OIDC provider — the same identity every Hanzo product authenticates against.',
      points: [
        { title: 'OIDC native', body: 'A standards-compliant issuer your apps can trust.', icon: 'lock' },
        { title: 'Roles & orgs', body: 'Assign roles and scope access per organization.', icon: 'shield' },
        { title: 'One identity', body: 'The same login secures every product in the console.', icon: 'globe' },
      ],
    },
    steps: [
      {
        id: 'invite',
        title: 'Invite a teammate',
        body: 'Add a user to your organization and assign their role.',
        action: { label: 'Open IAM', to: '/iam' },
        when: (s) => canAdminister(s.role),
        done: usedAny('iam'),
      },
    ],
  },
}

/** The curated guide for a catalog id, or `undefined` (the panel then stays silent). */
export function resolveGuide(id: string): ProductGuide | undefined {
  return GUIDES[id]
}

/** True when a product has a curated guide. */
export function hasGuide(id: string): boolean {
  return id in GUIDES
}
