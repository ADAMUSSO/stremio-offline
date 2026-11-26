// Meta údaje (názov, popis, epizódy) a obrázky uložené lokálne, aby katalóg fungoval aj offline
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR, BASE_URL } from './config.js'

const META_DIR = path.join(DATA_DIR, 'meta')
const IMG_DIR = path.join(DATA_DIR, 'img')

const metaFile = (type, id) => path.join(META_DIR, encodeURIComponent(type), encodeURIComponent(id) + '.json')
const imgKey = url => crypto.createHash('sha1').update(url).digest('hex')

export function get(type, id) {
    try {
        return JSON.parse(fs.readFileSync(metaFile(type, id), 'utf8'))
    } catch {
        return null
    }
}

export async function save(type, id, meta) {
    const file = metaFile(type, id)
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(file, JSON.stringify(meta))
}

export async function remove(type, id) {
    await fsp.rm(metaFile(type, id), { force: true })
}

// stiahne meta z addonu, ktorý ho poskytol (zvyčajne Cinemeta) a uloží ho
export async function fetchAndStore(metaTransportUrl, type, id) {
    const base = metaTransportUrl.replace(/\/manifest\.json$/, '')
    const url = `${base}/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`meta HTTP ${res.status}`)
    const { meta } = await res.json()
    if (!meta || !meta.id) throw new Error('meta missing')
    await save(type, id, meta)
    await cacheImages([meta.poster, meta.background, meta.logo])
    return meta
}

export async function cacheImages(urls) {
    await fsp.mkdir(IMG_DIR, { recursive: true })
    await Promise.all(urls.filter(u => typeof u === 'string' && /^https?:/.test(u)).map(async url => {
        const file = path.join(IMG_DIR, imgKey(url))
        if (fs.existsSync(file)) return
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
            if (!res.ok) return
            const buf = Buffer.from(await res.arrayBuffer())
            await fsp.writeFile(file + '.type', res.headers.get('content-type') || 'image/jpeg')
            await fsp.writeFile(file, buf)
        } catch {}
    }))
}

// ak je obrázok v cache, vráti lokálnu URL, inak pôvodnú
export function localImage(url) {
    if (typeof url !== 'string' || !/^https?:/.test(url)) return url
    const key = imgKey(url)
    return fs.existsSync(path.join(IMG_DIR, key)) ? `${BASE_URL}/img/${key}` : url
}

export function imagePath(key) {
    if (!/^[0-9a-f]{40}$/.test(key)) return null
    const file = path.join(IMG_DIR, key)
    if (!fs.existsSync(file)) return null
    let type = 'image/jpeg'
    try { type = fs.readFileSync(file + '.type', 'utf8') } catch {}
    return { file, type }
}
