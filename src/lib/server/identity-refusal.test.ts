/**
 * A REFUSAL, a network error and an ABSENCE are three different answers.
 *
 * IAM v1.33.31 made org scoping honour-or-refuse (`internal/authz/authz.go`
 * `Scope`): a non-SuperAdmin principal that asks about a foreign owner is REFUSED
 * rather than silently re-pointed at its own org. Read from that source, the wire
 * shapes are:
 *
 *   hit      HTTP 200 {status:"ok",    data:{…}}                  (httpx.Ok)
 *   absence  HTTP 200 {status:"error", msg:"the entity does not exist"}
 *                                                                 (httpx.Err — 200 BY
 *                                                                  CONTRACT: "branch on
 *                                                                  status, not HTTP code")
 *   refusal  HTTP 403 {status:"error", msg:"forbidden: …"}        (authz.Deny → 403)
 *
 * Absence is the ONLY one that may become `null`. This module's confidential
 * client is exactly the kind of principal the v1.33.31 rollout starts refusing, so
 * this is a deploy-ordering hazard rather than a theoretical one, and the damage
 * is concrete:
 *
 *   - `getMember` is the invite flow's identity read. A `null` tells the invitee
 *     "your membership was removed" (410) when IAM merely would not answer, and it
 *     is the same `null` the single-use activation guard reads.
 *   - `getUserKey` is the API-key state read. A `null` reports "no key", which is
 *     the exact regression its docstring records: the page falls back to "Create",
 *     the live key is hidden, and the user mints a duplicate over a key they can no
 *     longer revoke.
 *
 * The admin gate's own read is the deliberate EXCEPTION and is pinned here too: it
 * is fail-SOFT because the gate needs positive evidence, so softening can only ever
 * DENY. That asymmetry is the point — soften where a lost answer closes a door,
 * never where it opens one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

// The confidential client is read at module scope, and every route checks
// `mintConfigured()` before calling — so configure it before the import, which is
// what production guarantees.
vi.hoisted(() => {
  process.env.IAM_MINT_CLIENT_ID = 'hanzo-console'
  process.env.IAM_MINT_CLIENT_SECRET = 'test-secret'
})

vi.mock('./session', () => ({ consoleClaims: vi.fn() }))

import { getMember, getUserKey, getAdminGate, type SessionUser } from './identity'

/** IAM's genuine-absence envelope, verbatim (compat/aliases.go getHandler). */
const ABSENT = { status: 'error', msg: 'the entity does not exist' }
/** IAM's refusal, verbatim (authz.errForeignOrg, rendered by authz.Deny at 403). */
const REFUSAL = {
  status: 'error',
  msg: 'forbidden: this credential is scoped to organization hanzo',
}

const json = (body: unknown, status = 200) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

const user: SessionUser = {
  owner: 'maxpower',
  name: 'dave',
  id: 'maxpower/dave',
  accessKey: '',
  email: 'dave@maxpower.io',
  emailVerified: true,
  isAdmin: true,
  isSuperAdmin: false,
}

afterEach(() => vi.unstubAllGlobals())

describe('getMember — absence is the ONLY null', () => {
  it('a genuine absence is null (the invite really does name nobody)', async () => {
    json(ABSENT)
    await expect(getMember('acme/ghost')).resolves.toBeNull()
  })

  it('a hit returns the member', async () => {
    json({ status: 'ok', data: { owner: 'acme', name: 'dave', password: '' } })
    await expect(getMember('acme/dave')).resolves.toMatchObject({ name: 'dave' })
  })

  it('a REFUSAL is not an absence — it throws, and says why', async () => {
    json(REFUSAL, 403)
    await expect(getMember('acme/dave')).rejects.toThrow(/scoped to organization hanzo/)
  })

  it('a 5xx is not an absence', async () => {
    json({ status: 'error', msg: 'boom' }, 502)
    await expect(getMember('acme/dave')).rejects.toThrow()
  })

  it('an unreachable IAM is not an absence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    await expect(getMember('acme/dave')).rejects.toThrow(/unreachable/)
  })

  it('an unreadable envelope is not an absence', async () => {
    json({ status: 'error', msg: 'id (owner/name) or name is required' })
    await expect(getMember('acme/dave')).rejects.toThrow(/is required/)
  })
})

describe('getUserKey — a lost answer never reports "no key"', () => {
  it('a genuine absence is an honest empty', async () => {
    json(ABSENT)
    await expect(getUserKey(user)).resolves.toEqual({ accessKey: '', updatedAt: '' })
  })

  it('a hit returns the real key state', async () => {
    json({ status: 'ok', data: { accessKey: 'sk-live-abc', updatedTime: '2026-01-01T00:00:00Z' } })
    await expect(getUserKey(user)).resolves.toEqual({
      accessKey: 'sk-live-abc',
      updatedAt: '2026-01-01T00:00:00Z',
    })
  })

  it('a REFUSAL throws — it must NOT hide a live key behind "Create"', async () => {
    json(REFUSAL, 403)
    await expect(getUserKey(user)).rejects.toThrow(/scoped to organization hanzo/)
  })

  it('an unreachable IAM throws rather than reporting no key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    await expect(getUserKey(user)).rejects.toThrow(/unreachable/)
  })
})

/**
 * The admin gate reads IAM too, and there the softening is CORRECT: the gate
 * admits only on positive evidence (a verified brand-domain email AND an IAM admin
 * flag), so a lost answer can only deny. Pinned so the strictness above is never
 * "fixed" into throwing here — and, more importantly, so a refusal can never be
 * mistaken for an admission.
 */
describe('getAdminGate — a refused IAM read still fails CLOSED', () => {
  const req = (host: string) =>
    ({
      headers: {
        get: (h: string) => (h === 'host' ? host : h === 'cookie' ? 'cloud_session_id=x' : null),
      },
    }) as unknown as import('next/server').NextRequest

  it('refuses when IAM refuses the claims read (no gate opened on a 403)', async () => {
    // get-account answers with a brand-domain user whose verification is unknown;
    // the authoritative IAM re-read is REFUSED. The gate must not admit.
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1
        return call === 1
          ? new Response(
              JSON.stringify({
                status: 'ok',
                data: { owner: 'hanzo', name: 'z', email: 'z@hanzo.ai', type: 'normal-user' },
              }),
              { status: 200 },
            )
          : new Response(JSON.stringify(REFUSAL), { status: 403 })
      }),
    )
    await expect(getAdminGate(req('admin.hanzo.ai'))).resolves.toBeNull()
  })
})
