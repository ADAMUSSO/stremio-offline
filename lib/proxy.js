// Reverse proxy pre web UI Stremia 5 (web.stremio.com)
//  - do index.html vloží náš skript (/__dl/inject.js)
//  - každú úspešnú odpoveď uloží na disk; keď nie je internet, servuje z cache → UI sa načíta aj offline
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR, WEB_UPSTREAM, FORCE_OFFLINE, BASE_URL } from './config.js'

const CACHE_DIR = path.join(DATA_DIR, 'web-cache')
// absolútna URL — stránka môže bežať pod prefixom /proxy/d=... na streaming serveri
const INJECT = `<script src="${BASE_URL}/__dl/inject.js"></script>`
const PASS_HEADERS = ['content-type', 'cache-control', 'last-modified', 'etag', 'service-worker-allowed']

const cacheFile = url => path.join(CACHE_DIR, crypto.createHash('sha1').update(url).digest('hex'))

async function readCache(url) {
    const file = cacheFile(url)
    try {
        const headers = JSON.parse(await fsp.readFile(file + '.json', 'utf8'))
        return { headers, body: await fsp.readFile(file) }
    } catch {
        return null
    }
}

async function writeCache(url, headers, body) {
    const file = cacheFile(url)
    await fsp.mkdir(CACHE_DIR, { recursive: true })
    await fsp.writeFile(file + '.tmp', body)
    await fsp.rename(file + '.tmp', file)
    await fsp.writeFile(file + '.json', JSON.stringify(headers))
}

function inject(html) {
    const s = html.toString('utf8')
    if (s.includes(INJECT)) return Buffer.from(s)
    return Buffer.from(s.includes('</head>') ? s.replace('</head>', INJECT + '</head>') : INJECT + s)
}

export async function handleProxy(req, res, pathWithQuery) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end()
        return
    }
    const upstreamUrl = WEB_UPSTREAM + pathWithQuery
    const isNavigation = pathWithQuery === '/' || pathWithQuery.startsWith('/?') || /\.html?(\?|$)/.test(pathWithQuery)

    let result = null
    let fromCache = false
    if (!FORCE_OFFLINE) {
        try {
            const upstream = await fetch(upstreamUrl, {
                headers: {
                    accept: req.headers.accept || '*/*',
                    'accept-language': req.headers['accept-language'] || 'en',
                    'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(isNavigation ? 6000 : 60000),
            })
            const headers = {}
            for (const h of PASS_HEADERS) {
                const v = upstream.headers.get(h)
                if (v) headers[h] = v
            }
            const body = Buffer.from(await upstream.arrayBuffer())
            result = { status: upstream.status, headers, body }
            if (upstream.status === 200) writeCache(upstreamUrl, headers, body).catch(() => {})
        } catch {
            // bez siete → skúsime cache nižšie
        }
    }
    if (!result || result.status >= 500) {
        const cached = await readCache(upstreamUrl)
        if (cached) {
            result = { status: 200, ...cached }
            fromCache = true
        }
    }
    if (!result) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Stremio web UI is not available (offline and not cached yet).')
        return
    }

    let body = result.body
    const headers = { ...result.headers }
    if ((headers['content-type'] || '').includes('text/html')) {
        body = inject(body)
        headers['cache-control'] = 'no-cache'
    }
    headers['content-length'] = body.length
    if (fromCache) headers['x-stremio-offline-cache'] = 'hit'
    res.writeHead(result.status, headers)
    res.end(req.method === 'HEAD' ? undefined : body)
}

export function cacheStats() {
    try {
        const files = fs.readdirSync(CACHE_DIR).filter(f => !f.endsWith('.json'))
        return { entries: files.length }
    } catch {
        return { entries: 0 }
    }
}
