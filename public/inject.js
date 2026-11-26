// Stremio Offline — skript vložený do web UI Stremia 5
//  - položka "Offline" v bočnom menu Stremia a stránka so sťahovaniami / stiahnutými titulmi
//  - tlačidlo ⬇ pri každom streame v detaile titulu
(() => {
    if (window.__stremioOffline) return
    window.__stremioOffline = true

    // API beží na našom serveri; stránka môže byť pod proxy streaming servera (iný origin)
    const BASE = document.currentScript ? new URL(document.currentScript.src).origin : 'http://127.0.0.1:11488'
    const API = BASE + '/__dl/api'
    const HEADERS = { 'x-stremio-offline': '1' }
    const OFFLINE_NAME = '💾 Offline'
    const PAGE_HASH = '#/?offline=1'
    const DETAIL_ROUTE = /^#\/(metadetails|details?)\//

    let items = []
    let byEnc = new Map()
    let info = { manifestUrl: BASE + '/addon/manifest.json', addonSeen: true }
    let pageOpen = false
    let pendingDelete = null

    // ikony v štýle Stremia (viewBox 512, ťah 32)
    const path = (d, extra = '') => `<path d="${d}" style="stroke:currentcolor;stroke-linecap:round;stroke-linejoin:round;stroke-width:32;fill:none${extra}"/>`
    const icon = (...paths) => `<svg viewBox="0 0 512 512" aria-hidden="true">${paths.join('')}</svg>`
    const ICON = {
        offline: icon(path('M256 72v238m0 0-88-88m88 88 88-88'), path('M96 336v56a48 48 0 0 0 48 48h224a48 48 0 0 0 48-48v-56')),
        download: icon(path('M256 96v224m0 0-84-84m84 84 84-84M120 416h272')),
        check: icon(path('m112 268 96 96 192-216')),
        pause: icon(path('M176 112v288M336 112v288')),
        retry: icon(path('M96 256a160 160 0 1 0 48-114M96 96v96h96')),
        trash: icon(path('M112 144h288M208 144v-40h96v40m-160 0 20 280h184l20-280M224 216v144m64-144v144')),
        // vlastný zaoblený trojuholník v proporciách ikony z plagátov Stremia (optické posunutie je v tvare)
        play: '<svg viewBox="0 0 512 512" aria-hidden="true"><path d="M146 102v308q0 18 14.9 7.9l224.2-151.8q14.9-10.1 0-20.2L160.9 94.1q-14.9-10.1-14.9 7.9z" fill="currentColor"/></svg>',
        info: icon(path('M256 232v120'), path('M256 160h.01', ';stroke-width:44'), path('M256 64a192 192 0 1 0 0 384 192 192 0 0 0 0-384z')),
        plug: icon(path('M192 64v96m128-96v96M144 160h224v64a112 112 0 0 1-224 0zm112 176v112')),
        folder: icon(path('M64 144v232a40 40 0 0 0 40 40h304a40 40 0 0 0 40-40V200a40 40 0 0 0-40-40H260l-48-48H104a40 40 0 0 0-40 40z')),
        back: icon(path('M320 96 160 256l160 160')),
        up: icon(path('M256 416V112m0 0-112 112m112-112 112 112')),
        plus: icon(path('M256 112v288M112 256h288')),
        search: icon(path('M221 80a141 141 0 1 0 0 282 141 141 0 0 0 0-282zm105 246 106 106')),
        settings: icon(path('M262.3 64h-12.6a24 24 0 0 0-23.6 19.6l-4.8 26.3a147 147 0 0 0-37.9 21.9l-25.2-8.9a24 24 0 0 0-28.6 10.6l-6.3 10.9a24 24 0 0 0 5 30.3l20.4 17.4a148 148 0 0 0 0 43.8l-20.4 17.4a24 24 0 0 0-5 30.3l6.3 10.9a24 24 0 0 0 28.6 10.6l25.2-8.9a147 147 0 0 0 37.9 21.9l4.8 26.3a24 24 0 0 0 23.6 19.6h12.6a24 24 0 0 0 23.6-19.6l4.8-26.3a147 147 0 0 0 37.9-21.9l25.2 8.9a24 24 0 0 0 28.6-10.6l6.3-10.9a24 24 0 0 0-5-30.3l-20.4-17.4a148 148 0 0 0 0-43.8l20.4-17.4a24 24 0 0 0 5-30.3l-6.3-10.9a24 24 0 0 0-28.6-10.6l-25.2 8.9a147 147 0 0 0-37.9-21.9l-4.8-26.3A24 24 0 0 0 262.3 64z'), path('M256 192a64 64 0 1 0 0 128 64 64 0 0 0 0-128z')),
        drive: icon(path('M64 304h384v96a32 32 0 0 1-32 32H96a32 32 0 0 1-32-32zm0 0 48-176a32 32 0 0 1 31-24h226a32 32 0 0 1 31 24l48 176'), path('M368 368h.01', ';stroke-width:44')),
    }

    // --- štýly ------------------------------------------------------------------
    const style = document.createElement('style')
    style.textContent = `
    .sdl-btn{position:absolute;top:50%;right:4.25rem;transform:translateY(-50%);z-index:3;width:2.6rem;height:2.6rem;
      border-radius:50%;border:0;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;
      color:#fff;background:rgba(255,255,255,.08);opacity:.85;font:700 .7rem/1 PlusJakartaSans,sans-serif}
    .sdl-btn:hover{opacity:1;background:#7b5bf5}
    .sdl-btn svg{width:1.3rem;height:1.3rem}
    .sdl-btn[data-state=downloading],.sdl-btn[data-state=queued]{opacity:1;
      background:radial-gradient(closest-side,#1e1c33 78%,transparent 80% 100%),conic-gradient(#7b5bf5 var(--p,0%),rgba(255,255,255,.15) 0)}
    .sdl-btn[data-state=done]{opacity:1;background:#2f7d47}
    .sdl-btn[data-state=error]{opacity:1;background:#b3372f}
    .sdl-btn[data-state=paused]{opacity:1;background:#5a5870}
    .sdl-btn[data-state=starting]{opacity:.5;pointer-events:none}

    .sdl-nav{position:relative}
    html.sdl-offline-open nav[class*="vertical-nav-bar"] a.selected:not(.sdl-nav) svg{color:var(--foreground-color-primary,#fff);opacity:.35}
    html.sdl-offline-open nav[class*="vertical-nav-bar"] a.selected:not(.sdl-nav) [class*="label"]{color:var(--foreground-color-primary,#fff)}
    /* obsah Boardu (Spotlight banner, riadky) inak presvitá cez priehľadné menu Stremia */
    /* obsah Boardu úplne vypneme: Spotlight karusel by pod stránkou animoval ďalej (prekresľovanie/blikanie vo WebKite) */
    html.sdl-offline-open [class*="board-content-container"] > [class*="nav-content-container"]{display:none!important}
    @media (max-width:640px){
      html.sdl-offline-open nav[class*="vertical-nav-bar"] a.selected:not(.sdl-nav) [class*="label"]{opacity:.6}
    }
    .sdl-nav .sdl-count{position:absolute;top:.55rem;right:1.4rem;min-width:1.15rem;height:1.15rem;padding:0 .3rem;box-sizing:border-box;
      border-radius:.6rem;background:#7b5bf5;color:#fff;font:700 .7rem/1.15rem PlusJakartaSans,sans-serif;text-align:center}
    .sdl-nav .sdl-count:empty{display:none}

    .sdl-page{--px:2rem;--py:1.5rem;position:fixed;z-index:50;overflow:auto;box-sizing:border-box;padding:var(--py) var(--px) 3rem;will-change:transform;
      background:linear-gradient(41deg,#0c0b11 0%,#1a173e 100%);color:rgba(255,255,255,.9);font-family:PlusJakartaSans,Arial,sans-serif}
    .sdl-page[hidden]{display:none}
    .sdl-page h1{margin:0;font-size:1.6rem;font-weight:700}
    .sdl-page h2{margin:2rem 0 1rem;font-size:1.15rem;font-weight:600;color:rgba(255,255,255,.9)}
    .sdl-head{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
    .sdl-head .sdl-meta{flex:1;color:rgba(255,255,255,.5);font-size:.9rem}
    .sdl-pill{border:0;border-radius:2rem;padding:.6rem 1.1rem;background:rgba(255,255,255,.08);color:#fff;cursor:pointer;
      font:600 .9rem/1 PlusJakartaSans,sans-serif;display:inline-flex;gap:.5rem;align-items:center}
    .sdl-pill:hover{background:#7b5bf5}
    .sdl-pill svg{width:1.1rem;height:1.1rem}
    .sdl-banner{margin-top:1.25rem;padding:1rem 1.25rem;border-radius:.75rem;background:rgba(123,91,245,.15);display:flex;gap:1rem;align-items:center;flex-wrap:wrap}
    .sdl-banner p{margin:0;flex:1;min-width:16rem;color:rgba(255,255,255,.8)}
    .sdl-empty{margin-top:4rem;text-align:center;color:rgba(255,255,255,.5);line-height:1.7}
    .sdl-empty svg{width:4rem;height:4rem;color:rgba(255,255,255,.25)}

    .sdl-rows{display:flex;flex-direction:column;gap:.5rem}
    .sdl-row{display:grid;grid-template-columns:3rem 1fr auto;gap:.25rem 1rem;align-items:center;padding:.75rem 1rem;border-radius:.75rem;background:rgba(255,255,255,.04)}
    .sdl-row img,.sdl-row .sdl-noimg{grid-row:1/4;width:3rem;height:4.5rem;object-fit:cover;border-radius:.4rem;background:rgba(255,255,255,.06)}
    .sdl-row .sdl-title{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sdl-row .sdl-sub{grid-column:2;color:rgba(255,255,255,.5);font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sdl-row .sdl-bar{grid-column:2/4;height:4px;border-radius:2px;background:rgba(255,255,255,.1);overflow:hidden}
    .sdl-row .sdl-bar i{display:block;height:100%;background:#7b5bf5;transition:width .5s}
    .sdl-row[data-status=error] .sdl-bar i{background:#b3372f}
    .sdl-row .sdl-actions{grid-column:3;grid-row:1/3;display:flex;gap:.25rem}
    .sdl-icon{width:2.4rem;height:2.4rem;border:0;border-radius:50%;background:transparent;color:rgba(255,255,255,.7);cursor:pointer;
      display:flex;align-items:center;justify-content:center;padding:0;font:700 .7rem/1 PlusJakartaSans,sans-serif}
    .sdl-icon:hover{background:rgba(255,255,255,.1);color:#fff}
    .sdl-icon svg{width:1.25rem;height:1.25rem}
    .sdl-icon[data-confirm]{width:auto;padding:0 .8rem;border-radius:1.2rem;background:#b3372f;color:#fff}

    .sdl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(10rem,1fr));gap:1.5rem 1.25rem}
    .sdl-card{position:relative;cursor:pointer}
    .sdl-poster{position:relative;aspect-ratio:2/3;border-radius:.75rem;overflow:hidden;background:rgba(255,255,255,.06);
    }
    .sdl-card:hover .sdl-poster{box-shadow:0 0 0 2px rgba(255,255,255,.9)}
    .sdl-poster img{width:100%;height:100%;object-fit:cover;display:block}
    .sdl-poster .sdl-noimg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:1rem;text-align:center;font-weight:600}
    .sdl-play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(12,11,17,.25);opacity:0}
    .sdl-card:hover .sdl-play{opacity:1}
    .sdl-play span{width:3.5rem;height:3.5rem;border-radius:50%;background:rgba(12,11,17,.4);box-shadow:inset 0 0 0 2.1px rgba(255,255,255,.9);
      color:rgba(255,255,255,.9);display:flex;align-items:center;justify-content:center}
    .sdl-play svg{width:2rem;height:2rem}
    .sdl-tag{position:absolute;left:.5rem;top:.5rem;padding:.25rem .5rem;border-radius:.4rem;background:rgba(12,11,17,.8);font-size:.75rem;font-weight:700}
    .sdl-card-actions{position:absolute;right:.4rem;top:.4rem;display:flex;gap:.25rem;opacity:0}
    .sdl-card:hover .sdl-card-actions{opacity:1}
    .sdl-card-actions .sdl-icon{background:rgba(12,11,17,.8)}
    .sdl-card .sdl-title{margin-top:.6rem;font-weight:600;font-size:.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sdl-card .sdl-sub{color:rgba(255,255,255,.5);font-size:.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

    /* priečinok seriálu: za plagátom dve "karty" ako kôpka */
    .sdl-stack{position:relative} /* kôpka presahuje do medzery mriežky, karty ostanú rovnako veľké */
    .sdl-stack::before,.sdl-stack::after{content:"";position:absolute;inset:0;border-radius:.75rem;background:#3a3660}
    .sdl-stack::before{transform:translate(.7rem,-.7rem);opacity:.45}
    .sdl-stack::after{transform:translate(.35rem,-.35rem);opacity:.8}
    .sdl-stack .sdl-poster{z-index:1}
    /* Stremio dáva globálne overflow:hidden — kôpka musí presahovať */
    .sdl-page [data-section],.sdl-page .sdl-grid,.sdl-page .sdl-card,.sdl-page .sdl-stack{overflow:visible}
    .sdl-tag svg{width:.9rem;height:.9rem;vertical-align:-.15rem;margin-right:.25rem}

    .sdl-hero{position:relative;margin:calc(-1 * var(--py)) calc(-1 * var(--px)) 0;padding:var(--py) var(--px) 1.75rem;display:flex;gap:1.5rem;align-items:flex-end;min-height:12rem;
      background-size:cover;background-position:center 20%}
    .sdl-hero::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(12,11,17,.35) 0%,rgba(19,17,40,.85) 70%,#15132f 100%)}
    .sdl-hero > *{position:relative}
    .sdl-hero .sdl-back{align-self:flex-start;flex:0 0 auto}
    .sdl-hero img{width:7.5rem;aspect-ratio:2/3;object-fit:cover;border-radius:.6rem;box-shadow:0 8px 24px rgba(0,0,0,.5)}
    .sdl-hero-text{flex:1;min-width:0;padding-bottom:.25rem}
    .sdl-hero-text .sdl-meta{color:rgba(255,255,255,.6);font-size:.9rem;margin:.4rem 0 .9rem}
    .sdl-back{width:2.6rem;height:2.6rem;border-radius:50%;background:rgba(12,11,17,.6)}
    .sdl-eps{display:flex;flex-direction:column;gap:.5rem}
    .sdl-ep{display:grid;grid-template-columns:9rem 1fr auto;gap:.2rem 1rem;align-items:center;padding:.5rem;border-radius:.75rem;cursor:pointer;background:rgba(255,255,255,.03)}
    .sdl-ep:hover{background:rgba(255,255,255,.08)}
    .sdl-ep .sdl-thumb{grid-row:1/3;position:relative;aspect-ratio:16/9;border-radius:.5rem;overflow:hidden;background:rgba(255,255,255,.06)}
    .sdl-ep .sdl-thumb img{width:100%;height:100%;object-fit:cover;display:block}
    .sdl-ep .sdl-play span{width:2.4rem;height:2.4rem;box-shadow:inset 0 0 0 1.6px rgba(255,255,255,.9)}
    .sdl-ep .sdl-play svg{width:1.35rem;height:1.35rem}
    .sdl-ep:hover .sdl-play{opacity:1}
    .sdl-ep .sdl-title{font-weight:600;align-self:end;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sdl-ep .sdl-sub{grid-column:2;align-self:start;color:rgba(255,255,255,.5);font-size:.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sdl-ep .sdl-actions{grid-column:3;grid-row:1/3;display:flex;gap:.25rem}

    .sdl-hint{color:rgba(255,255,255,.55);font-size:.9rem;margin:.75rem 0 0;line-height:1.55}
    .sdl-hint b{color:rgba(255,255,255,.8);font-weight:600}
    .sdl-note{margin-top:1rem;padding:.75rem 1rem;border-radius:.75rem;background:rgba(255,180,0,.1);color:#ffd27a;font-size:.9rem}
    .sdl-note-row{display:flex;gap:1rem;align-items:center;flex-wrap:wrap}
    .sdl-note-row span{flex:1;min-width:14rem}
    .sdl-primary{background:#7b5bf5}
    .sdl-primary:hover{background:#8d70ff}
    .sdl-grow{flex:1}
    .sdl-head .sdl-back{background:rgba(255,255,255,.06)}
    .sdl-folder-row{grid-template-columns:2.6rem 1fr auto}
    .sdl-ficon{grid-row:1/3;width:2.6rem;height:2.6rem;border-radius:.6rem;background:rgba(123,91,245,.18);color:#c9bcff;display:flex;align-items:center;justify-content:center}
    .sdl-ficon svg{width:1.35rem;height:1.35rem}
    .sdl-kind{margin-left:.4rem;padding:.1rem .45rem;border-radius:.35rem;background:rgba(255,255,255,.08);font-size:.72rem;font-weight:600;color:rgba(255,255,255,.65);vertical-align:.1rem}
    .sdl-browser{border-radius:.9rem;background:rgba(255,255,255,.04);padding:1rem}
    .sdl-chips{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:.9rem}
    .sdl-chip{border:0;border-radius:2rem;padding:.5rem .9rem;background:rgba(255,255,255,.07);color:#fff;cursor:pointer;
      font:600 .82rem/1 PlusJakartaSans,sans-serif;display:inline-flex;gap:.4rem;align-items:center}
    .sdl-chip:hover{background:rgba(255,255,255,.14)}
    .sdl-chip svg{width:1rem;height:1rem}
    .sdl-pathbar{display:flex;align-items:center;gap:.5rem;margin-bottom:.6rem;min-height:2.4rem}
    .sdl-pathbar code{flex:1;min-width:0;overflow-wrap:anywhere;font:500 .85rem/1.35 ui-monospace,monospace;color:rgba(255,255,255,.8)}
    .sdl-page .sdl-dirs{max-height:20rem;overflow:auto;display:flex;flex-direction:column;border-radius:.6rem;background:rgba(0,0,0,.2);padding:.25rem 0}
    .sdl-dir{border:0;background:transparent;color:rgba(255,255,255,.88);text-align:left;padding:.6rem .85rem;display:flex;gap:.6rem;align-items:center;
      cursor:pointer;font:500 .9rem/1.25 PlusJakartaSans,sans-serif;flex:0 0 auto}
    .sdl-dir:hover{background:rgba(255,255,255,.07)}
    .sdl-dir svg{width:1.1rem;height:1.1rem;color:#a996ff;flex:0 0 auto}
    .sdl-browser-foot{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;margin-top:1rem}
    .sdl-seg{display:inline-flex;border-radius:2rem;background:rgba(255,255,255,.07);padding:.2rem}
    .sdl-seg button{border:0;background:transparent;color:rgba(255,255,255,.7);padding:.45rem .85rem;border-radius:2rem;cursor:pointer;font:600 .82rem/1 PlusJakartaSans,sans-serif}
    .sdl-seg button[aria-pressed=true]{background:#7b5bf5;color:#fff}

    .sdl-page.sdl-narrow{--px:1rem;--py:1rem}
    .sdl-page.sdl-narrow .sdl-grid{grid-template-columns:repeat(auto-fill,minmax(7.5rem,1fr));gap:1.25rem .9rem}
    .sdl-page.sdl-narrow .sdl-hero{flex-wrap:wrap;min-height:0}
    .sdl-page.sdl-narrow .sdl-hero img{width:5rem}
    .sdl-page.sdl-narrow .sdl-ep{grid-template-columns:6.5rem 1fr auto}
    .sdl-page.sdl-narrow .sdl-browser-foot .sdl-grow{display:none}

    .sdl-toast{position:fixed;left:50%;bottom:2rem;transform:translateX(-50%);z-index:2147483001;max-width:min(36rem,90vw);
      padding:.8rem 1.2rem;border-radius:.75rem;background:#2b2940;color:#fff;font:14px/1.4 PlusJakartaSans,sans-serif;
      box-shadow:0 8px 30px rgba(0,0,0,.5);transition:opacity .3s;will-change:opacity;cursor:pointer}
    .sdl-toast[data-type=error]{background:#7d2a24}
    `
    document.documentElement.appendChild(style)

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    const fmtSize = b => !b ? '' : b >= 1 << 30 ? (b / (1 << 30)).toFixed(2) + ' GB' : (b / (1 << 20)).toFixed(0) + ' MB'
    const fmtSpeed = b => !b ? '' : b >= 1 << 20 ? (b / (1 << 20)).toFixed(1) + ' MB/s' : (b / 1024).toFixed(0) + ' kB/s'
    const pctOf = it => it.progress != null ? Math.floor(it.progress * 100) : 0
    // stream z addonu má plný odkaz (.../transportUrl/metaUrl/type/id/videoId); trailer má len samotný stream
    const encOf = href => (href.match(/^#\/player\/([^/?]+)\/[^/?]+\/[^/?]*\/[^/?]+\/[^/?]+/) || [])[1] || null
    const isPageHash = () => /^#\/?(board)?\?(.*&)?offline=1(&|$)/.test(location.hash)
    const seriesParam = () => new URLSearchParams(location.hash.split('?')[1] || '').get('series')
    const pad2 = n => String(n).padStart(2, '0')
    const epCode = it => it.season != null && it.number != null ? `S${pad2(it.season)}E${pad2(it.number)}` : (it.episode || '').split(' · ')[0]
    const seasonName = s => s == null ? 'Other' : s === 0 ? 'Specials' : `Season ${s}`
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

    async function api(p, opts = {}) {
        const res = await fetch(API + p, { ...opts, headers: { ...HEADERS, ...(opts.body ? { 'content-type': 'application/json' } : {}) } })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        return data
    }

    let toastTimer
    function toast(text, type = 'info', onClick = null) {
        let el = document.querySelector('.sdl-toast')
        if (!el) {
            el = document.createElement('div')
            el.className = 'sdl-toast'
            document.body.appendChild(el)
        }
        el.textContent = text
        el.dataset.type = type
        el.style.opacity = '1'
        el.style.pointerEvents = 'auto'
        el.onclick = () => { el.style.opacity = '0'; el.style.pointerEvents = 'none'; onClick?.() }
        clearTimeout(toastTimer)
        toastTimer = setTimeout(() => { el.style.opacity = '0'; el.style.pointerEvents = 'none' }, 4500)
    }

    // --- tlačidlo ⬇ pri streame ---------------------------------------------------
    const stopAll = e => e.stopPropagation()

    function decorate(a) {
        const enc = encOf(a.getAttribute('href') || '')
        if (!enc || a.textContent.includes(OFFLINE_NAME)) {
            a.querySelector(':scope > .sdl-btn')?.remove()
            return
        }
        if (a.dataset.sdlEnc === enc && a.querySelector(':scope > .sdl-btn')) return updateBtn(a)
        a.dataset.sdlEnc = enc
        if (getComputedStyle(a).position === 'static') a.style.position = 'relative'
        let btn = a.querySelector(':scope > .sdl-btn')
        if (!btn) {
            btn = document.createElement('button')
            btn.type = 'button'
            btn.className = 'sdl-btn'
            for (const ev of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'contextmenu', 'keydown'])
                btn.addEventListener(ev, stopAll)
            btn.addEventListener('click', onStreamButton)
            a.appendChild(btn)
        }
        updateBtn(a)
    }

    function updateBtn(a) {
        const btn = a.querySelector(':scope > .sdl-btn')
        if (!btn || btn.dataset.state === 'starting') return
        const item = byEnc.get(a.dataset.sdlEnc)
        const state = item ? item.status : 'none'
        if (btn.dataset.state === state && state !== 'downloading' && state !== 'queued') return
        btn.dataset.state = state
        const pct = item?.progress != null ? pctOf(item) : null
        btn.style.setProperty('--p', (pct || 0) + '%')
        if (state === 'downloading' || state === 'queued') btn.textContent = pct != null ? `${pct}%` : '…'
        else btn.innerHTML = { done: ICON.check, error: ICON.retry, paused: ICON.pause }[state] || ICON.download
        btn.title = {
            none: 'Download for offline',
            queued: 'Waiting to download — click to open Offline',
            downloading: 'Downloading — click to open Offline',
            done: 'Downloaded — click to open Offline',
            error: `Download failed: ${item?.error || ''} — click to retry`,
            paused: 'Paused — click to resume',
        }[state]
    }

    async function onStreamButton(e) {
        e.preventDefault()
        e.stopPropagation()
        const btn = e.currentTarget
        const a = btn.closest('a')
        const item = byEnc.get(a.dataset.sdlEnc)
        try {
            if (item && (item.status === 'error' || item.status === 'paused')) {
                await api(`/downloads/${item.id}/resume`, { method: 'POST' })
                toast(`Resumed: ${item.title}`)
            } else if (item) {
                location.hash = PAGE_HASH
            } else {
                btn.dataset.state = 'starting'
                const data = await api('/download', { method: 'POST', body: JSON.stringify({ href: a.getAttribute('href') }) })
                toast(`Downloading “${data.title}${data.episode ? ' · ' + data.episode : ''}” — click to see progress`, 'info', () => { location.hash = PAGE_HASH })
            }
        } catch (err) {
            toast(err.message, 'error')
        } finally {
            if (btn.dataset.state === 'starting') btn.dataset.state = ''
            refresh()
        }
    }

    // --- položka "Offline" v bočnom menu -------------------------------------------
    function addNavItems() {
        document.querySelectorAll('nav[class*="vertical-nav-bar"]').forEach(nav => {
            if (nav.querySelector(':scope > .sdl-nav')) return
            const template = nav.querySelector('a[href="#/library"]') || nav.querySelector('a')
            if (!template) return
            const item = template.cloneNode(true)
            item.classList.remove('selected')
            item.classList.add('sdl-nav')
            item.setAttribute('href', PAGE_HASH)
            item.title = 'Offline'
            const svg = item.querySelector('svg')
            if (svg) svg.innerHTML = ICON.offline.replace(/^<svg[^>]*>|<\/svg>$/g, '')
            const label = item.querySelector('[class*="label"]')
            if (label) label.textContent = 'Offline'
            const count = document.createElement('span')
            count.className = 'sdl-count'
            item.appendChild(count)
            template.after(item)
        })
        updateNav()
    }

    function updateNav() {
        const running = items.filter(i => i.status === 'downloading' || i.status === 'queued').length
        // triedy meníme iba na našej položke; položky Stremia spravuje React
        document.querySelectorAll('.sdl-nav').forEach(item => {
            item.classList.toggle('selected', pageOpen)
            item.querySelector('.sdl-count').textContent = running || ''
        })
        // Stremio si myslí, že je na Boarde — jeho zvýraznenie len vizuálne potlačíme cez CSS
        document.documentElement.classList.toggle('sdl-offline-open', pageOpen)
    }

    // --- stránka Offline -------------------------------------------------------------
    const page = document.createElement('div')
    page.className = 'sdl-page'
    page.hidden = true
    page.addEventListener('click', onPageClick)

    let lastRect = null
    const visibleLast = sel => [...document.querySelectorAll(sel)].filter(n => {
        const r = n.getBoundingClientRect()
        return r.width > 0 && r.height > 0
    }).pop()

    function placePage() {
        // stránka zaberie obsahovú časť Stremia: pod horným menu a vedľa bočného menu,
        // v úzkom okne (pod 640 px) je "bočné" menu lišta dole → stránka končí nad ňou.
        // Pri príchode z detailu menu ešte nemusí byť vykreslené → posledná známa poloha,
        // scan() ju po vykreslení (MutationObserver) prepočíta
        const v = visibleLast('nav[class*="vertical-nav-bar"]')
        const h = visibleLast('nav[class*="horizontal-nav-bar"]')
        if (v || h) {
            const vr = v?.getBoundingClientRect()
            const top = h ? h.getBoundingClientRect().bottom : vr ? vr.top : 0
            lastRect = vr && vr.width > vr.height
                ? { left: 0, top, bottom: Math.max(0, window.innerHeight - vr.top) } // menu dole
                : { left: vr ? vr.right : 0, top, bottom: 0 } // menu vľavo
        }
        const rect = lastRect || { left: 84, top: 77, bottom: 0 }
        page.style.left = rect.left + 'px'
        page.style.top = rect.top + 'px'
        page.style.right = '0'
        page.style.bottom = rect.bottom + 'px'
        page.classList.toggle('sdl-narrow', rect.left === 0)
    }

    function setPage(open) {
        if (open === pageOpen) return
        pageOpen = open
        page.hidden = !open
        if (open) {
            placePage()
            setTimeout(placePage, 300) // poistka, ak sa menu vykreslí bez zmeny DOM, ktorú zachytí observer
            renderPage()
            refresh()
        }
        updateNav()
    }

    const viewParam = () => new URLSearchParams(location.hash.split('?')[1] || '').get('view')
    const allDone = () => items.filter(i => i.status === 'done' && i.available !== false).concat(lib.items)
    const findItem = id => items.find(i => i.id === id) || lib.items.find(i => i.id === id)
    const byTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base', numeric: true })

    function renderPage() {
        if (!pageOpen) return
        if (viewParam() === 'folders') return renderFolders()
        const series = seriesParam()
        if (series) return renderSeries(series)

        const active = items.filter(i => i.status !== 'done')
        const done = allDone()
        const groups = groupDone(done)
        const movies = groups.filter(g => g.kind === 'movie').map(g => g.item).sort(byTitle)
        const shows = groups.filter(g => g.kind === 'series').sort(byTitle)
        const total = done.reduce((sum, i) => sum + (i.size || 0), 0)
        const meta = [movies.length && plural(movies.length, 'movie', 'movies'), shows.length && `${shows.length} series`, total && fmtSize(total), lib.busy && 'scanning folders…']
            .filter(Boolean).join(' · ')
        const missing = lib.folders.filter(f => f.available === false)

        let head = `<div class="sdl-head"><h1>Offline</h1><div class="sdl-meta">${esc(meta)}</div>
            <button class="sdl-pill" data-act="folders" title="Where downloads are saved and folders with your movies and series">${ICON.settings}Settings</button></div>`
        if (!info.addonSeen) {
            head += `<div class="sdl-banner"><p>Install the <b>Offline Downloads</b> add-on to see these titles on the Board and in the stream list of each title.</p>
                <button class="sdl-pill" data-act="addon">${ICON.plug}Install add-on</button></div>`
        }
        if (missing.length) head += `<div class="sdl-note">Not connected: ${missing.map(f => esc(f.path)).join(', ')}. Its videos come back when the disk is connected.</div>`
        const unavailable = items.filter(i => i.status === 'done' && i.available === false)
        const offDisk = unavailable.filter(i => i.missing !== 'moved').length
        const moved = unavailable.length - offDisk
        if (offDisk) head += `<div class="sdl-note">${plural(offDisk, 'downloaded video is', 'downloaded videos are')} on a disk that is not connected. ${offDisk === 1 ? 'It comes' : 'They come'} back when you connect it.</div>`
        if (moved) head += `<div class="sdl-note sdl-note-row"><span>${plural(moved, 'downloaded video was', 'downloaded videos were')} moved or deleted outside Stremio.
            If you moved ${moved === 1 ? 'it' : 'them'} into a library folder, ${moved === 1 ? 'it shows' : 'they show'} up there automatically.</span>
            <button class="sdl-pill" data-act="forget-moved" title="Only removes the entries, no files are touched">Remove from list</button></div>`
        if (!done.length && !active.length && !unavailable.length) {
            head += `<div class="sdl-empty">${ICON.offline}<br>Nothing here yet.<br>Press ⬇ next to a stream to download it, or add a folder with movies or series from your disk.<br><br>
                <button class="sdl-pill sdl-primary" data-act="folders">${ICON.folder}Add a folder</button></div>`
        }

        let activeHtml = ''
        if (active.length) {
            activeHtml = `<h2>Downloading</h2><div class="sdl-rows">` + active.map(it => {
                const pct = pctOf(it)
                const sub = it.status === 'downloading'
                    ? (it.progress != null ? `${pct}% of ${it.size ? (it.sizeEstimated ? '~' : '') + fmtSize(it.size) : '?'}` : `${fmtSize(it.downloaded) || '0 MB'} downloaded`)
                      + ` · ${fmtSpeed(it.speed) || 'connecting…'}`
                    : it.status === 'queued' ? (it.error || 'Waiting…')
                    : it.status === 'paused' ? `Paused at ${pct}%`
                    : `Failed: ${it.error || 'unknown error'}`
                return `<div class="sdl-row" data-status="${esc(it.status)}">
                    ${it.thumbnail || it.poster ? `<img src="${esc(it.thumbnail || it.poster)}" alt="">` : '<div class="sdl-noimg"></div>'}
                    <div class="sdl-title" title="${esc(it.streamName)}">${esc(it.title)}${it.isEpisode ? ' · ' + esc(epCode(it)) : ''}</div>
                    <div class="sdl-actions">
                      ${['downloading', 'queued'].includes(it.status) ? `<button class="sdl-icon" data-act="pause" data-id="${it.id}" title="Pause">${ICON.pause}</button>` : ''}
                      ${['paused', 'error'].includes(it.status) ? `<button class="sdl-icon" data-act="resume" data-id="${it.id}" title="Resume">${ICON.retry}</button>` : ''}
                      ${deleteButton(it)}
                    </div>
                    <div class="sdl-sub">${esc(sub)}</div>
                    <div class="sdl-bar"><i style="width:${pct}%"></i></div></div>`
            }).join('') + `</div>`
        }

        const doneHtml =
            (movies.length ? `<h2>Movies</h2><div class="sdl-grid">${movies.map(movieCard).join('')}</div>` : '') +
            (shows.length ? `<h2>Series</h2><div class="sdl-grid">${shows.map(seriesCard).join('')}</div>` : '')
        // prekreslíme iba časti, ktoré sa zmenili (plagáty počas sťahovania neblikajú)
        setSection('head', head)
        setSection('active', activeHtml)
        setSection('done', doneHtml)
    }

    // filmy samostatne, epizódy toho istého seriálu spolu v jednom "priečinku" (stiahnuté aj z disku)
    function groupDone(done) {
        const groups = []
        const bySeries = new Map()
        for (const it of done) {
            if (!it.isEpisode) {
                groups.push({ kind: 'movie', item: it })
                continue
            }
            let g = bySeries.get(it.metaId)
            if (!g) {
                g = { kind: 'series', metaId: it.metaId, type: it.type, title: it.title, poster: null, episodes: [] }
                bySeries.set(it.metaId, g)
                groups.push(g)
            }
            g.poster = g.poster || it.poster
            g.episodes.push(it)
        }
        return groups
    }

    function movieCard(it) {
        const fromDisk = it.origin === 'library'
        return `<div class="sdl-card" data-kind="movie" data-act="play" data-id="${it.id}" title="Play${fromDisk ? '' : ' offline'}: ${esc(it.filename || it.title)}">
            <div class="sdl-poster">
              ${it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy">` : `<div class="sdl-noimg">${esc(it.title)}</div>`}
              <div class="sdl-play"><span>${ICON.play}</span></div>
              <div class="sdl-card-actions">
                ${it.detailHref ? `<button class="sdl-icon" data-act="details" data-id="${it.id}" title="Details">${ICON.info}</button>` : ''}
                ${fromDisk ? '' : deleteButton(it)}
              </div>
            </div>
            <div class="sdl-title">${esc(it.title)}</div>
            <div class="sdl-sub">${esc([it.year && String(it.year).slice(0, 4), fmtSize(it.size), fromDisk ? null : 'downloaded'].filter(Boolean).join(' · '))}</div>
          </div>`
    }

    function seriesCard(g) {
        const seasons = [...new Set(g.episodes.map(e => e.season))]
        const size = g.episodes.reduce((sum, e) => sum + (e.size || 0), 0)
        const where = seasons.length === 1 ? seasonName(seasons[0]) : plural(seasons.length, 'season', 'seasons')
        return `<div class="sdl-card" data-kind="series" data-act="series" data-meta="${esc(g.metaId)}" title="Open ${esc(g.title)}">
            <div class="sdl-stack"><div class="sdl-poster">
              ${g.poster ? `<img src="${esc(g.poster)}" alt="" loading="lazy">` : `<div class="sdl-noimg">${esc(g.title)}</div>`}
              <div class="sdl-tag">${ICON.folder}${g.episodes.length}</div>
              <div class="sdl-play"><span>${ICON.folder}</span></div>
            </div></div>
            <div class="sdl-title">${esc(g.title)}</div>
            <div class="sdl-sub">${esc(`${where} · ${plural(g.episodes.length, 'episode', 'episodes')} · ${fmtSize(size)}`)}</div>
          </div>`
    }

    // pohľad na jeden seriál: iba série, v ktorých je nejaká epizóda (stiahnutá alebo na disku)
    function renderSeries(metaId) {
        const eps = allDone().filter(i => i.isEpisode && i.metaId === metaId)
        if (!eps.length) {
            // seriál už nemá epizódy (napr. po zmazaní) → späť na prehľad
            if (refreshedOnce) location.hash = PAGE_HASH
            return
        }
        const first = eps.find(e => e.poster) || eps[0]
        const size = eps.reduce((sum, e) => sum + (e.size || 0), 0)
        const seasons = new Map()
        for (const e of eps) {
            if (!seasons.has(e.season)) seasons.set(e.season, [])
            seasons.get(e.season).push(e)
        }
        const order = [...seasons.keys()].sort((a, b) => (a ?? 1e9) - (b ?? 1e9))
        const head = `<div class="sdl-hero"${first.background ? ` style="background-image:url('${esc(first.background)}')"` : ''}>
              <button class="sdl-icon sdl-back" data-act="overview" title="Back to Offline">${ICON.back}</button>
              ${first.poster ? `<img src="${esc(first.poster)}" alt="">` : ''}
              <div class="sdl-hero-text">
                <h1>${esc(first.title)}</h1>
                <div class="sdl-meta">${esc(`${plural(order.length, 'season', 'seasons')} · ${plural(eps.length, 'episode', 'episodes')} · ${fmtSize(size)}`)}</div>
                ${first.detailHref ? `<button class="sdl-pill" data-act="details-series" data-meta="${esc(metaId)}" data-type="${esc(first.type)}">${ICON.info}Show in Stremio</button>` : ''}
              </div>
            </div>`
        const body = order.map(season => {
            const list = seasons.get(season).sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
            return `<h2>${esc(seasonName(season))}</h2><div class="sdl-eps">` + list.map(e => `
                <div class="sdl-ep" data-act="play" data-id="${e.id}" title="Play: ${esc(e.filename || '')}">
                  <div class="sdl-thumb">
                    ${e.thumbnail || e.background || e.poster ? `<img src="${esc(e.thumbnail || e.background || e.poster)}" alt="" loading="lazy">` : ''}
                    <div class="sdl-play"><span>${ICON.play}</span></div>
                  </div>
                  <div class="sdl-title">${esc([e.number != null ? `${e.number}.` : epCode(e), e.episodeTitle].filter(Boolean).join(' '))}</div>
                  <div class="sdl-actions">
                    ${e.detailHref ? `<button class="sdl-icon" data-act="details" data-id="${e.id}" title="Episode in Stremio">${ICON.info}</button>` : ''}
                    ${e.origin === 'library' ? '' : deleteButton(e)}
                  </div>
                  <div class="sdl-sub">${esc([epCode(e), fmtSize(e.size), e.origin === 'library' ? 'from folder' : 'downloaded', e.filename].filter(Boolean).join(' · '))}</div>
                </div>`).join('') + `</div>`
        }).join('')
        setSection('head', head)
        setSection('active', '')
        setSection('done', body)
    }

    // --- správa priečinkov s filmami a seriálmi -------------------------------------------
    let browse = null // { path, parent, dirs, videos, roots, kind, error, loading }
    let pendingRemove = null
    const KIND_LABEL = { auto: 'Movies & series', movies: 'Movies', series: 'Series' }

    function renderFolders() {
        const custom = info.downloadDirCustom
        const choosing = browse?.mode === 'downloads'
        const head = `<div class="sdl-head"><button class="sdl-icon sdl-back" data-act="overview" title="Back to Offline">${ICON.back}</button>
              <h1>Settings</h1><div class="sdl-meta"></div></div>
            <h2>Downloads</h2>
            <div class="sdl-row sdl-folder-row">
              <div class="sdl-ficon">${custom && /^(\/(media|run\/media|mnt|Volumes)\/|[A-Za-z]:[\\\/])/.test(custom) ? ICON.drive : ICON.download}</div>
              <div class="sdl-title" title="${esc(info.downloadDir || '')}">${esc(info.downloadDir || '')} <span class="sdl-kind">${custom ? 'Your folder' : 'Default'}</span></div>
              <div class="sdl-actions">
                ${custom ? `<button class="sdl-pill" data-act="download-default" title="${esc(info.downloadDirDefault || '')}">Use default</button>` : ''}
                <button class="sdl-pill${choosing ? ' sdl-primary' : ''}" data-act="choose-download-dir">${ICON.folder}Change…</button>
              </div>
              <div class="sdl-sub">New movies and series are saved here.${custom ? ' If this disk is not connected, downloads go to the default folder again.' : ''}</div>
            </div>
            ${info.downloadDirNote ? `<div class="sdl-note">${esc(info.downloadDirNote)}</div>` : ''}
            <h2>Library folders</h2>
            <div class="sdl-head"><p class="sdl-hint" style="flex:1;margin:0">Movies and series from these folders show up in Offline and play in Stremio,
              also without internet. Files are only read — never moved, changed or deleted.</p>
              ${lib.folders.length ? `<button class="sdl-pill" data-act="rescan">${ICON.retry}${lib.busy ? 'Scanning…' : 'Rescan'}</button>` : ''}</div>`
        const list = lib.folders.length
            ? `<div class="sdl-rows" style="margin-top:1rem">` + lib.folders.map(f => {
                const status = f.available === false ? 'Not connected' : f.lastScan ? `${plural(f.movies, 'movie', 'movies')} · ${plural(f.episodes, 'episode', 'episodes')}` : 'Scanning…'
                const removeBtn = pendingRemove === f.id
                    ? `<button class="sdl-icon" data-act="remove-folder" data-folder="${f.id}" data-confirm title="Files stay on the disk">Remove?</button>`
                    : `<button class="sdl-icon" data-act="remove-folder" data-folder="${f.id}" title="Remove from Stremio (files stay on the disk)">${ICON.trash}</button>`
                return `<div class="sdl-row sdl-folder-row">
                    <div class="sdl-ficon">${/^(\/(media|run\/media|mnt|Volumes)\/|[A-Za-z]:[\\\/])/.test(f.path) ? ICON.drive : ICON.folder}</div>
                    <div class="sdl-title" title="${esc(f.path)}">${esc(f.path.split('/').pop() || f.path)} <span class="sdl-kind">${esc(KIND_LABEL[f.kind] || '')}</span></div>
                    <div class="sdl-actions">${removeBtn}</div>
                    <div class="sdl-sub">${esc(f.path)} · ${esc(status)}</div>
                  </div>`
            }).join('') + `</div>`
            : ''
        setSection('head', head)
        setSection('active', list)
        setSection('done', `<h2 id="sdl-browser-title">${choosing ? 'Choose where to save downloads' : 'Add a library folder'}</h2>` + renderBrowser())
    }

    function renderBrowser() {
        if (!browse) {
            loadBrowse(null)
            return `<div class="sdl-browser"><p class="sdl-hint">Loading…</p></div>`
        }
        const roots = (browse.roots || []).map(r =>
            `<button class="sdl-chip" data-act="browse" data-path="${esc(r.path)}" title="${esc(r.path)}">${r.kind === 'drive' ? ICON.drive : ICON.folder}${esc(r.name)}</button>`).join('')
        const dirs = (browse.dirs || []).map(d =>
            `<button class="sdl-dir" data-act="browse" data-path="${esc(d.path)}">${ICON.folder}<span>${esc(d.name)}</span></button>`).join('')
        const kind = browse.kind || 'auto'
        return `<div class="sdl-browser">
            <div class="sdl-chips">${roots}<button class="sdl-chip" data-act="pick">${ICON.search}Choose in system dialog…</button></div>
            <div class="sdl-pathbar">
              ${browse.parent ? `<button class="sdl-icon" data-act="browse" data-path="${esc(browse.parent)}" title="Up">${ICON.up}</button>` : ''}
              <code>${esc(browse.path || '')}</code>
            </div>
            ${browse.error ? `<div class="sdl-note">${esc(browse.error)}</div>` : ''}
            <div class="sdl-dirs">${dirs || '<p class="sdl-hint" style="padding:0 .8rem">No subfolders here.</p>'}</div>
            <div class="sdl-browser-foot">
              <span class="sdl-hint" style="margin:0">${browse.mode === 'downloads' ? 'Each movie or series gets its own folder here'
                  : browse.videos ? plural(browse.videos, 'video', 'videos') + ' directly in this folder' : 'Videos in subfolders are found too'}</span>
              <span class="sdl-grow"></span>
              ${browse.mode === 'downloads' ? `
              <button class="sdl-pill" data-act="cancel-download-dir">Cancel</button>
              <button class="sdl-pill sdl-primary" data-act="set-download-dir">${ICON.download}Save downloads here</button>` : `
              <div class="sdl-seg" role="group" aria-label="What is in this folder">
                ${['auto', 'movies', 'series'].map(k => `<button data-act="kind" data-kind="${k}" aria-pressed="${kind === k}">${esc({ auto: 'Auto', movies: 'Movies', series: 'Series' }[k])}</button>`).join('')}
              </div>
              <button class="sdl-pill sdl-primary" data-act="add-folder">${ICON.plus}Add this folder</button>`}
            </div>
          </div>`
    }

    async function loadBrowse(dir) {
        const kind = browse?.kind || 'auto'
        const mode = browse?.mode || 'library'
        try {
            const data = await api('/fs' + (dir ? '?path=' + encodeURIComponent(dir) : ''))
            browse = { ...data, kind, mode }
        } catch (err) {
            browse = { ...(browse || {}), kind, mode, error: err.message }
        }
        renderPage()
    }

    function setSection(name, html) {
        let el = page.querySelector(`:scope > [data-section="${name}"]`)
        if (!el) {
            el = document.createElement('div')
            el.dataset.section = name
            page.appendChild(el)
        }
        if (el.__html !== html) {
            el.__html = html
            el.innerHTML = html
        }
    }

    function deleteButton(it) {
        return pendingDelete === it.id
            ? `<button class="sdl-icon" data-act="delete" data-id="${it.id}" data-confirm title="Click again to delete the file">Delete?</button>`
            : `<button class="sdl-icon" data-act="delete" data-id="${it.id}" title="Delete from this computer">${ICON.trash}</button>`
    }

    async function onPageClick(e) {
        const el = e.target.closest('[data-act]')
        if (!el) return
        e.stopPropagation()
        const { act, id } = el.dataset
        const item = findItem(id)
        try {
            if (act === 'addon') location.hash = '#/addons?addon=' + encodeURIComponent(info.manifestUrl)
            else if (act === 'play' && item?.playerHref) location.hash = item.playerHref
            else if (act === 'details' && item?.detailHref) location.hash = item.detailHref
            else if (act === 'series') location.hash = PAGE_HASH + '&series=' + encodeURIComponent(el.dataset.meta)
            else if (act === 'overview') location.hash = PAGE_HASH
            else if (act === 'folders') location.hash = PAGE_HASH + '&view=folders'
            else if (act === 'details-series') location.hash = `#/detail/${encodeURIComponent(el.dataset.type)}/${encodeURIComponent(el.dataset.meta)}`
            else if (act === 'pause' || act === 'resume') await api(`/downloads/${id}/${act}`, { method: 'POST' })
            else if (act === 'browse') return loadBrowse(el.dataset.path)
            else if (act === 'kind') {
                browse = { ...(browse || {}), kind: el.dataset.kind }
                return renderPage()
            } else if (act === 'pick') {
                toast('A folder dialog opened — it may be behind the Stremio window')
                const { path } = await api('/fs/pick', { method: 'POST', body: JSON.stringify({ start: browse?.path || null }) })
                if (path) return loadBrowse(path)
                return
            } else if (act === 'forget-moved') {
                const { forgotten } = await api('/downloads/forget-moved', { method: 'POST' })
                toast(`Removed ${plural(forgotten, 'entry', 'entries')} from the list. No files were touched.`)
            } else if (act === 'choose-download-dir') {
                // prehliadač sa prepne na výber priečinka na sťahovanie, začne pri pripojených diskoch
                browse = { ...(browse || {}), mode: 'downloads' }
                const drive = (browse.roots || []).find(r => r.kind === 'drive')
                await loadBrowse(info.downloadDirCustom || drive?.path || browse.path || null)
                page.querySelector('#sdl-browser-title')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                return
            } else if (act === 'cancel-download-dir') {
                browse = { ...(browse || {}), mode: 'library' }
                return renderPage()
            } else if (act === 'set-download-dir' && browse?.path) {
                info = { ...info, ...(await api('/settings/download-dir', { method: 'POST', body: JSON.stringify({ path: browse.path }) })) }
                browse = { ...browse, mode: 'library' }
                toast(`New downloads will be saved to ${info.downloadDir}`)
                return renderPage()
            } else if (act === 'download-default') {
                info = { ...info, ...(await api('/settings/download-dir', { method: 'POST', body: JSON.stringify({ path: null }) })) }
                toast(`Downloads go to the default folder again: ${info.downloadDir}`)
                return renderPage()
            } else if (act === 'add-folder' && browse?.path) {
                await api('/library/folders', { method: 'POST', body: JSON.stringify({ path: browse.path, kind: browse.kind || 'auto' }) })
                toast(`Added ${browse.path} — looking for movies and series…`)
                lib.version = 0
            } else if (act === 'rescan') {
                await api('/library/scan', { method: 'POST' })
                toast('Scanning folders…')
                lib.version = 0
            } else if (act === 'remove-folder') {
                const fid = el.dataset.folder
                if (pendingRemove !== fid) {
                    pendingRemove = fid
                    setTimeout(() => { if (pendingRemove === fid) { pendingRemove = null; renderPage() } }, 4000)
                    return renderPage()
                }
                pendingRemove = null
                await api(`/library/folders/${fid}`, { method: 'DELETE' })
                toast('Folder removed from Stremio. The files are still on the disk.')
                lib.version = 0
            } else if (act === 'delete' && item && item.origin !== 'library') {
                if (pendingDelete !== id) {
                    pendingDelete = id
                    setTimeout(() => { if (pendingDelete === id) { pendingDelete = null; renderPage() } }, 4000)
                    return renderPage()
                }
                pendingDelete = null
                await api(`/downloads/${id}`, { method: 'DELETE' })
                toast(`Deleted “${item.title}${item.isEpisode ? ' · ' + epCode(item) : ''}”`)
            }
        } catch (err) {
            toast(err.message, 'error')
        }
        refresh()
    }

    // --- obnovovanie stavu --------------------------------------------------------
    let refreshedOnce = false
    let lib = { version: 0, busy: false, folders: [], items: [] }
    async function refresh() {
        try {
            const settingsOpen = pageOpen && viewParam() === 'folders'
            const [downloadsList, library, freshInfo] = await Promise.all([
                api('/downloads'), api('/library?since=' + lib.version), settingsOpen ? api('/info') : null,
            ])
            items = downloadsList
            if (freshInfo) info = freshInfo
            if (!library.unchanged) lib = { version: library.version, busy: library.busy, folders: library.folders, items: library.items }
            refreshedOnce = true
        } catch {
            return
        }
        byEnc = new Map(items.filter(i => i.streamEnc).map(i => [i.streamEnc, i]))
        document.querySelectorAll('a[data-sdl-enc]').forEach(updateBtn)
        updateNav()
        renderPage()
    }

    function scan() {
        addNavItems()
        if (pageOpen) placePage()
        if (DETAIL_ROUTE.test(location.hash)) document.querySelectorAll('a[href^="#/player/"]').forEach(decorate)
    }

    // Stremio naviguje cez history.pushState (nevyvolá hashchange) → sledujeme aj pushState/replaceState
    function watchRoute(cb) {
        let last = location.href
        const check = () => {
            if (location.href === last) return
            last = location.href
            cb()
        }
        for (const method of ['pushState', 'replaceState']) {
            const original = history[method]
            history[method] = function (...args) {
                const result = original.apply(this, args)
                queueMicrotask(check)
                return result
            }
        }
        window.addEventListener('popstate', check)
        window.addEventListener('hashchange', check)
        setInterval(check, 500) // poistka, keby niečo zmenilo adresu inak
    }

    let lastSeries = null
    function onRoute() {
        setPage(isPageHash())
        // prechod prehľad ↔ seriál v rámci otvorenej stránky
        const series = pageOpen ? `${seriesParam()}|${viewParam()}` : null
        if (pageOpen && series !== lastSeries) {
            renderPage()
            page.scrollTop = 0
        }
        lastSeries = series
        scan()
    }

    function start() {
        document.body.appendChild(page)
        let queued = false
        new MutationObserver(() => {
            if (queued) return
            queued = true
            // setTimeout namiesto requestAnimationFrame — rAF v skrytom okne nebeží
            setTimeout(() => { queued = false; scan() }, 60)
        }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] })
        watchRoute(onRoute)
        window.addEventListener('resize', () => pageOpen && placePage())
        api('/info').then(data => { info = data; renderPage() }).catch(() => {})
        onRoute()
        refresh()
        // rýchlejšie obnovovanie iba keď niečo beží alebo je otvorená stránka
        setInterval(() => {
            const busy = pageOpen || lib.busy || items.some(i => i.status === 'downloading' || i.status === 'queued')
            if (busy || Date.now() % 10000 < 1600) refresh()
        }, 1500)
    }

    if (document.body) start()
    else document.addEventListener('DOMContentLoaded', start)
})()
