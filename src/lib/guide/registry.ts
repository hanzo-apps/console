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
import { CONSOLE_TOUR, PLAYGROUND_TOUR } from '~/lib/tour/steps'

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
  body: `Mint a personal sk- key to call ${label} from your apps, SDKs and CLI.`,
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
      headline: 'Every Hanzo product, one console.',
      subhead:
        'Models, vector search, functions, deployments, identity and spend, behind one login, one API key and one bill. Start with a key and a first call.',
      points: [
        { title: 'One key, every product', body: 'A single credential calls models, embeddings, search, and your own services.', icon: 'zap' },
        { title: 'Pay for what you use', body: 'Per-token pricing, with usage and spend on the overview.', icon: 'coins' },
        { title: 'Open source', body: 'The code is open — run a product here, or host it yourself.', icon: 'globe' },
      ],
    },
    steps: [
      getKeyStep('every Hanzo model'),
      {
        id: 'first-call',
        title: 'Try it in the Playground',
        body: 'Send your first prompt to a live model in the browser, with no code, then copy the request as curl or JSON.',
        action: { label: 'Open Playground', to: '/playground' },
        done: usedAny('playground', 'chat', 'models'),
      },
      {
        id: 'ship',
        title: 'Deploy a function',
        body: 'Deploy a serverless function and call it over HTTP.',
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
    // ONE console tour: the same walk the first-run tour opens by itself
    // (`FirstRunTour`) is what this card's "Take the tour" replays on demand.
    tour: CONSOLE_TOUR,
  },

  // ── AI ───────────────────────────────────────────────────────────────────────
  models: {
    id: 'models',
    label: 'Models',
    pitch: {
      headline: 'Frontier and open models, one API.',
      subhead:
        'Zen, Claude, GPT, Llama and more, all called through a single /v1 endpoint. Switching model means changing one string.',
      points: [
        { title: 'Same request shape', body: 'The /v1 endpoints keep the shape your SDK already sends, so it needs a new base URL and key.', icon: 'plug' },
        { title: 'Per-token pricing', body: 'Per-Mtok rates in the catalog, metered into one bill.', icon: 'coins' },
        { title: 'Routing and fallback', body: 'Give a model a primary provider and up to two fallbacks.', icon: 'gauge' },
      ],
    },
    steps: [
      getKeyStep('any model'),
      {
        id: 'playground',
        title: 'Compare models in the Playground',
        body: 'Send the same prompt to different models side by side and see which one suits your task and your budget.',
        action: { label: 'Open Playground', to: '/playground' },
        done: usedAny('playground'),
      },
    ],
  },

  chat: {
    id: 'chat',
    label: 'Chat',
    pitch: {
      headline: 'Multi-turn chat over any model in the catalog.',
      subhead:
        'Conversations against any model, streamed as they are written, with the Hanzo docs available to answer from.',
      points: [
        { title: 'Retrieval', body: 'An answer can draw on the Hanzo documentation.', icon: 'sparkles' },
        { title: 'Any model', body: 'Default to Zen or pick any model in the catalog per conversation.', icon: 'zap' },
        { title: 'Streaming', body: 'Replies arrive as they are written, not after the turn ends.', icon: 'gauge' },
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
      headline: 'Search your documents by meaning.',
      subhead:
        'Create a collection, add your documents, and query them by meaning. Embedding, indexing and retrieval sit on one surface.',
      points: [
        { title: 'Managed collections', body: 'Cosine-indexed collections with ingest and search built in.', icon: 'database' },
        { title: 'Any embedding model', body: 'Generate vectors with the model that fits your recall and your budget.', icon: 'sparkles' },
        { title: 'Semantic search', body: 'Query by meaning and get ranked matches.', icon: 'search' },
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
      headline: 'An agent, its tools, and a record of every run.',
      subhead:
        'Define an agent, give it tools, and start a run. Its output, status and duration are kept in the console.',
      points: [
        { title: 'Tool use', body: 'Give an agent tools and let it decide when to call them.', icon: 'plug' },
        { title: 'Runs on the record', body: 'A run keeps its output, its status and how long it took.', icon: 'gauge' },
        { title: 'Multi-agent', body: 'Several agents can work on one task.', icon: 'sparkles' },
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
        'Test prompts against live models in the browser, tune the parameters, and copy the request that ran as curl or JSON.',
      points: [
        { title: 'No setup', body: 'Prompt a live model from the browser. Nothing to install.', icon: 'zap' },
        { title: 'Copy as code', body: 'Take any run away as a curl command or the raw JSON request.', icon: 'code' },
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
    // The real walk of the Playground's own surfaces — modes, model, composer, Run,
    // the response and its cost, tuning, and taking the code away.
    tour: PLAYGROUND_TOUR,
  },

  vector: {
    id: 'vector',
    label: 'Vector',
    pitch: {
      headline: 'A vector database you create from the console.',
      subhead:
        'Store, index and query embeddings with cosine similarity, from your own client. It is what retrieval and semantic search run on.',
      points: [
        { title: 'On-demand', body: 'Provision a collection in the console — no cluster to run.', icon: 'database' },
        { title: 'Semantic queries', body: 'Nearest-neighbor search over your vectors.', icon: 'search' },
        { title: 'Open source', body: 'Built on hanzoai/vector, which is open source.', icon: 'globe' },
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
      headline: 'Functions run your code on demand.',
      subhead:
        'Deploy from the CLI. The console lists each function with its endpoint, its triggers, the secrets it reads and its per-invocation metrics.',
      points: [
        { title: 'No servers', body: 'Push a function and it scales to zero when idle.', icon: 'zap' },
        { title: 'Triggers & secrets', body: 'HTTP and event triggers, and the names of the secrets a function reads.', icon: 'plug' },
        { title: 'Per-call metrics', body: 'Invocations, duration, and errors tracked per function.', icon: 'gauge' },
      ],
    },
    steps: [
      {
        id: 'deploy',
        title: 'Deploy your first function',
        body: 'Deploy one from the CLI, then open Functions to see it with its endpoint.',
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
      headline: 'Group your work under a project.',
      subhead:
        'A project is what everything else is scoped to — API keys, datasets, deploys and observability. Make one your active scope and the console follows it.',
      points: [
        { title: 'One scope', body: 'API keys, datasets, deploys and logs all belong to a project.', icon: 'code' },
        { title: 'Switch in the top bar', body: 'Pick a project and every module reads that project.', icon: 'globe' },
        { title: 'Environments', body: 'Each project carries its own environments.', icon: 'gauge' },
      ],
    },
    steps: [
      {
        id: 'create',
        title: 'Create a project',
        body: 'Name a project, then use it as the scope for the work that follows.',
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
        'Manage users, roles and organizations on an OIDC provider — the same identity every Hanzo product authenticates against.',
      points: [
        { title: 'OIDC native', body: 'An OIDC issuer your apps can authenticate against.', icon: 'lock' },
        { title: 'Roles & orgs', body: 'Assign roles and scope access per organization.', icon: 'shield' },
        { title: 'One identity', body: 'The same login secures every product in the console.', icon: 'globe' },
      ],
    },
    steps: [
      {
        id: 'invite',
        title: 'Invite a teammate',
        body: 'Add a user to your organization and set their role in IAM.',
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
