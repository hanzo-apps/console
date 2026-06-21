/**
 * Provider domain logic — pure, no UI.
 *
 * Ported from ProviderEditPage.js: the new-provider template, the
 * category→type→subType cascade defaults, conditional field visibility, and the
 * temperature/topP enablement rules. Kept pure so the edit view stays a thin
 * render layer and this can be unit-tested.
 */
import type { Provider } from '~/lib/api'

const randomSuffix = () => Math.random().toString(36).slice(2, 8)

/** A fresh Model provider, mirroring ProviderListPage.newProvider(). */
export function newProvider(owner: string): Provider {
  const suffix = randomSuffix()
  return {
    owner,
    name: `provider_${suffix}`,
    displayName: `New Provider - ${suffix}`,
    category: 'Model',
    type: 'OpenAI',
    subType: 'gpt-4',
    clientId: '',
    clientSecret: '',
    apiKey: '',
    apiVersion: '',
    providerUrl: 'https://platform.openai.com/account/api-keys',
    compatibleProvider: '',
    temperature: 1,
    topP: 1,
    topK: 4,
    frequencyPenalty: 0,
    presencePenalty: 0,
    enableThinking: false,
    inputPricePerThousandTokens: 0,
    outputPricePerThousandTokens: 0,
    currency: 'USD',
    region: '',
    state: 'Active',
    isDefault: false,
    isRemote: false,
  }
}

export const CATEGORY_OPTIONS = [
  'Storage',
  'Model',
  'Embedding',
  'Agent',
  'Public Cloud',
  'Private Cloud',
  'Blockchain',
  'Video',
  'Text-to-Speech',
  'Speech-to-Text',
  'Bot',
  'Scan',
] as const

export const CURRENCY_OPTIONS = [
  'USD',
  'CNY',
  'EUR',
  'JPY',
  'GBP',
  'AUD',
  'CAD',
  'CHF',
  'HKD',
  'SGD',
] as const

export const STATE_OPTIONS = ['Active', 'Inactive'] as const

/** Default {type, subType} applied when the category changes. */
const CATEGORY_DEFAULTS: Record<string, Partial<Provider>> = {
  Storage: { type: 'Local File System' },
  Model: { type: 'OpenAI', subType: 'gpt-4' },
  Embedding: { type: 'OpenAI', subType: 'AdaSimilarity' },
  Agent: { type: 'MCP', subType: 'Default' },
  Video: { type: 'AWS' },
  'Text-to-Speech': { type: 'Alibaba Cloud', subType: 'cosyvoice-v1' },
  'Speech-to-Text': { type: 'Alibaba Cloud', subType: 'paraformer-realtime-v1' },
  'Private Cloud': { type: 'Kubernetes' },
  Bot: { type: 'Tencent', subType: 'WeCom Bot' },
  Scan: { type: 'Nmap', subType: 'Default' },
}

/** Default subType applied when the type changes, keyed by category then type. */
const TYPE_SUBTYPE: Record<string, Record<string, string>> = {
  Model: {
    OpenAI: 'gpt-4',
    Gemini: 'gemini-pro',
    OpenRouter: 'openai/gpt-4',
    Claude: 'claude-opus-4-0',
    Azure: 'gpt-4',
    'Alibaba Cloud': 'qwen-long',
    DeepSeek: 'deepseek-chat',
    Ollama: 'llama3.3:70b',
    Local: 'custom-model',
  },
  Embedding: {
    OpenAI: 'AdaSimilarity',
    Gemini: 'embedding-001',
    Azure: 'AdaSimilarity',
    Local: 'custom-embedding',
  },
  Agent: { MCP: 'Default', A2A: 'Default' },
  'Text-to-Speech': { 'Alibaba Cloud': 'cosyvoice-v1' },
  'Speech-to-Text': { 'Alibaba Cloud': 'paraformer-realtime-v1' },
  Bot: { Tencent: 'WeCom Bot' },
}

/** Apply category change with its type/subType defaults. */
export function applyCategory(p: Provider, category: string): Provider {
  return { ...p, category, ...(CATEGORY_DEFAULTS[category] ?? {}) }
}

/** Apply type change with its subType default for the current category. */
export function applyType(p: Provider, type: string): Provider {
  const sub = TYPE_SUBTYPE[p.category]?.[type]
  return { ...p, type, ...(sub ? { subType: sub } : {}) }
}

const MODEL_CATS = ['Model', 'Embedding', 'Text-to-Speech', 'Speech-to-Text', 'Agent', 'Bot']

export const showSubType = (p: Provider) => MODEL_CATS.includes(p.category)

export const showRegion = (p: Provider) =>
  !['Storage', 'Model', 'Embedding', 'Agent', 'Text-to-Speech', 'Speech-to-Text', 'Scan'].includes(
    p.category,
  ) &&
  !(p.category === 'Blockchain' && p.type === 'Ethereum') &&
  !(p.category === 'Private Cloud' && p.type === 'Kubernetes')

export const showClientSecret = (p: Provider) =>
  !(
    (p.category === 'Storage' && p.type !== 'OpenAI File System') ||
    (p.category === 'Agent' && p.type === 'MCP') ||
    (p.category === 'Blockchain' && p.type === 'ChainMaker') ||
    p.category === 'Scan' ||
    p.type === 'Dummy' ||
    p.type === 'Ollama'
  )

const TEMP_TYPES = [
  'OpenRouter',
  'Gemini',
  'Alibaba Cloud',
  'DeepSeek',
  'Mistral',
  'Ollama',
  'Writer',
  'Tencent Cloud',
  'StepFun',
  'Yi',
  'Baichuan',
]

const isReasoning = (sub: string) =>
  sub.includes('o1') || sub.includes('o3') || sub.includes('o4')

export const temperatureEnabled = (p: Provider): boolean => {
  if (p.category !== 'Model') return false
  if (TEMP_TYPES.includes(p.type)) return true
  if (p.type === 'OpenAI') return !isReasoning(p.subType ?? '')
  return false
}

export const topPEnabled = temperatureEnabled

/** Whether temperature/topP/penalty sliders apply at all for this provider. */
export const showSampling = (p: Provider) => p.category === 'Model'
