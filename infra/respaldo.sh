#!/bin/sh
# Respaldo diario de la base. Conserva los últimos 14 archivos en /respaldos.
set -eu
while true; do
  archivo="/respaldos/transporte_$(date +%F).dump"
  pg_dump -h db -U transporte -Fc transporte > "$archivo"
  ls -1t /respaldos/transporte_*.dump | tail -n +15 | while read -r viejo; do
    rm -f -- "$viejo"
  done
  sleep 86400
done
