/**
 * THE money formatter. One balance, one rendering, wherever it appears.
 *
 * There were ten of these, and they disagreed: half grouped the thousands and
 * half did not, so the SAME balance read `$149,741.15` on the billing page and
 * `$149741.15` in the sidebar three inches away. Nobody wrote that on purpose —
 * it is what a local `const usd = …` at the top of ten files converges to.
 *
 * `—` for absent, never `$0.00`. A balance that cannot be read and a balance
 * that is genuinely zero are different facts, and rendering them the same way is
 * the most expensive lie this surface can tell.
 */
export const usd = (cents: number | null | undefined): string =>
  cents == null || !Number.isFinite(cents)
    ? '—'
    : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * The same amount, shortened for a dense table where the column is narrower
 * than the number. Only above $10K, where the cents stop carrying meaning.
 */
export const usdShort = (cents: number | null | undefined): string => {
  if (cents == null || !Number.isFinite(cents)) return '—'
  const d = cents / 100
  return Math.abs(d) >= 10_000 ? `$${(d / 1000).toFixed(1)}K` : usd(cents)
}
