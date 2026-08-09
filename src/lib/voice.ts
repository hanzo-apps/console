'use client'

/**
 * Voice — the ONE machine, from `@hanzo/voice`.
 *
 * This file used to be a 187-line Web Speech wrapper of its own: a second voice
 * implementation with no waveform, no platform ear, and its own idea of what
 * "listening" meant. The package is the machine now — the same control hanzo.chat
 * and hanzo.app mount — and this module is only the console's configuration of
 * it plus the one predicate the topbar mics read.
 *
 * Speech: the platform's own `/v1/audio/{transcriptions,speech}` (whisper ears,
 * kokoro voice), same-origin so the session cookie rides along and the browser
 * never holds a gateway token. Where the platform refuses, the package falls
 * back to the browser's recogniser and SAYS SO on `voice.refusal` — a refusal
 * is worn, never silent.
 */
import { blocker, capability, speech } from '@hanzo/voice'

/** The console's speech configuration — the platform's models, same-origin. */
export const HANZO_SPEECH = speech({
  baseUrl: '',
  ear: 'whisper',
  voice: { model: 'kokoro' },
})

/** True iff voice can run here at all — the topbar mics render only when so. */
export function voiceSupported(): boolean {
  return blocker(capability(), HANZO_SPEECH) === null
}
