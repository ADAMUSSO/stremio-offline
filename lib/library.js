// Lokálna knižnica — priečinky s filmami a seriálmi (napr. na HDD)
//  - priečinky sa rekurzívne prehľadajú, z názvov súborov sa vyčíta názov/rok/séria/epizóda
//  - cez vyhľadávanie v Cinemete sa priradia k titulom Stremia (plagát, popis, názvy epizód)
//  - výsledky sa ukladajú, takže knižnica funguje aj offline; súbory sa nikdy nemažú ani nemenia
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { JsonStore } from './store.js'
import * as metas from './metas.js'

const CINEMETA = 'https://v3-cinemeta.strem.io'
const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|webm|mov|wmv|flv|ts|m2ts|mpg|mpeg|ogv|3gp)$/i
const SUB_EXT = /\.(srt|vtt|ass|ssa|sub)$/i
const RESCAN_MS = 30 * 60 * 1000
const RETRY_UNMATCHED_MS = 24 * 60 * 60 * 1000

const store = new JsonStore('library.json', { folders: [], files: [], matches: {} })
const hash = (s, n = 16) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n)

let version = 1
let scanning = false
let matching = false
const bump = () => { version++; store.save() }

export const getVersion = () => version
export const isBusy = () => scanning || matching

// --- parsovanie názvov súborov ---------------------------------------------------

// všetko od prvej technickej značky ďalej je smetie (kvalita, kodek, jazyk, skupina...)
const JUNK = /\b(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr10\+?|hdr|dv|dolby ?vision|blu-?ray|bdrip|brrip|bdremux|remux|web-?dl|web-?rip|webrip|web|hdtv|hdrip|dvdrip|dvdscr|dvd|xvid|divx|[xh][ .]?26[45]|hevc|avc|aac\d?(\.\d)?|ac3|eac3|dts(-hd)?|truehd|atmos|ddp?\d?(\.\d)?|mp3|10bit|8bit|proper|repack|extended|unrated|uncut|remastered|imax|multi|dual|cz|sk|eng|en|sub(s|bed)?|titulky|dabing|cze|slo|limited|internal)\b.*$/i
const GENERIC = /^(movie|film|video|cd ?\d|disc ?\d|part ?\d|sample|trailer|feature)$/i

function tidy(s) {
    return String(s || '')
        .replace(JUNK, '')
        .replace(/\((?:19|20)\d{2}\)/g, '')
        .replace(/[([{][^)\]}]*$/, '')
        .replace(/[\s\-–:,.]+$/, '')
        .replace(/^[\s\-–:,.]+/, '')
        .replace(/\s+/g, ' ')
        .trim()
}

function words(s) {
    return String(s).replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]+/g, ' ').replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim()
}

const SEASON_DIR = /^(?:season|s[ée]ria|seria|sezona|sezóna|staffel|saison|temporada|s)\s*0*(\d{1,2})$/i

export function parsePath(rel, folderKind) {
    const parts = rel.split(path.sep)
    const file = parts[parts.length - 1]
    const dirs = parts.slice(0, -1)
    const s = words(file)

    // epizóda: S01E02, 1x02
    let m = s.match(/^(.*?)\bS(\d{1,2}) ?E(\d{1,3})\b/i) || s.match(/^(.*?)\b(\d{1,2})x(\d{2,3})\b/i)
    let season = m ? Number(m[2]) : null
    let episode = m ? Number(m[3]) : null
    let title = m ? tidy(m[1]) : ''

    // priečinok "Season 2" / "Séria 2" určuje sériu
    const seasonDirIdx = dirs.findIndex(d => SEASON_DIR.test(words(d)))
    if (seasonDirIdx >= 0 && season == null) season = Number(words(dirs[seasonDirIdx]).match(SEASON_DIR)[1])

    if (!m && (folderKind === 'series' || seasonDirIdx >= 0)) {
        // "E05", "Ep 5", "Episode 5", "05 - Názov"
        const e = s.match(/\b(?:e|ep|episode|epizoda|epizóda|diel)[ .]?(\d{1,3})\b/i) || s.match(/^(\d{1,3})\b/)
        if (e) {
            episode = Number(e[1])
            season = season ?? 1
            m = e
        }
    }

    if (episode != null && folderKind !== 'movies') {
        let source = title
        if (!title) {
            // názov seriálu z priečinkov: nad "Season X", inak najvyšší priečinok
            const titleDir = seasonDirIdx > 0 ? dirs[seasonDirIdx - 1] : dirs[0]
            source = words(titleDir || '')
            title = tidy(source)
        }
        const yearM = (source.match(/\b((?:19|20)\d{2})\b/) || [])[1]
        return { kind: 'episode', title: tidy(title.replace(/\b(?:19|20)\d{2}\b/, '')) || title, year: yearM ? Number(yearM) : null, season, episode }
    }

    // film: "Názov (2010)" / "Názov.2010.1080p..."
    let year = null
    const y = s.match(/^(.*?)[\s(\[]*\b((?:19|20)\d{2})\b/)
    if (y && tidy(y[1])) {
        title = tidy(y[1])
        year = Number(y[2])
    } else {
        title = tidy(s)
    }
    if (!title || GENERIC.test(title)) {
        // generický názov súboru → názov z priečinka filmu
        const dir = dirs[dirs.length - 1]
        if (dir) {
            const d = parsePath(dir + '.mkv', 'movies')
            title = d.title
            year = year || d.year
        }
    }
    return { kind: 'movie', title: title || words(file), year, season: null, episode: null }
}

function subtitleLang(videoStem, subFile) {
    const rest = words(subFile).slice(words(videoStem).length).trim().toLowerCase()
    const code = rest.split(/[\s.]+/).filter(Boolean).pop() || ''
    const map = { sk: 'slk', slo: 'slk', slk: 'slk', slovak: 'slk', cz: 'ces', cs: 'ces', cze: 'ces', ces: 'ces', czech: 'ces', en: 'eng', eng: 'eng', english: 'eng' }
    return map[code] || (code.length === 3 ? code : 'und')
}

// --- prehľadávanie ------------------------------------------------------------------

async function walk(root, dir, out, depth = 0) {
    if (depth > 8) return
    let entries
    try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
        return
    }
    const names = entries.map(e => e.name)
    for (const e of entries) {
        if (e.name.startsWith('.')) continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
            if (/^(sample|samples|extras|featurettes|trailers)$/i.test(e.name)) continue
            await walk(root, full, out, depth + 1)
        } else if (e.isFile() && VIDEO_EXT.test(e.name)) {
            let stat
            try { stat = await fsp.stat(full) } catch { continue }
            if (/\bsample\b/i.test(e.name) && stat.size < 200 * 1024 * 1024) continue
            const stem = e.name.replace(/\.[^.]+$/, '')
            const subs = names.filter(n => SUB_EXT.test(n) && n.startsWith(stem)).map(n => ({ path: path.join(dir, n), lang: subtitleLang(stem, n) }))
            out.push({ path: full, rel: path.relative(root, full), size: stat.size, mtime: stat.mtimeMs, subs })
        }
    }
}

export async function scanAll() {
    if (scanning) return
    scanning = true
    try {
        for (const folder of store.data.folders) await scanFolder(folder)
    } finally {
        scanning = false
        bump()
    }
    matchAll().catch(e => console.error('[library] matching failed:', e.message))
}

async function scanFolder(folder) {
    const available = fs.existsSync(folder.path)
    folder.available = available
    if (!available) return // disk nie je pripojený → necháme posledný známy stav
    const found = []
    await walk(folder.path, folder.path, found)
    const previous = new Map(store.data.files.filter(f => f.folderId === folder.id).map(f => [f.path, f]))
    const files = found.map(f => {
        const prev = previous.get(f.path)
        const parsed = parsePath(f.rel, folder.kind)
        const keepMatch = prev && prev.size === f.size && prev.kind === parsed.kind
        return { id: hash(f.path), folderId: folder.id, ...f, ...parsed, match: keepMatch ? prev.match : null }
    })
    store.data.files = store.data.files.filter(f => f.folderId !== folder.id).concat(files)
    folder.lastScan = Date.now()
    folder.count = files.length
    console.log(`[library] ${folder.path}: ${files.length} videos`)
}

// --- párovanie s Cinemetou --------------------------------------------------------------

const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/^(the|a|an)\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '')

async function search(type, title, year) {
    const url = `${CINEMETA}/catalog/${type}/top/search=${encodeURIComponent(title)}.json`
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!res.ok) throw new Error(`search HTTP ${res.status}`)
    const { metas: results = [] } = await res.json()
    const t = norm(title)
    let best = null
    for (const [rank, m] of results.slice(0, 15).entries()) {
        const n = norm(m.name)
        let score = n === t ? 3 : n.startsWith(t) || t.startsWith(n) ? 1.5 : n.includes(t) || t.includes(n) ? 1 : 0
        // Cinemeta hľadá aj podľa lokálnych názvov (Pelíšky → Cosy Dens), takže prvý výsledok so zhodným rokom berieme
        if (rank === 0) score += 1
        const y = parseInt(m.releaseInfo || m.year, 10)
        if (year && y) score += year === y ? 2 : Math.abs(year - y) <= 1 ? 1 : -1.5
        if (!best || score > best.score) best = { score, id: m.id, name: m.name }
    }
    return best && best.score >= 2.5 ? best : null
}

async function matchAll() {
    if (matching) return
    matching = true
    try {
        const files = store.data.files.filter(f => !f.match)
        const byKey = new Map()
        for (const f of files) {
            const type = f.kind === 'episode' ? 'series' : 'movie'
            const key = `${type}:${norm(f.title)}:${type === 'movie' ? f.year || '' : ''}`
            if (!byKey.has(key)) byKey.set(key, { type, title: f.title, year: f.year, files: [] })
            byKey.get(key).files.push(f)
        }
        for (const [key, group] of byKey) {
            let cached = store.data.matches[key]
            if (!cached || (cached.none && Date.now() - cached.at > RETRY_UNMATCHED_MS)) {
                try {
                    const hit = group.title ? await search(group.type, group.title, group.year) : null
                    cached = hit ? { type: group.type, metaId: hit.id, at: Date.now() } : { none: true, at: Date.now() }
                    store.data.matches[key] = cached
                } catch {
                    continue // bez internetu → skúsime pri ďalšom prehľadaní
                }
            }
            if (cached.none) {
                // nespárované: lokálne id, epizódy jedného seriálu spolu
                const localId = group.type === 'series' ? `local:s${hash(key, 12)}` : null
                for (const f of group.files) {
                    const metaId = localId || `local:${f.id}`
                    f.match = { type: group.type, metaId, videoId: f.kind === 'episode' ? `${metaId}:${f.season}:${f.episode}` : metaId, local: true }
                }
            } else {
                let meta = metas.get(cached.type, cached.metaId)
                if (!meta) meta = await metas.fetchAndStore(`${CINEMETA}/manifest.json`, cached.type, cached.metaId).catch(() => null)
                for (const f of group.files) {
                    let videoId = cached.metaId
                    if (f.kind === 'episode') {
                        const v = (meta?.videos || []).find(v => Number(v.season) === f.season && Number(v.episode ?? v.number) === f.episode)
                        videoId = v?.id || `${cached.metaId}:${f.season}:${f.episode}`
                        if (v?.thumbnail) await metas.cacheImages([v.thumbnail])
                    }
                    f.match = { type: cached.type, metaId: cached.metaId, videoId }
                }
            }
            bump()
        }
    } finally {
        matching = false
        bump()
    }
}

// --- priečinky ----------------------------------------------------------------------

export function folders() {
    return store.data.folders.map(f => {
        const files = store.data.files.filter(x => x.folderId === f.id)
        return { ...f, movies: files.filter(x => x.kind === 'movie').length, episodes: files.filter(x => x.kind === 'episode').length, scanning }
    })
}

export async function addFolder(dir, kind = 'auto') {
    const full = path.resolve(String(dir || ''))
    const stat = await fsp.stat(full).catch(() => null)
    if (!stat?.isDirectory()) throw Object.assign(new Error('Folder does not exist'), { status: 400 })
    if (!['auto', 'movies', 'series'].includes(kind)) kind = 'auto'
    const dup = store.data.folders.find(f => f.path === full || full.startsWith(f.path + path.sep))
    if (dup) throw Object.assign(new Error(`Already in the library: ${dup.path}`), { status: 409 })
    const folder = { id: hash(full, 10), path: full, kind, addedAt: Date.now(), lastScan: null, available: true, count: 0 }
    store.data.folders.push(folder)
    bump()
    scanAll().catch(e => console.error('[library] scan failed:', e.message))
    return folder
}

export function removeFolder(id) {
    const before = store.data.folders.length
    store.data.folders = store.data.folders.filter(f => f.id !== id)
    store.data.files = store.data.files.filter(f => f.folderId !== id)
    bump()
    return store.data.folders.length !== before
}

// --- dotazy -------------------------------------------------------------------------------

const availableFolders = () => new Set(store.data.folders.filter(f => f.available !== false).map(f => f.id))

// súbory, ktoré sa dajú práve prehrať (disk pripojený)
export function playable() {
    const ok = availableFolders()
    return store.data.files.filter(f => ok.has(f.folderId))
}

export function fileById(id) {
    const f = store.data.files.find(x => x.id === id)
    return f && availableFolders().has(f.folderId) && fs.existsSync(f.path) ? f : null
}

export function subtitleOf(fileId, index) {
    const f = fileById(fileId)
    return f?.subs?.[index] || null
}

// identita pre Stremio (aj pre ešte nespárované súbory)
export function identity(f) {
    if (f.match) return f.match
    const type = f.kind === 'episode' ? 'series' : 'movie'
    const metaId = `local:${f.id}`
    return { type, metaId, videoId: metaId, local: true, pending: true }
}

export function usesMeta(type, metaId) {
    return store.data.files.some(f => f.match && f.match.type === type && f.match.metaId === metaId)
}

// syntetické meta pre nespárované tituly
export function localMeta(type, metaId) {
    const files = playable().filter(f => identity(f).metaId === metaId)
    if (!files.length) return null
    const first = files[0]
    const meta = { id: metaId, type, name: first.title || path.basename(first.path), releaseInfo: first.year ? String(first.year) : undefined, posterShape: 'poster' }
    if (type === 'series') {
        meta.videos = files.filter(f => f.kind === 'episode').map(f => ({
            id: identity(f).videoId, season: f.season, episode: f.episode, title: `Episode ${f.episode}`, released: new Date(0).toISOString(),
        }))
    }
    return meta
}

export function shutdown() {
    store.flush()
}

// pravidelné prehľadávanie (nové filmy, pripojený disk)
setTimeout(() => scanAll().catch(() => {}), 3000)
setInterval(() => scanAll().catch(() => {}), RESCAN_MS)
