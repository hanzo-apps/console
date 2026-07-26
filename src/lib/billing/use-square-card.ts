'use client'

/**
 * useSquareCard — the ONE reusable "mount a PCI-safe card field + get a nonce"
 * capability, shared by every in-console card-entry surface (Add credits =
 * `BillingCredits`, Add a payment method = `PaymentMethodsModule`).
 *
 * Decomplected (Hickey): this owns exactly one concern — standing up Square's
 * cross-origin card iframe and turning a completed entry into a single-use nonce —
 * separated from WHAT the caller does with that nonce (top up a balance vs. save a
 * method). The two surfaces used to duplicate a ~40-line mount effect; now there is
 * one card capability and two callers.
 *
 * PCI posture (unchanged, the whole point): the PAN / CVV / expiry are entered ONLY
 * into Square's own iframe (served from *.squarecdn.com) and tokenized IN THE
 * BROWSER by Square. This hook — and our servers and our logs — only ever see the
 * resulting opaque single-use nonce (`token`); never a card number. SAQ-A scope.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import { loadSquareSdk, type SquareCard } from './square'
import type { PaymentConfig } from '~/lib/api/billing'

/** Lifecycle of the mounted Square card field. */
export type CardMountPhase = 'idle' | 'mounting' | 'ready' | 'error'

export interface SquareCardController {
  /** Attach point — set as the `ref` of the container the card iframe mounts into. */
  containerRef: RefObject<HTMLDivElement | null>
  /** Mount lifecycle: idle (no config) → mounting → ready, or error. */
  phase: CardMountPhase
  /** Human message when `phase === 'error'` (SDK load / mount failure). */
  error: string
  /** True once the field is mounted and can be tokenized. */
  ready: boolean
  /**
   * Tokenize the entered card into a single-use Square nonce (`sourceId`), or throw
   * an Error with a human message (incomplete card / decline). The RAW PAN never
   * leaves Square's iframe — only this opaque nonce is returned.
   */
  tokenize: () => Promise<string>
}

/**
 * Mount Square's card field for `cfg` (the tenant's PUBLIC app/location/environment)
 * and expose a `tokenize()`. Pass `null` (config not loaded / not configured) to keep
 * the field idle. Re-mounts if the config identity changes; always destroys the field
 * on unmount so no Square iframe is orphaned.
 */
export function useSquareCard(cfg: PaymentConfig | null): SquareCardController {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cardInstance = useRef<SquareCard | null>(null)
  const [phase, setPhase] = useState<CardMountPhase>('idle')
  const [error, setError] = useState<string>('')

  // Only a config with a real Square application can mount a field.
  const applicationId = cfg?.applicationId ?? ''
  const locationId = cfg?.locationId ?? ''
  const environment = cfg?.environment ?? ''
  const configured = !!applicationId && !!locationId

  useEffect(() => {
    if (!configured) {
      setPhase('idle')
      return
    }
    let disposed = false
    setPhase('mounting')
    setError('')
    loadSquareSdk(environment)
      .then(async (sdk) => {
        if (disposed) return
        const payments = sdk.payments(applicationId, locationId)
        const card = await payments.card({
          // Match the console's monochrome dark surface — Square's card iframe defaults
          // to a bright WHITE field that reads as an off-brand box on the dark console.
          // Square renders the actual PCI-scoped inputs inside its OWN iframe; these are
          // the only knobs it exposes, so we set the full set to a dark, on-brand theme:
          // a near-black field (`$color1`), light legible text, muted placeholders, a
          // neutral border that brightens on focus, and a monochrome-red error tone. The
          // container the iframe mounts into is styled to match in BillingCredits.
          style: {
            input: {
              backgroundColor: '#0a0a0a',
              color: '#f2f2f2',
              fontSize: '14px',
            },
            'input::placeholder': { color: '#6b6b6b' },
            '.input-container': { borderColor: '#2a2a2a', borderRadius: '8px' },
            '.input-container.is-focus': { borderColor: '#8a8a8a' },
            '.input-container.is-error': { borderColor: '#b54a4a' },
            '.message-text': { color: '#9a9a9a' },
            '.message-icon': { color: '#9a9a9a' },
            '.message-text.is-error': { color: '#e06a6a' },
            '.message-icon.is-error': { color: '#e06a6a' },
          },
        })
        if (disposed) {
          await card.destroy().catch(() => {})
          return
        }
        const mount = containerRef.current
        if (!mount) return
        await card.attach(mount)
        if (disposed) {
          await card.destroy().catch(() => {})
          return
        }
        cardInstance.current = card
        setPhase('ready')
      })
      .catch((e: unknown) => {
        if (disposed) return
        setError(e instanceof Error ? e.message : 'Could not load the card form.')
        setPhase('error')
      })
    return () => {
      disposed = true
      const c = cardInstance.current
      cardInstance.current = null
      if (c) void c.destroy().catch(() => {})
    }
  }, [configured, applicationId, locationId, environment])

  const tokenize = useCallback(async (): Promise<string> => {
    const card = cardInstance.current
    if (!card) throw new Error('The card form is not ready.')
    const result = await card.tokenize()
    if (result.status !== 'OK' || !result.token) {
      const msg = result.errors?.map((x) => x.message).filter(Boolean).join('; ') || 'Card details are incomplete.'
      throw new Error(msg)
    }
    return result.token
  }, [])

  return { containerRef, phase, error, ready: phase === 'ready', tokenize }
}
