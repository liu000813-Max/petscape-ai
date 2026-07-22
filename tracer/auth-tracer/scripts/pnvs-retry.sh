#!/usr/bin/env bash
# Retry PNVS real-send up to 6 times, 5 min apart, until the product is opened.
# Uses dummy sign/template ONLY to detect subscription state; once opened, swap in
# the real PNVS_SIGN_NAME / PNVS_TEMPLATE_CODE from the console for a real send.
set -u
cd "$(dirname "$0")/.."
PHONE="${1:-}"
SIGN="${PNVS_SIGN_NAME:-PetScape}"
TMPL="${PNVS_TEMPLATE_CODE:-SMS_000000}"
MAX=6
if [ -z "$PHONE" ]; then
  echo "usage: $0 <test-phone>" >&2
  exit 2
fi
for i in $(seq 1 $MAX); do
  echo "=== attempt $i/$MAX $(date '+%H:%M:%S') ==="
  OUT=$(node scripts/pnvs-send.mjs "$PHONE" "$SIGN" "$TMPL" 2>&1)
  echo "$OUT" | grep -E "PNVS-(RESP|ERR|OK|NOT|REJ)"
  if echo "$OUT" | grep -q "PNVS-OK"; then
    echo "RESULT: PNVS opened + send accepted on attempt $i"
    exit 0
  fi
  if echo "$OUT" | grep -qE "PNVS-REJECTED"; then
    # A non-subscription rejection (e.g. sign/template invalid) means product IS open.
    echo "RESULT: product appears OPEN (rejection is config-level, not subscription) on attempt $i"
    exit 0
  fi
  if [ "$i" -lt "$MAX" ]; then
    echo "still not opened; sleeping 300s..."
    sleep 300
  fi
done
echo "RESULT: PNVS still not opened after $MAX attempts"
exit 3
