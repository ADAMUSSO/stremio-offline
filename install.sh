#!/usr/bin/env bash
# Inštalácia Stremio Offline
#  1. systemd user socket + služba (server sa spustí až keď ho Stremio prvýkrát zavolá)
#  2. prepísanie D-Bus aktivácie Stremia (flatpak), aby načítal UI cez náš server (--url)
#     URL ide cez proxy streaming servera Stremia → rovnaký origin ako doteraz, prihlásenie ostane
# Všetko je na úrovni používateľa a dá sa vrátiť cez ./uninstall.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(readlink -f "$(command -v node || true)" 2>/dev/null || true)"
PORT="${PORT:-11488}"
HTTPS_PORT="$((PORT + 1))"
APP_URL="http://127.0.0.1:11470/proxy/d=https%3A%2F%2F127.0.0.1%3A${HTTPS_PORT}/"
# Voliteľné premenné prostredia pre Stremio (medzerou oddelené), predvolene žiadne.
# Pozor: WEBKIT_DISABLE_DMABUF_RENDERER=1 na notebooku Intel + NVIDIA spôsobil extrémne sekanie a miznúce časti UI.
# Príklad: STREMIO_ENV="NAZOV=hodnota" ./install.sh
STREMIO_ENV="${STREMIO_ENV-}"
ENV_ARGS=""
for kv in $STREMIO_ENV; do ENV_ARGS+="--env=$kv "; done
UNIT_DIR="$HOME/.config/systemd/user"
DBUS_DIR="$HOME/.local/share/dbus-1/services"

[[ -x "$NODE" ]] || { echo "node not found in PATH" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl not found" >&2; exit 1; }
flatpak info com.stremio.Stremio >/dev/null 2>&1 || { echo "Stremio flatpak (com.stremio.Stremio) is not installed" >&2; exit 1; }

mkdir -p "$UNIT_DIR" "$DBUS_DIR"

# poradie ListenStream = fd 3 (HTTP), fd 4 (HTTPS)
cat > "$UNIT_DIR/stremio-offline.socket" <<EOF
[Unit]
Description=Stremio Offline sockets

[Socket]
ListenStream=127.0.0.1:$PORT
ListenStream=127.0.0.1:$HTTPS_PORT

[Install]
WantedBy=sockets.target
EOF

cat > "$UNIT_DIR/stremio-offline.service" <<EOF
[Unit]
Description=Stremio Offline (downloads and offline playback for Stremio)
Requires=stremio-offline.socket
After=stremio-offline.socket

[Service]
ExecStart=$NODE $DIR/server.js
Environment=PORT=$PORT HTTPS_PORT=$HTTPS_PORT
Restart=on-failure
RestartSec=3
EOF

# Stremio sa spúšťa D-Bus aktiváciou; súbor v ~/.local/share má prednosť pred tým z flatpaku
cat > "$DBUS_DIR/com.stremio.Stremio.service" <<EOF
[D-BUS Service]
Name=com.stremio.Stremio
Exec=/usr/bin/flatpak run --branch=stable --arch=x86_64 ${ENV_ARGS}--command=/app/bin/stremio com.stremio.Stremio --url $APP_URL --gapplication-service
EOF

systemctl --user daemon-reload
# D-Bus si načíta nový .service súbor
gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.ReloadConfig >/dev/null 2>&1 || true
systemctl --user stop stremio-offline.service 2>/dev/null || true
systemctl --user enable --now stremio-offline.socket

echo "Installed."
echo "  Stremio UI:  $APP_URL"
echo "  add-on:      http://127.0.0.1:$PORT/addon/manifest.json"
echo "  status:      systemctl --user status stremio-offline.socket stremio-offline.service"
[[ -n "$STREMIO_ENV" ]] && echo "  Stremio env: $STREMIO_ENV"
echo
echo "Quit Stremio completely (also from the tray) and start it again."
