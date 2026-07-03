import { describe, it, expect } from 'vitest'
import { MEDIA_BUCKET, s3Ref, isS3Ref, parseS3Ref, mediaKey } from './media-upload'

describe('media-upload — pure key/reference helpers', () => {
  it('s3Ref / isS3Ref / parseS3Ref round-trip a key', () => {
    const ref = s3Ref('photos/cat.png')
    expect(ref).toBe(`s3://${MEDIA_BUCKET}/photos/cat.png`)
    expect(isS3Ref(ref)).toBe(true)
    expect(parseS3Ref(ref)).toEqual({ bucket: MEDIA_BUCKET, key: 'photos/cat.png' })
  })

  it('isS3Ref is false for a plain URL or non-string', () => {
    expect(isS3Ref('https://cdn.example.com/x.png')).toBe(false)
    expect(isS3Ref('')).toBe(false)
    expect(isS3Ref(null)).toBe(false)
    expect(isS3Ref(42)).toBe(false)
  })

  it('parseS3Ref rejects a malformed ref', () => {
    expect(parseS3Ref('not-a-ref')).toBeNull()
    expect(parseS3Ref('s3://')).toBeNull()
    expect(parseS3Ref('s3://bucketonly')).toBeNull()
  })

  it('mediaKey slugifies, keeps the extension, and is collision-resistant', () => {
    const a = mediaKey('My Photo!.PNG')
    const b = mediaKey('My Photo!.PNG')
    expect(a).toMatch(/^my-photo-[a-z0-9]+\.png$/)
    expect(a).not.toBe(b) // random suffix → no collision
    expect(mediaKey('résumé.pdf')).toMatch(/^resume-[a-z0-9]+\.pdf$/)
    expect(mediaKey('noext')).toMatch(/^noext-[a-z0-9]+$/)
  })

  it('mediaKey nests under a slugified folder', () => {
    expect(mediaKey('a.jpg', 'Blog Images')).toMatch(/^blog-images\/a-[a-z0-9]+\.jpg$/)
  })
})
