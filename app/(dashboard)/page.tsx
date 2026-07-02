'use client'

import dynamic from 'next/dynamic'

/**
 * Dashboard home — GUI-free shell that loads the product catalog CLIENT-ONLY.
 *
 * The catalog renders the registry-backed product cards + LivingOverview (GUI /
 * react-native-web), so it is loaded via `dynamic(ssr:false)` to keep it off the
 * static-export prerender. This page's own module imports nothing GUI, so the
 * export cleanly emits `out/index.html` (the shell the cloud binary serves at `/`).
 */
const DashboardHome = dynamic(
  () => import('~/components/DashboardHomeClient').then((m) => m.DashboardHome),
  { ssr: false },
)

export default function Page() {
  return <DashboardHome />
}
