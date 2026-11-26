// Dekódovanie odkazu "#/player/..." zo Stremio 5 web UI
//
// Formát (stremio-core, deep_links): #/player/{stream}/{streamTransportUrl}/{metaTransportUrl}/{type}/{id}/{videoId}
// {stream} = base64(zlib(JSON objektu Stream)), každá časť je percent-encoded.
import zlib from 'node:zlib'

export function parsePlayerHref(href) {
    const hash = href.includes('#') ? href.slice(href.indexOf('#') + 1) : href
    const raw = hash.replace(/^\/+/, '').split('?')[0].split('/')
    if (raw[0] !== 'player' || !raw[1]) throw new Error('Not a Stremio player link')

    const part = i => (raw[i] === undefined || raw[i] === '' ? null : decodeURIComponent(raw[i]))
    const stream = JSON.parse(zlib.inflateSync(Buffer.from(part(1), 'base64')).toString('utf8'))

    return {
        streamEnc: raw[1],
        stream,
        streamTransportUrl: part(2),
        metaTransportUrl: part(3),
        type: part(4),
        id: part(5),
        videoId: part(6),
    }
}
