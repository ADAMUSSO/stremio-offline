// Jednoduché perzistentné JSON úložisko s atomickým zápisom
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './config.js'

export class JsonStore {
    constructor(name, defaults) {
        this.file = path.join(DATA_DIR, name)
        this.timer = null
        try {
            this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'))
        } catch {
            this.data = structuredClone(defaults)
        }
    }

    // uloženie s malým oneskorením, aby sa pri progrese nezapisovalo stále dookola
    save(delay = 500) {
        if (this.timer) return
        this.timer = setTimeout(() => this.flush(), delay)
    }

    flush() {
        clearTimeout(this.timer)
        this.timer = null
        fs.mkdirSync(path.dirname(this.file), { recursive: true })
        const tmp = this.file + '.tmp'
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
        fs.renameSync(tmp, this.file)
    }
}
