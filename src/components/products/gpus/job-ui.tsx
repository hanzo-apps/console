'use client'

/**
 * Shared gpu-jobs UI atoms — the ONE home for the job status pill, the cancel affordance
 * (with its confirm gate + error surface), and the freshness indicator, so the per-GPU
 * expansion (ConnectedMachines) and the org-wide Queue tab behave identically. Tone comes
 * from the pure `jobTone` (tested); everything visual stays white-label + light/dark-correct
 * via `@hanzo/gui`.
 */
import { useState } from 'react'
import { Button, Dialog, Spinner, Text, VisuallyHidden, XStack, YStack } from '@hanzo/gui'
import { X } from '@hanzogui/lucide-icons-2'

import {
  jobTone,
  jobActive,
  fmtJobStatus,
  fmtHeartbeat,
  cancelErrorMessage,
  type FleetJob,
  type JobTone,
} from '~/lib/api/fleet'
import { useToast } from '~/components/ui/Toast'

/** run = in-flight (blue), ok = done (green), down = failed (red), idle = queued/canceled (neutral). */
export const JOB_TONE_COLOR: Record<JobTone, string> = {
  run: '$color11',
  ok: '$green10',
  down: '$red10',
  idle: '$color9',
}

/** Status dot + label — the ONE job-state pill. `canceling` overrides with a spinner so an
 *  optimistically-canceled job reads honestly as in-progress until the poll reconciles. */
export function JobStatusPill({ status, canceling }: { status: string; canceling?: boolean }) {
  if (canceling) {
    return (
      <XStack items="center" gap="$1.5" aria-label="Status canceling">
        <Spinner size="small" />
        <Text fontSize="$2" color="$color11" numberOfLines={1}>Canceling…</Text>
      </XStack>
    )
  }
  return (
    <XStack items="center" gap="$1.5" aria-label={`Status ${status}`}>
      <YStack width={8} height={8} rounded="$10" bg={JOB_TONE_COLOR[jobTone(status)] as never} />
      <Text fontSize="$2" color="$color11" numberOfLines={1}>{fmtJobStatus(status)}</Text>
    </XStack>
  )
}

/**
 * Cancel a queued/running job — GATED by a confirm dialog (one irreversible click must be
 * intentional) and with the failure SURFACED (a 404/409/503 race is toasted, never
 * swallowed). `pending` (the parent's optimistic state) replaces the button with a spinner
 * so it can't be double-fired. Hidden for terminal jobs. `onCancel` REJECTS on error.
 */
export function CancelJobButton({
  job,
  onCancel,
  gpuName,
  pending,
}: {
  job: FleetJob
  onCancel: (job: FleetJob) => Promise<void>
  gpuName?: string
  pending?: boolean
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  if (pending) {
    return (
      <XStack items="center" gap="$1.5" aria-label="Canceling">
        <Spinner size="small" />
        <Text fontSize="$1" color="$color10">Canceling…</Text>
      </XStack>
    )
  }
  if (!jobActive(job)) return null

  const label = job.type === 'studio.render' ? 'render' : 'job'
  const where = gpuName || 'this GPU'

  const submit = async () => {
    setBusy(true)
    try {
      await onCancel(job)
      toast.success('Cancel requested', `The ${label} on ${where} is being canceled.`)
      setOpen(false)
    } catch (e) {
      toast.error('Couldn’t cancel', cancelErrorMessage(e))
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button size="$1" chromeless icon={<X size={13} />} onPress={() => setOpen(true)} aria-label={`Cancel job ${job.id}`}>
        Cancel
      </Button>
      <Dialog modal open={open} onOpenChange={(o) => { if (!busy) setOpen(o) }}>
        <Dialog.Portal>
          <Dialog.Overlay key="cancel-overlay" bg="rgba(0,0,0,0.55)" />
          <Dialog.Content key="cancel-content" bordered elevate width={440} maxW="92vw" p="$4" gap="$3">
            <VisuallyHidden>
              <Dialog.Title>Cancel job</Dialog.Title>
            </VisuallyHidden>
            <Text fontSize="$6" fontWeight="800">Cancel this {label} on {where}?</Text>
            <Text fontSize="$3" color="$color11">
              The {label}{job.type ? ` (${job.type})` : ''} will stop immediately. This can’t be undone.
            </Text>
            <XStack gap="$2" justify="flex-end">
              <Button chromeless onPress={() => setOpen(false)} disabled={busy}>Keep running</Button>
              <Button theme="red" onPress={() => void submit()} disabled={busy} icon={busy ? <Spinner size="small" /> : <X size={16} />}>
                Cancel {label}
              </Button>
            </XStack>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </>
  )
}

/**
 * "Updated Ns ago" freshness dot — green when the last poll succeeded, amber "Stale · last
 * updated Ns ago" when polling has been failing, so stale data is never shown as live
 * forever. Renders nothing until the first successful poll.
 */
export function FreshnessNote({ updatedAt, stale }: { updatedAt: number | null; stale?: boolean }) {
  if (!updatedAt) return null
  const ago = fmtHeartbeat(new Date(updatedAt).toISOString())
  return (
    <XStack items="center" gap="$1.5" aria-label={stale ? 'Data stale' : 'Live'}>
      <YStack width={7} height={7} rounded="$10" bg={stale ? '$yellow10' : '$green10'} />
      <Text fontSize="$1" color={stale ? '$yellow10' : '$color10'} numberOfLines={1}>
        {stale ? `Stale · last updated ${ago}` : `Updated ${ago}`}
      </Text>
    </XStack>
  )
}
