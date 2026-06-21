/** Message read API — `/v1/get-messages`. Ported from MessageBackend.js. */
import { get } from './client'
import { type Message } from './types'

export const MessageApi = {
  /** Messages in one chat (`get-messages?owner&chat`). Ordered oldest-first. */
  listForChat: (owner: string, chat: string) =>
    get<Message[]>('get-messages', { owner, chat }),
}
