import { describe, it, expect } from 'vitest'
import { normalizePage, normalizeMedia, cmsMediaFileUrl } from './cms'

describe('cms normalizers — bind to the REAL Payload collection shapes', () => {
  it('normalizePage reads title/slug/_status/updatedAt', () => {
    const p = normalizePage({ id: 'p1', title: 'Home', slug: 'home', _status: 'published', updatedAt: '2026-06-01T00:00:00Z' })
    expect(p.id).toBe('p1')
    expect(p.title).toBe('Home')
    expect(p.slug).toBe('home')
    expect(p.status).toBe('published')
    expect(p.updatedAt).toBe('2026-06-01T00:00:00Z')
  })

  it('normalizePage degrades a title-less doc to "(untitled)" (never throws / never blank)', () => {
    const p = normalizePage({ id: 'p2' })
    expect(p.title).toBe('(untitled)')
    expect(p.slug).toBeUndefined()
  })

  it('normalizeMedia reads filename/mimeType/filesize/dimensions', () => {
    const m = normalizeMedia({ id: 'm1', filename: 'logo.png', mimeType: 'image/png', filesize: 20480, width: 512, height: 512, alt: 'Logo' })
    expect(m.filename).toBe('logo.png')
    expect(m.mimeType).toBe('image/png')
    expect(m.filesize).toBe(20480)
    expect(m.width).toBe(512)
    expect(m.height).toBe(512)
    expect(m.alt).toBe('Logo')
  })

  it('normalizeMedia tolerates missing numeric fields (honest undefined, not NaN)', () => {
    const m = normalizeMedia({ id: 'm2', filename: 'doc.pdf', mimeType: 'application/pdf' })
    expect(m.filesize).toBeUndefined()
    expect(m.width).toBeUndefined()
  })

  it('cmsMediaFileUrl routes bytes through the OWN-origin /cms proxy (never the cross-origin cms host)', () => {
    // SSR (no window) → root-relative proxy path; never an absolute cms.<brand> URL.
    const url = cmsMediaFileUrl('photo.jpg')
    expect(url).toBe('/cms/api/media/file/photo.jpg')
    expect(url.startsWith('/cms/')).toBe(true)
    expect(url).not.toContain('cms.hanzo.ai')
  })

  it('cmsMediaFileUrl returns "" for an empty filename (no dangling proxy URL)', () => {
    expect(cmsMediaFileUrl('')).toBe('')
  })
})
