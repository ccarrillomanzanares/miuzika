#!/bin/sh
# Renders site/og-card.html to site/og.png (1200x630), the preview image that
# X, LinkedIn, WhatsApp, Telegram and Slack show for ccmai.org/miuzika/.
# They don't render SVG, hence a PNG. Needs a Chromium/Chrome binary; set
# CHROME=/path/to/chrome if it is not on PATH.
set -e
cd "$(dirname "$0")/.."
CHROME="${CHROME:-$(command -v chromium || command -v chromium-browser || command -v google-chrome || ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | tail -n1)}"
[ -x "$CHROME" ] || { echo "Chromium not found; set CHROME=/path/to/chrome" >&2; exit 1; }
"$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1200,630 --virtual-time-budget=5000 \
  --screenshot="$PWD/site/og.png" "file://$PWD/site/og-card.html"
echo "site/og.png written"
