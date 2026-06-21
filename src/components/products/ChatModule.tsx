'use client'

import { ChatApi, type Chat } from '~/lib/api'
import { ResourceList } from '~/components/ui/ResourceList'
import { useSession } from '~/lib/auth/session'

export function ChatModule(_props: { params: Record<string, string> }) {
  const { account } = useSession()
  const user = account?.name ?? 'admin'

  return (
    <ResourceList<Chat>
      title="Chat"
      subtitle="Chat sessions and history."
      rowKey={(r) => `${r.owner}/${r.name}`}
      columns={[
        { key: 'name', header: 'Name' },
        { key: 'displayName', header: 'Display name' },
        { key: 'user', header: 'User' },
        { key: 'store', header: 'Store' },
        { key: 'messageCount', header: 'Messages', width: 110 },
      ]}
      load={async () => (await ChatApi.list({ user })).rows}
    />
  )
}
