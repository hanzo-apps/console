/**
 * Workflow status mapping — ONE place that turns a Temporal
 * `WORKFLOW_EXECUTION_STATUS_*` string into a readable label, a tone, and a
 * stat-card bucket (running / completed / failed / suspended). Shared by the
 * Tasks console and the workflow detail panel so both read a status the same way.
 */
export type Tone = 'green' | 'yellow' | 'red' | 'neutral'
export type Bucket = 'running' | 'completed' | 'failed' | 'suspended' | 'other'

export function statusOf(raw: string): { label: string; tone: Tone; bucket: Bucket } {
  const s = (raw || '').replace(/^WORKFLOW_EXECUTION_STATUS_/, '').toUpperCase()
  switch (s) {
    case 'RUNNING':
      return { label: 'Running', tone: 'green', bucket: 'running' }
    case 'CONTINUED_AS_NEW':
      return { label: 'Continued', tone: 'green', bucket: 'running' }
    case 'COMPLETED':
      return { label: 'Completed', tone: 'green', bucket: 'completed' }
    case 'FAILED':
      return { label: 'Failed', tone: 'red', bucket: 'failed' }
    case 'TIMED_OUT':
      return { label: 'Timed out', tone: 'red', bucket: 'failed' }
    case 'TERMINATED':
      return { label: 'Terminated', tone: 'yellow', bucket: 'suspended' }
    case 'CANCELED':
      return { label: 'Canceled', tone: 'yellow', bucket: 'suspended' }
    default:
      return { label: s ? s.replace(/_/g, ' ').toLowerCase() : 'unknown', tone: 'neutral', bucket: 'other' }
  }
}

const TONE_BG: Record<Tone, string> = { green: '$color5', yellow: '$color4', red: '$color4', neutral: '$color3' }
const TONE_FG: Record<Tone, string> = { green: '$color12', yellow: '$color12', red: '$color12', neutral: '$color11' }

/** The bg/fg tokens for a status pill (Text style props). */
export function statusStyle(raw: string): { label: string; bg: string; color: string } {
  const { label, tone } = statusOf(raw)
  return { label, bg: TONE_BG[tone], color: TONE_FG[tone] }
}
