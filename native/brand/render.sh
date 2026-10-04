#!/usr/bin/env bash
# Renders the Play Store assets from the brand sources with headless Chromium.
#   store/icon-512.png                 the store listing icon (Play adds its own rounding)
#   store/feature-graphic-1024x500.png the store listing feature graphic
# Needs a Chromium binary: pass it as $CHROME, or have `chromium` on the PATH.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${CHROME:-$(command -v chromium || command -v chromium-browser || command -v google-chrome)}"
mkdir -p ../store
shot() { "$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size="$2" --screenshot="$3" "file://$PWD/$1" 2>/dev/null; }
# The listing icon is the launcher art zoomed a little: Play only rounds the corners, so the safe-zone margin can shrink.
printf '<html><body style="margin:0"><div style="width:512px;height:512px;overflow:hidden"><img src="icon.svg" style="display:block;width:640px;height:640px;margin:-64px"></div></body></html>' > .icon-512.html
shot .icon-512.html 512,512 ../store/icon-512.png
shot feature-graphic.html 1024,500 ../store/feature-graphic-1024x500.png
rm -f .icon-512.html
echo "wrote store/icon-512.png and store/feature-graphic-1024x500.png"
