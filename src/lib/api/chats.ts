/** Chat admin API — the `/v1/chat/chats` resource. */
import { get, getList, patch, post, del, memberOf } from './client'

const CHATS = 'chat/chats'
import { type Chat, type ListParams, listQuery } from './types'

export const ChatApi = {
  listGlobal: (params: ListParams & { store?: string } = {}) =>
    getList<Chat[]>(`${CHATS}/global`, { ...listQuery(params), store: params.store }),

  list: (params: ListParams & { user: string; store?: string; selectedUser?: string } ) =>
    getList<Chat[]>(CHATS, {
      ...listQuery(params),
      user: params.user,
      store: params.store,
      selectedUser: params.selectedUser,
    }),

  get: (owner: string, name: string) => get<Chat>(memberOf(CHATS, owner, name)),

  update: (owner: string, name: string, chat: Chat) =>
    patch(memberOf(CHATS, owner, name), chat),

  add: (chat: Chat) => post(CHATS, chat),

  remove: (chat: Chat) => del(memberOf(CHATS, chat.owner, chat.name)),
}
