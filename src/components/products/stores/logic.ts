/**
 * Store domain logic — pure, no UI.
 *
 * Ported from StoreListPage.newStore(): the new-store template (provider wiring,
 * chunk/search strategy, chat copy, limits). Kept to the meaningful fields the
 * editor surfaces; the backend round-trips the rest via the Store passthrough.
 */
import type { Store } from '~/lib/api'

const randomSuffix = () => Math.random().toString(36).slice(2, 8)

/** A fresh store, mirroring StoreListPage.newStore(). */
export function newStore(owner: string): Store {
  const suffix = randomSuffix()
  return {
    owner,
    name: `store_${suffix}`,
    displayName: `New Store - ${suffix}`,
    title: `Title - ${suffix}`,
    storageProvider: 'provider-storage-built-in',
    storageSubpath: `store_${suffix}`,
    imageProvider: '',
    splitProvider: 'Default',
    searchProvider: 'Default',
    modelProvider: '',
    embeddingProvider: '',
    agentProvider: '',
    textToSpeechProvider: 'Browser Built-In',
    speechToTextProvider: 'Browser Built-In',
    memoryLimit: 5,
    frequency: 10000,
    limitMinutes: 10,
    knowledgeCount: 5,
    suggestionCount: 3,
    welcome: 'Hello',
    welcomeTitle: "Hello, I'm Hanzo AI Assistant",
    welcomeText: "I'm here to help answer your questions",
    prompt: '',
    themeColor: '#5734d3',
    state: 'Active',
    isDefault: false,
  }
}

export const SPLIT_OPTIONS = ['Default', 'Basic', 'QA', 'Markdown'] as const
export const SEARCH_OPTIONS = ['Default', 'Hierarchy'] as const
export const STATE_OPTIONS = ['Active', 'Inactive'] as const
