#!/usr/bin/env bash
# Arma el paquete que se publica en Azure App Service (una sola carpeta, misma estructura que el repositorio):
#   api/dist (API compilada) · web/dist (app) · db/migrations · node_modules (solo dependencias de la API)
# Uso: npm ci && npm run build && scripts/empaquetar.sh paquete.zip
set -euo pipefail
salida="${1:-paquete.zip}"
raiz="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/api" "$tmp/web"
cp "$raiz/package.json" "$raiz/package-lock.json" "$tmp/"
cp "$raiz/api/package.json" "$tmp/api/"
cp "$raiz/web/package.json" "$tmp/web/"
(cd "$tmp" && npm ci --omit=dev -w api --no-audit --no-fund --ignore-scripts)
cp -r "$raiz/api/dist" "$tmp/api/dist"
cp -r "$raiz/web/dist" "$tmp/web/dist"
# Los enlaces de los workspaces no hacen falta en el servidor.
rm -f "$tmp/node_modules/api" "$tmp/node_modules/web"
mkdir -p "$tmp/db" && cp -r "$raiz/db/migrations" "$tmp/db/migrations"

rm -f "$salida"
(cd "$tmp" && zip -qr - .) > "$salida"
echo "Paquete listo: $salida ($(du -h "$salida" | cut -f1))"
