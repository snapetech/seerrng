#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <PKGBUILD> [<PKGBUILD> ...]" >&2
  exit 1
fi

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

for pkgbuild in "$@"; do
  [[ -f "$pkgbuild" ]] || fail "PKGBUILD missing: $pkgbuild"
  dir="$(cd "$(dirname "$pkgbuild")" && pwd)"

  mapfile -t sources < <(bash -c 'source "$1"; printf "%s\n" "${source[@]}"' bash "$pkgbuild")
  mapfile -t sums < <(bash -c 'source "$1"; printf "%s\n" "${sha256sums[@]}"' bash "$pkgbuild")

  [[ "${#sources[@]}" -eq "${#sums[@]}" ]] || fail "${pkgbuild}: source and sha256sums counts differ"

  for i in "${!sources[@]}"; do
    sum="${sums[$i]}"
    [[ -n "$sum" ]] || fail "${pkgbuild}: empty checksum at index ${i}"
    if [[ "$sum" == "SKIP" ]]; then
      continue
    fi

    source_name="${sources[$i]}"
    if [[ "$source_name" == *"://"* ]]; then
      continue
    fi
    source_name="${source_name%%::*}"
    source_name="${source_name##*/}"
    source_path="${dir}/${source_name}"
    [[ -f "$source_path" ]] || fail "${pkgbuild}: local source missing for checksum: ${source_name}"

    actual="$(sha256sum "$source_path" | awk '{print $1}')"
    [[ "$actual" == "$sum" ]] || fail "${pkgbuild}: checksum mismatch for ${source_name}: ${actual} != ${sum}"
  done
done

echo "AUR PKGBUILD checksum validation passed: $*"
