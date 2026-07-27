'use client'

/**
 * GPU surface chart chrome.
 *
 * The generic console primitives (metric tiles, panels, legend rows, util bars,
 * mini bar/spark marks, hint buttons) live in `~/components/ui/Metric` — the ONE
 * shared home — and are re-exported here so the GPU tabs keep importing them from
 * `./charts` unchanged. Only the GPU-specific `Donut` (centered count + "GPUs"
 * label) is defined locally.
 *
 * Renders EXACTLY the data passed — no interpolation, no fabricated baselines.
 */
import type { ReactElement } from 'react'

export {
  SERIES,
  colorForIndex,
  utilColor,
  // Metric's own spark mark (`points`) — the barrel aliases it away from Charts'.
  MetricSparkline as Sparkline,
  MiniBars,
  UtilBar,
  LegendDot,
  MetricCard,
  HintButton,
  Panel,
} from '@hanzo/ui/product'

const TRACK = 'rgba(128,128,128,0.18)'

/** A donut from real slices (value > 0). The classic stroke-dasharray ring. */
export function Donut({
  slices,
  size = 168,
  thickness = 22,
}: {
  slices: { label: string; value: number; color: string }[]
  size?: number
  thickness?: number
}): ReactElement | null {
  const total = slices.reduce((a, s) => a + s.value, 0)
  if (total <= 0) return null
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const cx = size / 2
  let offset = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="distribution">
      <g transform={`rotate(-90 ${cx} ${cx})`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={TRACK} strokeWidth={thickness} />
        {slices.map((s) => {
          const frac = s.value / total
          const seg = frac * c
          const el = (
            <circle
              key={s.label}
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${seg} ${c - seg}`}
              strokeDashoffset={-offset}
            >
              <title>{`${s.label}: ${s.value}`}</title>
            </circle>
          )
          offset += seg
          return el
        })}
      </g>
      <text x={cx} y={cx - 4} textAnchor="middle" fontSize={22} fontWeight={800} fill="currentColor">
        {total}
      </text>
      <text x={cx} y={cx + 16} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.6}>
        GPUs
      </text>
    </svg>
  )
}
