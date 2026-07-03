/**
 * Fun machine/bot names — `adjective-animal`, Docker/Heroku style (dark-llama,
 * cosmic-axolotl, turbo-wombat). We pre-fill the launch form with one of these so a
 * user can click-and-go and rapid-launch, re-roll on demand (the 🎲 button), and get a
 * fresh name after each launch. Curated word lists, pure, no deps.
 *
 * `randomName()` returns the clean two-word name (preferred — readable). Pass
 * `{ suffix: true }` only when a name must be unique; it appends a short readable
 * base36 token (dark-llama-7f3).
 */

const ADJECTIVES = [
  'dark', 'sleepy', 'brave', 'cosmic', 'feral', 'sassy', 'turbo', 'mighty',
  'sneaky', 'funky', 'grumpy', 'zen', 'rogue', 'quantum', 'neon', 'swift',
  'lucky', 'cranky', 'wobbly', 'spicy', 'noble', 'jolly', 'bold', 'plucky',
] as const

const ANIMALS = [
  'llama', 'narwhal', 'panda', 'axolotl', 'sloth', 'otter', 'yak', 'gecko',
  'moth', 'koala', 'ferret', 'wombat', 'pangolin', 'capybara', 'octopus',
  'lemur', 'walrus', 'puffin', 'tapir', 'quokka', 'mantis', 'badger',
] as const

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]

/** A fresh `adjective-animal` name (e.g. `sassy-otter`); `{ suffix: true }` for uniqueness. */
export function randomName(opts?: { suffix?: boolean }): string {
  const base = `${pick(ADJECTIVES)}-${pick(ANIMALS)}`
  return opts?.suffix ? `${base}-${Math.random().toString(36).slice(2, 5)}` : base
}
