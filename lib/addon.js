// Lokálny Stremio addon: katalóg "Offline", meta z cache, streamy a titulky
// zo stiahnutých súborov aj z lokálnej knižnice (priečinky na disku)
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { BASE_URL, DATA_DIR } from './config.js'
import * as downloads from './downloads.js'
import * as library from './library.js'
import * as metas from './metas.js'

export const OFFLINE_STREAM_NAME = '💾 Offline'
export const MANIFEST_URL = `${BASE_URL}/addon/manifest.json`

export const manifest = {
    id: 'community.stremio-offline',
    version: '0.2.0',
    name: 'Offline Downloads',
    description: 'Downloaded videos and movies or series from folders on this computer. They play without internet.',
    logo: `${BASE_URL}/__dl/logo.svg`,
    // bez idPrefixes → Stremio sa nás pýta na každé id; neznáme id odbavíme hneď prázdnou odpoveďou
    resources: ['catalog', 'meta', 'stream', 'subtitles'],
    types: ['movie', 'series', 'anime', 'tv', 'channel', 'other'],
    catalogs: [
        { type: 'movie', id: 'offline', name: 'Offline' },
        { type: 'series', id: 'offline', name: 'Offline' },
    ],
    behaviorHints: { configurable: false },
}

const sizeLabel = b => (b > 1 << 30 ? (b / (1 << 30)).toFixed(2) + ' GB' : Math.round(b / (1 << 20)) + ' MB')

// --- spoločný pohľad na stiahnuté súbory aj knižnicu ------------------------------------

function entries() {
    const fromDownloads = downloads.allItems().filter(i => i.status === 'done').map(i => ({
        source: 'download', id: i.id, type: i.type, metaId: i.metaId, videoId: i.videoId,
        file: i.file, size: i.size, title: i.title, at: i.finishedAt || 0, subs: [],
    }))
    const fromLibrary = library.playable().map(f => {
        const who = library.identity(f)
        return {
            source: 'library', id: f.id, type: who.type, metaId: who.metaId, videoId: who.videoId, local: !!who.local, pending: !!who.pending,
            file: f.path, size: f.size, title: f.title, year: f.year, season: f.season, episode: f.episode, at: f.mtime || 0, subs: f.subs || [],
        }
    })
    return fromDownloads.concat(fromLibrary)
}

function metaOf(type, id) {
    return metas.get(type, id) || (id.startsWith('local:') ? library.localMeta(type, id) : null)
}

function fileUrl(e) {
    const name = encodeURIComponent(path.basename(e.file))
    return e.source === 'library' ? `${BASE_URL}/lib/${e.id}/${name}` : `${BASE_URL}/files/${e.id}/${name}`
}

function streamOf(e) {
    const name = path.basename(e.file)
    return {
        name: OFFLINE_STREAM_NAME,
        description: `${name}\n${sizeLabel(e.size || 0)} · ${e.source === 'library' ? 'from a folder on this computer' : 'downloaded'}`,
        url: fileUrl(e),
        behaviorHints: { filename: name, videoSize: e.size || undefined, bingeGroup: 'stremio-offline' },
    }
}

// odkaz do prehrávača Stremia (rovnaký formát ako stremio-core: base64(zlib(JSON)));
// stream aj meta idú z nášho addonu → prehrá sa aj bez internetu
function playerHref(e) {
    const enc = encodeURIComponent(zlib.deflateSync(Buffer.from(JSON.stringify(streamOf(e)))).toString('base64'))
    const m = encodeURIComponent(MANIFEST_URL)
    return `#/player/${enc}/${m}/${m}/${encodeURIComponent(e.type)}/${encodeURIComponent(e.metaId)}/${encodeURIComponent(e.videoId)}`
}

const withLocalImages = meta => ({
    ...meta,
    poster: metas.localImage(meta.poster),
    background: metas.localImage(meta.background),
    logo: metas.localImage(meta.logo),
})

// --- zdroje addonu --------------------------------------------------------------------------

function catalog(type) {
    // seriály do "series", všetko ostatné (filmy, anime, ...) do "movie"
    const groups = new Map()
    for (const e of entries()) {
        if (e.pending || (type === 'series') !== (e.type === 'series')) continue
        const key = `${e.type}/${e.metaId}`
        const prev = groups.get(key)
        if (!prev || prev.at < e.at) groups.set(key, e)
    }
    return [...groups.values()]
        .sort((a, b) => b.at - a.at)
        .map(e => {
            const meta = metaOf(e.type, e.metaId)
            return {
                id: e.metaId,
                type: e.type,
                name: meta?.name || e.title,
                poster: metas.localImage(meta?.poster),
                posterShape: meta?.posterShape || 'poster',
                releaseInfo: meta?.releaseInfo,
                description: meta?.description,
            }
        })
}

function meta(type, id) {
    const saved = metaOf(type, id)
    if (!saved) return null
    const have = new Set(entries().filter(e => e.metaId === id).map(e => e.videoId))
    const result = withLocalImages(saved)
    if (Array.isArray(saved.videos) && saved.videos.length) {
        // offline zobrazíme iba epizódy, ktoré máme na disku
        result.videos = saved.videos
            .filter(v => have.has(v.id))
            .map(v => ({ ...v, thumbnail: metas.localImage(v.thumbnail) }))
    }
    return result
}

const matchesId = (e, type, id) => e.videoId === id || (e.metaId === id && e.type === type && e.videoId === e.metaId)

function streams(type, id) {
    return entries().filter(e => matchesId(e, type, id)).map(streamOf)
}

// titulky uložené vedľa videa v priečinku (napr. Film.sk.srt)
function subtitles(type, id) {
    return entries()
        .filter(e => e.source === 'library' && e.subs.length && matchesId(e, type, id))
        .flatMap(e => e.subs.map((s, i) => ({ id: `offline-${e.id}-${i}`, url: `${BASE_URL}/libsub/${e.id}/${i}`, lang: s.lang })))
}

// --- údaje pre stránku Offline v aplikácii --------------------------------------------------

function episodeInfo(e, meta) {
    const isEpisode = e.videoId !== e.metaId
    const video = isEpisode ? (meta?.videos || []).find(v => v.id === e.videoId) : null
    const idParts = isEpisode ? e.videoId.split(':') : []
    const num = v => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v))
    return {
        isEpisode,
        season: num(video?.season) ?? num(e.season) ?? num(idParts.at(-2)),
        number: num(video?.episode ?? video?.number) ?? num(e.episode) ?? num(idParts.at(-1)),
        episodeTitle: video?.title || video?.name || null,
        thumbnail: metas.localImage(video?.thumbnail) || null,
    }
}

export function decorateItem(item) {
    const meta = metas.get(item.type, item.metaId)
    const full = downloads.allItems().find(i => i.id === item.id)
    const info = episodeInfo(item, meta)
    return {
        ...item,
        ...info,
        source: { kind: item.source?.kind },
        origin: 'download',
        poster: metas.localImage(meta?.poster) || null,
        background: metas.localImage(meta?.background) || null,
        detailHref: `#/detail/${encodeURIComponent(item.type)}/${encodeURIComponent(item.metaId)}${info.isEpisode ? '/' + encodeURIComponent(item.videoId) : ''}`,
        playerHref: item.status === 'done' && full ? playerHref({ source: 'download', ...full }) : null,
    }
}

export function libraryItems() {
    return entries().filter(e => e.source === 'library').map(e => {
        const meta = metaOf(e.type, e.metaId)
        const info = episodeInfo(e, meta)
        return {
            id: e.id,
            origin: 'library',
            status: 'done',
            type: e.type,
            metaId: e.metaId,
            videoId: e.videoId,
            title: meta?.name || e.title,
            year: meta?.releaseInfo || e.year || null,
            ...info,
            size: e.size,
            filename: path.basename(e.file),
            folderPath: path.dirname(e.file),
            matched: !e.local,
            pending: e.pending,
            subs: e.subs.length,
            finishedAt: e.at,
            poster: metas.localImage(meta?.poster) || null,
            background: metas.localImage(meta?.background) || null,
            detailHref: e.local ? null : `#/detail/${encodeURIComponent(e.type)}/${encodeURIComponent(e.metaId)}${info.isEpisode ? '/' + encodeURIComponent(e.videoId) : ''}`,
            playerHref: playerHref(e),
        }
    })
}

// či Stremio už od nás pýtal katalóg = addon je nainštalovaný (zapamätá sa na disku)
const SEEN_FILE = path.join(DATA_DIR, 'addon-seen')
let seen = fs.existsSync(SEEN_FILE)
export const isSeen = () => seen
function markSeen() {
    if (seen) return
    seen = true
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(SEEN_FILE, new Date().toISOString())
}

// vráti JSON odpoveď alebo null (404)
export function handle(pathname) {
    const rest = pathname.replace(/^\/addon\/?/, '')
    if (rest === 'manifest.json' || rest === '') return manifest
    const m = rest.match(/^(catalog|meta|stream|subtitles)\/([^/]+)\/([^/]+?)(?:\/([^/]*))?\.json$/)
    if (!m) return null
    const [, resource, rawType, rawId, extra] = m
    const type = decodeURIComponent(rawType)
    const id = decodeURIComponent(rawId)
    if (resource === 'catalog') {
        markSeen()
        // všetko vraciame naraz, ďalšie stránky (skip=...) sú prázdne
        const paged = /(^|&)skip=[1-9]/.test(extra || '')
        return { metas: id === 'offline' && !paged ? catalog(type) : [] }
    }
    if (resource === 'stream') return { streams: streams(type, id), cacheMaxAge: 0 }
    if (resource === 'subtitles') return { subtitles: subtitles(type, id), cacheMaxAge: 0 }
    const found = meta(type, id)
    return found ? { meta: found, cacheMaxAge: 0 } : null
}
