import { describe, it, expect } from 'vitest'

import { isChunkLoadError, isNextControlFlowError, shouldReloadForChunk } from './boundary-logic'

/** A thrown value shaped like a webpack ChunkLoadError. */
function chunkError(message: string): Error {
  const e = new Error(message)
  e.name = 'ChunkLoadError'
  return e
}

/** A thrown value shaped like a Next control-flow error (notFound/redirect). */
function nextError(digest: string): Error {
  const e = new Error('control-flow') as Error & { digest: string }
  e.digest = digest
  return e
}

describe('isChunkLoadError', () => {
  it('matches by error name', () => {
    expect(isChunkLoadError(chunkError('boom'))).toBe(true)
  })

  it('matches the webpack "Loading chunk N failed" message', () => {
    expect(isChunkLoadError(new Error('Loading chunk 4821 failed.\n(error: https://x/_next/static/chunks/4821.js)'))).toBe(true)
    expect(isChunkLoadError(new Error('Loading CSS chunk app-layout failed'))).toBe(true)
  })

  it('matches the Next/Turbopack dynamic-import failure messages', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://x/_next/static/chunks/playground.js'))).toBe(true)
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true)
  })

  it('is false for ordinary render errors', () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(false)
    expect(isChunkLoadError(new TypeError('x is not a function'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError('some string')).toBe(false)
  })
})

describe('isNextControlFlowError', () => {
  it('matches notFound() and redirect() digests (must be re-thrown)', () => {
    expect(isNextControlFlowError(nextError('NEXT_NOT_FOUND'))).toBe(true)
    expect(isNextControlFlowError(nextError('NEXT_REDIRECT;replace;/signin;307;'))).toBe(true)
    expect(isNextControlFlowError(nextError('NEXT_HTTP_ERROR_FALLBACK;404'))).toBe(true)
  })

  it('matches the useSearchParams CSR bailout', () => {
    expect(isNextControlFlowError(nextError('BAILOUT_TO_CLIENT_SIDE_RENDERING'))).toBe(true)
  })

  it('is false for real crashes (they should render the fallback, not re-throw)', () => {
    expect(isNextControlFlowError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isNextControlFlowError(chunkError('Loading chunk 1 failed'))).toBe(false)
    expect(isNextControlFlowError({ digest: 12345 })).toBe(false)
    expect(isNextControlFlowError(null)).toBe(false)
  })
})

describe('shouldReloadForChunk', () => {
  it('reloads on the first chunk error (no prior reload)', () => {
    expect(shouldReloadForChunk(1_000_000, null)).toBe(true)
  })

  it('does NOT reload again within the window (no reload loop)', () => {
    expect(shouldReloadForChunk(1_000_000, 995_000)).toBe(false) // 5s ago, window 15s
  })

  it('reloads again once the window has passed', () => {
    expect(shouldReloadForChunk(1_000_000, 980_000)).toBe(true) // 20s ago
    expect(shouldReloadForChunk(1_000_000, 985_000, 15_000)).toBe(true) // exactly 15s
  })

  it('treats a non-finite/absent last-reload as safe to reload', () => {
    expect(shouldReloadForChunk(1_000_000, Number.NaN)).toBe(true)
  })
})
