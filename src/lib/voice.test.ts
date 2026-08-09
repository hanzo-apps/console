/**
 * voice — the console's configuration of `@hanzo/voice` (node-safe, pure).
 *
 * `voiceSupported()` is the ONE gate the chrome reads to decide whether to
 * render the "Talk to Hanzo" mics. It now answers from the package's own
 * `capability`/`blocker`, which widens the old gate in exactly one way: a
 * browser with no SpeechRecognition but a MediaRecorder + microphone is STILL
 * supported, because the platform's ear (`/v1/audio/transcriptions`) can
 * transcribe for it. These pin that contract:
 *
 *  - in node (no speech machinery at all) it is false — SSR never renders a mic;
 *  - a recogniser (plain or vendor-prefixed) alone is enough;
 *  - a recorder + microphone alone is enough — the platform-ear leg;
 *  - text-to-speech alone is NOT — the gate is "can this browser listen";
 *  - an insecure context is never supported, whatever else is present.
 *
 * The machine's runtime wiring (mic → waveform → turn) is the package's own
 * test suite's job plus the Playwright render spec — not re-proven here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HANZO_SPEECH, voiceSupported } from './voice'

class FakeRecognition {}
class FakeRecorder {}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('module surface', () => {
  it('exports the gate and the console speech configuration', () => {
    expect(typeof voiceSupported).toBe('function')
    // Same-origin platform speech: whisper ears, kokoro voice.
    expect(HANZO_SPEECH).toBeTruthy()
  })
})

describe('voiceSupported', () => {
  it('is false in node — SSR and a speechless browser never show a mic', () => {
    expect(voiceSupported()).toBe(false)
  })

  it('is true with a recogniser', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognition)
    expect(voiceSupported()).toBe(true)
  })

  it('is true with the vendor-prefixed recogniser', () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    expect(voiceSupported()).toBe(true)
  })

  it('is true with a recorder + microphone — the platform ear transcribes', () => {
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => {} } })
    expect(voiceSupported()).toBe(true)
  })

  it('is false with text-to-speech alone — the gate is "can it listen"', () => {
    vi.stubGlobal('speechSynthesis', {})
    expect(voiceSupported()).toBe(false)
  })

  it('is false in an insecure context, whatever else is present', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognition)
    vi.stubGlobal('isSecureContext', false)
    expect(voiceSupported()).toBe(false)
  })
})
