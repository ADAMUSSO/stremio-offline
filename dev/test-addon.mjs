// Testovací Stremio addon s legálnymi (Creative Commons) streamami na skúšanie sťahovania:
//  - Sintel (tt1727587): torrent cez Stremio streaming server
//  - Big Buck Bunny (tt1254207): priamy HTTP súbor a HLS (.m3u8)
//  - seriál Chernobyl (tt7366338), séria 1: krátke lokálne testovacie videá (vyrobí ich ffmpeg) na skúšanie
//    "stiahni celú sériu": 720p je pri každej epizóde, 1080p (rovnaký bingeGroup) iba pri E01–E03,
//    E04 má podobný 1080p z inej skupiny, E05 1080p nemá
// Spustenie: node dev/test-addon.mjs  →  v Stremiu nainštaluj http://127.0.0.1:11499/manifest.json
// STREAM_DELAY_MS=1500 node dev/test-addon.mjs → pomalé odpovede (ako skutočné addony), dá sa sledovať priebeh
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const PORT = Number(process.env.PORT || 11499)
const BASE = `http://127.0.0.1:${PORT}`
const VIDEO_DIR = path.join(os.tmpdir(), 'offline-stremio-test-videos')
const STREAM_DELAY_MS = Number(process.env.STREAM_DELAY_MS || 0)

const manifest = {
    id: 'dev.offline-stremio.cc-streams',
    version: '1.1.0',
    name: 'CC Test Streams',
    description: 'Creative Commons and generated test streams for developing Offline Stremio',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
}

const streams = {
    tt1727587: [{
        name: 'CC Torrent',
        description: 'Sintel 1080p (WebTorrent)',
        infoHash: '08ada5a7a6183aae1e09d831df6748d566095a10',
        fileIdx: 5,
        sources: ['tracker:udp://tracker.opentrackr.org:1337/announce', 'tracker:udp://tracker.openbittorrent.com:6969', 'dht:08ada5a7a6183aae1e09d831df6748d566095a10'],
    }],
    tt1254207: [
        { name: 'CC HTTP', description: 'Big Buck Bunny 720p 10s (test-videos.co.uk)', url: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_10MB.mp4' },
        { name: 'CC HLS', description: 'Big Buck Bunny HLS (mux.dev)', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' },
    ],
}

// séria 1 seriálu Chernobyl: lokálne vyrobené videá
const local = (file, name, group) => ({
    name: `CC Local\n${name}`,
    description: file,
    url: `${BASE}/video/${file}`,
    behaviorHints: { bingeGroup: group, filename: file },
})
for (let n = 1; n <= 5; n++) {
    const e = `S01E0${n}`
    const list = [local(`Chernobyl.${e}.720p.WEB.x264-TEST.mp4`, '720p', 'cc-local|720p|WEB')]
    if (n <= 3) list.unshift(local(`Chernobyl.${e}.1080p.WEB-DL.x265-GRP.mp4`, '1080p', 'cc-local|1080p|WEB-DL'))
    if (n === 4) list.unshift(local(`Chernobyl.${e}.1080p.WEBRip.x265-OTHER.mp4`, '1080p', 'cc-local|1080p|WEBRip'))
    streams[`tt7366338:1:${n}`] = list
}

function ensureVideo(file) {
    const target = path.join(VIDEO_DIR, file)
    if (fs.existsSync(target)) return target
    fs.mkdirSync(VIDEO_DIR, { recursive: true })
    const label = file.replace(/^Chernobyl\./, '').replace(/\.mp4$/, '').replace(/[^A-Za-z0-9. -]/g, ' ')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
        '-vf', `drawtext=text='${label}':fontcolor=white:fontsize=28:box=1:boxcolor=black@0.6:x=(w-tw)/2:y=h-60`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', target])
    return target
}

function sendVideo(req, res, file) {
    let target
    try {
        target = ensureVideo(file)
    } catch (e) {
        res.statusCode = 500
        return res.end(`ffmpeg failed: ${e.message}`)
    }
    const size = fs.statSync(target).size
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
    res.setHeader('content-type', 'video/mp4')
    res.setHeader('accept-ranges', 'bytes')
    let start = 0
    let end = size - 1
    if (range) {
        start = Number(range[1])
        end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
        res.statusCode = 206
        res.setHeader('content-range', `bytes ${start}-${end}/${size}`)
    }
    res.setHeader('content-length', end - start + 1)
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(target, { start, end }).pipe(res)
}

http.createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*')
    const v = req.url.match(/^\/video\/([A-Za-z0-9._-]+\.mp4)$/)
    if (v) return sendVideo(req, res, v[1])
    res.setHeader('content-type', 'application/json')
    if (req.url === '/manifest.json') return res.end(JSON.stringify(manifest))
    const m = req.url.match(/^\/stream\/(movie|series)\/([^/]+)\.json/)
    const body = JSON.stringify({ streams: m ? streams[decodeURIComponent(m[2])] || [] : [] })
    setTimeout(() => res.end(body), m ? STREAM_DELAY_MS : 0)
}).listen(PORT, '127.0.0.1', () => console.log(`CC test add-on: ${BASE}/manifest.json`))
