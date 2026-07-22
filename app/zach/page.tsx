'use client'

/**
 * /zach — Zach's personal command center ("portal for all things Zach").
 *
 * A public, self-contained landing that aggregates the real Hanzo surfaces +
 * quick links + settings behind the shared HanzoAppBar. Lives OUTSIDE the
 * (dashboard) auth group, so it renders for anyone and static-exports cleanly
 * (it ships in the console bundle → console.hanzo.ai/zach + cloud.hanzo.ai/zach).
 *
 * Real links only. The app cards are driven by the ONE canonical HANZO_APPS
 * list (DRY) so this portal never drifts from the launcher.
 */
import React from 'react'
import { HanzoAppBar, HANZO_APPS } from '@hanzogui/shell'

const ORANGE = '#f97316'
const BG = '#050506'
const CARD = '#0b0b0f'
const BORDER = 'rgba(255,255,255,0.08)'
const FG = 'rgba(255,255,255,0.92)'
const FG_DIM = 'rgba(255,255,255,0.5)'

// The primary app cards — the owner's core surfaces (from the canonical list).
const APP_CARDS = HANZO_APPS.filter((a) => a.core && a.id !== 'zach')

// Extra real shortcuts beyond the core apps.
const QUICK_LINKS: { label: string; href: string }[] = [
  { label: 'GitHub · hanzoai', href: 'https://github.com/hanzoai' },
  { label: 'Docs', href: 'https://docs.hanzo.ai' },
  { label: 'Status', href: 'https://status.hanzo.ai' },
  { label: 'KMS · secrets', href: 'https://kms.hanzo.ai' },
  { label: 'Platform · deploy', href: 'https://platform.hanzo.ai' },
  { label: 'o11y · observability', href: 'https://o11y.hanzo.ai' },
  { label: 'Registry', href: 'https://registry.hanzo.ai' },
  { label: 'Account & billing', href: 'https://hanzo.id/account' },
]

export default function ZachPortal() {
  return (
    <div style={{ minHeight: '100vh', background: BG, color: FG, fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>
      <HanzoAppBar
        currentApp="zach"
        currentAppLabel="Zach"
        settingsHref="https://hanzo.id/account"
        accountHref="https://hanzo.id/account"
      />

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '40px 20px 80px' }}>
        {/* Hero */}
        <header style={{ marginBottom: 36 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: ORANGE }}>
            Personal command center
          </div>
          <h1 style={{ margin: '8px 0 6px', fontSize: 40, fontWeight: 850, letterSpacing: -1 }}>Zach</h1>
          <p style={{ margin: 0, color: FG_DIM, fontSize: 15 }}>
            Portal for all things Zach — every Hanzo surface, one click away.
          </p>
        </header>

        {/* App cards */}
        <Section title="Apps">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
            {APP_CARDS.map((app) => {
              const Icon = app.icon
              return (
                <a
                  key={app.id}
                  href={app.href}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 16,
                    borderRadius: 14,
                    border: `1px solid ${BORDER}`,
                    background: CARD,
                    color: FG,
                    textDecoration: 'none',
                    transition: 'border-color 120ms ease, transform 120ms ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = ORANGE
                    e.currentTarget.style.transform = 'translateY(-1px)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = BORDER
                    e.currentTarget.style.transform = 'none'
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 44,
                      height: 44,
                      flexShrink: 0,
                      borderRadius: 12,
                      background: 'rgba(249,115,22,0.14)',
                      color: ORANGE,
                    }}
                  >
                    <Icon size={22} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{app.label}</span>
                    {app.description ? (
                      <span style={{ display: 'block', fontSize: 12.5, color: FG_DIM }}>{app.description}</span>
                    ) : null}
                  </span>
                </a>
              )
            })}
          </div>
        </Section>

        {/* Quick links */}
        <Section title="Quick links">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
            {QUICK_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '11px 14px',
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  background: 'transparent',
                  color: FG,
                  textDecoration: 'none',
                  fontSize: 13.5,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span>{l.label}</span>
                <span aria-hidden="true" style={{ color: FG_DIM }}>↗</span>
              </a>
            ))}
          </div>
        </Section>

        <footer style={{ marginTop: 40, paddingTop: 20, borderTop: `1px solid ${BORDER}`, color: FG_DIM, fontSize: 12.5 }}>
          <a href="https://hanzo.id/account" style={{ color: ORANGE, textDecoration: 'none' }}>
            Settings & account →
          </a>
          <span style={{ marginLeft: 14 }}>Hanzo AI</span>
        </footer>
      </main>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 30 }}>
      <h2 style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.42)', margin: '0 0 12px' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}
