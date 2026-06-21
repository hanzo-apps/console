/** Chat admin API — `/v1/*-chat(s)`. Ported from ChatBackend.js. */
import { get, getList, post, idOf } from './client'
import { type Chat, type ListParams, listQuery } from './types'

export const ChatApi = {
  listGlobal: (params: ListParams & { store?: string } = {}) =>
    getList<Chat[]>('get-global-chats', { ...listQuery(params), store: params.store }),

  list: (params: ListParams & { user: string; store?: string; selectedUser?: string } ) =>
    getList<Chat[]>('get-chats', {
      ...listQuery(params),
      user: params.user,
      store: params.store,
      selectedUser: params.selectedUser,
    }),

  get: (owner: string, name: string) => get<Chat>('get-chat', { id: idOf(owner, name) }),

  update: (owner: string, name: string, chat: Chat) =>
    post('update-chat', chat, { id: idOf(owner, name) }),

  add: (chat: Chat) => post('add-chat', chat),

  remove: (chat: Chat) => post('delete-chat', chat),
}
