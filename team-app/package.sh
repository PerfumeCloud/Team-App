#!/usr/bin/env bash
# Baut das Upload-Paket für netcup: team-app/build/
#   build/public   → Dokumentenstamm der Subdomain (App + api.php)
#   build/app      → PHP-Code (nicht öffentlich)
#   build/storage  → Daten/Logs (nicht öffentlich)
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${SKIP_WEB_BUILD:-0}" != "1" ]]; then
  (cd web && npm ci --no-audit --no-fund && npm run build)
fi

rm -rf build
mkdir -p build/public build/storage
cp -R server/app build/app
cp server/public/api.php server/public/.htaccess build/public/
cp -R web/dist/. build/public/
printf 'Require all denied\n' > build/storage/.htaccess
printf 'Require all denied\n' > build/app/.htaccess

echo "Fertig: $(pwd)/build"
