# Offline Stremio

Download movies and series **directly inside the Stremio 5 desktop app**, watch them **without internet**, and play
the movies and series you already have on your own disks — all in Stremio's own player, with posters, episode
names and subtitles.

> **Unofficial project.** It is not affiliated with or endorsed by Stremio; "Stremio" is a trademark of its owners.
> Offline Stremio ships **no content sources** — it only downloads what you already play through your own add-ons,
> and you are responsible for what you download under the laws of your country. It does not unlock or modify
> Stremio's own paid downloader.

---

## Features

- **⬇ next to every stream** — on a movie or episode page, every stream gets a download button. It shows the
  progress in % and turns into ✓ when the file is saved.
- **"Offline" in Stremio's sidebar** — a new section with everything you can watch offline:
  downloads in progress (pause, resume, delete) and grids of **Movies** and **Series**.
- **Series grouped in folders** — all episodes of a show sit in one card with the show's poster. Opening it shows
  only the seasons that have at least one episode.
- **Your own folders and external drives** — add folders like `Movies` or `Series` from your disk or HDD.
  File names are recognised (`Inception.2010.1080p.mkv`, `S01E02`, `1x02`, `Season 2/…`), matched with Stremio's
  catalogue (posters, descriptions, episode titles — local titles such as *Pelíšky* or *Kolja* work too) and played
  in Stremio. Subtitles next to the video (`Movie.en.srt`) are offered in the player.
  Your files are only read — never moved, renamed or deleted.
- **External drives just work** — plug a drive in and its movies appear within a few seconds; unplug it and they
  are hidden until it is back.
- **Choose where downloads go** — e.g. straight to an external HDD to keep your computer clean. If that drive is not
  connected, downloads go to the default folder again.
- **Works without internet** — Stremio's interface is cached on your computer, so the app starts and plays your
  offline videos even with no connection.
- **Your account stays as it is** — library, add-ons and settings are untouched (on Linux you even stay logged in).
- **Starts and stops with Stremio** — the small helper only runs while Stremio is open (or while something is still
  downloading).

## Platforms

| Platform | Status |
|---|---|
| **Linux** — Stremio from Flathub (`com.stremio.Stremio` 1.2+) | ✅ used daily |
| **macOS** — Stremio 5 for macOS | 🧪 implemented, **not yet tested on a real Mac** — feedback welcome |
| **Windows** | ⏳ not yet (the code is prepared, the installer is missing) |

## How it works

The Stremio desktop window is a web page (`web.stremio.com`) shown inside the app, plus Stremio's own **streaming
server** that runs on your computer at `127.0.0.1:11470` and plays torrents.

Offline Stremio adds a small **helper** (a Node.js program, no extra packages) that also runs only on your computer
(`127.0.0.1`, not reachable from the network):

```
Stremio app (window + mpv player)
   │  opens the interface from the helper instead of directly from web.stremio.com
   ▼
Offline Stremio helper (127.0.0.1:11488)
   ├─ serves Stremio's normal web interface + a small script that adds ⬇ buttons and the Offline section
   ├─ keeps a copy of the interface on disk           → Stremio starts without internet
   ├─ downloads streams                                → torrents through Stremio's own streaming server,
   │                                                     HTTP/debrid links directly, HLS via ffmpeg
   ├─ scans your library folders and drives            → matched with Stremio's catalogue (Cinemeta)
   └─ a local Stremio add-on + file server             → Stremio's player plays the files from your disk
```

How Stremio is pointed to the helper — **you keep starting Stremio from its normal icon**:

- **Linux:** the installer adds a user-level D-Bus override so the Stremio app starts with
  `--url` pointing to the helper, and a systemd *socket* that starts the helper only when Stremio connects.
- **macOS:** a small login agent sets `WEBUI_URL` for apps started from the Dock/Finder (Stremio 5 for macOS reads it
  as `--webui-url`) and starts the helper whenever Stremio is running.

The Stremio app itself is never modified, and the uninstaller restores the normal start.

The helper talks to the internet only where Stremio would: `web.stremio.com` (the interface), Stremio's catalogue
(titles and posters) and your stream sources. No telemetry.

## Requirements

**Linux**
- Stremio from Flathub: `flatpak install flathub com.stremio.Stremio`
- Node.js **20 or newer** (`node --version`). If your distribution ships an older one, use [nvm](https://github.com/nvm-sh/nvm)
  or the packages from [nodejs.org](https://nodejs.org).
- `openssl` (usually preinstalled)
- optional: `ffmpeg` (for HLS streams), `zenity` (for the system folder picker)

**macOS**
- Stremio 5 for macOS in `/Applications` ([stremio.com/downloads](https://www.stremio.com/downloads))
- Node.js **20 or newer**: `brew install node` or the installer from [nodejs.org](https://nodejs.org)
  (the Node.js bundled inside Stremio is version 16, which is too old)
- optional: `ffmpeg` (`brew install ffmpeg`) for HLS streams

## Installation

### 1. Download

Either download the latest release — **[Releases](https://github.com/ADAMUSSO/stremio-offline/releases/latest) →
Source code (zip / tar.gz)** — unzip it and open a terminal in the unzipped folder, or clone the repository:

```bash
git clone https://github.com/ADAMUSSO/stremio-offline.git
cd stremio-offline
```

> Put the folder somewhere permanent first (for example your home folder). The helper runs from this folder —
> if you move or delete it later, Stremio will not start with the Offline features until you run the installer again.

### 2a. Linux

```bash
bash install.sh
```

Then **quit Stremio completely** — also from the tray icon if it is there — and start it again from its normal icon.

You will see **Offline** in the left sidebar, under *Library*. You stay logged in.

### 2b. macOS

Open **Terminal** in the project folder and run:

```bash
bash install-macos.sh
```

Then **quit Stremio** (⌘Q) and open it again from the Dock or Applications as usual.

- The first time you need to **log in to Stremio again** — the interface now runs from a local address instead of
  `web.stremio.com`, which has its own login.
- macOS shows a *"Background item added"* notice (the small login agent) and may ask whether **node** may access a
  removable volume or your Downloads folder — allow it. You can change this later in
  *System Settings → Privacy & Security*.
- If the normal Stremio icon does not show the Offline section, install the fallback launcher and start Stremio with
  **Stremio Offline** from Applications instead:

  ```bash
  bash install-macos.sh --launcher
  ```

### 3. Optional: the add-on

On the **Offline** page you can click **Install add-on**. It adds "Offline" rows to the Board and Discover, and a
`💾 Offline` stream on the page of every title you have offline. Everything else works without it.

The add-on is saved to your Stremio account, so on your other devices (phone, TV) it shows as unavailable — it only
exists on this computer.

## Using it

### Download a movie or an episode

1. Open a movie or an episode and look at the list of streams.
2. Click **⬇** next to a stream. The button shows the progress; click it again to open the Offline section.
3. When it shows **✓**, the file is saved and plays without internet.

Downloads continue in the background while Stremio is open. Torrent downloads that were interrupted because Stremio
was closed continue the next time you open it.

### Watch offline

Open **Offline** in the sidebar:

- **Movies** — click a poster to play. **ⓘ** opens the normal Stremio page, **🗑** deletes a downloaded file
  (files from your own folders are never deleted).
- **Series** — each show is a folder card with the number of episodes. Open it to see the seasons and episodes you
  have and play any of them. Stremio continues to the next episode automatically.
- **Downloading** — progress, speed, pause, resume and delete for running downloads.

### Add your own folders or an external drive

**Offline → Settings → Library folders**

1. Pick a folder: use the shortcuts (Home, Videos/Movies, Downloads and connected drives), click through the
   folders, or use **Choose in system dialog…**.
2. Choose what is inside: **Auto**, **Movies** or **Series** (folders named `Movies`, `Filmy`, `Series`, `Shows`…
   are recognised automatically in Auto mode).
3. Click **Add this folder**. The folder is scanned and matched with Stremio's catalogue.

Names that work well:

```
Movies/Inception (2010)/Inception.2010.1080p.mkv
Movies/Inception (2010)/Inception.2010.1080p.en.srt      ← subtitles next to the video
Series/Dark/Season 1/Dark.S01E02.mkv
Series/Dark/dark 3x4.mkv
Series/Chernobyl/chernobyl 1.mkv                           ← "name + number" files in one folder = episodes
```

Titles that cannot be found in Stremio's catalogue (home videos, abbreviations) still play — they just show the file
name instead of a poster.

When you connect or disconnect a drive, the library updates by itself within a few seconds. **Rescan** is only needed
if you add files while the drive stays connected (otherwise it happens every 30 minutes).

### Choose where downloads are saved

**Offline → Settings → Downloads → Change…** — pick a folder (for example on your external HDD) and click
**Save downloads here**. **Use default** switches back.

If the chosen drive is not connected, downloads go to the default folder again and the page tells you so — choose the
drive again after you connect it. Videos you downloaded to a drive are hidden while it is disconnected and come back
when you plug it in. If you move downloaded files into one of your library folders, Offline Stremio notices it and
shows them from the library.

## Where things are stored

| | Linux | macOS |
|---|---|---|
| Downloads (default) | `~/Videos/Stremio` | `~/Movies/Stremio` |
| Helper data (lists, cache, posters) | `~/.local/share/stremio-offline` | `~/Library/Application Support/stremio-offline` |
| Logs | `journalctl --user -u stremio-offline` | `~/Library/Logs/offline-stremio.log`, `offline-stremio-agent.log` |

## Configuration

Environment variables (Linux: in `~/.config/systemd/user/stremio-offline.service`; macOS: in the agent's
`~/Library/LaunchAgents/community.offline-stremio.plist`). The defaults are fine for most people.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `11488` | helper port (Linux also uses `PORT + 1` for HTTPS) |
| `DOWNLOAD_DIR` | see table above | default download folder (a custom one is set in Offline → Settings) |
| `DATA_DIR` | see table above | where the helper keeps its data |
| `MAX_PARALLEL` | `2` | downloads at the same time |
| `IDLE_EXIT_MS` | `60000` | how long after Stremio closes the helper stops (0 = never) |

## Updating

```bash
git pull
bash install.sh          # Linux
bash install-macos.sh    # macOS
```

If you downloaded a ZIP, download the new one, replace the old folder's contents and run the installer again.
Then restart Stremio.

## Uninstall

```bash
bash uninstall.sh        # Linux
bash uninstall-macos.sh  # macOS
```

Quit Stremio and start it again — it is back to normal. Your downloaded videos and the helper data stay where they
are (see *Where things are stored*); delete them yourself if you want.

## Troubleshooting

**Stremio shows a blank window or an error.** The helper is not running.
- Linux: `systemctl --user status stremio-offline.socket stremio-offline.service` and
  `journalctl --user -u stremio-offline -n 50`. If you updated Node.js (for example with nvm), its path changed —
  run `bash install.sh` again.
- macOS: look at `~/Library/Logs/offline-stremio.log` and `offline-stremio-agent.log`.

**There is no "Offline" in the sidebar.** Quit Stremio completely (Linux: also from the tray; macOS: ⌘Q) and start it
again. On macOS try the fallback launcher (`bash install-macos.sh --launcher`).

**Torrent downloads are slow.** Stremio limits torrent speed with its torrent profile: Settings → Streaming →
**Torrent Profile** (choose a faster one).

**The whole Stremio window flickers when hovering on Linux.** This is a bug of Stremio's Linux app itself
(WebKitGTK, see stremio-linux-shell issues #61 and #67) and happens without Offline Stremio too.

**A drive is not found on macOS.** Allow *node* to access removable volumes in
System Settings → Privacy & Security → Files and Folders (or Full Disk Access).

**A title has no poster / the wrong one.** It could not be matched with Stremio's catalogue from the file name.
Rename the file like `Title (Year).mkv` or `Show S01E02.mkv` and click **Rescan**.

**YouTube streams and external links cannot be downloaded** — only torrents, HTTP/debrid links and HLS streams.

## Limitations

- Stremio loads its interface from the internet and changes it from time to time; an update can break parts of the
  Offline section until this project is updated.
- macOS support is not tested on real hardware yet. Windows is not supported yet.
- On macOS you have to log in to Stremio once more after installing.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) — architecture, file overview, how to run a development instance next to your
installed one, test tools (a Creative Commons test add-on and a fake library drive) and the Stremio quirks this
project works around.

## Credits & license

Inspired by [BurningSands70/stremio-downloader](https://github.com/BurningSands70/stremio-downloader), which worked with
the old Stremio 4 web interface in a separate window.

MIT License — see [LICENSE](LICENSE).
