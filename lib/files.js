// Servovanie súborov s podporou Range (pretáčanie v prehrávači)
import fs from 'node:fs'
import path from 'node:path'

const TYPES = {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
    '.avi': 'video/x-msvideo', '.mov': 'video/quicktime', '.ts': 'video/mp2t', '.m2ts': 'video/mp2t',
    '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg', '.flv': 'video/x-flv', '.wmv': 'video/x-ms-wmv',
    '.ogv': 'video/ogg', '.3gp': 'video/3gpp', '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt',
}

export function sendFile(req, res, file, type) {
    let stat
    try {
        stat = fs.statSync(file)
    } catch {
        res.writeHead(404).end('Not found')
        return
    }
    const headers = {
        'Content-Type': type || TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
    }
    let start = 0
    let end = stat.size - 1
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
    if (range && (range[1] || range[2])) {
        if (range[1]) {
            start = Number(range[1])
            if (range[2]) end = Math.min(end, Number(range[2]))
        } else {
            start = Math.max(0, stat.size - Number(range[2])) // posledných N bajtov
        }
        if (start > end || start >= stat.size) {
            res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }).end()
            return
        }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 })
    } else {
        res.writeHead(200, { ...headers, 'Content-Length': stat.size })
    }
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(file, { start, end }).pipe(res)
}
