#!/usr/bin/env bash
# Assembles the upload tree for shared hosting:
#   <out>/public_html/God/   ← front controller, .htaccess, pre-rendered site, Mini App (app/)
#   <out>/millerenos/src/    ← PHP code (outside the web root)
# Usage: assemble.sh <rendered-site-dir> <miniapp-dist-dir> <out-dir> [base-dir-name]
set -euo pipefail
SITE="$1"; MINI="$2"; OUT="$3"; BASE="${4:-God}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$OUT"
mkdir -p "$OUT/public_html/$BASE/app" "$OUT/millerenos/src" "$OUT/millerenos/config"
cp -R "$SITE"/. "$OUT/public_html/$BASE/"
cp "$HERE/public/index.php" "$HERE/public/.htaccess" "$OUT/public_html/$BASE/"
sed -i "s#ErrorDocument 404 /God/404.html#ErrorDocument 404 /$BASE/404.html#" "$OUT/public_html/$BASE/.htaccess"
cp -R "$MINI"/. "$OUT/public_html/$BASE/app/"
cp "$HERE/public/app-htaccess/.htaccess" "$OUT/public_html/$BASE/app/.htaccess"
cp "$HERE"/src/*.php "$HERE/src/i18n.json" "$OUT/millerenos/src/"
printf 'Require all denied\n' > "$OUT/millerenos/.htaccess"
echo "assembled into $OUT"
