#!/usr/bin/env bash
# Compile mask_pay to the WSL-native disk first, then copy it into build/.
# The Windows mount drops writes under heavy load (EIO), and a partial compile
# there leaves a build that looks finished.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=/tmp/mask_pay_build
rm -rf "$OUT"
compact compile +0.31.1 src/mask_pay.compact "$OUT"
rm -rf build/mask_pay
mkdir -p build
cp -r "$OUT" build/mask_pay
echo "mask_pay built"
