import assert from 'node:assert/strict'
import test from 'node:test'

import worker from '../src/worker.js'

const assetResponse = new Response('<h1>archive</h1>', {
  headers: { 'Content-Type': 'text/html' },
})

test('adds a noindex header to ordinary archive assets', async () => {
  const response = await worker.fetch(new Request('https://hugo.jaxplays.org/news/'), {
    ASSETS: { fetch: async () => assetResponse },
    LARGE_ASSETS: { get: async () => null },
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive')
  assert.equal(await response.text(), '<h1>archive</h1>')
})

test('streams oversized legacy programs from R2', async () => {
  const response = await worker.fetch(
    new Request('https://hugo.jaxplays.org/media/programs/2026-Into-the-Woods.pdf'),
    {
      ASSETS: { fetch: async () => new Response('missing', { status: 404 }) },
      LARGE_ASSETS: {
        get: async (key) => ({
          body: 'program',
          httpEtag: '"archive-etag"',
          size: 7,
          writeHttpMetadata: (headers) => headers.set('Content-Type', 'application/pdf'),
          key,
        }),
      },
    },
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Content-Type'), 'application/pdf')
  assert.equal(response.headers.get('ETag'), '"archive-etag"')
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive')
  assert.equal(await response.text(), 'program')
})

test('falls back to R2 for any oversized archive asset omitted from the static bundle', async () => {
  const response = await worker.fetch(
    new Request('https://hugo.jaxplays.org/downloads/archive.zip'),
    {
      ASSETS: { fetch: async () => new Response('missing', { status: 404 }) },
      LARGE_ASSETS: {
        get: async (key) => ({
          body: 'archive',
          httpEtag: '"archive-zip"',
          size: 7,
          writeHttpMetadata: (headers) => headers.set('Content-Type', 'application/zip'),
          key,
        }),
      },
    },
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Content-Type'), 'application/zip')
  assert.equal(await response.text(), 'archive')
})
