#!/usr/bin/env bash
# Push test fixture files to the connected Android emulator / device.
# Run this once before the Maestro E2E flow.
#
# Usage:
#   bash scripts/push-fixtures.sh [SERIAL]
#
# SERIAL is optional; if omitted, adb uses the only connected device.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/../test-fixtures"
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"

if [ ! -f "$FIXTURES_DIR/lorem-ipsum.epub" ]; then
  echo "❌  Fixtures not found. Run first:"
  echo "       node scripts/generate-fixtures.mjs"
  exit 1
fi

SERIAL_FLAG=""
if [ -n "${1:-}" ]; then
  SERIAL_FLAG="-s $1"
fi

# Push to /sdcard/Download/ — accessible via the system file picker
echo "Pushing fixtures to /sdcard/Download/ …"
$ADB $SERIAL_FLAG push "$FIXTURES_DIR/lorem-ipsum.epub"  /sdcard/Download/
$ADB $SERIAL_FLAG push "$FIXTURES_DIR/track-01.wav"      /sdcard/Download/
$ADB $SERIAL_FLAG push "$FIXTURES_DIR/track-02.wav"      /sdcard/Download/
$ADB $SERIAL_FLAG push "$FIXTURES_DIR/track-03.wav"      /sdcard/Download/

# Broadcast so the MediaStore picks them up and they appear in file pickers
$ADB $SERIAL_FLAG shell am broadcast \
  -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
  -d file:///sdcard/Download/lorem-ipsum.epub  >/dev/null 2>&1 || true

echo "✓  Done. Files are available in the Downloads folder on the device."
