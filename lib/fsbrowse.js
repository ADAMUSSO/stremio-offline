// Prehliadanie priečinkov pri pridávaní knižnice — iba čítanie zoznamu adresárov, nič sa nemení
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { xdgUserDir } from './config.js'

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

// rýchle skratky: domov, Videá, Stiahnuté a pripojené disky
export function roots() {
    const home = os.homedir()
    const user = os.userInfo().username
    const out = [{ name: 'Home', path: home, kind: 'home' }]
    for (const [name, dir] of [['Videos', xdgUserDir('VIDEOS', 'Videos')], ['Downloads', xdgUserDir('DOWNLOAD', 'Downloads')]]) {
        if (fs.existsSync(dir)) out.push({ name, path: dir, kind: 'folder' })
    }
    for (const base of [`/media/${user}`, `/run/media/${user}`, '/mnt']) {
        for (const p of subdirs(base)) out.push({ name: path.basename(p), path: p, kind: 'drive' })
    }
    return out
}

export async function list(dir) {
    const full = path.resolve(dir || os.homedir())
    const entries = await fsp.readdir(full, { withFileTypes: true })
    const dirs = []
    let videos = 0
    for (const e of entries) {
        if (e.name.startsWith('.')) continue
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

// systémové okno na výber priečinka (zenity); vráti cestu alebo null pri zrušení
export function pick(startDir) {
    return new Promise((resolve, reject) => {
        const args = ['--file-selection', '--directory', '--title=Choose a folder with movies or series']
        if (startDir) args.push(`--filename=${startDir.replace(/\/?$/, '/')}`)
        let proc
        try {
            proc = spawn('zenity', args, { stdio: ['ignore', 'pipe', 'ignore'] })
        } catch (e) {
            return reject(e)
        }
        let out = ''
        const timer = setTimeout(() => proc.kill(), 10 * 60 * 1000)
        proc.stdout.on('data', b => { out += b })
        proc.on('error', reject)
        proc.on('close', code => {
            clearTimeout(timer)
            resolve(code === 0 && out.trim() ? out.trim() : null)
        })
    })
}
