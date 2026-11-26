#!/usr/bin/env bash
# Odinštalovanie — vráti Stremio na pôvodné spúšťanie; stiahnuté súbory a dáta ostanú
set -euo pipefail

[[ "$(uname)" == "Linux" ]] || { echo "This script is for Linux. On macOS use ./uninstall-macos.sh" >&2; exit 1; }

systemctl --user disable --now stremio-offline.socket 2>/dev/null || true
systemctl --user stop stremio-offline.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/stremio-offline.socket" "$HOME/.config/systemd/user/stremio-offline.service"
rm -f "$HOME/.local/share/dbus-1/services/com.stremio.Stremio.service"
systemctl --user daemon-reload
gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.ReloadConfig >/dev/null 2>&1 || true

echo "Uninstalled. Downloads stay in ~/Videos/Stremio, data in ~/.local/share/stremio-offline."
echo "Quit Stremio completely and start it again."
