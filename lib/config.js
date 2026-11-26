// Konfigurácia — cesty a porty podľa systému (Linux, macOS, Windows), všetko sa dá prepísať env premennými
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const PLATFORM = process.platform // 'linux' | 'darwin' | 'win32'
export const IS_LINUX = PLATFORM === 'linux'
export const IS_MAC = PLATFORM === 'darwin'
export const IS_WIN = PLATFORM === 'win32'

export function xdgUserDir(name, fallback) {
    if (IS_LINUX) {
        try {
            const dir = execFileSync('xdg-user-dir', [name], { encoding: 'utf8' }).trim()
            if (dir && dir !== os.homedir()) return dir
        } catch {}
    }
    return path.join(os.homedir(), fallback)
}

// priečinok s dátami (zoznam sťahovaní, knižnica, cache UI) podľa zvyklostí systému
function defaultDataDir() {
    if (IS_MAC) return path.join(os.homedir(), 'Library', 'Application Support', 'stremio-offline')
    if (IS_WIN) return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'stremio-offline')
    return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'stremio-offline')
}

// predvolený priečinok na sťahovanie: macOS má ~/Movies, ostatné ~/Videos
function defaultDownloadDir() {
    if (IS_MAC) return path.join(os.homedir(), 'Movies', 'Stremio')
    return path.join(xdgUserDir('VIDEOS', 'Videos'), 'Stremio')
}

export const HOST = '127.0.0.1'
export const PORT = Number(process.env.PORT || 11488)
export const BASE_URL = `http://${HOST}:${PORT}`

// HTTPS port treba iba na Linuxe: tam UI ide cez proxy streaming servera (/proxy/d=...), ktorá vie len HTTPS,
// aby ostal origin 127.0.0.1:11470 (prihlásenie ostane). macOS/Windows načítajú UI z nášho HTTP portu priamo.
export const ENABLE_HTTPS = process.env.ENABLE_HTTPS ? process.env.ENABLE_HTTPS === '1' : IS_LINUX
export const HTTPS_PORT = Number(process.env.HTTPS_PORT || PORT + 1)
export const HTTPS_URL = `https://${HOST}:${HTTPS_PORT}`

// odkiaľ berieme web UI Stremia 5 a kde beží jeho streaming server
export const WEB_UPSTREAM = (process.env.WEB_UPSTREAM || 'https://web.stremio.com').replace(/\/$/, '')
export const STREAMING_SERVER = (process.env.STREAMING_SERVER || 'http://127.0.0.1:11470').replace(/\/$/, '')
export const STREMIO_ORIGIN = new URL(STREAMING_SERVER).origin

// URL, ktorú dostane Stremio pri štarte (Linux --url, macOS/Windows --webui-url)
export const APP_URL = ENABLE_HTTPS ? `${STREAMING_SERVER}/proxy/d=${encodeURIComponent(HTTPS_URL)}/` : `${BASE_URL}/`

export const DATA_DIR = process.env.DATA_DIR || defaultDataDir()
export const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || defaultDownloadDir()

export const MAX_PARALLEL = Math.max(1, Number(process.env.MAX_PARALLEL || 2))

// len na testovanie: proxy sa správa, akoby nebol internet (ide iba z cache)
export const FORCE_OFFLINE = process.env.FORCE_OFFLINE === '1'
