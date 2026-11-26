# Offline Stremio — poznámky pre vývoj

Čistý Node.js (≥ 20, ESM), žiadne npm závislosti. Komentáre v kóde sú po slovensky, texty v UI po anglicky.

## Architektúra

```
Stremio (flatpak, stremio-linux-shell: GTK4 + WebKitGTK + mpv)
   │  spustený s --url http://127.0.0.1:11470/proxy/d=https%3A%2F%2F127.0.0.1%3A11489/
   ▼     (prepísaný D-Bus súbor ~/.local/share/dbus-1/services/com.stremio.Stremio.service)
Stremio streaming server :11470  /proxy/d=<https cieľ>/…   ← origin stránky ostáva 127.0.0.1:11470
   ▼
server.js  (:11488 HTTP, :11489 HTTPS self-signed; systemd socket aktivácia, fd 3 = HTTP, fd 4 = HTTPS)
   ├─ /                 lib/proxy.js     proxy na web.stremio.com, do HTML vloží <script src=":11488/__dl/inject.js">,
   │                                     každú odpoveď uloží na disk (web-cache) → UI sa načíta aj offline
   ├─ /__dl/inject.js   public/inject.js klientsky skript v Stremiu (tlačidlá ⬇, menu „Offline“, stránka Offline)
   ├─ /__dl/api/…       server.js        API pre inject.js (sťahovanie, knižnica, prehliadanie priečinkov)
   ├─ /addon/…          lib/addon.js     Stremio addon: catalog, meta, stream, subtitles
   ├─ /files/<id>/…     lib/files.js     stiahnuté súbory (Range)
   ├─ /lib/<id>/…       lib/files.js     súbory z knižnice priečinkov (iba indexované)
   ├─ /libsub/<id>/<n>                   titulky vedľa videa
   └─ /img/<sha1>                        uložené plagáty/pozadia (offline)
```

Prečo cez proxy streaming servera: proxy `/proxy/d=` prijme iba HTTPS ciele (self-signed certifikát mu nevadí),
a vďaka nej stránka ostane na origine `127.0.0.1:11470` — rovnaký localStorage ako pôvodné Stremio,
takže prihlásenie, knižnica a addony ostanú. Shell vkladá svoj IPC skript (mpv) do každej stránky, preto prehrávač funguje.

## Súbory

| súbor | čo robí |
|---|---|
| `server.js` | HTTP/HTTPS server, routing, API, CORS (UI z originu Stremia), automatické vypnutie |
| `lib/config.js` | porty, cesty, env premenné |
| `lib/proxy.js` | proxy web UI + vloženie skriptu + diskový cache |
| `lib/playerLink.js` | dekódovanie `#/player/{stream}/…` (base64(zlib(JSON)) zo stremio-core) |
| `lib/downloads.js` | správca sťahovania: torrent cez `:11470/{hash}/{idx}`, HTTP s Range, HLS cez ffmpeg |
| `lib/library.js` | knižnica priečinkov: prehľadanie, parsovanie názvov, párovanie s Cinemetou |
| `lib/metas.js` | uložené meta a obrázky pre offline |
| `lib/addon.js` | Stremio addon + dáta pre stránku Offline (playerHref, detailHref) |
| `lib/fsbrowse.js` | zoznam priečinkov a systémový výber (zenity) |
| `lib/files.js` | servovanie súborov s Range |
| `lib/store.js` | JSON úložisko s atomickým zápisom |
| `lib/settings.js` | nastavenie priečinka na sťahovanie (`settings.json`), návrat na predvolený pri odpojenom disku |
| `lib/tls.js` | self-signed certifikát (openssl) |
| `public/inject.js` | celé UI v Stremiu (vanilla JS + CSS v jednom súbore) |
| `install.sh` / `uninstall.sh` | systemd socket + služba, D-Bus override |
| `dev/` | nástroje na vývoj (nižšie) |

Dáta: `~/.local/share/stremio-offline/` — `downloads.json`, `library.json`, `settings.json`, `meta/`, `img/`, `web-cache/`, `tls/`, `addon-seen`.

## Ako sa robí vývoj

```bash
# vývojová inštancia na portoch 11590/11591 s vlastnými dátami (nainštalovaná verzia beží ďalej)
npm run dev
# testovací addon s Creative Commons streamami (Sintel torrent, Big Buck Bunny HTTP + HLS)
npm run test-addon
# falošný HDD s malými videami (filmy, seriály, titulky, nezhodné domáce video)
npm run test-library
```

Potom otvor URL, ktorú vypíše `npm run dev`, v prehliadači (Stremio musí bežať kvôli `:11470`).
V tom profile prehliadača nainštaluj `http://127.0.0.1:11499/manifest.json` (CC streamy) a v Offline → Folders pridaj
`/tmp/offline-stremio-test-hdd/Movies` a `…/Series`.

`public/inject.js` sa číta z disku pri každej požiadavke — stačí obnoviť stránku. Zmeny v `lib/` a `server.js`
vyžadujú reštart (`systemctl --user restart stremio-offline.service` pre nainštalovanú verziu).

Logy: `journalctl --user -u stremio-offline.service -f`.

Užitočné na testovanie automatického vypnutia (simulácia socket aktivácie a zatvoreného Stremia):

```bash
STREAMING_SERVER=http://127.0.0.1:9 IDLE_EXIT_MS=6000 PORT=11590 DATA_DIR=/tmp/x \
  systemd-socket-activate -l 127.0.0.1:11590 -l 127.0.0.1:11591 \
  -E STREAMING_SERVER -E IDLE_EXIT_MS -E PORT -E DATA_DIR node server.js
```

## Záludnosti Stremia 5 (web UI), na ktoré sme narazili

- **Navigácia cez `history.pushState`** — nevyvolá `hashchange`. `inject.js` preto obaľuje pushState/replaceState
  (`watchRoute`) a má aj poistku každých 500 ms.
- **Triedy sú CSS moduly s hashom** (`nav-tab-button-tW6qT`) a menia sa s každým buildom → selektory vždy cez
  `[class*="vertical-nav-bar"]` a podobne.
- **Nemeniť triedy na prvkoch, ktoré spravuje React** (napr. `selected` v menu) — React ich nemusí vrátiť.
  Zvýraznenie potláčame CSS-kom cez triedu na `<html>` (`sdl-offline-open`).
- **Stránka Offline je na trase `#/?offline=1`** (Board s parametrom), lebo pri neznámej trase Stremio zobrazí
  „Page not found“ bez menu. `#/downloads` patrí natívnemu downloaderu Stremia (iba pre platené Supporter účty — nemeniť).
- **Board so Spotlight bannerom** presvitá cez priehľadné menu → `nav-content-container` Boardu pri otvorenej stránke
  Offline vypíname cez `display:none` (`visibility` si potomkovia prepíšu a pri `opacity` karusel pod stránkou
  ďalej animuje a WebKit prekresľuje).
- **WebKitGTK blikanie pri hoveri:** prechodové animácie `opacity`/`outline` na hover vytvoria a zrušia grafickú
  vrstvu → dve bliknutia. Hover efekty sú preto okamžité (bez `transition`), rámik plagátu cez `box-shadow`.
  Zabudovaný prehliadač na testovanie je Chromium, takže toto sa dá overiť iba v samotnej appke.
- **Blikanie celej appky pri hoveri/scrollovaní** je chyba samotného Stremia pre Linux (WebKitGTK,
  stremio-linux-shell #61, #67), nie tohto projektu. `install.sh` vie pridať premenné cez `STREMIO_ENV`
  (predvolene žiadne). Vyskúšané na Intel Iris Xe + RTX 3050: `WEBKIT_DISABLE_DMABUF_RENDERER=1` → extrémne sekanie
  a čierne/miznúce časti UI, preto sa nepoužíva.
  Analýza screencastu (snímka po snímke): pri hoveri sa v oblasti plagátu na jednu snímku vráti starší obsah
  (zelená ikona → sivá → zelená), t. j. displej ukáže zastaraný buffer len v časti okna. Kandidát:
  `STREMIO_ENV="GDK_DISABLE=offload" ./install.sh` (GTK neposiela obraz WebKitu cez samostatnú subsurface,
  zloží ho sám; hardvérové vykresľovanie ostáva). Výsledok: blikanie ostalo, vrátené. Nechávame pôvodné spúšťanie. Wrapper `/app/bin/stremio` pri `/dev/nvidia0` sám nastaví
  `GSK_RENDERER=opengl`, takže túto premennú cez `--env` prepísať nejde (len obídením wrappera).
- **Tlačidlo play** kopíruje štandard Stremia z plagátov: 56 px kruh, `rgba(12,11,17,.4)`, vnútorný okraj
  2.1 px `rgba(255,255,255,.9)`, ikona 32 px zo stremio-icons (optické posunutie je v tvare, nie v `margin`).
- **Úzke okno (< 640 px):** bočné menu sa stane lištou dole → `placePage()` počíta polohu z oboch líšt.
- **Globálne `overflow: hidden`** v CSS Stremia — vlastné kontajnery, ktoré majú presahovať, treba povoliť.
- **`requestAnimationFrame` v skrytom okne nebeží** → MutationObserver plánuje cez `setTimeout`.
- **Odkaz na stream** `#/player/{enc}/{streamTransportUrl}/{metaTransportUrl}/{type}/{id}/{videoId}`;
  trailer má len `{enc}`. Pole `sources` z addonu je v serializovanom streame ako `announce`.
- **Meta pre id** Stremio pýta od všetkých addonov a zobrazí prvé hotové v poradí addonov (Cinemeta býva prvá).
- Streaming server vie aj `GET /{hash}/{idx}?external=1&download=1` (súbor ako príloha) a torrent si vytvorí sám.

## Priečinok na sťahovanie

- `settings.downloadDir()` sa volá pri štarte sťahovania, pri `/info` (stránka Settings sa obnovuje každých 1,5 s)
  a pri štarte servera. Ak vlastný priečinok neexistuje alebo nie je zapisovateľný, nastavenie sa zmaže
  (= predvolený) a uloží sa vysvetlenie — používateľ chcel po pripojení HDD vyberať priečinok ručne.
- Rozpracované sťahovanie má cestu pevne v `item.file`; pri odpojenom disku skončí chybou a po pripojení sa dá obnoviť.
- Stiahnuté položky na odpojenom disku majú `available: false` (stav sa nemení na chybu); addon ich nevracia.
  `missing` rozlišuje `disconnected` (prvý existujúci nadradený priečinok je `/run/media/<user>`, `/media/<user>`,
  `/mnt`…) a `moved` (disk je pripojený, súbor presunutý/zmazaný mimo Stremia).
- Presunuté stiahnuté súbory: po každom prehľadaní knižnice `downloads.adoptMoved()` nájde súbor s rovnakým názvom
  a veľkosťou v knižnici a zruší záznam o sťahovaní (súbory sa nemenia) — titul sa ďalej zobrazuje z knižnice.
  Nenájdené presunuté súbory ponúkne stránka Offline odstrániť zo zoznamu (`POST /__dl/api/downloads/forget-moved`).
- Knižnica priečinkov preskočí súbory spravované sťahovaním (`library.setExclude`), aby sa neukázali dvakrát.

## Knižnica priečinkov

- Pripojenie/odpojenie disku: `checkMounts()` každých 5 s porovná podpis priečinkov (`dev:ino` alebo `missing`);
  pri zmene spustí `scanAll()`. Počas prehľadávania sa zmena zaradí (`rescanPending`).
- Prázdny priečinok na inom zariadení ako pri poslednom prehľadaní = prázdny bod pripojenia → `available: false`,
  súbory sa nezahodia.
- `effectiveKind()`: typ Auto podľa názvu priečinka; `parseAll()`: súrodenci s číslom na konci → epizódy.
- Názvy v tvare `dva-a-pul-chlapa-s05e04-2003` (pomlčky namiesto medzier) sa čítajú ako slová; rok sa pri epizódach
  hľadá v celom názve súboru. Cinemeta hľadá aj podľa lokálnych názvov a rok rozhodne o zhode.
- Nespárované súbory sa pri každom prehľadaní skúsia znova (výsledky vyhľadávania sú v `library.json → matches`,
  neúspešné sa opakujú najskôr po 24 h).
- Cinemeta nenájde všetko (napr. slovenský seriál „Profesionáli“, skratky ako „AOT“) — také tituly ostanú lokálne
  (`local:` id) a hrajú sa s názvom zo súboru.

## Nápady na ďalšiu prácu

- Ručné priradenie titulu pre nespárované položky (vyhľadať v Stremiu alebo vložiť IMDb id).

- **Verzia pre Windows/macOS bez zásahu do Stremia:** rovnaký server ako lokálny addon + malá aplikácia v lište
  (ako streaming server Stremia). Fungovalo by: vlastné priečinky/HDD, sťahovanie (položky „⬇ Save offline“
  v zozname streamov, zdrojový addon sa zadá v nastaveniach), katalógy „Offline“, prehrávanie offline.
  Nefungovalo by: položka v menu a štart UI bez internetu (to vyžaduje zmenu spúšťania Stremia).
  Pri prístupe z `https://web.stremio.com` na `127.0.0.1` treba odpovedať aj na Private Network Access preflight
  (`Access-Control-Allow-Private-Network: true`). Na Windows/Mac netestované.
- **Čisto online addon „⬇ Download“** (bez inštalácie): streamy s `externalUrl` na `:11470/{hash}/{idx}?external=1&download=1`
  alebo debrid URL → stiahne prehliadač; prehrávanie potom cez vstavaný „Local files“ addon Stremia
  (Windows Search / Spotlight / na Linuxe iba domovský priečinok).
- Lokálne (CZ/SK) názvy titulov namiesto anglických z Cinemety.
- Čistenie `web-cache` od starých buildov web UI.
