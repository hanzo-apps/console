/** Message read API — the `/v1/ai/messages` resource. Ported from MessageBackend.js. */
import { get } from './client'
import { type Message } from './types'

export const MessageApi = {
  /** Messages in one chat (`ai/messages?owner&chat`). Ordered oldest-first. */
  listForChat: (owner: string, chat: string) =>
    get<Message[]>('ai/messages', { owner, chat }),
}
