'use client'

/**
 * Top-left brand logomark — the ONE brand glyph in the console chrome, matching
 * the unified Hanzo app-shell (hanzo.app + hanzo.chat): the real geometric mark
 * ALONE (no wordmark, no product name, no letter-H text), white-labeled by host.
 *
 * The mark is the host-derived `BrandMark` (Hanzo H / Lux / Zoo / Pars per host,
 * `currentColor` so it inherits the calm chrome foreground and adapts to the
 * theme) — never a hardcoded Hanzo asset. On a lux/zoo/pars host it renders THAT
 * brand's mark. Left-click → product home (`/`); RIGHT-CLICK → a small brand
 * context menu (Settings · Brand · Docs · About), the same affordance the shared
 * shell's HanzoMark exposes.
 *
 * The interactive surface is a plain `<div>` (the console's own escape hatch, as
 * used for `<div onScroll>` in OrgSwitcher) so the native `contextmenu` event is
 * guaranteed to fire and the mark still inherits the chrome color via
 * `currentColor`. The menu reuses the console's one menu surface (a `$color2`
 * paper sheet with the shared `hz-paper hz-menu-in` styling) — no new menu
 * system; it is a cursor-anchored overlay (a right-click has no trigger rect to
 * anchor a Popover to).
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Text, XStack, YStack } from '@hanzo/gui'
import { BookOpen, Globe, Info, SlidersHorizontal } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { getBrand } from '~/lib/branding/brands'
import { BrandMark, useOrgLogo } from '~/components/ui/BrandLogo'

type MenuItem = {
  icon: typeof SlidersHorizontal
  label: string
  onSelect: () => void
}

/** The cursor-anchored brand menu — clamped inside the viewport, closes on
 *  outside-click / Escape. One paper sheet, shared chrome styling. */
function BrandMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Clamp so the sheet never spills past the viewport edge.
  const left = typeof window !== 'undefined' ? Math.min(x, window.innerWidth - 200) : x
  const top = typeof window !== 'undefined' ? Math.min(y, window.innerHeight - 200) : y

  return (
    <div ref={ref} role="menu" style={{ position: 'fixed', left, top, zIndex: 9999 }}>
      <YStack
        className="hz-paper hz-menu-in"
        minW={184}
        p="$1.5"
        gap="$0.5"
        rounded="$4"
        bg="$color2"
        borderWidth={1}
        borderColor="$borderColor"
      >
        {items.map((item) => (
          <XStack
            key={item.label}
            role="menuitem"
            onPress={() => {
              onClose()
              item.onSelect()
            }}
            cursor="pointer"
            items="center"
            gap="$2.5"
            px="$2"
            py="$2"
            rounded="$3"
            hoverStyle={{ bg: '$color4' }}
          >
            <item.icon size={15} />
            <Text fontSize="$2" color="$color12">
              {item.label}
            </Text>
          </XStack>
        ))}
      </YStack>
    </div>
  )
}

/**
 * The top-left brand mark. `collapsed` centers it in the icon rail. Left-click →
 * home; right-click → the brand context menu.
 */
export function SidebarBrand({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const router = useRouter()
  const brand = getBrand()
  // White-label: the selected org's OWN logo is the primary chrome identity (the
  // tenant's brand, front and center). The host BrandMark is only the fallback when
  // the org has set no logo — the `hanzo` org's logo is the Hanzo mark, so it stays
  // on-brand. `useOrgLogo` is the ONE cached org-logo source, shared with BrandLogo.
  const orgLogo = useOrgLogo()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const go = useCallback(
    (path: string) => {
      router.push(path)
      onNavigate?.()
    },
    [router, onNavigate],
  )

  const openExternal = useCallback((url: string) => {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener')
  }, [])

  const onContextMenu = useCallback((e: ReactMouseEvent) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }, [])

  // Settings + Docs are REAL, always-resolving targets (the `/settings` product +
  // the brand's docs site); Brand + About open the brand's own marketing site
  // (white-labeled — a lux/zoo host opens ITS site, never hanzo.ai). No dead links.
  const items: MenuItem[] = [
    { icon: SlidersHorizontal, label: 'Settings', onSelect: () => go('/settings') },
    { icon: Globe, label: 'Brand', onSelect: () => openExternal(`${brand.websiteUrl}/brand`) },
    { icon: BookOpen, label: 'Docs', onSelect: () => openExternal(config.docsUrl) },
    { icon: Info, label: 'About', onSelect: () => openExternal(brand.websiteUrl) },
  ]

  return (
    <>
      <div
        onClick={() => go('/')}
        onContextMenu={onContextMenu}
        role="link"
        aria-label={`${brand.brandName} — home (right-click for brand menu)`}
        title={brand.brandName}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          height: 40,
          paddingLeft: collapsed ? 0 : 4,
          cursor: 'pointer',
          color: 'var(--color12)',
        }}
      >
        {orgLogo ? (
          // The org's own IAM logo, at the brand-mark size — the tenant's brand leads
          // the chrome; the Hanzo H is hidden whenever the org has its own.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={orgLogo}
            alt={brand.brandName}
            style={{ height: 24, width: 'auto', maxWidth: 140, objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <BrandMark size={24} />
        )}
      </div>
      {menu ? <BrandMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} /> : null}
    </>
  )
}
