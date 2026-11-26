#!/bin/bash
# Agent Offline Stremio pre macOS — spúšťa ho launchd pri prihlásení (LaunchAgent, viď install-macos.sh)
#  1. nastaví WEBUI_URL pre aplikácie spúšťané z Docku/Findera → bežná ikona Stremia načíta rozhranie
#     s funkciami Offline (Stremio 5 pre macOS číta --webui-url aj z premennej WEBUI_URL)
#  2. keď beží Stremio a nebeží pomocník, spustí ho; pomocník sa sám vypne asi minútu po zatvorení Stremia
# macOS nevie spustiť pomocníka až pri prvom pripojení (ako systemd na Linuxe), preto tento malý strážca.

NODE="${OFFLINE_STREMIO_NODE:?missing OFFLINE_STREMIO_NODE}"
DIR="${OFFLINE_STREMIO_DIR:?missing OFFLINE_STREMIO_DIR}"
EXE="${STREMIO_EXE:-/Applications/Stremio.app/Contents/MacOS/Stremio}"
PORT="${PORT:-11488}"
LOG="${OFFLINE_STREMIO_LOG:-$HOME/Library/Logs/offline-stremio.log}"

launchctl setenv WEBUI_URL "http://127.0.0.1:$PORT/"

helper_up() { curl -sf -m 1 "http://127.0.0.1:$PORT/__dl/health" >/dev/null; }
stremio_up() { pgrep -f "$EXE" >/dev/null; }

while true; do
    if stremio_up; then
        if ! helper_up; then
            IDLE_EXIT=1 PORT="$PORT" "$NODE" "$DIR/server.js" >>"$LOG" 2>&1 &
            for _ in $(seq 25); do helper_up && break; sleep 0.2; done
        fi
        sleep 3
    else
        sleep 1
    fi
done
