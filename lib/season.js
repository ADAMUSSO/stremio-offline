// Stiahnutie celej série (alebo zvyšku série) z jedného zdroja
//  - používateľ vyberie stream pri jednej epizóde; pre ostatné epizódy sa opýtame ten istý addon
//    a vyberieme stream z rovnakého zdroja:
//      1. rovnaký torrent (balík celej série, iný fileIdx)
//      2. rovnaký behaviorHints.bingeGroup — štandard Stremia pre "ten istý zdroj" (podľa neho
//         Stremio vyberá ďalšiu epizódu pri automatickom prehrávaní)
//      3. inak podobný stream v rovnakej kvalite (rozlíšenie, release group, zdroj, kodek) — označí sa
//  - epizódy, ktoré už sú offline alebo sa sťahujú, a ešte neodvysielané epizódy sa preskočia
import crypto from 'node:crypto'
import * as downloads from './downloads.js'
import * as metas from './metas.js'
import * as addon from './addon.js'

const { HttpError } = downloads
const pad = n => String(n).padStart(2, '0')
const epNum = v => v.episode ?? v.number
const codeOf = v => v.season != null && epNum(v) != null ? `S${pad(v.season)}E${pad(epNum(v))}` : (v.name || v.title || v.id)
const aired = v => !v.released || !(Date.parse(v.released) > Date.now())

async function loadMeta(parsed) {
    const { metaTransportUrl, type, id } = parsed
    let meta = metas.get(type, id)
    if (metaTransportUrl) meta = await metas.fetchAndStore(metaTransportUrl, type, id).catch(() => meta)
    if (!Array.isArray(meta?.videos) || !meta.videos.length) throw new HttpError(400, 'This title has no episode list')
    return meta
}

// epizódy tej istej série ako vybraná epizóda (bez čísla série: všetky epizódy)
function seasonOf(meta, videoId) {
    const current = meta.videos.find(v => v.id === videoId)
    if (!current) throw new HttpError(404, 'This episode is not in the episode list')
    const seen = new Set()
    const list = meta.videos
        .filter(v => (current.season == null || v.season === current.season) && !seen.has(v.id) && seen.add(v.id))
        .sort((a, b) => (epNum(a) ?? 0) - (epNum(b) ?? 0) || String(a.released || '').localeCompare(String(b.released || '')))
    return { season: current.season ?? null, current, list }
}

// ktoré epizódy už máme: offline (stiahnuté alebo z priečinka), alebo sa práve sťahujú
function haveState(type, metaId) {
    const state = new Map()
    for (const id of addon.offlineVideoIds(type, metaId)) state.set(id, 'offline')
    for (const i of downloads.allItems()) {
        if (i.type !== type || i.metaId !== metaId || state.get(i.videoId) === 'offline') continue
        if (i.status === 'done') state.set(i.videoId, 'offline') // aj na odpojenom disku
        else if (i.status !== 'error') state.set(i.videoId, 'queued')
    }
    return state
}

const seasonLabel = s => s == null ? 'All episodes' : s === 0 ? 'Specials' : `Season ${s}`

// Údaje pre ponuku pri tlačidle ⬇ (koľko epizód by sa stiahlo)
export async function preview(parsed) {
    const videoId = parsed.videoId || parsed.id
    const meta = await loadMeta(parsed)
    const { season, current, list } = seasonOf(meta, videoId)
    const have = haveState(parsed.type, parsed.id)
    return {
        title: meta.name || parsed.id,
        season,
        seasonLabel: seasonLabel(season),
        current: videoId,
        canSearch: !!parsed.streamTransportUrl,
        episodes: list.map(v => ({ id: v.id, code: codeOf(v), aired: aired(v), state: have.get(v.id) || null })),
    }
}

// --- výber rovnakého zdroja ------------------------------------------------------------------

const textOf = s => [s.name, s.description ?? s.title, s.behaviorHints?.filename].filter(Boolean).join('\n')
const kindOf = s => s.infoHash ? 'torrent' : typeof s.url === 'string' && /^https?:/i.test(s.url) ? 'http' : null
const hashOf = s => (s.infoHash || (String(s.url || '').match(/(?:^|[^0-9a-f])([0-9a-f]{40})(?![0-9a-f])/i) || [])[1] || '').toLowerCase() || null

const RES = [[/\b(2160p|4k|uhd)\b/i, '2160p'], [/\b1440p\b/i, '1440p'], [/\b1080p\b/i, '1080p'], [/\b720p\b/i, '720p'], [/\b(576p|540p)\b/i, '576p'], [/\b480p\b/i, '480p'], [/\b360p\b/i, '360p']]
const TAGS = [
    ['remux', /\bremux\b/i], ['bluray', /\b(blu-?ray|bdrip|brrip|bd)\b/i], ['webdl', /\bweb-?dl\b/i], ['webrip', /\bweb-?rip\b/i],
    ['hdtv', /\bhdtv\b/i], ['dvd', /\bdvd(rip)?\b/i], ['hdr', /\bhdr(10\+?)?\b/i], ['dv', /\b(dv|dovi|dolby ?vision)\b/i],
    ['hevc', /\b(x265|h\.?265|hevc)\b/i], ['avc', /\b(x264|h\.?264|avc)\b/i], ['10bit', /\b10-?bit\b/i], ['atmos', /\batmos\b/i],
]
const resolutionOf = text => (RES.find(([re]) => re.test(text)) || [])[1] || null
const tagsOf = text => new Set(TAGS.filter(([, re]) => re.test(text)).map(([t]) => t))
// release group: "...x264-GROUP.mkv" / "...[GROUP]"
function groupOf(text) {
    const m = text.match(/-([A-Za-z0-9]{2,20})(?:\.(?:mkv|mp4|avi|m4v|ts))?\s*$/m) || text.match(/\[([A-Za-z0-9 ._-]{2,20})\]\s*(?:\.(?:mkv|mp4))?\s*$/m)
    return m ? m[1].toLowerCase() : null
}

function profile(s) {
    const text = textOf(s)
    return { kind: kindOf(s), hash: hashOf(s), binge: s.behaviorHints?.bingeGroup || null, res: resolutionOf(text), tags: tagsOf(text), group: groupOf(text), name: String(s.name || '').split('\n')[0].trim().toLowerCase() }
}

// vráti { stream, how: 'same' | 'similar' } alebo null
export function pickSameSource(chosen, candidates) {
    const want = profile(chosen)
    let best = null
    for (const [index, stream] of candidates.entries()) {
        if (stream.ytId || stream.externalUrl && !stream.url) continue
        const got = profile(stream)
        if (!got.kind || got.kind !== want.kind) continue
        let score
        let how = 'similar'
        if (want.hash && got.hash === want.hash) { score = 1000; how = 'same' }
        else if (want.binge && got.binge === want.binge) { score = 500; how = 'same' }
        else {
            // podobný zdroj: rozlíšenie sa musí zhodovať; bez rozlíšenia aspoň release group
            if (want.res ? got.res !== want.res : !(want.group && got.group === want.group)) continue
            score = 10
            if (want.group && got.group === want.group) score += 4
            if (want.name && got.name === want.name) score += 1
            for (const t of want.tags) if (got.tags.has(t)) score += 1
            for (const t of got.tags) if (!want.tags.has(t)) score -= 0.5
        }
        score -= index * 0.001 // pri zhode poradie addonu
        if (!best || score > best.score) best = { stream, how, score }
    }
    return best && { stream: best.stream, how: best.how }
}

async function fetchStreams(transportUrl, type, videoId) {
    const base = transportUrl.replace(/\/manifest\.json(\?.*)?$/, '')
    const url = `${base}/stream/${encodeURIComponent(type)}/${encodeURIComponent(videoId)}.json`
    let lastError
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
            if (!res.ok) throw new Error(`add-on answered HTTP ${res.status}`)
            const { streams } = await res.json()
            return Array.isArray(streams) ? streams : []
        } catch (e) {
            lastError = e
        }
    }
    throw lastError
}

// --- dávky (jedna dávka = jedno "stiahni celú sériu") -----------------------------------------

const batches = new Map()

function publicBatch(b) {
    const { parsed, ...rest } = b
    return rest
}

export function list() {
    return [...batches.values()].map(publicBatch)
}

export function isBusy() {
    return [...batches.values()].some(b => b.status === 'searching')
}

export function stop(id) {
    const b = batches.get(id)
    if (!b || b.status !== 'searching') return false
    b.stopped = true
    return true
}

export function dismiss(id) {
    return batches.delete(id)
}

// scope: 'season' = celá séria, 'rest' = od tejto epizódy do konca série
export async function start(parsed, scope) {
    if (!parsed.streamTransportUrl) throw new HttpError(400, 'This stream does not come from an add-on, so the other episodes cannot be looked up')
    const { stream } = parsed
    if (!kindOf(stream)) throw new HttpError(400, 'This stream cannot be downloaded')
    const videoId = parsed.videoId || parsed.id
    const meta = await loadMeta(parsed)
    const { season, current, list: episodes } = seasonOf(meta, videoId)
    const from = scope === 'rest' ? episodes.indexOf(current) : 0
    const have = haveState(parsed.type, parsed.id)
    const targets = episodes.slice(from).filter(v => aired(v) && !have.has(v.id))
    if (!targets.length) throw new HttpError(409, `All episodes of ${seasonLabel(season).toLowerCase()} are already offline or downloading`)

    const batch = {
        id: crypto.randomBytes(6).toString('hex'),
        type: parsed.type,
        metaId: parsed.id,
        title: meta.name || parsed.id,
        season,
        seasonLabel: seasonLabel(season),
        scope: scope === 'rest' ? 'rest' : 'season',
        from: scope === 'rest' ? codeOf(current) : null,
        poster: metas.localImage(meta.poster) || null,
        streamName: [stream.name, stream.description || stream.title].filter(Boolean).join(' — ').slice(0, 300),
        status: 'searching',
        total: targets.length,
        checked: 0,
        queued: [],
        similar: [],
        notFound: [],
        failed: [],
        missingIds: [], // epizódy bez zdroja (aj chyby addonu) — UI na ne odkáže, nech si používateľ vyberie iný stream
        createdAt: Date.now(),
        finishedAt: null,
    }
    batches.set(batch.id, batch)
    run(batch, parsed, meta, targets).catch(e => console.error(`[season ${batch.id}]`, e))
    return publicBatch(batch)
}

async function run(batch, parsed, meta, targets) {
    const videoId = parsed.videoId || parsed.id
    // vyhľadávanie v addone po dvoch naraz, pridávanie do fronty v poradí epizód
    let next = 0
    const lookups = new Array(targets.length)
    const settle = new Array(targets.length)
    targets.forEach((_, i) => { lookups[i] = new Promise(r => { settle[i] = r }) })
    const lookup = async v => {
        if (v.id === videoId) return { stream: parsed.stream, how: 'same', chosen: true }
        return pickSameSource(parsed.stream, await fetchStreams(parsed.streamTransportUrl, parsed.type, v.id))
    }
    const worker = async () => {
        while (next < targets.length && !batch.stopped) {
            const i = next++
            settle[i](await lookup(targets[i]).then(found => ({ found }), error => ({ error })))
        }
    }
    const workers = [worker(), worker()]

    for (const [i, v] of targets.entries()) {
        if (batch.stopped) break
        const { found, error } = await lookups[i]
        if (batch.stopped) break // po "Stop" už nič nepridávame, ani epizódy, ktoré sa práve dohľadali
        const code = codeOf(v)
        if (error) {
            batch.failed.push(code)
            batch.missingIds.push(v.id)
            console.error(`[season ${batch.id}] ${code}: ${error.message}`)
        } else if (!found) {
            batch.notFound.push(code)
            batch.missingIds.push(v.id)
        } else {
            try {
                await downloads.add({
                    stream: found.stream,
                    streamEnc: found.chosen ? parsed.streamEnc : null,
                    streamTransportUrl: parsed.streamTransportUrl,
                    metaTransportUrl: null,
                    meta,
                    type: parsed.type,
                    id: parsed.id,
                    videoId: v.id,
                })
                batch.queued.push(code)
                if (found.how === 'similar') batch.similar.push(code)
            } catch (e) {
                batch.failed.push(code)
                batch.missingIds.push(v.id)
                console.error(`[season ${batch.id}] ${code}: ${e.message}`)
            }
        }
        batch.checked++
    }
    await Promise.all(workers)
    batch.status = batch.stopped ? 'stopped' : 'done'
    batch.finishedAt = Date.now()
    console.log(`[season ${batch.id}] ${batch.title} ${batch.seasonLabel}: ${batch.queued.length} queued, ${batch.similar.length} similar, ${batch.notFound.length} not found, ${batch.failed.length} failed`)
    // dávku bez problémov po chvíli skryjeme — epizódy sú už v zozname sťahovaní
    if (!batch.notFound.length && !batch.failed.length && !batch.similar.length) setTimeout(() => batches.delete(batch.id), 8000)
}
