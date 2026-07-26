'use client'

/**
 * Voice — talk to Hanzo. A self-contained, feature-detected wrapper over the
 * browser's native Web Speech API: speech-to-text (SpeechRecognition) for "talk
 * instead of type", and text-to-speech (speechSynthesis) so a voice-initiated
 * reply is spoken back. NOTHING leaves the browser here — the transcript is fed
 * into the SAME chat binding (`AiApi.ragChatStream`) the typed composer uses, so
 * voice is just another way to drive the one assistant. No new backend, no audio
 * upload, no third-party SDK.
 *
 * Feature-detected + SSR-safe by construction: on a browser without
 * SpeechRecognition (or during SSR) `supported` is false and every control is a
 * no-op, so a caller renders the mic ONLY when `supported` — never a fake/dead
 * voice button. Chrome/Edge (webkitSpeechRecognition) are the primary targets;
 * Safari/Firefox degrade to typed input honestly.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

// Minimal structural types for the Web Speech API (not in lib.dom for all TS
// targets). We touch only the members used below — kept local so the hook stays
// self-contained and strict-clean.
type SpeechRecognitionAlternative = { transcript: string }
type SpeechRecognitionResult = { 0: SpeechRecognitionAlternative; isFinal: boolean; length: number }
type SpeechRecognitionResultList = { length: number; [index: number]: SpeechRecognitionResult }
type SpeechRecognitionEventLike = { resultIndex: number; results: SpeechRecognitionResultList }
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null
  return window.speechSynthesis ?? null
}

/** True iff this browser can both listen and speak (or at least listen). */
export function voiceSupported(): boolean {
  return recognitionCtor() !== null
}

export type UseVoiceOptions = {
  /** Called with the FINAL transcript when the user finishes an utterance. */
  onFinal: (text: string) => void
  /** Optional live interim transcript (as the user speaks) for a "listening…" HUD. */
  onInterim?: (text: string) => void
}

export type Voice = {
  /** This browser can do speech recognition. Render the mic only when true. */
  supported: boolean
  /** The mic is open and listening. */
  listening: boolean
  /** A reply is being spoken aloud. */
  speaking: boolean
  /** Start listening (no-op when unsupported / already listening). */
  start: () => void
  /** Stop listening. */
  stop: () => void
  /** Toggle listening. */
  toggle: () => void
  /** Speak `text` aloud (TTS); cancels any in-progress utterance first. */
  speak: (text: string) => void
  /** Stop any in-progress speech. */
  shush: () => void
}

/**
 * The voice controller. Recognition is single-utterance (not continuous): the
 * caller decides whether to re-arm the mic after a reply (hands-free) — this hook
 * stays a thin, predictable primitive. All listeners are cleaned up on unmount.
 */
export function useVoice({ onFinal, onInterim }: UseVoiceOptions): Voice {
  const [supported] = useState<boolean>(() => voiceSupported())
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  // Keep the latest callbacks in refs so the recognition instance (created once)
  // always calls through to the current closures without being re-created.
  const finalRef = useRef(onFinal)
  const interimRef = useRef(onInterim)
  finalRef.current = onFinal
  interimRef.current = onInterim

  const ensure = useCallback((): SpeechRecognitionLike | null => {
    if (recRef.current) return recRef.current
    const Ctor = recognitionCtor()
    if (!Ctor) return null
    const rec = new Ctor()
    rec.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US'
    rec.continuous = false
    rec.interimResults = true
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const text = r[0]?.transcript ?? ''
        if (r.isFinal) {
          const finalText = text.trim()
          if (finalText) finalRef.current(finalText)
        } else {
          interim += text
        }
      }
      if (interim) interimRef.current?.(interim)
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    recRef.current = rec
    return rec
  }, [])

  const start = useCallback(() => {
    const rec = ensure()
    if (!rec) return
    try {
      rec.start()
      setListening(true)
    } catch {
      // start() throws if already started — treat as already-listening.
      setListening(true)
    }
  }, [ensure])

  const stop = useCallback(() => {
    setListening(false)
    try {
      recRef.current?.stop()
    } catch {
      /* not started */
    }
  }, [])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  const shush = useCallback(() => {
    setSpeaking(false)
    synth()?.cancel()
  }, [])

  const speak = useCallback((text: string) => {
    const s = synth()
    const clean = text.trim()
    if (!s || !clean) return
    s.cancel()
    const u = new SpeechSynthesisUtterance(clean)
    u.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US'
    u.onstart = () => setSpeaking(true)
    u.onend = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    s.speak(u)
  }, [])

  // Clean up on unmount — stop the mic and any speech.
  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort()
      } catch {
        /* noop */
      }
      synth()?.cancel()
    }
  }, [])

  return { supported, listening, speaking, start, stop, toggle, speak, shush }
}
