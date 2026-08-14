'use client'

/**
 * Chat — an interactive assistant by default, with session history alongside.
 *
 * `/chat` opens the live conversation (`ChatConversation` → real completions via
 * the keyless `/ai` proxy). The "History" toggle lists prior saved sessions
 * (`ChatListView`), and `/chat/<name>` deep-links a read-only thread
 * (`ChatView`). One module, three composable views; nothing fabricated.
 */
import { useState } from 'react'
import { useRouter } from '~/lib/router'

import { ChatConversation } from './chat/ChatConversation'
import { ChatListView } from './chat/ChatListView'
import { ChatView } from './chat/ChatView'

export function ChatModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const name = params.name
  // The chat's real OWNER travels in the route (`/chat/<owner>/<name>`) — casibase
  // chats are keyed `owner/name` and a customer org's chats are NOT owned by the
  // literal `admin` org, so dropping the owner made every saved chat unopenable.
  const owner = params.owner
  const [view, setView] = useState<'chat' | 'history'>('chat')

  if (name) {
    return (
      <ChatView
        owner={owner ? decodeURIComponent(owner) : undefined}
        name={decodeURIComponent(name)}
        onDone={() => router.push('/chat')}
      />
    )
  }
  if (view === 'history') {
    return (
      <ChatListView
        onOpen={(c) => router.push(`/chat/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.name)}`)}
        onBack={() => setView('chat')}
      />
    )
  }
  return <ChatConversation onShowHistory={() => setView('history')} />
}
