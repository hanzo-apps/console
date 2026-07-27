/** Message read API — the `/v1/ai/messages` resource. */
import { get } from './client'
import { type Message } from './types'

export const MessageApi = {
  /** Messages in one chat (`chat/messages?owner&chat`). Ordered oldest-first. */
  listForChat: (owner: string, chat: string) =>
    get<Message[]>('ai/messages', { owner, chat }),
}
