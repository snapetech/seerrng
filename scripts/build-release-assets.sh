#!/usr/bin/env bash
set -euo pipefail
umask 077

tag="${1:?usage: build-release-assets.sh <tag> <dist-dir>}"
dist_dir="${2:-dist-release}"
[[ "$tag" =~ ^v[0-9][0-9A-Za-z._+-]{0,127}$ ]] || {
  echo "Invalid release tag: $tag" >&2
  exit 2
}
[[ ! -L "$dist_dir" ]] || {
  echo "Refusing symlink distribution directory: $dist_dir" >&2
  exit 2
}
mkdir -p -- "$dist_dir"
dist_abs="$(cd "$dist_dir" && pwd -P)"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=macos ;;
  MINGW*|MSYS*|CYGWIN*) os=windows ;;
  *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) arch="$(uname -m)" ;;
esac

asset="seerrng-${tag}-${os}-${arch}"
work_dir="$(mktemp -d)"
work_dir="$(cd "$work_dir" && pwd -P)"
archive_temporary=""
checksum_temporary=""
cleanup() {
  rm -rf -- "$work_dir"
  [[ -z "$archive_temporary" ]] || rm -f -- "$archive_temporary"
  [[ -z "$checksum_temporary" ]] || rm -f -- "$checksum_temporary"
}
trap cleanup EXIT
stage="${work_dir}/${asset}"
mkdir -p "$stage"

if command -v corepack >/dev/null 2>&1; then
  corepack enable
fi
CI=true CYPRESS_INSTALL_BINARY=0 pnpm install --frozen-lockfile
pnpm build

cp -R .next dist public "$stage"/
cp package.json pnpm-lock.yaml pnpm-workspace.yaml next.config.ts seerr-api.yml LICENSE "$stage"/
mkdir -p "$stage/bin"
cp bin/prepare.mjs "$stage/bin/"
(cd "$stage" && CI=true CYPRESS_INSTALL_BINARY=0 pnpm install --prod --frozen-lockfile)
rm -rf "${stage:?}/.next/cache" "${stage:?}/.next/dev" "${stage:?}/bin" "${stage:?}/cache"
mkdir -p "$stage/config"
touch "$stage/config/.gitkeep"

while IFS= read -r -d '' link; do
  target="$(readlink "$link")"
  link_dir="$(dirname -- "$link")"
  if [[ "$target" == /* ]]; then
    resolved="$(realpath "$target")" || {
      echo "Refusing broken archive symlink: $link -> $target" >&2
      exit 1
    }
  else
    resolved="$(realpath "$link_dir/$target")" || {
      echo "Refusing broken archive symlink: $link -> $target" >&2
      exit 1
    }
  fi
  [[ "$resolved" == "$stage"/* ]] || {
    if [[ "$target" == /* ]]; then
      echo "Refusing absolute archive symlink: $link -> $target" >&2
    else
      echo "Refusing escaping archive symlink: $link -> $target" >&2
    fi
    exit 1
  }

  if [[ "$target" == /* ]]; then
    relative_target="$(node -e 'const path = require("node:path"); process.stdout.write(path.posix.relative(process.argv[1], process.argv[2]));' "$link_dir" "$resolved")"
    rm -- "$link"
    ln -s -- "$relative_target" "$link"
  fi
done < <(find "$stage" -type l -print0)

cat > "$stage/start.sh" <<'EOF'
#!/usr/bin/env sh
set -eu
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$script_dir"
export NODE_ENV="${NODE_ENV:-production}"
export CONFIG_DIRECTORY="${CONFIG_DIRECTORY:-${script_dir}/config}"
exec node dist/index.js "$@"
EOF
chmod 0755 "$stage/start.sh"

cat > "$stage/start.cmd" <<'EOF'
@echo off
set NODE_ENV=production
cd /d "%~dp0"
if "%CONFIG_DIRECTORY%"=="" set CONFIG_DIRECTORY=%CD%\config
node dist\index.js %*
EOF

cat > "$stage/seerrng" <<'EOF'
#!/usr/bin/env sh
set -eu
exec "$(dirname "$0")/start.sh" "$@"
EOF
chmod 0755 "$stage/seerrng"
cp "$stage/start.cmd" "$stage/seerrng.cmd"

if [[ "$os" == "windows" ]]; then
  archive_name="${asset}.zip"
  archive_temporary="$(mktemp "${dist_abs}/.${archive_name}.tmp.XXXXXX.zip")"
  rm -f -- "$archive_temporary"
  if command -v zip >/dev/null 2>&1; then
    (cd "$work_dir" && zip -qr "$archive_temporary" "$asset")
  elif command -v powershell.exe >/dev/null 2>&1; then
    if command -v cygpath >/dev/null 2>&1; then
      powershell_source="$(cygpath -w "${work_dir}/${asset}")"
      powershell_archive="$(cygpath -w "$archive_temporary")"
    else
      powershell_source="${work_dir}/${asset}"
      powershell_archive="$archive_temporary"
    fi
    # PowerShell expands these environment variables.
    # shellcheck disable=SC2016
    POWERSHELL_SOURCE="$powershell_source" POWERSHELL_ARCHIVE="$powershell_archive" \
      powershell.exe -NoProfile -Command \
      'Compress-Archive -LiteralPath $env:POWERSHELL_SOURCE -DestinationPath $env:POWERSHELL_ARCHIVE -Force'
  elif command -v powershell >/dev/null 2>&1; then
    # PowerShell expands these environment variables.
    # shellcheck disable=SC2016
    POWERSHELL_SOURCE="${work_dir}/${asset}" POWERSHELL_ARCHIVE="$archive_temporary" \
      powershell -NoProfile -Command \
      'Compress-Archive -LiteralPath $env:POWERSHELL_SOURCE -DestinationPath $env:POWERSHELL_ARCHIVE -Force'
  else
    echo "zip or PowerShell Compress-Archive is required to build Windows assets" >&2
    exit 1
  fi
else
  archive_name="${asset}.tar.gz"
  archive_temporary="$(mktemp "${dist_abs}/.${archive_name}.tmp.XXXXXX.tar.gz")"
  tar -C "$work_dir" -czf "$archive_temporary" "$asset"
fi

chmod 0644 "$archive_temporary"
mv -f -- "$archive_temporary" "${dist_abs}/${archive_name}"
checksum_temporary="$(mktemp "${dist_abs}/.${asset}.sha256.tmp.XXXXXX")"
(cd "$dist_abs" && sha256sum "$archive_name" >"$checksum_temporary")
chmod 0644 "$checksum_temporary"
mv -f -- "$checksum_temporary" "${dist_abs}/${asset}.sha256"
