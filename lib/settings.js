// Nastavenia — kam sa sťahujú filmy a seriály (napr. externý HDD)
// Keď vybraný priečinok nie je dostupný (disk odpojený, len na čítanie), nastavenie sa vráti na predvolený
// priečinok; po pripojení disku si ho používateľ vyberie znova.
import fs from 'node:fs'
import path from 'node:path'
import { JsonStore } from './store.js'
import { DOWNLOAD_DIR } from './config.js'

const store = new JsonStore('settings.json', { downloadDir: null })
let note = null

function usable(dir) {
    try {
        if (!fs.statSync(dir).isDirectory()) return false
        fs.accessSync(dir, fs.constants.W_OK)
        return true
    } catch {
        return false
    }
}

// aktuálny priečinok na sťahovanie (pri nedostupnom vlastnom sa vráti na predvolený)
export function downloadDir() {
    const custom = store.data.downloadDir
    if (custom && !usable(custom)) {
        note = `${custom} was not available (disk not connected?), so downloads are saved to the default folder again.`
        console.log(`[settings] ${note}`)
        store.data.downloadDir = null
        store.save()
    }
    return store.data.downloadDir || DOWNLOAD_DIR
}

export function setDownloadDir(dir) {
    if (dir == null || dir === '' || path.resolve(dir) === path.resolve(DOWNLOAD_DIR)) {
        store.data.downloadDir = null
    } else {
        const full = path.resolve(String(dir))
        if (!usable(full)) {
            throw Object.assign(new Error(`Cannot save to ${full} (missing or read-only)`), { status: 400 })
        }
        store.data.downloadDir = full
    }
    note = null
    store.save()
    return downloadInfo()
}

export function downloadInfo() {
    const effective = downloadDir()
    return {
        downloadDir: effective,
        downloadDirDefault: DOWNLOAD_DIR,
        downloadDirCustom: store.data.downloadDir,
        downloadDirNote: note,
    }
}

export function shutdown() {
    store.flush()
}
