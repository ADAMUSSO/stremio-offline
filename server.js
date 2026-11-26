// Stremio Offline — lokálny server pre Stremio 5
//  1. proxy web UI s vloženým tlačidlom "⬇ stiahnuť" pri každom streame
//  2. správca sťahovania (torrent cez Stremio streaming server, HTTP, HLS)
//  3. Stremio addon so stiahnutými titulmi na offline prehrávanie
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOST, PORT, BASE_URL, HTTPS_PORT, HTTPS_URL, STREMIO_ORIGIN, APP_URL, DOWNLOAD_DIR, DATA_DIR, WEB_UPSTREAM, STREAMING_SERVER } from './lib/config.js'
import { ensureCert } from './lib/tls.js'
import { parsePlayerHref } from './lib/playerLink.js'
import { handleProxy } from './lib/proxy.js'
import { sendFile } from './lib/files.js'
import * as downloads from './lib/downloads.js'
import * as addon from './lib/addon.js'
import * as metas from './lib/metas.js'
import * as library from './lib/library.js'
import * as fsbrowse from './lib/fsbrowse.js'
import * as settings from './lib/settings.js'

library.setExclude(p => downloads.isDownloadFile(p))

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `127.0.0.1:${HTTPS_PORT}`, `localhost:${HTTPS_PORT}`])
// odkiaľ smie bežať naše UI: priamo, cez HTTPS port, alebo cez proxy streaming servera (origin Stremia)
const UI_ORIGINS = new Set([BASE_URL, `http://localhost:${PORT}`, HTTPS_URL, STREMIO_ORIGIN, STREMIO_ORIGIN.replace('127.0.0.1', 'localhost')])

// cors: '*' pre addon/súbory, alebo konkrétny origin pre API
function json(res, status, data, cors = null) {
    const body = JSON.stringify(data)
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
        ...(cors ? { 'access-control-allow-origin': cors, vary: 'origin' } : {}),
    })
    res.end(body)
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let size = 0
        const chunks = []
        req.on('data', c => {
            size += c.length
            if (size > 256 * 1024) reject(new Error('Body too large'))
            else chunks.push(c)
        })
        req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (e) { reject(e) }
        })
        req.on('error', reject)
    })
}

// API smie volať iba naše vlastné UI (ochrana pred inými stránkami v prehliadači)
function apiAllowed(req) {
    const origin = req.headers.origin
    return req.headers['x-stremio-offline'] === '1' && (!origin || UI_ORIGINS.has(origin))
}

async function handleApi(req, res, pathname) {
    const origin = req.headers.origin && UI_ORIGINS.has(req.headers.origin) ? req.headers.origin : null
    const reply = (status, data) => json(res, status, data, origin)
    if (!apiAllowed(req)) return reply(403, { error: 'Forbidden' })
    const m = pathname.match(/^\/__dl\/api\/downloads(?:\/([0-9a-f]+))?(?:\/(pause|resume))?$/)
    if (pathname === '/__dl/api/info' && req.method === 'GET') {
        return reply(200, { manifestUrl: addon.MANIFEST_URL, addonSeen: addon.isSeen(), streamingServer: STREAMING_SERVER, ...settings.downloadInfo() })
    }
    // kam sa sťahuje: { path } = vlastný priečinok (napr. HDD), { path: null } = predvolený
    if (pathname === '/__dl/api/settings/download-dir' && req.method === 'POST') {
        const { path: dir } = await readJson(req)
        try {
            return reply(200, settings.setDownloadDir(dir))
        } catch (e) {
            return reply(e.status || 500, { error: e.message })
        }
    }
    if (pathname === '/__dl/api/download' && req.method === 'POST') {
        const { href } = await readJson(req)
        let parsed
        try {
            parsed = parsePlayerHref(String(href || ''))
        } catch (e) {
            return reply(400, { error: e.message })
        }
        try {
            return reply(200, await downloads.add(parsed))
        } catch (e) {
            return reply(e.status || 500, { error: e.message })
        }
    }
    if (m && !m[1] && req.method === 'GET') return reply(200, downloads.list().map(addon.decorateItem))

    // --- lokálna knižnica (priečinky na disku) ---
    if (pathname === '/__dl/api/library' && req.method === 'GET') {
        const since = Number(new URL(req.url, BASE_URL).searchParams.get('since'))
        const version = library.getVersion()
        if (since === version && !library.isBusy()) return reply(200, { version, unchanged: true })
        return reply(200, { version, busy: library.isBusy(), folders: library.folders(), items: addon.libraryItems() })
    }
    if (pathname === '/__dl/api/library/folders' && req.method === 'POST') {
        const { path: dir, kind } = await readJson(req)
        try {
            return reply(200, await library.addFolder(dir, kind))
        } catch (e) {
            return reply(e.status || 500, { error: e.message })
        }
    }
    const lf = pathname.match(/^\/__dl\/api\/library\/folders\/([0-9a-f]+)$/)
    if (lf && req.method === 'DELETE') return reply(library.removeFolder(lf[1]) ? 200 : 404, { ok: true })
    if (pathname === '/__dl/api/library/scan' && req.method === 'POST') {
        library.scanAll().catch(() => {})
        return reply(200, { ok: true })
    }
    if (pathname === '/__dl/api/fs' && req.method === 'GET') {
        try {
            const dir = new URL(req.url, BASE_URL).searchParams.get('path')
            return reply(200, { ...(await fsbrowse.list(dir)), roots: fsbrowse.roots() })
        } catch (e) {
            return reply(400, { error: `Cannot open folder: ${e.code || e.message}` })
        }
    }
    if (pathname === '/__dl/api/fs/pick' && req.method === 'POST') {
        const { start } = await readJson(req)
        try {
            return reply(200, { path: await fsbrowse.pick(start) })
        } catch (e) {
            return reply(500, { error: `System folder dialog is not available (${e.code || e.message})` })
        }
    }
    if (m && m[1] && m[2] && req.method === 'POST') {
        const ok = m[2] === 'pause' ? downloads.pause(m[1]) : downloads.resume(m[1])
        return reply(ok ? 200 : 409, { ok })
    }
    if (m && m[1] && !m[2] && req.method === 'DELETE') {
        const ok = await downloads.remove(m[1])
        return reply(ok ? 200 : 404, { ok })
    }
    return reply(404, { error: 'Not found' })
}

let openResponses = 0

async function handler(req, res) {
    openResponses++
    res.on('close', () => openResponses--)
    try {
        // ochrana pred DNS rebindingom
        if (!ALLOWED_HOSTS.has(req.headers.host || '')) {
            res.writeHead(421).end('Misdirected request')
            return
        }
        const url = new URL(req.url, BASE_URL)
        const { pathname } = url

        if (req.method === 'OPTIONS') {
            const origin = req.headers.origin
            const isApi = pathname.startsWith('/__dl/api/')
            res.writeHead(204, {
                'access-control-allow-origin': isApi ? (UI_ORIGINS.has(origin) ? origin : 'null') : '*',
                'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
                'access-control-allow-headers': 'content-type, x-stremio-offline, range',
                'access-control-max-age': '600',
                vary: 'origin',
            })
            res.end()
            return
        }

        if (pathname.startsWith('/__dl/api/')) return await handleApi(req, res, pathname)

        if (pathname === '/__dl/inject.js') {
            console.log(`UI loaded (${req.headers['user-agent'] || '?'})`)
            return sendFile(req, res, path.join(PUBLIC_DIR, 'inject.js'), 'text/javascript; charset=utf-8')
        }
        if (pathname === '/__dl/logo.svg') return sendFile(req, res, path.join(PUBLIC_DIR, 'logo.svg'), 'image/svg+xml')
        if (pathname === '/__dl/health') return json(res, 200, { ok: true }, '*')

        if (pathname === '/addon' || pathname.startsWith('/addon/')) {
            const out = addon.handle(pathname)
            return out ? json(res, 200, out, '*') : json(res, 404, { error: 'Not found' }, '*')
        }

        const fileMatch = pathname.match(/^\/files\/([0-9a-f]+)\//)
        if (fileMatch) {
            const file = downloads.filePathOf(fileMatch[1])
            if (!file) return json(res, 404, { error: 'Not found' }, '*')
            return sendFile(req, res, file)
        }

        // súbory z lokálnej knižnice — iba tie, ktoré sú v prehľadaných priečinkoch
        const libMatch = pathname.match(/^\/lib\/([0-9a-f]+)\//)
        if (libMatch) {
            const f = library.fileById(libMatch[1])
            if (!f) return json(res, 404, { error: 'Not found (is the disk connected?)' }, '*')
            return sendFile(req, res, f.path)
        }
        const subMatch = pathname.match(/^\/libsub\/([0-9a-f]+)\/(\d+)$/)
        if (subMatch) {
            const sub = library.subtitleOf(subMatch[1], Number(subMatch[2]))
            if (!sub) return json(res, 404, { error: 'Not found' }, '*')
            return sendFile(req, res, sub.path, /\.vtt$/i.test(sub.path) ? 'text/vtt; charset=utf-8' : 'text/plain; charset=utf-8')
        }

        const imgMatch = pathname.match(/^\/img\/([0-9a-f]{40})$/)
        if (imgMatch) {
            const img = metas.imagePath(imgMatch[1])
            if (!img) return json(res, 404, { error: 'Not found' }, '*')
            return sendFile(req, res, img.file, img.type)
        }

        return await handleProxy(req, res, pathname + url.search)
    } catch (e) {
        console.error(e)
        if (!res.headersSent) json(res, 500, { error: e.message })
        else res.destroy()
    }
}

// systemd socket aktivácia: fd 3 = HTTP, fd 4 = HTTPS (poradie podľa ListenStream v .socket)
const activated = Number(process.env.LISTEN_FDS || 0) >= 2 && Number(process.env.LISTEN_PID || process.pid) === process.pid
const httpServer = http.createServer(handler)
const httpsServer = https.createServer(ensureCert(), handler)
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
httpServer.listen(activated ? { fd: 3 } : { port: PORT, host: HOST })
httpsServer.listen(activated ? { fd: 4 } : { port: HTTPS_PORT, host: HOST }, () => {
    console.log(`Stremio Offline running${activated ? ' (socket activated)' : ''}`)
    console.log(`  Stremio --url: ${APP_URL}`)
    console.log(`  web UI from:   ${WEB_UPSTREAM}`)
    console.log(`  add-on:        ${addon.MANIFEST_URL}`)
    console.log(`  downloads:     ${settings.downloadDir()}${settings.downloadDir() === DOWNLOAD_DIR ? ' (default)' : ''}`)
    console.log(`  data:          ${DATA_DIR}`)
})

function exitCleanly() {
    downloads.shutdown()
    library.shutdown()
    settings.shutdown()
    httpServer.close()
    httpsServer.close()
    process.exit(0)
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, exitCleanly)

// Automatické vypnutie: keď je Stremio zatvorené (jeho streaming server neodpovedá) a nič sa nesťahuje,
// neprehráva ani neprehľadáva, po minúte skončíme. systemd socket nás pri ďalšom štarte Stremia spustí znova.
const IDLE_EXIT_MS = Number(process.env.IDLE_EXIT_MS || 60000)
let stremioGoneSince = null
async function checkIdle() {
    const stremioUp = await fetch(`${STREAMING_SERVER}/settings`, { signal: AbortSignal.timeout(3000) }).then(r => r.ok).catch(() => false)
    // openResponses > 0 = práve sa niečo prehráva alebo načítava z nášho servera
    const busy = downloads.hasActive(stremioUp) || library.isBusy() || openResponses > 0
    if (stremioUp || busy) {
        stremioGoneSince = null
        return
    }
    stremioGoneSince ??= Date.now()
    if (Date.now() - stremioGoneSince >= IDLE_EXIT_MS) {
        console.log('Stremio is closed and nothing is downloading — stopping until Stremio starts again')
        exitCleanly()
    }
}
if (activated && IDLE_EXIT_MS > 0) setInterval(checkIdle, Math.min(15000, IDLE_EXIT_MS / 2))
