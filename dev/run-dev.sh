#!/usr/bin/env bash
# Vývojová inštancia vedľa nainštalovanej: iné porty (11590/11591) a vlastné dáta,
# takže tvoje skutočné sťahovania ani knižnica sa nemenia. Vyžaduje bežiaci Stremio (streaming server 11470).
# Otvor vypísanú URL v prehliadači — načíta Stremio web UI s touto verziou inject.js.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
export PORT="${PORT:-11590}"
export DATA_DIR="${DATA_DIR:-/tmp/offline-stremio-dev/data}"
export DOWNLOAD_DIR="${DOWNLOAD_DIR:-/tmp/offline-stremio-dev/videos}"
mkdir -p "$DATA_DIR" "$DOWNLOAD_DIR"

echo "Open in a browser: http://127.0.0.1:11470/proxy/d=https%3A%2F%2F127.0.0.1%3A$((PORT + 1))/#/?offline=1"
echo "Data: $DATA_DIR   Downloads: $DOWNLOAD_DIR"
exec node "$DIR/server.js"
