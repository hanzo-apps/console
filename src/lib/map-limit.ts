/**
 * Run an async job over a list with a bounded number in flight.
 *
 * A page that needs one call per row must not open one connection per row: a few
 * hundred repos would fire a few hundred requests at the same origin, and the browser
 * would queue them anyway while the first paint waited on the last of them. The gate
 * keeps the tail short and the backend unsurprised.
 *
 * `fn` returns void and collects through a closure — the ONE shape, so a caller that
 * wants results writes them where it wants them and no second signature exists to
 * choose between. Rejections propagate: a caller that wants per-item tolerance catches
 * inside `fn`, which is where it knows what a failure means for that item.
 */
export async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx])
    }
  })
  await Promise.all(workers)
}
