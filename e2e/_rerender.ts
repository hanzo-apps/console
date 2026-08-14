/**
 * Commit recorder — React DevTools' own accounting, without the extension.
 *
 * React hands every commit to `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot`.
 * Installing a minimal hook BEFORE any page script (Playwright's addInitScript)
 * gets the same fiber trees the Profiler panel reads.
 *
 * A fiber whose render function ran carries the PerformedWork flag — that is how
 * DevTools decides what to list. On its own it over-reports badly: a subtree React
 * never descends into is reused whole, so its fibers still carry the flag from
 * whenever they last rendered. `actualStartTime` settles it — React's profiler
 * timer stamps every fiber it begins work on, so a stamp later than the previous
 * commit means "visited in THIS render". Both together are exactly "its render ran,
 * this time".
 *
 * `ctx` is the useful part: which context values changed IDENTITY in a commit.
 * Scattered, unrelated components re-rendering at once has one cause, and this
 * names it without needing a displayName anywhere in the app.
 */
import type { Page } from '@playwright/test'

export type Commit = { count: number; duration: number; names: string[]; roots: string[]; ctx: string[] }

export async function recordCommits(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const commits: unknown[] = []
    ;(window as never as { __commits: unknown[] }).__commits = commits

    type Named = { displayName?: string; name?: string; type?: unknown; render?: unknown; _context?: Named }
    const named = (v: unknown): string => {
      const n = v as Named
      return n.displayName || n.name || 'Anonymous'
    }
    const label = (fiber: { type?: unknown; elementType?: unknown }): string | null => {
      const t: unknown = fiber.type ?? fiber.elementType
      if (t == null || typeof t === 'string') return null
      if (typeof t === 'function') return named(t)
      const o = t as Named
      if (o.displayName) return o.displayName
      const inner = o.type ?? o.render
      if (typeof inner === 'function') return `${named(inner)}*`
      if (o._context?.displayName) return `${o._context.displayName}.Provider`
      return null
    }

    const PERFORMED_WORK = 0b1
    let sinceCommit = -1

    const hook = {
      supportsFiber: true,
      renderers: new Map(),
      _id: 0,
      isDisabled: false,
      inject(renderer: unknown) {
        const id = ++hook._id
        hook.renderers.set(id, renderer)
        return id
      },
      onCommitFiberRoot(_id: unknown, root: { current: Record<string, unknown> }) {
        const names: string[] = []
        // The SHALLOWEST fibers that re-rendered — every deeper one is that wave's
        // consequence, so this is the list that names a cause.
        const roots: string[] = []
        const ctx: string[] = []
        const top = root.current
        const stack: { f: Record<string, unknown>; covered: boolean }[] = [{ f: top, covered: false }]
        while (stack.length) {
          const { f, covered } = stack.pop()!
          let next = covered
          // tag 10 === ContextProvider
          if (f.tag === 10 && f.alternate) {
            const now = (f.memoizedProps as { value?: unknown } | null)?.value
            const before = ((f.alternate as Record<string, unknown>).memoizedProps as { value?: unknown } | null)
              ?.value
            if (now !== before) {
              ctx.push(
                now && typeof now === 'object'
                  ? `{${Object.keys(now).slice(0, 14).join(',')}}`
                  : `${typeof now}:${String(now)}`,
              )
            }
          }
          const fresh = (f.actualStartTime as number) > sinceCommit
          if (f.alternate && fresh && ((f.flags as number) & PERFORMED_WORK) === PERFORMED_WORK) {
            const n = label(f as never)
            if (n) {
              names.push(n)
              if (!covered) {
                let p = f.return as Record<string, unknown> | null
                let parent = ''
                while (p && !parent) {
                  parent = label(p as never) ?? ''
                  p = p.return as Record<string, unknown> | null
                }
                roots.push(parent ? `${n} < ${parent}` : n)
                next = true
              }
            }
          }
          let c = f.child as Record<string, unknown> | null
          while (c) {
            stack.push({ f: c, covered: next })
            c = c.sibling as Record<string, unknown> | null
          }
        }
        commits.push({ count: names.length, duration: top.actualDuration ?? 0, names, roots, ctx })
        sinceCommit = performance.now()
      },
      onPostCommitFiberRoot() {},
      onCommitFiberUnmount() {},
      checkDCE() {},
      getFiberRoots() {
        return new Set()
      },
      getInternalModuleRanges() {
        return []
      },
      registerInternalModuleStart() {},
      registerInternalModuleStop() {},
      setStrictMode() {},
      emit() {},
      on() {},
      off() {},
      sub() {
        return () => {}
      },
    }
    ;(window as never as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook
  })
}

/** Drop every commit recorded so far — call immediately before the interaction. */
export async function resetCommits(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as never as { __commits: unknown[] }).__commits.length = 0
  })
}

/** Every commit recorded since the last reset. */
export async function readCommits(page: Page): Promise<Commit[]> {
  return page.evaluate(() => (window as never as { __commits: Commit[] }).__commits.slice())
}

/** Commits, components re-rendered, render time, and what changed identity. */
export function summarize(commits: Commit[]): {
  commits: number
  components: number
  ms: number
  roots: [string, number][]
  ctx: [string, number][]
} {
  const rootTally = new Map<string, number>()
  for (const c of commits) for (const n of c.roots) rootTally.set(n, (rootTally.get(n) ?? 0) + 1)
  const ctxTally = new Map<string, number>()
  for (const c of commits) for (const n of c.ctx) ctxTally.set(n, (ctxTally.get(n) ?? 0) + 1)
  return {
    commits: commits.length,
    components: commits.reduce((a, c) => a + c.count, 0),
    ms: Math.round(commits.reduce((a, c) => a + c.duration, 0) * 100) / 100,
    roots: [...rootTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
    ctx: [...ctxTally.entries()].sort((a, b) => b[1] - a[1]),
  }
}
