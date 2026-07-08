// Copyright (C) 2020-2026, Hanzo AI Inc. All rights reserved.
//
// HanzoAnalytics — the ONE analytics tag for every Hanzo surface.
//
// There is exactly one analytics module in the stack: the native tracker served
// from https://analytics.hanzo.ai/script.js (hanzoai/analytics). It is a
// multi-provider tag manager — a single <script> fans out to:
//   - Hanzo's own first-party analytics (/api/send, /api/ast, /api/element)
//   - GA4          via data-ga-id       -> googletagmanager.com/gtag/js
//   - Meta Pixel   via data-fb-pixel-id -> connect.facebook.net/.../fbevents.js
//   - GTM / TikTok / LinkedIn / Pinterest / Snap / Plausible (unused here)
//
// GA4 + the Facebook Pixel are NOT separate snippets: they are data attributes
// on this one tag. This is the DRY, one-way analytics surface, reused verbatim
// across hanzo.ai, hanzo.app, console, and the waitlist funnel.
//
// IDs are env-driven and PUBLIC (they ship in client JS — not KMS secrets):
//   NEXT_PUBLIC_ANALYTICS_WEBSITE_ID  per-surface Hanzo-analytics website id
//   NEXT_PUBLIC_GA_ID                 GA4 measurement id  (G-XXXXXXXXXX) — global
//   NEXT_PUBLIC_FB_PIXEL_ID           Meta Pixel id       (15-16 digits) — global
//
// With no NEXT_PUBLIC_ANALYTICS_WEBSITE_ID set the tag does not load (console
// has no analytics property yet — create one at analytics.hanzo.ai and set the
// env var). GA/Pixel likewise load only when their ids are provided.
//
// NOTE (white-label): console is multi-brand (console.hanzo.ai / .lux.cloud /
// .zoo). This tag is Hanzo's first-party analytics; do not ship it on non-Hanzo
// brand hosts unless a per-brand website id is provisioned. It is gated purely
// on the env var, so leaving NEXT_PUBLIC_ANALYTICS_WEBSITE_ID unset for brand
// builds keeps it off.

'use client'

import Script from 'next/script'

const WEBSITE_ID = process.env.NEXT_PUBLIC_ANALYTICS_WEBSITE_ID
const GA_ID = process.env.NEXT_PUBLIC_GA_ID
const FB_PIXEL_ID = process.env.NEXT_PUBLIC_FB_PIXEL_ID

export function HanzoAnalytics() {
  if (!WEBSITE_ID) return null
  return (
    <Script
      src="https://analytics.hanzo.ai/script.js"
      data-website-id={WEBSITE_ID}
      {...(GA_ID ? { 'data-ga-id': GA_ID } : {})}
      {...(FB_PIXEL_ID ? { 'data-fb-pixel-id': FB_PIXEL_ID } : {})}
      strategy="afterInteractive"
    />
  )
}

/**
 * trackEvent — fire a named conversion/funnel event through the one analytics
 * module. Forwarded to Hanzo analytics AND (when ids are set) GA4
 * (`gtag('event', ...)`) and the Meta Pixel (`fbq('trackCustom', ...)`).
 */
export function trackEvent(name: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  const w = window as unknown as {
    hanzo?: { track: (n: string, p?: Record<string, unknown>) => void }
  }
  try {
    w.hanzo?.track(name, props)
  } catch {
    /* analytics must never break the app */
  }
}
