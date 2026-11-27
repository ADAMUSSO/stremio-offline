// Stiahnutie celej série (alebo zvyšku série) z jedného zdroja
//  - používateľ vyberie stream pri jednej epizóde; pre ostatné epizódy sa opýtame ten istý addon
//    a automaticky pridáme IBA presne ten istý zdroj:
//      1. rovnaký torrent (balík celej série, iný fileIdx) — aj hash v debrid URL
//      2. rovnaký behaviorHints.bingeGroup — addon tým hovorí "ten istý zdroj" (podľa neho Stremio vyberá
//         ďalšiu epizódu pri automatickom prehrávaní); ak by sa líšilo rozlíšenie alebo release group, neberieme ho
//  - všetky ostatné epizódy čakajú na používateľa: v Offline → "Choose streams" si stream vyberie sám
//    (najpodobnejšie streamy sú navrchu, nič sa nevyberá automaticky)
//  - epizódy, ktoré už sú offline alebo sa sťahujú, a ešte neodvysielané epizódy sa preskočia
import crypto from 'node:crypto'
import * as downloads from './downloads.js'
import * as metas from './metas.js'
import * as addon from './addon.js'
import { JsonStore } from './store.js'

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
    const { season, list } = seasonOf(meta, videoId)
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

// --- porovnanie streamov ----------------------------------------------------------------------

const descOf = s => s.description ?? s.title ?? ''
const textOf = s => [s.name, descOf(s), s.behaviorHints?.filename].filter(Boolean).join('\n')
const kindOf = s => s.ytId ? null : s.infoHash ? 'torrent' : typeof s.url === 'string' && /^https?:/i.test(s.url) ? 'http' : null
const hashOf = s => (s.infoHash || (String(s.url || '').match(/(?:^|[^0-9a-f])([0-9a-f]{40})(?![0-9a-f])/i) || [])[1] || '').toLowerCase() || null
// identita streamu (rovnaký tvar ako sourceKey v downloads.js)
export const keyOf = s => s.infoHash ? `bt:${String(s.infoHash).toLowerCase()}:${s.fileIdx ?? ''}` : s.url ? `url:${s.url}` : null

const RES = [[/\b(2160p|4k|uhd)\b/i, '2160p'], [/\b1440p\b/i, '1440p'], [/\b1080p\b/i, '1080p'], [/\b720p\b/i, '720p'], [/\b(576p|540p)\b/i, '576p'], [/\b480p\b/i, '480p'], [/\b360p\b/i, '360p']]
const TAGS = [
    ['remux', /\bremux\b/i], ['bluray', /\b(blu-?ray|bdrip|brrip|bd)\b/i], ['webdl', /\bweb-?dl\b/i], ['webrip', /\bweb-?rip\b/i],
    ['hdtv', /\bhdtv\b/i], ['dvd', /\bdvd(rip)?\b/i], ['hdr', /\bhdr(10\+?)?\b/i], ['dv', /\b(dv|dovi|dolby ?vision)\b/i],
    ['hevc', /\b(x265|h\.?265|hevc)\b/i], ['avc', /\b(x264|h\.?264|avc)\b/i], ['10bit', /\b10-?bit\b/i], ['atmos', /\batmos\b/i],
]
const resolutionOf = text => (RES.find(([re]) => re.test(text)) || [])[1] || null
const tagsOf = text => new Set(TAGS.filter(([, re]) => re.test(text)).map(([t]) => t))
// release group z riadku s názvom súboru: "…x264-GROUP.mkv", "…H264-MEMENTO[rartv]"
function groupOf(text) {
    for (const line of text.split('\n')) {
        const clean = line.trim().replace(/(\s*\[[^\]]*\])+$/, '').replace(/\.(mkv|mp4|avi|m4v|ts)$/i, '')
        const m = clean.match(/[\w.\s]-([A-Za-z0-9]{2,20})$/)
        if (m) return m[1].toLowerCase()
    }
    return null
}

function profile(s) {
    const text = textOf(s)
    return { kind: kindOf(s), hash: hashOf(s), binge: s.behaviorHints?.bingeGroup || null, res: resolutionOf(text), tags: tagsOf(text), group: groupOf(text), name: String(s.name || '').split('\n')[0].trim().toLowerCase() }
}

// rovnaký zdroj? (jediné, čo sa pridá bez opýtania)
function sameSource(want, got) {
    if (!got.kind || got.kind !== want.kind) return false
    if (want.hash && got.hash === want.hash) return true
    if (want.binge && got.binge === want.binge) {
        // addon môže mať bingeGroup voľnejší (napr. len kvalitu) — iné rozlíšenie alebo release group nie je ten istý zdroj
        if (want.res && got.res && want.res !== got.res) return false
        if (want.group && got.group && want.group !== got.group) return false
        return true
    }
    return false
}

// podobnosť pre poradie v ponuke (nič sa podľa nej nevyberá samo)
function similarity(want, got) {
    let score = got.kind === want.kind ? 6 : 0
    if (want.res && got.res) score += want.res === got.res ? 5 : -2
    if (want.group && got.group === want.group) score += 4
    if (want.name && got.name === want.name) score += 1
    for (const t of want.tags) if (got.tags.has(t)) score += 1
    for (const t of got.tags) if (!want.tags.has(t)) score -= 0.5
    return score
}

export function pickSameSource(chosen, candidates) {
    const want = profile(chosen)
    return candidates.find(s => sameSource(want, profile(s))) || null
}

// streamy jednej epizódy pre výber: najpodobnejšie navrchu, "closest" = rovnaký druh a kvalita
export function rankForChoice(chosen, candidates) {
    const want = profile(chosen)
    const ranked = candidates
        .map((s, i) => ({ s, i, p: profile(s) }))
        .filter(x => x.p.kind && keyOf(x.s))
        .map(x => ({ ...x, score: similarity(want, x.p) }))
        .sort((a, b) => b.score - a.score || a.i - b.i)
    let closest = 0
    return ranked.map(x => {
        const close = closest < 3 && x.p.kind === want.kind && (want.res ? x.p.res === want.res : !!want.group && x.p.group === want.group)
        if (close) closest++
        return {
            key: keyOf(x.s),
            kind: x.p.kind,
            name: String(x.s.name || '').trim(),
            description: String(descOf(x.s)).trim(),
            closest: close,
        }
    })
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
// Uložené na disku: epizódy čakajúce na výber prežijú zatvorenie Stremia aj reštart pomocníka.
// Zoznamy streamov sú len v pamäti (pri výbere sa v prípade potreby stiahnu z addonu znova).

const store = new JsonStore('seasons.json', { batches: [] })
for (const b of store.data.batches) {
    if (b.status === 'searching') b.status = 'stopped' // pomocník skončil uprostred hľadania
}
store.save()

const batches = () => store.data.batches
const findBatch = id => batches().find(b => b.id === id)
const streamCache = new Map() // `${batchId}|${videoId}` → streamy z addonu

function publicBatch(b) {
    const { source, ...rest } = b
    return rest
}

export function list() {
    return batches().map(publicBatch)
}

export function isBusy() {
    return batches().some(b => b.status === 'searching')
}

const stopped = new Set()
export function stop(id) {
    const b = findBatch(id)
    if (!b || b.status !== 'searching') return false
    stopped.add(id)
    return true
}

export function dismiss(id) {
    const i = batches().findIndex(b => b.id === id)
    if (i < 0) return false
    batches().splice(i, 1)
    for (const key of streamCache.keys()) if (key.startsWith(id + '|')) streamCache.delete(key)
    store.save()
    return true
}

// dávku, pri ktorej už nič nečaká na používateľa, po chvíli skryjeme — epizódy sú v zozname sťahovaní
function retireLater(b) {
    if (b.status === 'searching' || b.pending.length) return
    setTimeout(() => { if (findBatch(b.id) && !b.pending.length) dismiss(b.id) }, 8000)
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
        source: { transportUrl: parsed.streamTransportUrl, stream },
        status: 'searching',
        total: targets.length,
        checked: 0,
        queued: [], // kódy epizód pridaných do sťahovania
        pending: [], // { videoId, code, title, reason: 'different' | 'none' | 'error' } — čakajú na výber
        skipped: [],
        createdAt: Date.now(),
        finishedAt: null,
    }
    batches().push(batch)
    store.save()
    run(batch, parsed, meta, targets).catch(e => console.error(`[season ${batch.id}]`, e))
    return publicBatch(batch)
}

async function run(batch, parsed, meta, targets) {
    const videoId = parsed.videoId || parsed.id
    // vyhľadávanie v addone po dvoch naraz, pridávanie do fronty v poradí epizód
    let next = 0
    const settle = []
    const lookups = targets.map((_, i) => new Promise(r => { settle[i] = r }))
    const lookup = async v => {
        if (v.id === videoId) return { stream: parsed.stream, chosen: true }
        const streams = await fetchStreams(parsed.streamTransportUrl, parsed.type, v.id)
        streamCache.set(`${batch.id}|${v.id}`, streams)
        const same = pickSameSource(parsed.stream, streams)
        return same ? { stream: same } : { none: !streams.some(s => kindOf(s)) }
    }
    const worker = async () => {
        while (next < targets.length && !stopped.has(batch.id)) {
            const i = next++
            settle[i](await lookup(targets[i]).then(found => ({ found }), error => ({ error })))
        }
    }
    const workers = [worker(), worker()]

    for (const [i, v] of targets.entries()) {
        if (stopped.has(batch.id)) break
        const { found, error } = await lookups[i]
        if (stopped.has(batch.id)) break // po "Stop" už nič nepridávame, ani epizódy, ktoré sa práve dohľadali
        const ep = { videoId: v.id, code: codeOf(v), title: v.name || v.title || null }
        if (error) {
            batch.pending.push({ ...ep, reason: 'error' })
            console.error(`[season ${batch.id}] ${ep.code}: ${error.message}`)
        } else if (!found.stream) {
            batch.pending.push({ ...ep, reason: found.none ? 'none' : 'different' })
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
                batch.queued.push(ep.code)
            } catch (e) {
                batch.pending.push({ ...ep, reason: 'error' })
                console.error(`[season ${batch.id}] ${ep.code}: ${e.message}`)
            }
        }
        batch.checked++
        store.save()
    }
    await Promise.all(workers)
    batch.status = stopped.delete(batch.id) ? 'stopped' : 'done'
    batch.finishedAt = Date.now()
    store.save()
    console.log(`[season ${batch.id}] ${batch.title} ${batch.seasonLabel}: ${batch.queued.length} queued, ${batch.pending.length} waiting for a choice`)
    retireLater(batch)
}

// --- výber streamu pre epizódy, ktoré z vybraného zdroja nie sú -------------------------------

async function streamsFor(b, videoId, fresh = false) {
    const key = `${b.id}|${videoId}`
    if (!fresh && streamCache.has(key)) return streamCache.get(key)
    const streams = await fetchStreams(b.source.transportUrl, b.type, videoId)
    streamCache.set(key, streams)
    return streams
}

// pre stránku "Choose streams": čakajúce epizódy a ich streamy (najpodobnejšie navrchu)
export async function choices(id) {
    const b = findBatch(id)
    if (!b) throw new HttpError(404, 'This season download is no longer available')
    const episodes = await Promise.all(b.pending.map(async ep => {
        try {
            // pri chybe addonu skúsime znova
            const streams = await streamsFor(b, ep.videoId, ep.reason === 'error')
            return { ...ep, streams: rankForChoice(b.source.stream, streams) }
        } catch (e) {
            return { ...ep, streams: [], error: `The add-on did not answer (${e.message})` }
        }
    }))
    return { batch: publicBatch(b), chosen: { kind: kindOf(b.source.stream) }, episodes }
}

// picks: [{ videoId, key }] — key = vybraný stream, null = epizódu preskočiť
export async function choose(id, picks) {
    const b = findBatch(id)
    if (!b) throw new HttpError(404, 'This season download is no longer available')
    const meta = metas.get(b.type, b.metaId)
    const added = []
    const errors = []
    for (const pick of Array.isArray(picks) ? picks : []) {
        const ep = b.pending.find(e => e.videoId === pick?.videoId)
        if (!ep) continue
        if (pick.key == null) {
            b.skipped.push(ep.code)
        } else {
            let stream = (await streamsFor(b, ep.videoId).catch(() => [])).find(s => keyOf(s) === pick.key)
            if (!stream) stream = (await streamsFor(b, ep.videoId, true).catch(() => [])).find(s => keyOf(s) === pick.key)
            if (!stream || !kindOf(stream)) {
                errors.push(`${ep.code}: this stream is no longer offered by the add-on`)
                continue
            }
            try {
                await downloads.add({ stream, streamEnc: null, streamTransportUrl: b.source.transportUrl, metaTransportUrl: null, meta, type: b.type, id: b.metaId, videoId: ep.videoId })
                b.queued.push(ep.code)
                added.push(ep.code)
            } catch (e) {
                errors.push(`${ep.code}: ${e.message}`)
                continue
            }
        }
        b.pending = b.pending.filter(e => e !== ep)
        streamCache.delete(`${b.id}|${ep.videoId}`)
    }
    store.save()
    retireLater(b)
    return { batch: publicBatch(b), added, errors }
}

export function shutdown() {
    store.flush()
}
