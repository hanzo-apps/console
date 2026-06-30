'use client'

/**
 * Dependency-free SVG charts for the Overview dashboard.
 *
 * console2 ships no chart library (see CLAUDE.md — the existing viz is hand-rolled
 * gui Stacks). Rather than add a dep, these are small, crisp inline-SVG primitives
 * that render in the Next web DOM alongside @hanzo/gui components and theme to the
 * dark shell. Line/Bar measure their container (ResizeObserver) for pixel-true
 * coordinates and a hover read-out; Donut/Sparkline are fixed-size.
 *
 * Colors are explicit (gui's `$color*` tokens are component props, not values an
 * <svg> can read), tuned for the dark default.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Distinct hues for categorical series (spend-by-model donut), dark-tuned. */
export const CHART_PALETTE = [
  '#7c5cff',
  '#23c562',
  '#ff9f45',
  '#3aa0ff',
  '#ff5d8f',
  '#16c0c8',
  '#c084fc',
  '#f4c245',
]
export const CHART_OTHER = '#64748b'

const ACCENT = CHART_PALETTE[0]
const GRID = 'rgba(148,163,184,0.16)'
const AXIS = 'rgba(148,163,184,0.85)'

export type ChartPoint = { label: string; value: number }

function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, w }
}

// ── Sparkline (fixed size, for metric cards) ─────────────────────────────────

export function Sparkline({
  values,
  width = 132,
  height = 40,
  color = ACCENT,
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}) {
  const clean = values.filter((v) => Number.isFinite(v))
  if (clean.length < 2) return <svg width={width} height={height} aria-hidden />
  const max = Math.max(...clean, 1)
  const min = Math.min(...clean, 0)
  const span = max - min || 1
  const n = clean.length
  const px = (i: number) => (i / (n - 1)) * (width - 2) + 1
  const py = (v: number) => height - 2 - ((v - min) / span) * (height - 4)
  const line = clean.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ')
  const area = `${line} L${(width - 1).toFixed(1)},${height} L1,${height} Z`
  return (
    <svg width={width} height={height} aria-hidden style={{ display: 'block' }}>
      <path d={area} fill={color} fillOpacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ── Shared hover read-out ────────────────────────────────────────────────────

function Tooltip({ x, height, label, value }: { x: number; height: number; label: string; value: string }) {
  // Keep the box on-screen near the guide line.
  const left = Math.max(0, x - 60)
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top: 0,
        height,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'flex-start',
      }}
    >
      <div
        style={{
          background: 'rgba(15,17,21,0.94)',
          border: '1px solid rgba(148,163,184,0.25)',
          borderRadius: 8,
          padding: '6px 9px',
          fontSize: 11,
          lineHeight: 1.35,
          color: '#e2e8f0',
          whiteSpace: 'nowrap',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ color: AXIS }}>{label}</div>
        <div style={{ fontWeight: 700 }}>{value}</div>
      </div>
    </div>
  )
}

function nearestIndex(clientX: number, rect: DOMRect, padL: number, innerW: number, n: number): number {
  if (n <= 1) return 0
  const mx = clientX - rect.left - padL
  const i = Math.round((mx / (innerW || 1)) * (n - 1))
  return Math.max(0, Math.min(n - 1, i))
}

// ── Line chart (tokens over time) ────────────────────────────────────────────

export function LineChart({
  data,
  height = 210,
  color = ACCENT,
  formatValue = (v) => String(v),
}: {
  data: ChartPoint[]
  height?: number
  color?: string
  formatValue?: (v: number) => string
}) {
  const { ref, w } = useContainerWidth()
  const [hover, setHover] = useState<number | null>(null)
  const padL = 10
  const padR = 10
  const padT = 12
  const padB = 24
  const n = data.length
  const innerW = Math.max(1, w - padL - padR)
  const innerH = Math.max(1, height - padT - padB)
  const max = Math.max(...data.map((d) => d.value), 1)
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => padT + innerH - (v / max) * innerH

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ')
  const area = n >= 2 ? `${line} L${x(n - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z` : ''
  const ticks = axisTicks(data)

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {w > 0 ? (
        <svg
          width={w}
          height={height}
          style={{ display: 'block' }}
          onMouseMove={(e) => setHover(nearestIndex(e.clientX, e.currentTarget.getBoundingClientRect(), padL, innerW, n))}
          onMouseLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((g) => (
            <line key={g} x1={padL} x2={w - padR} y1={padT + innerH * g} y2={padT + innerH * g} stroke={GRID} strokeWidth={1} />
          ))}
          {area ? <path d={area} fill={color} fillOpacity={0.1} /> : null}
          {n >= 2 ? <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
          {hover != null && data[hover] ? (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} stroke={AXIS} strokeWidth={1} strokeDasharray="3 3" />
              <circle cx={x(hover)} cy={y(data[hover].value)} r={4} fill={color} stroke="#0f1115" strokeWidth={2} />
            </>
          ) : null}
          {ticks.map((t) => (
            <text key={t.i} x={x(t.i)} y={height - 7} fontSize={10} fill={AXIS} textAnchor={t.anchor}>
              {t.label}
            </text>
          ))}
        </svg>
      ) : null}
      {hover != null && data[hover] ? (
        <Tooltip x={x(hover)} height={height} label={data[hover].label} value={formatValue(data[hover].value)} />
      ) : null}
    </div>
  )
}

// ── Bar chart (spend over time) ──────────────────────────────────────────────

export function BarChart({
  data,
  height = 210,
  color = ACCENT,
  formatValue = (v) => String(v),
}: {
  data: ChartPoint[]
  height?: number
  color?: string
  formatValue?: (v: number) => string
}) {
  const { ref, w } = useContainerWidth()
  const [hover, setHover] = useState<number | null>(null)
  const padL = 10
  const padR = 10
  const padT = 12
  const padB = 24
  const n = data.length
  const innerW = Math.max(1, w - padL - padR)
  const innerH = Math.max(1, height - padT - padB)
  const max = Math.max(...data.map((d) => d.value), 1)
  const slot = innerW / Math.max(1, n)
  const barW = Math.max(1, Math.min(slot * 0.62, 36))
  const cx = (i: number) => padL + slot * i + slot / 2
  const ticks = axisTicks(data)

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {w > 0 ? (
        <svg
          width={w}
          height={height}
          style={{ display: 'block' }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const i = Math.floor((e.clientX - rect.left - padL) / (slot || 1))
            setHover(Math.max(0, Math.min(n - 1, i)))
          }}
          onMouseLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((g) => (
            <line key={g} x1={padL} x2={w - padR} y1={padT + innerH * g} y2={padT + innerH * g} stroke={GRID} strokeWidth={1} />
          ))}
          {data.map((d, i) => {
            const h = (d.value / max) * innerH
            return (
              <rect
                key={i}
                x={cx(i) - barW / 2}
                y={padT + innerH - h}
                width={barW}
                height={Math.max(0, h)}
                rx={Math.min(3, barW / 2)}
                fill={color}
                fillOpacity={hover === i ? 1 : 0.78}
              />
            )
          })}
          {ticks.map((t) => (
            <text key={t.i} x={cx(t.i)} y={height - 7} fontSize={10} fill={AXIS} textAnchor="middle">
              {t.label}
            </text>
          ))}
        </svg>
      ) : null}
      {hover != null && data[hover] ? (
        <Tooltip x={cx(hover)} height={height} label={data[hover].label} value={formatValue(data[hover].value)} />
      ) : null}
    </div>
  )
}

/** Pick a few evenly-spaced x labels (first/mid/last) to avoid crowding. */
function axisTicks(data: ChartPoint[]): { i: number; label: string; anchor: 'start' | 'middle' | 'end' }[] {
  const n = data.length
  if (n === 0) return []
  if (n === 1) return [{ i: 0, label: data[0].label, anchor: 'middle' }]
  const mid = Math.floor((n - 1) / 2)
  const out: { i: number; label: string; anchor: 'start' | 'middle' | 'end' }[] = [
    { i: 0, label: data[0].label, anchor: 'start' },
    { i: n - 1, label: data[n - 1].label, anchor: 'end' },
  ]
  if (n >= 5) out.splice(1, 0, { i: mid, label: data[mid].label, anchor: 'middle' })
  return out
}

// ── Donut (spend by model) ───────────────────────────────────────────────────

export type DonutSlice = { label: string; value: number; color: string }

export function Donut({
  slices,
  size = 184,
  thickness = 26,
  center,
}: {
  slices: DonutSlice[]
  size?: number
  thickness?: number
  center?: ReactNode
}) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0)
  const r = size / 2
  const rInner = r - thickness
  const mid = (r + rInner) / 2

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ display: 'block' }}>
        {total <= 0 ? (
          <circle cx={r} cy={r} r={mid} fill="none" stroke={GRID} strokeWidth={thickness} />
        ) : slices.length === 1 ? (
          <circle cx={r} cy={r} r={mid} fill="none" stroke={slices[0].color} strokeWidth={thickness} />
        ) : (
          renderArcs(slices, total, r, rInner)
        )}
      </svg>
      {center ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          {center}
        </div>
      ) : null}
    </div>
  )
}

function renderArcs(slices: DonutSlice[], total: number, rOuter: number, rInner: number): ReactNode {
  let a0 = -Math.PI / 2
  const paths: ReactNode[] = []
  slices.forEach((s, idx) => {
    const frac = Math.max(0, s.value) / total
    if (frac <= 0) return
    const a1 = a0 + frac * Math.PI * 2
    paths.push(<path key={idx} d={annularArc(rOuter, rOuter, rOuter, rInner, a0, Math.min(a1, a0 + Math.PI * 1.9999))} fill={s.color} />)
    a0 = a1
  })
  return <>{paths}</>
}

function polar(cx: number, cy: number, rad: number, a: number): [number, number] {
  return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]
}

function annularArc(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0
  const [x0, y0] = polar(cx, cy, rOuter, a0)
  const [x1, y1] = polar(cx, cy, rOuter, a1)
  const [x2, y2] = polar(cx, cy, rInner, a1)
  const [x3, y3] = polar(cx, cy, rInner, a0)
  return `M${x0},${y0} A${rOuter},${rOuter} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${rInner},${rInner} 0 ${large} 0 ${x3},${y3} Z`
}
