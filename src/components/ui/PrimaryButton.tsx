'use client'

/**
 * Primary button — the one white, high-emphasis action for the console.
 *
 * Monochrome brand: `theme="light"` flips the button to the light theme inside
 * the dark console, giving a white fill with a near-black label and icon — no
 * hue accent. Use it for the single primary action in a view (sign in, save,
 * get started). Secondary and destructive actions use the default neutral
 * `Button`.
 *
 * When an org enables a custom brand color, the shared `hz-accent-fill` class
 * recolors this button to the org accent (with readable contrast text) via the ONE
 * root `--hz-accent` variable; with no custom theme it stays the default white.
 */
import type { ComponentProps } from 'react'
import { Button } from '@hanzo/gui'

export function PrimaryButton({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button theme="light" className={['hz-accent-fill', className].filter(Boolean).join(' ')} {...props} />
}
