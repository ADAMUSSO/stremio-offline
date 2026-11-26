// Prehliadanie priečinkov pri pridávaní knižnice — iba čítanie zoznamu adresárov, nič sa nemení
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { xdgUserDir, IS_MAC, IS_WIN } from './config.js'

const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|webm|mov|wmv|flv|ts|m2ts|mpg|mpeg|ogv|3gp)$/i

function subdirs(base) {
    try {
        return fs.readdirSync(base, { withFileTypes: true })
            .filter(e => !e.name.startsWith('.') && (e.isDirectory() || e.isSymbolicLink()))
            .map(e => path.join(base, e.name))
            .filter(p => { try { return fs.statSync(p).isDirectory() } catch { return false } })
    } catch {
        return []
    }
}

// rýchle skratky: domov, Videá/Filmy, Stiahnuté a pripojené disky
export function roots() {
    const home = os.homedir()
    const out = [{ name: 'Home', path: home, kind: 'home' }]
    const videos = IS_MAC ? path.join(home, 'Movies') : xdgUserDir('VIDEOS', 'Videos')
    const downloads = IS_MAC || IS_WIN ? path.join(home, 'Downloads') : xdgUserDir('DOWNLOAD', 'Downloads')
    for (const [name, dir] of [[IS_MAC ? 'Movies' : 'Videos', videos], ['Downloads', downloads]]) {
        if (fs.existsSync(dir)) out.push({ name, path: dir, kind: 'folder' })
    }
    if (IS_MAC) {
        // /Volumes: externé disky; systémový disk je tam ako odkaz na "/" — ten vynecháme
        for (const p of subdirs('/Volumes')) {
            try { if (fs.realpathSync(p) === '/') continue } catch { continue }
            out.push({ name: path.basename(p), path: p, kind: 'drive' })
        }
    } else if (IS_WIN) {
        for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
            const drive = `${letter}:\\`
            if (fs.existsSync(drive)) out.push({ name: `${letter}:`, path: drive, kind: 'drive' })
        }
    } else {
        const user = os.userInfo().username
        for (const base of [`/media/${user}`, `/run/media/${user}`, '/mnt']) {
            for (const p of subdirs(base)) out.push({ name: path.basename(p), path: p, kind: 'drive' })
        }
    }
    return out
}

export async function list(dir) {
    const full = path.resolve(dir || os.homedir())
    const entries = await fsp.readdir(full, { withFileTypes: true })
    const dirs = []
    let videos = 0
    for (const e of entries) {
        if (e.name.startsWith('.') || (IS_WIN && /^\$|^System Volume Information$/i.test(e.name))) continue
        const p = path.join(full, e.name)
        let isDir = e.isDirectory()
        if (e.isSymbolicLink()) {
            try { isDir = (await fsp.stat(p)).isDirectory() } catch { continue }
        }
        if (isDir) dirs.push({ name: e.name, path: p })
        else if (VIDEO_EXT.test(e.name)) videos++
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    return { path: full, parent: full === path.parse(full).root ? null : path.dirname(full), dirs, videos }
}

// systémové okno na výber priečinka podľa systému
function pickerCommand(startDir) {
    const title = 'Choose a folder with movies or series'
    if (IS_MAC) {
        const start = startDir ? ` default location (POSIX file ${JSON.stringify(startDir)})` : ''
        return ['osascript', ['-e', `POSIX path of (choose folder with prompt ${JSON.stringify(title)}${start})`]]
    }
    if (IS_WIN) {
        const script = [
            'Add-Type -AssemblyName System.Windows.Forms',
            '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
            `$d.Description = '${title}'`,
            startDir ? `$d.SelectedPath = '${startDir.replace(/'/g, "''")}'` : '',
            'if ($d.ShowDialog() -eq "OK") { [Console]::Out.Write($d.SelectedPath) }',
        ].filter(Boolean).join('; ')
        return ['powershell', ['-NoProfile', '-STA', '-Command', script]]
    }
    const args = ['--file-selection', '--directory', `--title=${title}`]
    if (startDir) args.push(`--filename=${startDir.replace(/\/?$/, '/')}`)
    return ['zenity', args]
}

// vráti vybranú cestu alebo null pri zrušení
export function pick(startDir) {
    return new Promise((resolve, reject) => {
        const [cmd, args] = pickerCommand(startDir)
        let proc
        try {
            proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] })
        } catch (e) {
            return reject(e)
        }
        let out = ''
        const timer = setTimeout(() => proc.kill(), 10 * 60 * 1000)
        proc.stdout.on('data', b => { out += b })
        proc.on('error', reject)
        proc.on('close', code => {
            clearTimeout(timer)
            const chosen = out.trim().replace(/(.)\/$/, '$1') // macOS vracia cestu s "/" na konci
            resolve(code === 0 && chosen ? chosen : null)
        })
    })
}
