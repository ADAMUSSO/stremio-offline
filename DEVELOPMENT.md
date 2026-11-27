# Offline Stremio — developer notes

Plain Node.js (≥ 20, ES modules), no npm dependencies. UI texts are in English; code comments are in Slovak.

## Architecture

### Linux

```
Stremio (flatpak, stremio-linux-shell: GTK4 + WebKitGTK + mpv)
   │  started with --url http://127.0.0.1:11470/proxy/d=https%3A%2F%2F127.0.0.1%3A11489/
   ▼     (user D-Bus override ~/.local/share/dbus-1/services/com.stremio.Stremio.service)
Stremio streaming server :11470  /proxy/d=<https target>/…   ← the page origin stays 127.0.0.1:11470
   ▼
server.js  (:11488 HTTP, :11489 HTTPS self-signed; systemd socket activation, fd 3 = HTTP, fd 4 = HTTPS)
```

Why through the streaming server's proxy: `/proxy/d=` only accepts HTTPS targets (it accepts self-signed
certificates), and it keeps the page on the origin `127.0.0.1:11470` — the same localStorage as the original Stremio,
so the login, library and add-ons stay. The shell injects its IPC script (mpv) into every page, so the player works.

### macOS

```
Stremio 5 for macOS (Rust, WKWebView + mpv), started from the Dock/Finder
   │  reads WEBUI_URL=http://127.0.0.1:11488/ (set by launchctl setenv in the login agent)
   ▼
server.js  (:11488 HTTP only, started by macos/offline-stremio-agent.sh with IDLE_EXIT=1)
```

### The helper (all platforms)

```
server.js
   ├─ /                 lib/proxy.js     proxy to web.stremio.com, injects <script src=":11488/__dl/inject.js"> into the HTML,
   │                                     stores every response on disk (web-cache) → the UI also loads offline
   ├─ /__dl/inject.js   public/inject.js client script inside Stremio (⬇ buttons, "Offline" menu item and page)
   ├─ /__dl/api/…       server.js        API for inject.js (downloads, library, folder browsing, settings)
   ├─ /addon/…          lib/addon.js     Stremio add-on: catalog, meta, stream, subtitles
   ├─ /files/<id>/…     lib/files.js     downloaded files (Range)
   ├─ /lib/<id>/…       lib/files.js     files from library folders (indexed files only)
   ├─ /libsub/<id>/<n>                   subtitles next to a library video
   └─ /img/<sha1>                        cached posters/backgrounds (offline)
```

## Files

| File | Purpose |
|---|---|
| `server.js` | HTTP/HTTPS server, routing, API, CORS (UI on Stremio's origin), idle exit |
| `lib/config.js` | ports, paths and env variables per platform (Linux / macOS / Windows) |
| `lib/node-check.js` | Node 20+ check (first import in `server.js`) |
| `lib/proxy.js` | web UI proxy + script injection + disk cache |
| `lib/playerLink.js` | decodes `#/player/{stream}/…` (base64(zlib(JSON)) from stremio-core) |
| `lib/downloads.js` | download manager: torrents via `:11470/{hash}/{idx}`, HTTP with Range resume, HLS via ffmpeg |
| `lib/season.js` | "download the whole season": finds the same source for every episode in the same add-on |
| `lib/library.js` | library folders: scanning, file name parsing, Cinemeta matching, drive (un)plug detection |
| `lib/metas.js` | cached metadata and images for offline use |
| `lib/addon.js` | Stremio add-on + data for the Offline page (playerHref, detailHref) |
| `lib/settings.js` | download folder setting (`settings.json`), falls back to the default when the drive is missing |
| `lib/fsbrowse.js` | folder listing, drive shortcuts and the system folder picker (zenity / osascript / PowerShell) |
| `lib/files.js` | file serving with Range |
| `lib/store.js` | JSON store with atomic writes |
| `lib/tls.js` | self-signed certificate (openssl), Linux only |
| `public/inject.js` | the whole UI inside Stremio (vanilla JS + CSS in one file) |
| `install.sh` / `uninstall.sh` | Linux: systemd socket + service, D-Bus override |
| `install-macos.sh` / `uninstall-macos.sh` | macOS: LaunchAgent + `WEBUI_URL`, optional launcher `Stremio Offline.app` |
| `macos/offline-stremio-agent.sh` | macOS login agent: sets `WEBUI_URL`, starts the helper while Stremio runs |
| `dev/` | development tools (below) |

Data (Linux `~/.local/share/stremio-offline/`, macOS `~/Library/Application Support/stremio-offline/`):
`downloads.json`, `library.json`, `settings.json`, `seasons.json`, `meta/`, `img/`, `web-cache/`, `tls/` (Linux), `addon-seen`.

## Development workflow

```bash
# development instance on ports 11590/11591 with its own data (the installed one keeps running)
npm run dev
# test add-on: Creative Commons streams (Sintel torrent, Big Buck Bunny HTTP + HLS) and generated videos for
# season 1 of Chernobyl (tt7366338) to test season downloads; STREAM_DELAY_MS=2500 makes it slow like real add-ons
npm run test-addon
# fake drive with tiny videos (movies, series, subtitles, an unmatched home video)
npm run test-library
```

Open the URL printed by `npm run dev` in a browser (Stremio must be running because of `:11470`). In that browser
profile install `http://127.0.0.1:11499/manifest.json` (CC streams) and in Offline → Settings add
`/tmp/offline-stremio-test-hdd/Movies` and `…/Series`.

`public/inject.js` is read from disk on every request — reloading the page is enough. Changes in `lib/` and
`server.js` need a restart (`systemctl --user restart stremio-offline.service` for the installed Linux version).

Logs: `journalctl --user -u stremio-offline.service -f` (Linux), `~/Library/Logs/offline-stremio*.log` (macOS).

Testing the idle exit (simulated socket activation and a closed Stremio):

```bash
STREAMING_SERVER=http://127.0.0.1:9 IDLE_EXIT_MS=6000 PORT=11590 DATA_DIR=/tmp/x \
  systemd-socket-activate -l 127.0.0.1:11590 -l 127.0.0.1:11591 \
  -E STREAMING_SERVER -E IDLE_EXIT_MS -E PORT -E DATA_DIR node server.js
```

"macOS mode" can be tried on Linux: `ENABLE_HTTPS=0 IDLE_EXIT=1 PORT=11590 DATA_DIR=/tmp/x node server.js` and open
`http://127.0.0.1:11590/`.

## Stremio 5 (web UI) quirks this project works around

- **Navigation uses `history.pushState`**, which fires no `hashchange`. `inject.js` wraps pushState/replaceState
  (`watchRoute`) and also checks the URL every 500 ms.
- **Class names are hashed CSS modules** (`nav-tab-button-tW6qT`) and change with every build → always select with
  `[class*="vertical-nav-bar"]` and similar.
- **Never toggle classes on React-managed elements** (e.g. `selected` in the menu) — React may not restore them.
  The highlight is overridden with CSS through a class on `<html>` (`sdl-offline-open`).
- **The Offline page lives at `#/?offline=1`** (the Board with a parameter), because an unknown route shows
  "Page not found" without the menu. `#/downloads` belongs to Stremio's native downloader (paid Supporter accounts
  only — do not touch it).
- **The Board's Spotlight banner shows through the transparent menu bars** → the Board's `nav-content-container` is
  hidden with `display:none` while Offline is open (`visibility` is overridden by descendants, and with `opacity` the
  carousel keeps animating underneath and WebKit keeps repainting).
- **Narrow window (< 640 px):** the side menu becomes a bottom bar → `placePage()` positions the page from both bars.
- **Global `overflow: hidden`** in Stremio's CSS — own containers that should overflow must allow it explicitly.
- **`requestAnimationFrame` does not run in a hidden window** → the MutationObserver schedules with `setTimeout`.
- **WebKitGTK hover flicker:** `opacity`/`outline` transitions on hover create and drop a compositing layer → two
  flashes. Hover effects are instant (no `transition`), the poster ring uses `box-shadow`.
- **App-wide flicker on hover/scroll on Linux** is a bug of Stremio's Linux app itself (WebKitGTK,
  stremio-linux-shell #61, #67), not of this project. A screencast analysed frame by frame shows the display briefly
  presenting an older buffer in the changed area. Tried on Intel Iris Xe + RTX 3050:
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` → heavy stutter and black/missing areas (do not use);
  `GDK_DISABLE=offload` → no change. `install.sh` can still pass variables with `STREMIO_ENV` (default: none).
  The flatpak wrapper `/app/bin/stremio` sets `GSK_RENDERER=opengl` itself when `/dev/nvidia0` exists, so that
  variable cannot be overridden with `--env`.
- **Play button** follows Stremio's poster button: 56 px circle, `rgba(12,11,17,.4)`, 2.1 px inner ring
  `rgba(255,255,255,.9)`, 32 px icon — an original rounded triangle in the proportions of Stremio's icon (the
  stremio-icons set has no license, so it is not copied; the optical offset is in the shape, not in `margin`).
- **Stream links** are `#/player/{enc}/{streamTransportUrl}/{metaTransportUrl}/{type}/{id}/{videoId}`; a trailer has
  only `{enc}`. The add-on's `sources` field appears as `announce` in the serialized stream.
- **Meta for an id** is requested from all add-ons; Stremio shows the first ready one in add-on order (Cinemeta is
  usually first).
- The streaming server also supports `GET /{hash}/{idx}?external=1&download=1` (file as attachment) and creates the
  torrent by itself.

## Season downloads

- `POST /__dl/api/season/preview {href}` → the episode list of the season with `aired` and `state`
  (`offline` / `queued`) for the ⬇ menu; `POST /__dl/api/season {href, scope: 'season'|'rest'}` starts a batch;
  `GET /__dl/api/season/batches`, `POST …/batches/:id/stop`, `DELETE …/batches/:id` (dismiss),
  `GET …/batches/:id/choices` (streams for the episodes waiting for a choice),
  `POST …/batches/:id/choose {picks: [{videoId, key}]}` (`key` = `bt:{hash}:{idx}` / `url:{url}`, `null` = skip).
- The player link has everything needed: the stream, the add-on's transport URL, the meta add-on, type, id and
  videoId. The episode list comes from the meta add-on (Cinemeta), other episodes' streams from
  `{transportUrl}/stream/{type}/{videoId}.json` — two requests at a time, added to the queue in episode order.
- **Only the exact source is added without asking** (the user's explicit requirement — they often use add-ons other
  than Torrentio and sometimes cannot download torrents). `pickSameSource()`: same kind (torrent / HTTP) and either
  the same `infoHash` (a season pack, a different `fileIdx`) or a hash in a debrid URL, or the same
  `behaviorHints.bingeGroup` without a conflicting resolution or release group (Torrentio uses one bingeGroup per
  release; other add-ons may use a looser one).
- Everything else goes to `batch.pending` (`reason`: `different`, `none` = no downloadable stream, `error` = the
  add-on did not answer) and waits for the user on the "Choose streams" view (`#/?offline=1&pick=<id>`).
  `rankForChoice()` only orders that list (same kind and resolution first, marked `closest` → "Same quality");
  nothing is preselected. "Open in Stremio" leads to the episode page for other add-ons.
- Batches are saved in `seasons.json` (pending choices survive closing Stremio); stream lists are cached in memory
  and fetched again when needed. `season.isBusy()` keeps the helper running while a lookup runs.
- Episodes added by a batch have no Stremio-encoded stream (`streamEnc: null`). The ⬇ buttons match them by
  `sourceKey|videoId`: `inject.js` decodes the stream from the link (`DecompressionStream('deflate')`) to get the
  same `bt:{hash}:{fileIdx}` / `url:{url}` key as the server.

## Download folder

- `settings.downloadDir()` is evaluated when a download starts, on `/info` (the Settings page refreshes every 1.5 s)
  and at server start. If the custom folder is missing or not writable, the setting is cleared (= default) and an
  explanation is stored — the user picks the drive again after connecting it.
- A running download keeps its path in `item.file`; on a disconnected drive it fails and can be resumed later.
- Downloads on a disconnected drive get `available: false` (the status is not changed to an error) and the add-on
  does not return them. `missing` tells `disconnected` (the first existing parent is `/run/media/<user>`,
  `/media/<user>`, `/mnt`, `/Volumes`, or a missing Windows drive letter) from `moved` (the drive is there, the file
  was moved or deleted outside Stremio).
- Moved downloads: after every library scan `downloads.adoptMoved()` looks for a file with the same name and size in
  the library and drops the download record (files are not touched) — the title is then shown from the library.
  Moved files that are not found can be removed from the list (`POST /__dl/api/downloads/forget-moved`).
- The library skips files managed by downloads (`library.setExclude`) so they are not shown twice.

## Library folders

- Drive (un)plug: `checkMounts()` compares a signature of every folder (`dev:ino` or `missing`) every 5 s and runs
  `scanAll()` on a change. Changes during a scan are queued (`rescanPending`).
- An empty folder on a different device than at the last scan is treated as an empty mount point →
  `available: false`, files are kept.
- `effectiveKind()`: Auto mode by folder name (Movies/Filmy → movies, Series/Seriály/Shows → series);
  `parseAll()`: siblings that differ only by a trailing number are episodes.
- Slug names like `dva-a-pul-chlapa-s05e04-2003` (dashes instead of spaces) are read as words; for episodes the year
  is searched in the whole file name. Cinemeta search also knows local titles and the year decides the match
  (the first result is accepted when the year matches).
- Unmatched files are retried on every scan (search results are cached in `library.json → matches`; failures are
  retried after 24 h at the earliest).
- Cinemeta does not find everything (e.g. the Slovak series *Profesionáli*, abbreviations like *AOT*) — such titles
  stay local (`local:` ids) and play with the file name as title.

## macOS and Windows

Found in the apps (macOS: the unpacked `Stremio_x64.dmg` 5.1.26, read-only string inspection of the binary;
Windows: the stremio-shell-ng source code):

- Both apps are written in Rust with mpv and have **`--webui-url`**, plus `--server-url`, `--start-hidden`,
  `--hide-splash`… macOS uses WKWebView with the IPC handler `window.webkit.messageHandlers.ipc`, Windows WebView2.
  Windows trusts IPC messages from the origin of `--webui-url` (`same_origin` in the source); macOS probably as well.
- The default UI is `https://web.stremio.com/#/?streamingServerUrl=…` → origin `web.stremio.com`, so the login cannot
  be kept with a custom UI (log in once more). That is why macOS/Windows use neither the streaming server proxy nor
  HTTPS (`ENABLE_HTTPS=0`): the UI comes directly from `http://127.0.0.1:11488/`.
- macOS bundles its own `node` (v16.20.2) and `server.js` in `Stremio.app/Contents/MacOS/`; Node 16 is too old
  (no `fetch`, `AbortSignal.any`…), hence `lib/node-check.js` requires Node 20+.
- macOS has neither D-Bus activation nor socket activation usable from Node. The normal Stremio icon works through an
  environment variable: the binary contains env names for all options (`START_HIDDEN`, `STAGING`, `WEBUI_URL`… — also
  for boolean flags, which have no `value_name`, so these are clap `env` attributes). `launchctl setenv WEBUI_URL …`
  applies to apps started from the Dock/Finder. It is set by the LaunchAgent `community.offline-stremio`
  (`macos/offline-stremio-agent.sh`), which also checks every second (`pgrep`) whether Stremio runs and then starts
  the helper with `IDLE_EXIT=1`. The Mac shell (like shell-ng) loads the UI only after its streaming server has
  started, which gives the helper time. Verified only by simulation on Linux (fake Stremio process, stubbed
  `launchctl`).
- Fallback `install-macos.sh --launcher`: the app `~/Applications/Stremio Offline.app` starts the helper and
  `open -a Stremio --args --webui-url=…` (offers a restart when Stremio already runs without it).
- Windows (shell-ng) does not read `--webui-url` from the environment → the installer will have to change or add a
  shortcut.
- `lib/config.js`, `lib/fsbrowse.js` and `lib/downloads.js` already have branches for `darwin` and `win32` (paths,
  `/Volumes`, drive letters, folder picker via `osascript` / PowerShell). A Windows installer is still missing.

## Ideas

- Windows installer (PowerShell): a "Stremio Offline" shortcut with `--webui-url`, helper with `IDLE_EXIT=1`.
- Manually assign a title to unmatched items (search in Stremio or paste an IMDb id).
- An add-on-only variant without touching Stremio's start: the same helper as a local add-on + a tray app. It would
  keep own folders/HDD, downloads (as "⬇ Save offline" streams with a configured source add-on), the "Offline"
  catalogs and offline playback, but lose the menu item and the offline start of the UI. Requests from
  `https://web.stremio.com` to `127.0.0.1` also need the Private Network Access preflight
  (`Access-Control-Allow-Private-Network: true`).
- A pure online "⬇ Download" add-on (no install): streams with `externalUrl` pointing to
  `:11470/{hash}/{idx}?external=1&download=1` or debrid URLs → the browser downloads them; playback through Stremio's
  built-in "Local files" add-on (Windows Search / Spotlight / home folder on Linux).
- Local (CZ/SK) titles instead of the English ones from Cinemeta.
- Clean old web UI builds from `web-cache`.
