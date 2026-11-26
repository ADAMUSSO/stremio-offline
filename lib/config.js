// Konfigurácia — cesty a porty, všetko sa dá prepísať env premennými
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export function xdgUserDir(name, fallback) {
    try {
        const dir = execFileSync('xdg-user-dir', [name], { encoding: 'utf8' }).trim()
        if (dir && dir !== os.homedir()) return dir
    } catch {}
    return path.join(os.homedir(), fallback)
}

const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')

export const HOST = '127.0.0.1'
export const PORT = Number(process.env.PORT || 11488)
export const BASE_URL = `http://${HOST}:${PORT}`
// HTTPS port — proxy streaming servera (/proxy/d=...) vie iba HTTPS; self-signed certifikát mu nevadí
export const HTTPS_PORT = Number(process.env.HTTPS_PORT || PORT + 1)
export const HTTPS_URL = `https://${HOST}:${HTTPS_PORT}`

// odkiaľ berieme web UI Stremia 5 a kde beží jeho streaming server
export const WEB_UPSTREAM = (process.env.WEB_UPSTREAM || 'https://web.stremio.com').replace(/\/$/, '')
export const STREAMING_SERVER = (process.env.STREAMING_SERVER || 'http://127.0.0.1:11470').replace(/\/$/, '')
export const STREMIO_ORIGIN = new URL(STREAMING_SERVER).origin

// URL, ktorú dostane Stremio cez --url: rovnaký origin ako predvolené UI (127.0.0.1:11470) →
// ostane prihlásenie, knižnica, addony aj nastavenia
export const APP_URL = `${STREAMING_SERVER}/proxy/d=${encodeURIComponent(HTTPS_URL)}/`

export const DATA_DIR = process.env.DATA_DIR || path.join(dataHome, 'stremio-offline')
export const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(xdgUserDir('VIDEOS', 'Videos'), 'Stremio')

export const MAX_PARALLEL = Math.max(1, Number(process.env.MAX_PARALLEL || 2))

// len na testovanie: proxy sa správa, akoby nebol internet (ide iba z cache)
export const FORCE_OFFLINE = process.env.FORCE_OFFLINE === '1'
