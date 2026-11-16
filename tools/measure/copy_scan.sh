#!/bin/sh
# Copy the Scaniverse 3DGS scan into scan/aigina.ply (gitignored) and check its header.
# Usage: tools/measure/copy_scan.sh ["/path/to/Aigina 2.ply"]
set -eu

src="${1:-/Users/aparna/Downloads/Aigina 2.ply}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
dest="$root/scan/aigina.ply"
expected_vertices=898477
expected_floats=62

[ -f "$src" ] || { echo "copy_scan: source not found: $src" >&2; exit 1; }

mkdir -p "$root/scan"
if ! git -C "$root" check-ignore -q "scan/aigina.ply"; then
  echo "copy_scan: scan/aigina.ply is NOT gitignored; refusing to copy." >&2
  exit 1
fi

header="$(LC_ALL=C sed -n '1,/^end_header/p' "$src" | head -n 100)"
echo "$header" | grep -q '^format binary_little_endian 1.0' || { echo "copy_scan: not binary_little_endian" >&2; exit 1; }
vertices="$(echo "$header" | awk '/^element vertex/ {print $3}')"
floats="$(echo "$header" | grep -c '^property float ')"
others="$(echo "$header" | grep '^property ' | grep -vc '^property float ' || true)"

[ "$vertices" = "$expected_vertices" ] || { echo "copy_scan: expected $expected_vertices vertices, got $vertices" >&2; exit 1; }
[ "$floats" = "$expected_floats" ] && [ "$others" = "0" ] || { echo "copy_scan: expected $expected_floats float32 properties, got $floats (+$others other)" >&2; exit 1; }

cp "$src" "$dest"
echo "copy_scan: OK. $vertices vertices x $floats <f4 -> $dest"
