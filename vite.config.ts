import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function irsaDevelopmentProxy(): Plugin {
  return {
    name: 'cosmic-lens-irsa-proxy',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(request.url ?? '/', 'http://localhost')
        if (request.method !== 'GET' || ![
          '/api/irsa/product/png',
          '/api/irsa/product/download',
          '/api/irsa/compare',
        ].includes(requestUrl.pathname)) return next()
        try {
          const apiResponse = await fetch(`http://127.0.0.1:8000${requestUrl.pathname}${requestUrl.search}`)
          response.statusCode = apiResponse.status
          for (const header of ['content-type', 'content-disposition', 'x-fits-metadata', 'x-fits-image-hdus', 'cache-control']) {
            const value = apiResponse.headers.get(header)
            if (value) response.setHeader(header, value)
          }
          response.end(new Uint8Array(await apiResponse.arrayBuffer()))
        } catch (error) {
          console.error('SPHEREx image backend is unavailable:', error)
          response.statusCode = 503
          response.end('Start the FastAPI backend to convert and analyze FITS products.')
        }
      })
      server.middlewares.use('/api/irsa/sia', async (request, response, next) => {
        if (request.method !== 'GET') return next()
        const query = new URL(request.url ?? '/', 'http://localhost').searchParams
        const ra = Number(query.get('ra'))
        const dec = Number(query.get('dec'))
        const radius = Number(query.get('radius') ?? '0.1')
        const maxRec = Number(query.get('maxrec') ?? '500')
        const collections = (query.get('collections') ?? 'spherex_dr1')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
        if (!Number.isFinite(ra) || ra < 0 || ra > 360 || !Number.isFinite(dec) || dec < -90 || dec > 90 || !Number.isFinite(radius) || radius <= 0 || radius > 1 || collections.length === 0 || !Number.isFinite(maxRec) || maxRec < 1 || maxRec > 1000) {
          response.statusCode = 400
          response.end('Invalid sky coordinates, search radius, or archive selection.')
          return
        }
        const params = new URLSearchParams({
          COLLECTION: collections.join(','),
          POS: `CIRCLE ${ra} ${dec} ${radius}`,
          MAXREC: String(maxRec),
          RESPONSEFORMAT: 'VOTABLE',
        })
        try {
          const archiveResponse = await fetch(`https://irsa.ipac.caltech.edu/SIA?${params}`)
          response.statusCode = archiveResponse.status
          response.setHeader('Content-Type', archiveResponse.headers.get('content-type') ?? 'application/x-votable+xml')
          response.end(await archiveResponse.text())
        } catch (error) {
          console.error('IRSA development proxy request failed:', error)
          response.statusCode = 502
          response.end('Could not connect to the IRSA archive.')
        }
      })
      server.middlewares.use('/api/irsa/product', async (request, response, next) => {
        if (request.method !== 'GET') return next()
        const query = new URL(request.url ?? '/', 'http://localhost').searchParams
        const url = query.get('url') ?? ''
        let product: URL
        try {
          product = new URL(url)
        } catch {
          response.statusCode = 400
          response.end('Invalid SPHEREx DR1 product URL.')
          return
        }
        if (product.protocol !== 'https:' || product.hostname !== 'irsa.ipac.caltech.edu'
          || !product.pathname.startsWith('/ibe/data/spherex/dr1/') || product.search) {
          response.statusCode = 400
          response.end('Invalid SPHEREx DR1 product URL.')
          return
        }
        const range = request.headers.range
        const match = range?.match(/^bytes=(\d+)-(\d+)$/)
        if (!match || Number(match[2]) < Number(match[1])
          || Number(match[2]) - Number(match[1]) + 1 > 32 * 1024 * 1024) {
          response.statusCode = 416
          response.end('A supported byte range is required.')
          return
        }
        try {
          const archiveResponse = await fetch(product, { headers: { Range: range } })
          response.statusCode = archiveResponse.status
          for (const header of ['content-type', 'content-range', 'content-length', 'accept-ranges']) {
            const value = archiveResponse.headers.get(header)
            if (value) response.setHeader(header, value)
          }
          response.end(new Uint8Array(await archiveResponse.arrayBuffer()))
        } catch (error) {
          console.error('IRSA product proxy request failed:', error)
          response.statusCode = 502
          response.end('Could not retrieve the IRSA product.')
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), irsaDevelopmentProxy()],
})
