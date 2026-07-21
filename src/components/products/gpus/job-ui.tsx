'use client'

/**
 * Shared gpu-jobs UI atoms — the ONE home for the job status pill + its tone colors,
 * so the per-GPU expansion (ConnectedMachines) and the org-wide Queue tab render a job's
 * state identically. Tone comes from the pure `jobTone` (tested); this only maps it to a
 * theme token, so the visual stays white-label + light/dark-correct via `@hanzo/gui`.
 */
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { X } from '@hanzogui/lucide-icons-2'

import { jobTone, fmtJobStatus, jobActive, type FleetJob, type JobTone } from '~/lib/api/fleet'

/** run = in-flight (blue), ok = done (green), down = failed (red), idle = queued/canceled (neutral). */
export const JOB_TONE_COLOR: Record<JobTone, string> = {
  run: '$blue10',
  ok: '$green10',
  down: '$red10',
  idle: '$color9',
}

/** Status dot + label — the ONE job-state pill, shared across the GPU surfaces. */
export function JobStatusPill({ status }: { status: string }) {
  return (
    <XStack items="center" gap="$1.5" aria-label={`Status ${status}`}>
      <YStack width={8} height={8} rounded="$10" bg={JOB_TONE_COLOR[jobTone(status)] as never} />
      <Text fontSize="$2" color="$color11" numberOfLines={1}>
        {fmtJobStatus(status)}
      </Text>
    </XStack>
  )
}

/** A small "Cancel" affordance for a queued/running job; hidden for terminal jobs. */
export function CancelJobButton({ job, onCancel }: { job: FleetJob; onCancel: (job: FleetJob) => void }) {
  if (!jobActive(job)) return null
  return (
    <Button size="$1" chromeless icon={<X size={13} />} onPress={() => onCancel(job)} aria-label={`Cancel job ${job.id}`}>
      Cancel
    </Button>
  )
}
