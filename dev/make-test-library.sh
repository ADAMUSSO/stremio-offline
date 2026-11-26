#!/usr/bin/env bash
# Vytvorí falošný "HDD" s malými testovacími videami (3 s) na skúšanie knižnice priečinkov:
# filmy (aj generický názov, český názov, domáce video bez zhody), seriály (Season / Séria priečinky) a titulky.
# Použitie: dev/make-test-library.sh [cieľový priečinok]   (predvolene /tmp/offline-stremio-test-hdd)
set -euo pipefail

ROOT="${1:-/tmp/offline-stremio-test-hdd}"
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }

rm -rf "$ROOT"
mkdir -p "$ROOT/Movies/Inception (2010)" "$ROOT/Movies/Matrix" \
    "$ROOT/Series/Silicon Valley/Season 2" "$ROOT/Series/Silicon Valley/Season 3" \
    "$ROOT/Series/South Park/Séria 3" "$ROOT/Series/Two and a Half Men"

TINY="$(mktemp --suffix=.mkv)"
ffmpeg -v error -f lavfi -i testsrc=duration=3:size=320x240:rate=25 -f lavfi -i sine=duration=3 \
    -shortest -c:v libx264 -c:a aac -y "$TINY"

for f in \
    "Movies/Inception (2010)/Inception.2010.1080p.BluRay.x264-SPARKS.mkv" \
    "Movies/Pelíšky (1999) CZ dabing.mkv" \
    "Movies/Matrix/movie.mkv" \
    "Movies/Moja dovolenka v Tatrách 2023.mkv" \
    "Series/Silicon Valley/Season 2/Silicon.Valley.S02E05.1080p.mkv" \
    "Series/Silicon Valley/Season 2/Silicon.Valley.S02E06.1080p.mkv" \
    "Series/Silicon Valley/Season 3/Silicon.Valley.S03E01.1080p.mkv" \
    "Series/South Park/Séria 3/05 - Chinpokomon.mkv" \
    "Series/Two and a Half Men/Two.and.a.half.men.S06E05.720p.mkv"; do
    cp "$TINY" "$ROOT/$f"
done
rm -f "$TINY"

printf '1\n00:00:00,500 --> 00:00:02,500\nTestovacie titulky\n' > "$ROOT/Movies/Inception (2010)/Inception.2010.1080p.BluRay.x264-SPARKS.sk.srt"

echo "Test library created in $ROOT"
find "$ROOT" -type f | sort
