# Offline Stremio

Sťahovanie a offline prehrávanie priamo v aplikácii Stremio 5 (Linux flatpak `com.stremio.Stremio` 1.2+), s akýmkoľvek účtom.
Inšpirované [BurningSands70/stremio-downloader](https://github.com/BurningSands70/stremio-downloader), ktorý funguje iba so starým web UI v4 v samostatnom okne.

> **English summary:** a small local helper for the Linux (flatpak) Stremio 5 app. It adds a download button next to every
> stream, an "Offline" section in Stremio's sidebar (downloads plus movies and series from your own folders/HDD, matched
> with Cinemeta), offline playback in Stremio's player and an offline-capable UI. Install with `./install.sh`, remove with
> `./uninstall.sh`. Developer notes are in [DEVELOPMENT.md](DEVELOPMENT.md).

Vývoj a architektúra: [DEVELOPMENT.md](DEVELOPMENT.md).

**Požiadavky:** Linux so Stremiom z Flathubu (`com.stremio.Stremio`), Node.js 20+, `openssl`, voliteľne `ffmpeg` (HLS streamy)
a `zenity` (systémové okno na výber priečinka). Bez externých npm balíkov.

## Čo pribudne v Stremiu

- **⬇ pri každom streame** v detaile filmu/epizódy: klik spustí sťahovanie, tlačidlo ukazuje percentá a potom ✓.
- **Položka „Offline“ v bočnom menu** (pod Library): rozpracované sťahovania (pauza, pokračovanie, mazanie),
  sekcie **Movies** a **Series** (stiahnuté aj z priečinkov na disku spolu). Klik na plagát filmu ho prehrá
  v prehrávači Stremia, aj bez internetu. Epizódy jedného seriálu sú spolu v „priečinku“ s plagátom seriálu;
  po otvorení sa ukážu len série, v ktorých nejaká epizóda je.
- **Priečinky z disku/HDD** (Offline → Folders): vyber priečinok (skratky Home, Videos, pripojené disky
  z `/media`, `/mnt`, alebo systémové okno), typ Auto / Movies / Series. Súbory sa rozpoznajú podľa názvu
  (`Názov.2010.1080p…`, `S01E02`, `1x02`, priečinky „Season 2“ / „Séria 2“) a spárujú s Cinemetou
  (plagát, popis, názvy epizód; funguje aj s českými/slovenskými názvami ako Pelíšky, Kolja).
  Titulky vedľa videa (`Film.sk.srt`) sa ponúknu v prehrávači. Súbory sa iba čítajú — nič sa nepresúva ani nemaže.
  Odpojený disk sa ukáže ako „Not connected“ a jeho filmy sa vrátia po pripojení; priečinky sa prehľadávajú
  pri štarte a každých 30 minút (alebo tlačidlom Rescan).
- **Addon „Offline Downloads“** (voliteľný, inštalácia jedným klikom zo stránky Offline): riadok „Offline“ na Boarde
  a stream `💾 Offline` v zozname streamov pri titule.
- **Štart bez internetu**: web UI Stremia sa ukladá na disk, takže appka sa načíta aj offline.

Prihlásenie, knižnica, addony a nastavenia ostávajú — UI beží na rovnakom origine ako doteraz.

## Ako to funguje

```
Stremio (GTK/WebKit shell, mpv)
   │  --url http://127.0.0.1:11470/proxy/d=https://127.0.0.1:11489/
   ▼
Stremio streaming server :11470 (/proxy)  ── origin ostáva 127.0.0.1:11470
   ▼
offline-stremio pomocník (node, :11488 HTTP + :11489 HTTPS, systemd socket aktivácia)
   ├─ /            proxy na web.stremio.com + vložený inject.js, odpovede sa ukladajú na disk
   ├─ /__dl/api    správca sťahovania a knižnice priečinkov
   ├─ /lib         súbory z priečinkov knižnice (iba prehľadané súbory)
   ├─ /addon       Stremio addon: katalóg, meta z cache, stream "💾 Offline"
   └─ /files       stiahnuté súbory s podporou Range (pretáčanie)
   │
   ▼  torrenty
Stremio streaming server (127.0.0.1:11470/{infoHash}/{fileIdx})
```

- Linux shell Stremia má prepínač `--url` a IPC pre mpv vkladá do každej stránky.
- Proxy streaming servera vie iba HTTPS (self-signed certifikát akceptuje), preto druhý port 11489 s certifikátom z `openssl`.
- Odkaz na stream (`#/player/...`) je base64(zlib(JSON)) zo stremio-core; server z neho vyčíta torrent / URL.
- Torrent cez streaming server Stremia, HTTP/debrid priamo (pokračuje cez Range), HLS cez `ffmpeg -c copy` do `.mkv`.
- Keď sa Stremio zavrie počas sťahovania torrentu, sťahovanie počká a po ďalšom spustení pokračuje.
- Pomocník sa spustí, až keď ho Stremio zavolá (systemd socket). Keď je Stremio zatvorené a nič sa nesťahuje,
  neprehráva ani neprehľadáva, po minúte sa sám vypne (`IDLE_EXIT_MS`, 0 = nikdy).

## Inštalácia / odinštalovanie

```bash
./install.sh
```

```bash
./uninstall.sh
```

Po oboch treba Stremio úplne ukončiť (aj z tray) a spustiť znova. Odinštalovanie nechá súbory v `~/Videos/Stremio`.
Ak sa zmení cesta k `node` (napr. iná verzia v nvm), spusti `./install.sh` znova.

## Nastavenia (env premenné v `~/.config/systemd/user/stremio-offline.service`)

| premenná | predvolené |
|---|---|
| `PORT` / `HTTPS_PORT` | `11488` / `11489` |
| `DOWNLOAD_DIR` | `~/Videos/Stremio` |
| `DATA_DIR` | `~/.local/share/stremio-offline` |
| `MAX_PARALLEL` | `2` |

Pre samotné Stremio: `STREMIO_ENV` pri inštalácii (predvolené `WEBKIT_DISABLE_DMABUF_RENDERER=1`) — WebKitGTK v Stremiu
pre Linux pri hoveri/scrollovaní bliká (stremio-linux-shell #61, #67), najmä na notebookoch s NVIDIA. Ak by stále blikalo,
skús iný variant a Stremio potom úplne reštartuj:

```bash
STREMIO_ENV="WEBKIT_DMABUF_RENDERER_FORCE_SHM=1" ./install.sh
```

```bash
STREMIO_ENV="WEBKIT_SKIA_ENABLE_CPU_RENDERING=1" ./install.sh
```

Bez úprav: `STREMIO_ENV="" ./install.sh`.

## Poznámky

- Projekt sa volá `offline-stremio`; technické názvy ostali `stremio-offline` (systemd služba, priečinok dát,
  id addonu `community.stremio-offline`), aby sa pri premenovaní nerozbili existujúce inštalácie.

- Stremio má aj vlastný natívny downloader (`#/downloads`), ale iba pre platené „Supporter“ účty a bez offline štartu UI.
  Tento projekt ho neodomyká ani nemení — je to samostatný downloader.
- Addon sa synchronizuje do účtu; na iných zariadeniach (mobil, TV) bude nedostupný (`127.0.0.1` je tam iné zariadenie).
- Rýchlosť torrentov obmedzuje torrent profil v Stremiu (Settings → Streaming; predvolený ~3,5 MB/s).
- YouTube streamy a externé odkazy sa sťahovať nedajú.
