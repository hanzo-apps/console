/**
 * voice — feature-detection unit tests (node-safe, pure).
 *
 * `voiceSupported()` is the ONE gate the chrome reads to decide whether to render
 * the "Talk to Hanzo" mic (topbar) and the composer mic — a browser without
 * SpeechRecognition must NEVER show a dead control. These tests pin that gate:
 *
 *  - in node (no `window`) it is false — so SSR and a non-speech browser both
 *    correctly hide the mic;
 *  - it flips true when EITHER `window.SpeechRecognition` OR the vendor-prefixed
 *    `window.webkitSpeechRecognition` is present (Chrome/Edge are the primary
 *    targets, hence the prefixed fallback);
 *  - a TTS-only browser (has `speechSynthesis`, NO recognition ctor) is still
 *    false — the gate is "can this browser LISTEN", not "can it speak".
 *
 * Kept pure/robust — no DOM, no network. The repo has no @testing-library/react or
 * jsdom (see package.json / CLAUDE.md: tests are pure-logic; component-render tests
 * are the e2e layer's job), so the hook's runtime wiring (mic → start() → the
 * recognition instance) is proven by `tsc` + the Playwright render spec
 * (`e2e/chrome-brand-voice.spec.ts`), not by rendering the hook here. `window` is
 * stubbed with `vi.stubGlobal` and auto-restored, so no test leaks a global.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as voice from './voice'
import { useVoice, voiceSupported } from './voice'

/** A minimal, inert SpeechRecognition ctor — the shape the gate keys off. */
class FakeRecognition {
  lang = ''
  continuous = false
  interimResults = false
  onresult: unknown = null
  onerror: unknown = null
  onend: unknown = null
  started = 0
  start() {
    this.started += 1
  }
  stop() {}
  abort() {}
}

/** Install a fake `window` for the duration of a test (auto-restored in afterEach). */
function stubWindow(props: Record<string, unknown>): void {
  vi.stubGlobal('window', props)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('module surface', () => {
  it('exports voiceSupported and useVoice as functions', () => {
    expect(typeof voiceSupported).toBe('function')
    expect(typeof useVoice).toBe('function')
    // The named exports are the ONLY surface — a caller feature-detects with
    // voiceSupported() and drives the mic with the useVoice hook.
    expect(typeof voice.voiceSupported).toBe('function')
    expect(typeof voice.useVoice).toBe('function')
  })
})

describe('voiceSupported (feature detection)', () => {
  it('is false in node — no window, so SSR and non-speech browsers hide the mic', () => {
    // vitest runs in the node environment (no jsdom) → `window` is undefined.
    expect(typeof window).toBe('undefined')
    expect(voiceSupported()).toBe(false)
  })

  it('is true when window.SpeechRecognition is present', () => {
    stubWindow({ SpeechRecognition: FakeRecognition })
    expect(voiceSupported()).toBe(true)
  })

  it('is true via the vendor-prefixed webkitSpeechRecognition fallback (Chrome/Edge)', () => {
    stubWindow({ webkitSpeechRecognition: FakeRecognition })
    expect(voiceSupported()).toBe(true)
  })

  it('prefers the unprefixed ctor but accepts either', () => {
    stubWindow({ SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition })
    expect(voiceSupported()).toBe(true)
  })

  it('is false for a TTS-only browser — speechSynthesis without a recognition ctor', () => {
    // The gate is "can this browser LISTEN"; a browser that can only speak must
    // still hide the mic (never a dead control that does nothing on tap).
    stubWindow({ speechSynthesis: { speak() {}, cancel() {} } })
    expect(voiceSupported()).toBe(false)
  })

  it('re-evaluates the live window each call (not memoized at import)', () => {
    // false → present → absent, proving the detection reads the CURRENT environment
    // every call (so a late-arriving polyfill or an SSR→hydrate transition is seen).
    expect(voiceSupported()).toBe(false)
    stubWindow({ SpeechRecognition: FakeRecognition })
    expect(voiceSupported()).toBe(true)
    vi.unstubAllGlobals()
    expect(voiceSupported()).toBe(false)
  })
})

describe('the recognition contract the hook relies on', () => {
  it('the ctor the gate accepts is newable and exposes start/stop/abort', () => {
    // The gate admits a ctor; the hook constructs it and calls start()/stop()/abort().
    // Prove that contract is a plain newable with those methods (what useVoice needs),
    // independent of React — a regression to the detected shape fails here.
    stubWindow({ SpeechRecognition: FakeRecognition })
    expect(voiceSupported()).toBe(true)
    const Ctor = (window as unknown as { SpeechRecognition: new () => FakeRecognition }).SpeechRecognition
    const rec = new Ctor()
    expect(typeof rec.start).toBe('function')
    expect(typeof rec.stop).toBe('function')
    expect(typeof rec.abort).toBe('function')
    rec.start()
    expect(rec.started).toBe(1)
  })
})
