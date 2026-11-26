// Testovací Stremio addon s legálnymi (Creative Commons) streamami na skúšanie sťahovania:
//  - Sintel (tt1727587): torrent cez Stremio streaming server
//  - Big Buck Bunny (tt1254207): priamy HTTP súbor a HLS (.m3u8)
// Spustenie: node dev/test-addon.mjs  →  v Stremiu nainštaluj http://127.0.0.1:11499/manifest.json
import http from 'node:http'

const PORT = Number(process.env.PORT || 11499)

const manifest = {
    id: 'dev.offline-stremio.cc-streams',
    version: '1.0.0',
    name: 'CC Test Streams',
    description: 'Creative Commons test streams for developing Offline Stremio',
    resources: ['stream'],
    types: ['movie'],
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

http.createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('content-type', 'application/json')
    if (req.url === '/manifest.json') return res.end(JSON.stringify(manifest))
    const m = req.url.match(/^\/stream\/movie\/([^/]+)\.json/)
    res.end(JSON.stringify({ streams: m ? streams[decodeURIComponent(m[1])] || [] : [] }))
}).listen(PORT, '127.0.0.1', () => console.log(`CC test add-on: http://127.0.0.1:${PORT}/manifest.json`))
