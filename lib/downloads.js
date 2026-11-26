// Správca sťahovania
//  - torrenty idú cez Stremio streaming server (http://127.0.0.1:11470/{infoHash}/{fileIdx})
//  - HTTP/debrid odkazy sa sťahujú priamo (s pokračovaním cez Range)
//  - HLS (.m3u8) sa ukladá cez ffmpeg do .mkv
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { DOWNLOAD_DIR, STREAMING_SERVER, MAX_PARALLEL, BASE_URL } from './config.js'
import { JsonStore } from './store.js'
import * as metas from './metas.js'
import * as library from './library.js'

const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|webm|mov|wmv|flv|ts|m2ts|mpg|mpeg|ogv|3gp)$/i
const MIME_EXT = {
    'video/mp4': 'mp4', 'video/x-matroska': 'mkv', 'video/webm': 'webm', 'video/x-msvideo': 'avi',
    'video/quicktime': 'mov', 'video/mp2t': 'ts', 'video/x-flv': 'flv', 'video/mpeg': 'mpg',
}

export class HttpError extends Error {
    constructor(status, message) {
        super(message)
        this.status = status
    }
}

const store = new JsonStore('downloads.json', { items: [] })
const active = new Map() // id -> AbortController
const items = () => store.data.items
const find = id => items().find(i => i.id === id)

// pri štarte: rozbehnuté sťahovania pokračujú, chýbajúce súbory označíme
for (const item of items()) {
    if (item.status === 'downloading') item.status = 'queued'
    if (item.status === 'done' && !fs.existsSync(item.file)) {
        item.status = 'error'
        item.error = 'File is missing on disk'
    }
}
store.save()

function sanitize(name) {
    return String(name || '').replace(/[/\\:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Stremio'
}

const pad = n => String(n).padStart(2, '0')

function publicView(item) {
    const { source, ...rest } = item
    return {
        ...rest,
        source: { kind: source.kind },
        filename: item.file ? path.basename(item.file) : null,
        progress: item.size ? Math.min(1, item.downloaded / item.size) : item.progressHint ?? null,
        // pri HLS veľkosť vopred nepoznáme → odhad z doterajšieho priebehu
        size: item.size || (item.progressHint > 0.02 ? Math.round(item.downloaded / item.progressHint) : null),
        sizeEstimated: !item.size && item.progressHint > 0.02,
    }
}

export function list() {
    return items().map(publicView).reverse()
}

export function get(id) {
    const item = find(id)
    return item ? publicView(item) : null
}

export function doneFor(type, id) {
    return items().filter(i => i.status === 'done' && (i.videoId === id || (i.metaId === id && i.type === type && i.videoId === i.metaId)))
}

export function allItems() {
    return items()
}

export function filePathOf(id) {
    const item = find(id)
    return item && item.status === 'done' ? item.file : null
}

export async function add(parsed) {
    const { stream, streamEnc, metaTransportUrl, type, id } = parsed
    const videoId = parsed.videoId || id
    if (!type || !id) throw new HttpError(400, 'The link has no title information')
    if (stream.ytId) throw new HttpError(400, 'YouTube streams cannot be downloaded')
    if (typeof stream.url === 'string' && stream.url.startsWith(BASE_URL)) throw new HttpError(409, 'This stream is already offline')
    if (!stream.infoHash && !stream.url) throw new HttpError(400, 'This stream has no downloadable source')

    const sourceKey = stream.infoHash
        ? `bt:${stream.infoHash.toLowerCase()}:${stream.fileIdx ?? ''}`
        : `url:${stream.url}`

    const existing = items().find(i => i.sourceKey === sourceKey && i.videoId === videoId)
    if (existing) {
        if (existing.status === 'error' || existing.status === 'paused') resume(existing.id)
        return publicView(existing)
    }

    let meta = metas.get(type, id)
    if (metaTransportUrl) meta = await metas.fetchAndStore(metaTransportUrl, type, id).catch(() => meta)

    const video = videoId !== id ? (meta?.videos || []).find(v => v.id === videoId) : null
    if (video?.thumbnail) metas.cacheImages([video.thumbnail])
    const episode = video
        ? [video.season != null && (video.episode ?? video.number) != null ? `S${pad(video.season)}E${pad(video.episode ?? video.number)}` : null, video.title || video.name]
            .filter(Boolean).join(' · ')
        : null

    const hints = stream.behaviorHints || {}
    const item = {
        id: crypto.randomBytes(6).toString('hex'),
        sourceKey,
        streamEnc,
        type,
        metaId: id,
        videoId,
        title: meta?.name || stream.title || stream.name || id,
        year: meta?.releaseInfo || meta?.year || null,
        episode,
        streamName: [stream.name, stream.description || stream.title].filter(Boolean).join(' — ').slice(0, 300),
        source: stream.infoHash
            // stremio-core serializuje "sources" z addonu ako "announce"
            ? { kind: 'torrent', infoHash: stream.infoHash.toLowerCase(), fileIdx: stream.fileIdx ?? null, sources: stream.announce || stream.sources || [], filename: hints.filename || null }
            : { kind: 'http', url: stream.url, headers: hints.proxyHeaders?.request || {}, filename: hints.filename || null },
        status: 'queued',
        file: null,
        size: null,
        downloaded: 0,
        speed: 0,
        error: null,
        createdAt: Date.now(),
        finishedAt: null,
    }
    items().push(item)
    store.save()
    pump()
    return publicView(item)
}

export function pause(id) {
    const item = find(id)
    if (!item || !['queued', 'downloading'].includes(item.status)) return false
    item.status = 'paused'
    item.speed = 0
    active.get(id)?.abort()
    store.save()
    return true
}

export function resume(id) {
    const item = find(id)
    if (!item || !['paused', 'error'].includes(item.status)) return false
    item.status = 'queued'
    item.error = null
    store.save()
    pump()
    return true
}

export async function remove(id) {
    const idx = items().findIndex(i => i.id === id)
    if (idx < 0) return false
    const [item] = items().splice(idx, 1)
    active.get(id)?.abort()
    store.save()
    if (item.file) {
        await fsp.rm(item.file, { force: true })
        await fsp.rm(item.file + '.part', { force: true })
        await fsp.rmdir(path.dirname(item.file)).catch(() => {}) // len ak je priečinok prázdny
    }
    // meta zmažeme, len ak ho nepoužíva iné sťahovanie ani lokálna knižnica
    if (!items().some(i => i.type === item.type && i.metaId === item.metaId) && !library.usesMeta(item.type, item.metaId))
        await metas.remove(item.type, item.metaId)
    return true
}

let stopping = false

function pump() {
    if (stopping) return
    for (const item of items()) {
        if (active.size >= MAX_PARALLEL) break
        if (item.status === 'queued' && !active.has(item.id) && !(item.retryAt > Date.now())) run(item)
    }
}

async function streamingServerUp() {
    try {
        return (await fetch(`${STREAMING_SERVER}/settings`, { signal: AbortSignal.timeout(3000) })).ok
    } catch {
        return false
    }
}

async function run(item) {
    const ctl = new AbortController()
    active.set(item.id, ctl)
    item.status = 'downloading'
    item.error = null
    delete item.retryAt
    store.save()
    try {
        if (item.source.kind === 'torrent') await runTorrent(item, ctl.signal)
        else await runHttp(item, ctl.signal)
        item.status = 'done'
        item.finishedAt = Date.now()
        if (item.size == null || item.downloaded > item.size) item.size = item.downloaded
    } catch (e) {
        if (ctl.signal.aborted) {
            // pauza alebo zmazanie — stav už nastavil volajúci
        } else if (item.source.kind === 'torrent' && !(await streamingServerUp())) {
            // Stremio je zatvorené → počkáme a po jeho spustení pokračujeme od miesta prerušenia
            item.status = 'queued'
            item.error = 'Waiting for Stremio to start…'
            item.retryAt = Date.now() + 15000
            setTimeout(pump, 15500)
        } else {
            item.status = 'error'
            item.error = e.message || String(e)
            console.error(`[download ${item.id}] ${item.error}`)
        }
    } finally {
        item.speed = 0
        active.delete(item.id)
        store.save()
        pump()
    }
}

// --- cieľový súbor -----------------------------------------------------------

function targetFile(item, name) {
    const folder = sanitize(item.year ? `${item.title} (${String(item.year).slice(0, 4)})` : item.title)
    let base = sanitize(name)
    const ext = path.extname(base)
    const stem = base.slice(0, base.length - ext.length)
    let file = path.join(DOWNLOAD_DIR, folder, base)
    // nekolidovať so súborom iného sťahovania
    for (let n = 2; items().some(i => i !== item && i.file === file) || (fs.existsSync(file) && !fs.existsSync(file + '.part')); n++) {
        file = path.join(DOWNLOAD_DIR, folder, `${stem} (${n})${ext}`)
    }
    return file
}

function fallbackName(item, ext) {
    return `${item.title}${item.episode ? ' ' + item.episode.split(' · ')[0] : ''}.${ext}`
}

// --- torrent cez streaming server --------------------------------------------

async function createTorrent(source, signal) {
    const sources = [...new Set([...(source.sources || []), `dht:${source.infoHash}`])]
    const res = await fetch(`${STREAMING_SERVER}/${source.infoHash}/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ torrent: { infoHash: source.infoHash }, peerSearch: { sources, min: 40, max: 200 } }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
    })
    if (!res.ok) throw new Error(`Streaming server: HTTP ${res.status}`)
    const info = await res.json()
    if (!Array.isArray(info.files) || !info.files.length) throw new Error('Torrent has no files (no peers?)')
    return info
}

function guessFileIdx(files, filename) {
    if (filename) {
        const idx = files.findIndex(f => path.basename(f.name) === filename || f.name === filename)
        if (idx >= 0) return idx
    }
    const videos = files.map((f, i) => ({ f, i })).filter(x => VIDEO_EXT.test(x.f.name))
    const pool = videos.length ? videos : files.map((f, i) => ({ f, i }))
    return pool.sort((a, b) => b.f.length - a.f.length)[0].i
}

async function runTorrent(item, signal) {
    const info = await createTorrent(item.source, signal).catch(e => {
        if (signal.aborted || e.message.startsWith('Torrent has no files')) throw e
        throw new Error(`Stremio streaming server unavailable (${e.cause?.code || e.message}). Is Stremio running?`)
    })
    let idx = item.source.fileIdx
    if (idx == null || idx < 0 || !info.files[idx]) idx = guessFileIdx(info.files, item.source.filename)
    item.source.fileIdx = idx
    if (!item.file) item.file = targetFile(item, path.basename(info.files[idx].name))
    item.size = info.files[idx].length
    await httpToFile(`${STREAMING_SERVER}/${item.source.infoHash}/${idx}`, {}, item, signal)
}

// --- HTTP / debrid / HLS --------------------------------------------------------

function filenameFromDisposition(cd) {
    if (!cd) return null
    const star = cd.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)
    if (star) try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')) } catch {}
    const plain = cd.match(/filename\s*=\s*"?([^";]+)"?/i)
    return plain ? plain[1].trim() : null
}

async function runHttp(item, signal) {
    const { url, headers } = item.source
    if (!item.file) {
        // zistíme typ obsahu a názov bez sťahovania celého súboru
        const probe = await fetch(url, { headers: { ...headers, Range: 'bytes=0-0' }, signal, redirect: 'follow' })
        if (!probe.ok) throw new Error(`HTTP ${probe.status}`)
        const type = (probe.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
        const finalPath = decodeURIComponent(new URL(probe.url).pathname)
        await probe.body?.cancel()
        item.source.hls = /mpegurl|m3u/.test(type) || /\.m3u8$/i.test(finalPath)
        let name = item.source.filename || filenameFromDisposition(probe.headers.get('content-disposition')) || path.basename(finalPath)
        if (item.source.hls) name = fallbackName(item, 'mkv')
        else if (!VIDEO_EXT.test(name || '')) name = fallbackName(item, MIME_EXT[type] || 'mp4')
        item.file = targetFile(item, name)
        const range = probe.headers.get('content-range')
        if (!item.source.hls && range && /\/\d+$/.test(range)) item.size = Number(range.split('/').pop())
    }
    if (item.source.hls) await runFfmpeg(item, signal)
    else await httpToFile(url, headers, item, signal)
}

// sťahovanie do .part s pokračovaním (Range) a meraním rýchlosti
async function httpToFile(url, headers, item, signal) {
    const part = item.file + '.part'
    await fsp.mkdir(path.dirname(part), { recursive: true })
    let start = 0
    try { start = (await fsp.stat(part)).size } catch {}

    if (start > 0 && item.size && start >= item.size) {
        await fsp.rename(part, item.file)
        item.downloaded = start
        return
    }

    const res = await fetch(url, { headers: start > 0 ? { ...headers, Range: `bytes=${start}-` } : headers, signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (start > 0 && res.status !== 206) start = 0 // server ignoroval Range → odznova
    const len = Number(res.headers.get('content-length'))
    if (len) item.size = start + len
    item.downloaded = start

    let windowBytes = 0
    let windowStart = Date.now()
    const counter = new Transform({
        transform(chunk, _enc, cb) {
            item.downloaded += chunk.length
            windowBytes += chunk.length
            const now = Date.now()
            if (now - windowStart >= 1000) {
                item.speed = Math.round(windowBytes / ((now - windowStart) / 1000))
                windowBytes = 0
                windowStart = now
                store.save(10000)
            }
            cb(null, chunk)
        },
    })

    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part, { flags: start > 0 ? 'a' : 'w' }), { signal })
    if (item.size && item.downloaded < item.size) throw new Error(`Incomplete download (${item.downloaded}/${item.size} bytes)`)
    await fsp.rename(part, item.file)
}

function runFfmpeg(item, signal) {
    return new Promise((resolve, reject) => {
        const part = item.file + '.part'
        fs.mkdirSync(path.dirname(part), { recursive: true })
        const headerArg = Object.entries(item.source.headers || {}).map(([k, v]) => `${k}: ${v}\r\n`).join('')
        // loglevel info kvôli riadku "Duration:" (z neho počítame percentá); štatistiky idú cez -progress
        const args = ['-nostdin', '-nostats', '-y', '-loglevel', 'info', '-progress', 'pipe:1',
            ...(headerArg ? ['-headers', headerArg] : []),
            // bez -map vyberie ffmpeg jednu najlepšiu video a audio stopu (nie všetky kvality z master playlistu)
            '-i', item.source.url, '-c', 'copy', '-f', 'matroska', part]
        const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
        let lastSize = 0
        let lastTime = Date.now()
        let stderr = ''
        let duration = 0 // sekundy
        proc.stdout.on('data', buf => {
            const text = String(buf)
            const t = text.match(/out_time_us=(\d+)/g)
            if (t && duration) item.progressHint = Math.min(0.999, Number(t.pop().split('=')[1]) / 1e6 / duration)
            const m = text.match(/total_size=(\d+)/g)
            if (!m) return
            const size = Number(m.pop().split('=')[1])
            const now = Date.now()
            if (now > lastTime) item.speed = Math.round((size - lastSize) / ((now - lastTime) / 1000))
            lastSize = size
            lastTime = now
            item.downloaded = size
        })
        proc.stderr.on('data', b => {
            stderr = (stderr + b).slice(-4000)
            const d = !duration && stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/)
            if (d) duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])
        })
        const onAbort = () => proc.kill('SIGTERM')
        signal.addEventListener('abort', onAbort, { once: true })
        proc.on('error', e => reject(new Error(`ffmpeg: ${e.message}`)))
        proc.on('close', code => {
            signal.removeEventListener('abort', onAbort)
            if (signal.aborted) return reject(new Error('aborted'))
            if (code !== 0) {
                const last = stderr.trim().split('\n').filter(l => /error|invalid|failed|denied|not found/i.test(l)).pop()
                return reject(new Error(`ffmpeg failed: ${last || 'exit code ' + code}`))
            }
            delete item.progressHint
            fs.renameSync(part, item.file)
            item.size = fs.statSync(item.file).size
            item.downloaded = item.size
            resolve()
        })
    })
}

// beží alebo čaká nejaké sťahovanie? torrenty sa bez Stremia (jeho servera) aj tak nepohnú
export function hasActive(stremioUp) {
    return items().some(i => (i.status === 'downloading' || i.status === 'queued') && (i.source.kind !== 'torrent' || stremioUp))
}

export function shutdown() {
    stopping = true
    for (const ctl of active.values()) ctl.abort()
    for (const item of items()) if (item.status === 'downloading') item.status = 'queued'
    store.flush()
}

pump()
