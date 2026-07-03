'use client'

// HARNESS ROUTE (uncommitted, never staged) — renders PageHeader + DataTable
// OUTSIDE the (dashboard) AuthGate so the mobile-CSS fixes can be verified at
// 390/360 without an IAM session. Delete after verification.
import { Button, Text, YStack } from '@hanzo/gui'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'

type Bucket = { name: string; createdAt: string; region: string }

const rows: Bucket[] = [
  { name: 'production-assets-longish-bucket-name', createdAt: '2026-06-30 14:22:10', region: 'us-east-1' },
  { name: 'staging-user-uploads', createdAt: '2026-05-11 09:04:55', region: 'eu-west-2' },
  { name: 'backups-daily', createdAt: '2026-01-02 00:00:00', region: 'ap-south-1' },
]

const columns: Column<Bucket>[] = [
  { key: 'name', header: 'Bucket', render: (b) => <Text fontSize="$3" fontWeight="600" numberOfLines={1}>{b.name}</Text> },
  { key: 'region', header: 'Region', width: 140, render: (b) => <Text fontSize="$3">{b.region}</Text> },
  { key: 'createdAt', header: 'Created', width: 200, render: (b) => <Text fontSize="$3">{b.createdAt}</Text> },
  { key: 'actions', header: '', width: 100, render: () => <Text fontSize="$3">⋯</Text> },
]

export default function MobileHarness() {
  return (
    <YStack gap="$4" p="$4" maxW={900} self="center" width="100%">
      <PageHeader
        title="Billing overview"
        subtitle="Balance, month-to-date spend, and a projected run-rate for your organization — billed to the same account the gateway debits."
        actions={
          <>
            <Button size="$2">Refresh</Button>
            <Button size="$2" theme="light">Add credits</Button>
          </>
        }
      />
      <PageHeader
        title="S3"
        subtitle="S3-compatible buckets and objects, scoped to your organization."
        actions={<Button size="$2">New bucket</Button>}
      />
      <DataTable columns={columns} rows={rows} rowKey={(b) => b.name} />
    </YStack>
  )
}
