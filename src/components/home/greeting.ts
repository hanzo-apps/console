/**
 * The greeting: what the person is called, and what they are doing here.
 *
 * "Good evening, Zach Kelling" is how a database addresses a record. A person is
 * called Zach, and the thing they came here to do is build — so the greeting says
 * both, and says nothing about the hour, which the reader can already see.
 *
 * The verb turns over once a DAY. Re-rolling it per render reads as a slot machine
 * and re-rolling it never reads as a string nobody chose; a day is the only cadence
 * slow enough to notice and fast enough to stay warm. It is derived from the date
 * rather than drawn at random, so every render within a day agrees — which is also
 * what keeps it from flickering between the server's HTML and the browser's.
 */

/**
 * One verb per weekday. Seven, so the cycle is a week — long enough that a repeat
 * feels like a rhythm rather than a loop, and short enough that none of them is a
 * stranger. Each has to read naturally after "Good", which is what rules out most
 * of the obvious founder vocabulary ("Good scaling" is a sentence nobody says).
 */
const VERBS = [
  'compounding', // Sunday
  'building', // Monday
  'shipping', // Tuesday
  'hacking', // Wednesday
  'scheming', // Thursday
  'launching', // Friday
  'tinkering', // Saturday
] as const

/** The verb for a given date. Sunday is 0, which is where the list starts. */
export function verbFor(date: Date): string {
  return VERBS[date.getDay() % VERBS.length]
}

/**
 * What a person is called, from whatever the account happens to carry.
 *
 * An IAM record's display name is a full name, a username, or an email, and only
 * the first is a name in the sense that matters here. Each is reduced to the part a
 * person would answer to, and anything that survives none of those rules is
 * returned unchanged — an unfamiliar shape is not an invitation to guess.
 */
export function firstName(raw: string | null | undefined): string {
  const name = (raw ?? '').trim()
  if (!name) return ''

  // An email is a login, not a name: keep the local part, and only up to the first
  // separator, so zach.kelling@ and zach+cloud@ both come back as "zach".
  const local = name.includes('@') ? name.split('@')[0] : name
  const first = local.split(/[\s._+-]+/).filter(Boolean)[0] ?? local

  // A single lowercase token is a handle the person chose. Leave it exactly as they
  // wrote it — "z" is a name here, and "Z" is someone else's idea of one.
  return first
}

/**
 * The whole line. Kept together so the comma cannot end up orphaned when there is
 * no name to follow it — the case that produces "Good building, " in the wild.
 */
export function greet(date: Date, who: string | null | undefined): string {
  const name = firstName(who)
  const verb = verbFor(date)
  return name ? `Good ${verb}, ${name}` : `Good ${verb}`
}
