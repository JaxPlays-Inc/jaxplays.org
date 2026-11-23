const noindex = (response) => {
  const headers = new Headers(response.headers)
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

const largeAsset = async (request, env, pathname) => {
  const object = await env.LARGE_ASSETS.get(pathname.slice(1))
  if (!object) return undefined

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Cache-Control', headers.get('Cache-Control') || 'public, max-age=3600')
  headers.set('Content-Length', String(object.size))
  headers.set('ETag', object.httpEtag)

  return noindex(
    new Response(request.method === 'HEAD' ? null : object.body, {
      headers,
      status: 200,
    }),
  )
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const assetResponse = await env.ASSETS.fetch(request)
    if (assetResponse.status !== 404) return noindex(assetResponse)
    const archived = await largeAsset(request, env, url.pathname)
    if (archived) return archived
    return noindex(assetResponse)
  },
}
