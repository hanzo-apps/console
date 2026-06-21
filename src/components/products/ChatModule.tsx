'use client'

/**
 * Chat admin — session list + read-only chat view, native on @hanzo/gui.
 *
 * Logic ported from ChatListPage.js + ChatPage.js + backend/ChatBackend.js (and
 * MessageBackend.js for the thread): list chats (`get-chats`), open one to read
 * its message thread (`get-messages?owner&chat`), delete (`delete-chat`). UI
 * rebuilt clean on GUI primitives (no antd).
 *
 * Routing: `/chat` lists; `/chat/<name>` views one session.
 */
import { useRouter } from 'next/navigation'

import { ChatListView } from './chat/ChatListView'
import { ChatView } from './chat/ChatView'

export function ChatModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const name = params.name

  if (name) {
    return <ChatView name={decodeURIComponent(name)} onDone={() => router.push('/chat')} />
  }
  return <ChatListView onOpen={(c) => router.push(`/chat/${encodeURIComponent(c.name)}`)} />
}
