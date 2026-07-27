'use client'

/**
 * Infrastructure board — the CONTROLS that change the fleet: the gate every one of them
 * passes through (`Gated`/`Blocked`, shared with the destroy panels in `InfraModule`),
 * a droplet resize, and a node-pool scale. They live together because they obey the same
 * two rules:
 *
 *  1. A control the server has ALREADY refused is never offered. `Gated` renders the
 *     action only when the snapshot's own permission bit says yes; otherwise it renders
 *     `Blocked` — the refusal, carrying the server's `blockedReason` verbatim.
 *  2. A refusal that only arrives at CALL time (the scan went incomplete, the pool
 *     shrank below what the cluster can schedule) surfaces the server's own message, via
 *     `ConfirmDelete`'s inline error or the toast — never a generic "failed".
 *
 * The confirm itself is the console's ONE panel (`ConfirmDelete`), armed by typing the
 * resource name whenever the action destroys something that cannot come back.
 */
import { useState, type ReactNode } from 'react'
import { Card, Text, XStack, YStack } from '@hanzo/gui'
import { ShieldAlert } from '@hanzogui/lucide-icons-2'

import { AdminInfraApi, resizeMessage, scaleMessage, type Gate, type InfraNode, type InfraPool } from '~/lib/api/admin-infra'
import { ConfirmDelete } from '~/components/ui/ConfirmDelete'
import { FieldRow, FieldSwitch, FieldText } from '~/components/ui/Field'
import { useToast } from '~/components/ui/Toast'

/** The refusal, rendered: what may not be done here, and the server's reason WHY. */
export function Blocked({ title, reason }: { title: string; reason: string }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" bg="$color2" p="$3" gap="$1.5">
      <XStack gap="$2" items="center">
        <ShieldAlert size={15} color="$color10" />
        <Text fontSize="$3" fontWeight="700" color="$color12">{title}</Text>
      </XStack>
      <Text fontSize="$2" color="$color11">{reason}</Text>
    </Card>
  )
}

/** One control site: the action when the server allows it, its refusal when it does not. */
export function Gated({ gate, title, children }: { gate: Gate; title: string; children: ReactNode }) {
  return gate.allowed ? <>{children}</> : <Blocked title={title} reason={gate.reason} />
}

/**
 * Resize a droplet to another size slug. The slug is typed, not picked: DigitalOcean's
 * size catalog is not in this snapshot, so offering a list would mean inventing one.
 */
export function ResizeDroplet({ node, gate, onDone }: { node: InfraNode; gate: Gate; onDone: () => void }) {
  const toast = useToast()
  const [size, setSize] = useState('')
  const [disk, setDisk] = useState(false)
  const target = size.trim()

  return (
    <YStack gap="$2.5">
      <Text fontSize="$4" fontWeight="700" color="$color12">Resize</Text>
      <Gated gate={gate} title="This droplet cannot be resized">
        <FieldRow label="New size">
          <FieldText value={size} onChange={setSize} placeholder={node.sizeSlug} />
        </FieldRow>
        <FieldRow label="Grow the disk">
          <XStack gap="$3" items="center">
            <FieldSwitch checked={disk} onChange={setDisk} />
            <Text fontSize="$1" color="$color10" flex={1}>Permanent — a larger disk can never be shrunk back.</Text>
          </XStack>
        </FieldRow>
        {target && target !== node.sizeSlug ? (
          <ConfirmDelete
            message={resizeMessage(node, target, disk)}
            confirmLabel={`Resize ${node.name}`}
            busyLabel="Resizing…"
            // Typing the name is the bar for the irreversible half only: a disk resize
            // cannot be undone, a CPU/memory one can be set back.
            confirmText={disk ? node.name : undefined}
            run={async () => {
              const r = await AdminInfraApi.resizeDroplet(node.id, target, disk)
              toast.success(`Resizing ${r.name || node.name} to ${r.size}`, 'The droplet powers off for the resize; its pods reschedule elsewhere.')
            }}
            onDone={onDone}
          />
        ) : (
          <Text fontSize="$2" color="$color10">Enter a different size slug — it is {node.sizeSlug} now.</Text>
        )}
      </Gated>
    </YStack>
  )
}

/**
 * Scale ONE node pool. A shrink destroys nodes DigitalOcean chooses, so it is armed by
 * typing the pool name; a grow only starts billing, so the stated consequence is enough.
 */
export function ScalePool({ clusterId, pool, gate, onDone }: { clusterId: string; pool: InfraPool; gate: Gate; onDone: () => void }) {
  const toast = useToast()
  const [count, setCount] = useState(String(pool.count))
  const target = Number(count.trim())
  const parsed = count.trim() !== '' && Number.isInteger(target) && target >= 0
  const valid = parsed && target !== pool.count

  return (
    <YStack gap="$2" py="$2" borderBottomWidth={1} borderColor="$borderColor">
      <YStack>
        <Text fontSize="$3" color="$color12">{pool.name}</Text>
        <Text fontSize="$1" color="$color10">
          {pool.size || '—'} · {pool.count} node{pool.count === 1 ? '' : 's'}
          {pool.nodes !== pool.count ? ` (${pool.nodes} up)` : ''}
        </Text>
      </YStack>
      <Gated gate={gate} title={`Pool “${pool.name}” cannot be scaled`}>
        <FieldRow label="Node count">
          <FieldText value={count} onChange={setCount} placeholder={String(pool.count)} />
        </FieldRow>
        {valid ? (
          <ConfirmDelete
            message={scaleMessage(pool.name, pool.count, target)}
            confirmLabel={`Scale ${pool.name} to ${target}`}
            busyLabel="Scaling…"
            confirmText={target < pool.count ? pool.name : undefined}
            run={async () => {
              const r = await AdminInfraApi.scaleNodePool(clusterId, pool.name, target)
              // The note is the server telling us what it could NOT prove. It stays up
              // until dismissed (durationMs 0) — a caveat that auto-hides is a swallowed one.
              toast.toast({
                kind: 'success',
                title: `Scaling ${r.pool} to ${r.count} node${r.count === 1 ? '' : 's'}`,
                description: r.note || 'DigitalOcean is reconciling the pool; rescan to see the new nodes.',
                durationMs: r.note ? 0 : undefined,
              })
            }}
            onDone={onDone}
          />
        ) : (
          <Text fontSize="$2" color="$color10">{parsed ? `Already ${pool.count}.` : 'Enter a whole node count.'}</Text>
        )}
      </Gated>
    </YStack>
  )
}
