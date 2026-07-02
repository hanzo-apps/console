'use client'

import dynamic from 'next/dynamic'
import type { ReactNode } from 'react'

/**
 * Dashboard layout — a GUI-free shell that loads the authed chrome CLIENT-ONLY.
 *
 * The chrome (AuthGate → OrgGate → shell + provider stack) is a react-native-web
 * GUI tree whose sidebar is built from the product registry — it cannot be
 * server-evaluated, which `output: 'export'` would otherwise force. Loading it via
 * `dynamic(ssr:false)` keeps the GUI off the prerender: the export emits the shell
 * `index.html` (served by the cloud binary, webui.go) and the console mounts on the
 * client against the same-origin cloud `/v1`.
 */
const DashboardChrome = dynamic(
  () => import('~/components/DashboardChrome').then((m) => m.DashboardChrome),
  { ssr: false },
)

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardChrome>{children}</DashboardChrome>
}
