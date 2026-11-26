// Self-signed certifikát pre HTTPS port (vygeneruje sa raz cez openssl)
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { DATA_DIR, HOST } from './config.js'

export function ensureCert() {
    const dir = path.join(DATA_DIR, 'tls')
    const key = path.join(dir, 'key.pem')
    const cert = path.join(dir, 'cert.pem')
    if (!fs.existsSync(key) || !fs.existsSync(cert)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
            '-keyout', key, '-out', cert, '-subj', `/CN=${HOST}`, '-addext', `subjectAltName=IP:${HOST}`], { stdio: 'ignore' })
    }
    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) }
}
