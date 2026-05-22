#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/compose.bookshelf.yml"
LAB_DIR="${LAB_DIR:-${REPO_DIR}/.bookshelf-migration-lab}"
PROJECT_NAME="${PROJECT_NAME:-seerrng-bookshelf-migration-lab}"

SOURCE_EBOOK_CONFIG_DIR="${SOURCE_EBOOK_CONFIG_DIR:-}"
SOURCE_AUDIOBOOK_CONFIG_DIR="${SOURCE_AUDIOBOOK_CONFIG_DIR:-}"

LAB_SOURCE_EBOOK_DIR="${LAB_DIR}/source/ebook"
LAB_SOURCE_AUDIOBOOK_DIR="${LAB_DIR}/source/audiobook"
LAB_TARGET_EBOOK_DIR="${LAB_DIR}/target/ebook"
LAB_TARGET_AUDIOBOOK_DIR="${LAB_DIR}/target/audiobook"
LAB_MEDIA_DIR="${LAB_DIR}/media"
LAB_DOWNLOAD_DIR="${LAB_DIR}/download"
LAB_PLEX_DIR="${LAB_DIR}/plex"
LAB_INSTALL_DIR="${LAB_DIR}/install"
LAB_BACKUP_DIR="${LAB_DIR}/backups/$(date +%Y%m%d-%H%M%S)"

LAB_EBOOK_PORT="${LAB_EBOOK_PORT:-18787}"
LAB_AUDIOBOOK_PORT="${LAB_AUDIOBOOK_PORT:-18788}"
EXISTING_LAB_EBOOK_API_KEY="$(sed -n 's/^LAB_EBOOK_API_KEY=//p' "${LAB_DIR}/.env" 2>/dev/null | tail -n 1 || true)"
EXISTING_LAB_AUDIOBOOK_API_KEY="$(sed -n 's/^LAB_AUDIOBOOK_API_KEY=//p' "${LAB_DIR}/.env" 2>/dev/null | tail -n 1 || true)"
LAB_EBOOK_API_KEY="${LAB_EBOOK_API_KEY:-${EXISTING_LAB_EBOOK_API_KEY:-$(date +%s%N | sha256sum | awk '{print substr($1,1,32)}')}}"
LAB_AUDIOBOOK_API_KEY="${LAB_AUDIOBOOK_API_KEY:-${EXISTING_LAB_AUDIOBOOK_API_KEY:-$(date +%s%N | sha256sum | awk '{print substr($1,1,32)}')}}"
BOOKSHELF_IMAGE="${BOOKSHELF_IMAGE:-ghcr.io/snapetech/bookshelfng:hardcover}"
BOOKSHELF_METADATA_URL="${BOOKSHELF_METADATA_URL:-https://hardcover.bookinfo.pro}"
BOOKSHELF_HARDCOVER="${BOOKSHELF_HARDCOVER:-true}"
HARDCOVER_VALIDATION_TERM="${HARDCOVER_VALIDATION_TERM:-Foundation Isaac Asimov}"
HARDCOVER_MIGRATION_MAX_BOOKS="${HARDCOVER_MIGRATION_MAX_BOOKS:-}"
HARDCOVER_API_TIMEOUT_MS="${HARDCOVER_API_TIMEOUT_MS:-30000}"
HARDCOVER_RATE_LIMIT_DELAY_MS="${HARDCOVER_RATE_LIMIT_DELAY_MS:-1500}"
HARDCOVER_RATE_LIMIT_BATCH_SIZE="${HARDCOVER_RATE_LIMIT_BATCH_SIZE:-10}"
HARDCOVER_RATE_LIMIT_MAX_RETRIES="${HARDCOVER_RATE_LIMIT_MAX_RETRIES:-5}"
HARDCOVER_RATE_LIMIT_BACKOFF_BASE_MS="${HARDCOVER_RATE_LIMIT_BACKOFF_BASE_MS:-5000}"
HARDCOVER_VALIDATION_LOOKUP_RETRIES="${HARDCOVER_VALIDATION_LOOKUP_RETRIES:-3}"
HARDCOVER_VALIDATION_LOOKUP_RETRY_DELAY_MS="${HARDCOVER_VALIDATION_LOOKUP_RETRY_DELAY_MS:-10000}"
HARDCOVER_DEDUPE_TARGET_CACHE="${HARDCOVER_DEDUPE_TARGET_CACHE:-true}"
HARDCOVER_IDENTIFIER_FALLBACK="${HARDCOVER_IDENTIFIER_FALLBACK:-false}"
HARDCOVER_MATCH_CONCURRENCY="${HARDCOVER_MATCH_CONCURRENCY:-6}"
HARDCOVER_OPENLIBRARY_RECOVERY="${HARDCOVER_OPENLIBRARY_RECOVERY:-true}"
HARDCOVER_LOCAL_IMPORT="${HARDCOVER_LOCAL_IMPORT:-false}"
HARDCOVER_LOCAL_DB_IMPORT="${HARDCOVER_LOCAL_DB_IMPORT:-false}"
APPLY_IMPORT="${APPLY_IMPORT:-false}"
SKIP_PULL="${SKIP_PULL:-false}"
BUILD_LOCAL_IMAGE="${BUILD_LOCAL_IMAGE:-auto}"
BOOKSHELFNG_REPO="${BOOKSHELFNG_REPO:-/home/keith/Documents/code/bookshelfng}"
LOCAL_IMAGE_TAG="${LOCAL_IMAGE_TAG:-seerrng/bookshelfng-hardcover-lab:local}"

usage() {
  cat <<EOF
Usage: $0 [discover|prepare|report|apply|resume|validate|summary|down|clean]

Creates an isolated Bookshelf Hardcover migration lab.

Required for prepare/report/apply:
  SOURCE_EBOOK_CONFIG_DIR=/path/to/source/readarr-or-bookshelf-config

Optional:
  SOURCE_AUDIOBOOK_CONFIG_DIR=/path/to/source/audiobook-config
  LAB_DIR=${LAB_DIR}
  LAB_EBOOK_PORT=${LAB_EBOOK_PORT}
  LAB_AUDIOBOOK_PORT=${LAB_AUDIOBOOK_PORT}
  BOOKSHELF_IMAGE=${BOOKSHELF_IMAGE}
  BOOKSHELF_HARDCOVER=${BOOKSHELF_HARDCOVER}
  BUILD_LOCAL_IMAGE=auto|true|false
  BOOKSHELFNG_REPO=${BOOKSHELFNG_REPO}
  HARDCOVER_VALIDATION_TERM="${HARDCOVER_VALIDATION_TERM}"
  HARDCOVER_MIGRATION_MAX_BOOKS=50
  HARDCOVER_API_TIMEOUT_MS=30000
  HARDCOVER_RATE_LIMIT_DELAY_MS=1500
  HARDCOVER_RATE_LIMIT_BATCH_SIZE=10
  HARDCOVER_RATE_LIMIT_MAX_RETRIES=5
  HARDCOVER_RATE_LIMIT_BACKOFF_BASE_MS=5000
  HARDCOVER_VALIDATION_LOOKUP_RETRIES=3
  HARDCOVER_VALIDATION_LOOKUP_RETRY_DELAY_MS=10000
  HARDCOVER_DEDUPE_TARGET_CACHE=true|false
  HARDCOVER_SOFTCOVER_EBOOK_BASE_URL=http://...
  HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL=http://...
  HARDCOVER_IDENTIFIER_FALLBACK=true|false
  HARDCOVER_MATCH_CONCURRENCY=6
  HARDCOVER_OPENLIBRARY_RECOVERY=true|false
  HARDCOVER_LOCAL_IMPORT=true|false
  HARDCOVER_LOCAL_DB_IMPORT=true|false
  APPLY_IMPORT=true

Modes:
  discover  Print candidate source config paths from Docker and common dirs.
  prepare   Copy source config read-only into the lab and start disposable targets.
  report    prepare, then generate migration reports without importing books.
  apply     prepare, generate reports, import strict matches into disposable targets, validate.
  resume    prepare, then continue the latest migration report/apply/validate run.
  validate  Validate the already-running disposable targets.
  summary   Print counts from the latest lab migration report.
  down      Stop lab containers.
  clean     Stop lab containers and remove LAB_DIR.
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

write_config_xml() {
  local config_dir="$1"
  local port="$2"
  local api_key="$3"

  mkdir -p "$config_dir"
  cat >"${config_dir}/config.xml" <<EOF
<Config>
  <LogLevel>info</LogLevel>
  <Port>${port}</Port>
  <UrlBase></UrlBase>
  <BindAddress>*</BindAddress>
  <SslPort>6868</SslPort>
  <EnableSsl>False</EnableSsl>
  <LaunchBrowser>False</LaunchBrowser>
  <ApiKey>${api_key}</ApiKey>
  <AuthenticationMethod>External</AuthenticationMethod>
  <Branch>develop</Branch>
  <UpdateMechanism>Docker</UpdateMechanism>
</Config>
EOF
}

copy_source_config() {
  local source_dir="$1"
  local target_dir="$2"
  local label="$3"

  if [ -z "$source_dir" ]; then
    mkdir -p "$target_dir"
    return
  fi

  if [ ! -d "$source_dir" ]; then
    echo "${label} source config does not exist: ${source_dir}" >&2
    exit 1
  fi

  if [ "$(realpath "$source_dir")" = "$(realpath -m "$target_dir")" ]; then
    echo "Using existing ${label} source config in lab: ${target_dir}"
    return
  fi

  mkdir -p "$target_dir"
  rsync -a --safe-links \
    --exclude 'logs/' \
    --exclude 'Backups/' \
    --exclude 'MediaCover/' \
    --exclude 'logs.db*' \
    --exclude 'cache.db*' \
    "${source_dir%/}/" "${target_dir}/"
  chmod -R u+rwX "$target_dir"
  echo "Copied ${label} source config into lab: ${target_dir}"
}

ensure_lab_path_for_container_path() {
  local container_path="$1"
  local host_path=""

  case "$container_path" in
    /data/*)
      host_path="${LAB_MEDIA_DIR}/${container_path#/data/}"
      ;;
    /download/*)
      host_path="${LAB_DOWNLOAD_DIR}/${container_path#/download/}"
      ;;
    /downloads/*)
      host_path="${LAB_MEDIA_DIR}/${container_path#/downloads/}"
      ;;
    /plex/*)
      host_path="${LAB_PLEX_DIR}/${container_path#/plex/}"
      ;;
    /media/plex/*)
      host_path="${LAB_PLEX_DIR}/${container_path#/media/plex/}"
      ;;
  esac

  if [ -n "$host_path" ]; then
    mkdir -p "$host_path"
  fi
}

ensure_lab_root_folders() {
  local db_file
  local root_path

  for db_file in "${LAB_SOURCE_EBOOK_DIR}/readarr.db" "${LAB_SOURCE_AUDIOBOOK_DIR}/readarr.db"; do
    if [ ! -r "$db_file" ]; then
      continue
    fi

    while IFS= read -r root_path; do
      [ -n "$root_path" ] && ensure_lab_path_for_container_path "$root_path"
    done < <(
      sqlite3 -readonly "$db_file" \
        "select Path from RootFolders where Path is not null and Path != '';" \
        2>/dev/null || true
    )
  done
}

write_env_file() {
  cat >"${LAB_DIR}/.env" <<EOF
PUID=$(id -u)
PGID=$(id -g)
TZ=${TZ:-America/Regina}
COMPOSE_PROFILES=
BOOKSHELF_BACKEND=hardcover
BOOKSHELF_IMAGE=${BOOKSHELF_IMAGE}
BOOKSHELF_METADATA_URL=${BOOKSHELF_METADATA_URL}
BOOKSHELF_HARDCOVER=${BOOKSHELF_HARDCOVER}
BOOKSHELF_EBOOKS_CONFIG_DIR=${LAB_TARGET_EBOOK_DIR}
BOOKSHELF_AUDIOBOOKS_CONFIG_DIR=${LAB_TARGET_AUDIOBOOK_DIR}
BOOKSHELF_EBOOKS_CONTAINER_NAME=${PROJECT_NAME}-ebooks
BOOKSHELF_AUDIOBOOKS_CONTAINER_NAME=${PROJECT_NAME}-audiobooks
MEDIA_ROOT=${LAB_MEDIA_DIR}
DOWNLOAD_ROOT=${LAB_DOWNLOAD_DIR}
PLEX_ROOT=${LAB_PLEX_DIR}
RREADING_GLASSES_POSTGRES_PASSWORD=unused-lab-password
BOOKSHELF_EBOOKS_PORT=${LAB_EBOOK_PORT}
BOOKSHELF_AUDIOBOOKS_PORT=${LAB_AUDIOBOOK_PORT}
LAB_EBOOK_API_KEY=${LAB_EBOOK_API_KEY}
LAB_AUDIOBOOK_API_KEY=${LAB_AUDIOBOOK_API_KEY}
EOF
}

compose_lab() {
  docker compose -p "$PROJECT_NAME" --env-file "${LAB_DIR}/.env" -f "$COMPOSE_FILE" "$@"
}

can_pull_image() {
  docker manifest inspect "$BOOKSHELF_IMAGE" >/dev/null 2>&1
}

build_local_image() {
  if [ ! -f "${BOOKSHELFNG_REPO}/docker/Dockerfile" ]; then
    echo "Cannot build local Bookshelf image; Dockerfile not found under ${BOOKSHELFNG_REPO}" >&2
    exit 1
  fi

  if [ ! -d "${BOOKSHELFNG_REPO}/_output/UI" ]; then
    echo "Cannot build local Bookshelf image; ${BOOKSHELFNG_REPO}/_output/UI is missing." >&2
    echo "Build bookshelfng first or set BOOKSHELF_IMAGE to an accessible image." >&2
    exit 1
  fi

  echo "Building local Hardcover lab image: ${LOCAL_IMAGE_TAG}"
  docker build \
    -f "${BOOKSHELFNG_REPO}/docker/Dockerfile" \
    --build-arg METADATA_URL="$BOOKSHELF_METADATA_URL" \
    --build-arg HARDCOVER=true \
    --build-arg GIT_BRANCH=lab \
    --build-arg COMMIT_HASH=local \
    --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -t "$LOCAL_IMAGE_TAG" \
    "$BOOKSHELFNG_REPO"
  BOOKSHELF_IMAGE="$LOCAL_IMAGE_TAG"
}

ensure_bookshelf_image() {
  case "$BUILD_LOCAL_IMAGE" in
    true)
      build_local_image
      ;;
    false)
      if [ "$SKIP_PULL" != "true" ]; then
        compose_lab pull bookshelf-ebooks bookshelf-audiobooks
      fi
      ;;
    auto)
      if docker image inspect "$BOOKSHELF_IMAGE" >/dev/null 2>&1; then
        return
      fi

      if can_pull_image; then
        if [ "$SKIP_PULL" != "true" ]; then
          compose_lab pull bookshelf-ebooks bookshelf-audiobooks
        fi
      elif docker image inspect ghcr.io/snapetech/bookshelfng:softcover >/dev/null 2>&1; then
        echo "Cannot pull ${BOOKSHELF_IMAGE}; using local softcover image with HARDCOVER=true for the lab."
        BOOKSHELF_IMAGE="ghcr.io/snapetech/bookshelfng:softcover"
      else
        echo "Cannot pull ${BOOKSHELF_IMAGE}; falling back to local build."
        build_local_image
      fi
      ;;
    *)
      echo "Invalid BUILD_LOCAL_IMAGE=${BUILD_LOCAL_IMAGE}; expected auto, true, or false." >&2
      exit 2
      ;;
  esac
}

wait_for_api() {
  local label="$1"
  local port="$2"
  local api_key="$3"
  local attempt

  for attempt in $(seq 1 60); do
    if curl -fsS -H "X-Api-Key: ${api_key}" \
      "http://127.0.0.1:${port}/api/v1/config/development" >/dev/null 2>&1; then
      echo "${label} Bookshelf API is ready on port ${port}."
      return
    fi

    sleep 2
  done

  echo "${label} Bookshelf API did not become ready on port ${port}." >&2
  compose_lab logs --tail=120
  exit 1
}

discover_sources() {
  require_command docker

  echo "Docker containers with Bookshelf/Readarr-like names:"
  docker ps -a \
    --format '  {{.Names}}  {{.Image}}  {{.Status}}' |
    grep -Ei 'bookshelf|readarr|hardcover|softcover|rreading' || true

  echo
  echo "Likely bind-mounted config paths from matching containers:"
  docker ps -a --format '{{.Names}}' |
    grep -Ei 'bookshelf|readarr|hardcover|softcover' |
    while IFS= read -r container; do
      docker inspect "$container" \
        --format '{{range .Mounts}}{{if eq .Destination "/config"}}  {{$.Name}}: {{.Source}}{{"\n"}}{{end}}{{end}}'
    done || true

  echo
  echo "Common local config paths that exist:"
  for path in \
    /opt/bookshelf-backend \
    /mnt/datapool_lvm_media/readarr-config \
    /mnt/datapool_lvm_media/bookshelf-ebooks-config \
    /mnt/datapool_lvm_media/bookshelf-audiobooks-config \
    "${HOME}/.config/Readarr" \
    "${HOME}/.config/readarr" \
    "${HOME}/.config/bookshelf"; do
    if [ -e "$path" ]; then
      echo "  ${path}"
      find "$path" -maxdepth 2 \( -name config.xml -o -name nzbdrone.db \) -print 2>/dev/null |
        sed 's#^#    #'
    fi
  done
}

prepare_lab() {
  require_command docker
  require_command rsync
  require_command sqlite3
  require_command curl
  require_command node

  if [ -z "$SOURCE_EBOOK_CONFIG_DIR" ]; then
    echo "SOURCE_EBOOK_CONFIG_DIR is required for prepare/report/apply." >&2
    exit 2
  fi

  mkdir -p "$LAB_DIR" "$LAB_MEDIA_DIR" "$LAB_DOWNLOAD_DIR" "$LAB_PLEX_DIR"
  copy_source_config "$SOURCE_EBOOK_CONFIG_DIR" "$LAB_SOURCE_EBOOK_DIR" "ebook"
  copy_source_config "$SOURCE_AUDIOBOOK_CONFIG_DIR" "$LAB_SOURCE_AUDIOBOOK_DIR" "audiobook"
  ensure_lab_root_folders
  write_config_xml "$LAB_TARGET_EBOOK_DIR" "$LAB_EBOOK_PORT" "$LAB_EBOOK_API_KEY"
  write_config_xml "$LAB_TARGET_AUDIOBOOK_DIR" "$LAB_AUDIOBOOK_PORT" "$LAB_AUDIOBOOK_API_KEY"
  write_env_file
  ensure_bookshelf_image
  write_env_file

  compose_lab up -d bookshelf-ebooks bookshelf-audiobooks
  wait_for_api "ebook" "$LAB_EBOOK_PORT" "$LAB_EBOOK_API_KEY"
  wait_for_api "audiobook" "$LAB_AUDIOBOOK_PORT" "$LAB_AUDIOBOOK_API_KEY"
  echo "Lab Hardcover targets started:"
  echo "  ebook:     http://127.0.0.1:${LAB_EBOOK_PORT} apiKey=${LAB_EBOOK_API_KEY}"
  echo "  audiobook: http://127.0.0.1:${LAB_AUDIOBOOK_PORT} apiKey=${LAB_AUDIOBOOK_API_KEY}"
}

run_migration_report() {
  local apply_rebuild="$1"

  BOOKSHELF_BACKEND=hardcover \
    BOOKSHELF_IMAGE="$BOOKSHELF_IMAGE" \
    BOOKSHELF_METADATA_URL="$BOOKSHELF_METADATA_URL" \
    INSTALL_DIR="$LAB_INSTALL_DIR" \
    BACKUP_DIR="$LAB_BACKUP_DIR" \
    BOOKSHELF_EBOOKS_CONFIG_DIR="$LAB_SOURCE_EBOOK_DIR" \
    BOOKSHELF_AUDIOBOOKS_CONFIG_DIR="$LAB_SOURCE_AUDIOBOOK_DIR" \
    RREADING_GLASSES_POSTGRES_DIR="${LAB_DIR}/source/rreading-glasses-postgres" \
    BOOKSHELF_EBOOKS_PORT="$LAB_EBOOK_PORT" \
    BOOKSHELF_AUDIOBOOKS_PORT="$LAB_AUDIOBOOK_PORT" \
    HARDCOVER_EBOOK_API_KEY="$LAB_EBOOK_API_KEY" \
    HARDCOVER_AUDIOBOOK_API_KEY="$LAB_AUDIOBOOK_API_KEY" \
    HARDCOVER_EBOOK_BASE_URL="http://127.0.0.1:${LAB_EBOOK_PORT}" \
    HARDCOVER_AUDIOBOOK_BASE_URL="http://127.0.0.1:${LAB_AUDIOBOOK_PORT}" \
    HARDCOVER_EBOOK_CONFIG_DIR="$LAB_TARGET_EBOOK_DIR" \
    HARDCOVER_AUDIOBOOK_CONFIG_DIR="$LAB_TARGET_AUDIOBOOK_DIR" \
    HARDCOVER_SOFTCOVER_EBOOK_BASE_URL="${HARDCOVER_SOFTCOVER_EBOOK_BASE_URL:-}" \
    HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL="${HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL:-}" \
    HARDCOVER_SOFTCOVER_EBOOK_API_KEY="${HARDCOVER_SOFTCOVER_EBOOK_API_KEY:-}" \
    HARDCOVER_SOFTCOVER_AUDIOBOOK_API_KEY="${HARDCOVER_SOFTCOVER_AUDIOBOOK_API_KEY:-}" \
    HARDCOVER_VALIDATION_TERM="$HARDCOVER_VALIDATION_TERM" \
    HARDCOVER_MIGRATION_MAX_BOOKS="$HARDCOVER_MIGRATION_MAX_BOOKS" \
    HARDCOVER_RATE_LIMIT_DELAY_MS="$HARDCOVER_RATE_LIMIT_DELAY_MS" \
    HARDCOVER_RATE_LIMIT_BATCH_SIZE="$HARDCOVER_RATE_LIMIT_BATCH_SIZE" \
    HARDCOVER_RATE_LIMIT_MAX_RETRIES="$HARDCOVER_RATE_LIMIT_MAX_RETRIES" \
    HARDCOVER_RATE_LIMIT_BACKOFF_BASE_MS="$HARDCOVER_RATE_LIMIT_BACKOFF_BASE_MS" \
    HARDCOVER_VALIDATION_LOOKUP_RETRIES="$HARDCOVER_VALIDATION_LOOKUP_RETRIES" \
    HARDCOVER_VALIDATION_LOOKUP_RETRY_DELAY_MS="$HARDCOVER_VALIDATION_LOOKUP_RETRY_DELAY_MS" \
    HARDCOVER_DEDUPE_TARGET_CACHE="$HARDCOVER_DEDUPE_TARGET_CACHE" \
    HARDCOVER_IDENTIFIER_FALLBACK="$HARDCOVER_IDENTIFIER_FALLBACK" \
    HARDCOVER_MATCH_CONCURRENCY="$HARDCOVER_MATCH_CONCURRENCY" \
    HARDCOVER_OPENLIBRARY_RECOVERY="$HARDCOVER_OPENLIBRARY_RECOVERY" \
    HARDCOVER_API_TIMEOUT_MS="$HARDCOVER_API_TIMEOUT_MS" \
    HARDCOVER_LOCAL_IMPORT="$HARDCOVER_LOCAL_IMPORT" \
    HARDCOVER_LOCAL_DB_IMPORT="$HARDCOVER_LOCAL_DB_IMPORT" \
    APPLY_HARDCOVER_REBUILD="$apply_rebuild" \
    MIN_BACKUP_FREE_MULTIPLIER=1 \
    "${SCRIPT_DIR}/install-bookshelf-backend.sh" --migrate-to-hardcover --skip-pull

  printf '%s\n' "${LAB_BACKUP_DIR}/hardcover-migration" >"${LAB_DIR}/latest-migration-dir"
  echo "Migration lab reports: ${LAB_BACKUP_DIR}/hardcover-migration"
}

run_migration_dir() {
  local migration_dir="$1"
  local apply_rebuild="$2"

  if [ -z "$migration_dir" ] || [ ! -f "${migration_dir}/migration-report.json" ]; then
    echo "No resumable migration report found." >&2
    exit 1
  fi

  BOOKSHELF_EBOOKS_PORT="$LAB_EBOOK_PORT" \
    BOOKSHELF_AUDIOBOOKS_PORT="$LAB_AUDIOBOOK_PORT" \
    HARDCOVER_EBOOK_API_KEY="$LAB_EBOOK_API_KEY" \
    HARDCOVER_AUDIOBOOK_API_KEY="$LAB_AUDIOBOOK_API_KEY" \
    HARDCOVER_EBOOK_BASE_URL="http://127.0.0.1:${LAB_EBOOK_PORT}" \
    HARDCOVER_AUDIOBOOK_BASE_URL="http://127.0.0.1:${LAB_AUDIOBOOK_PORT}" \
    HARDCOVER_EBOOK_CONFIG_DIR="$LAB_TARGET_EBOOK_DIR" \
    HARDCOVER_AUDIOBOOK_CONFIG_DIR="$LAB_TARGET_AUDIOBOOK_DIR" \
    HARDCOVER_SOFTCOVER_EBOOK_BASE_URL="${HARDCOVER_SOFTCOVER_EBOOK_BASE_URL:-}" \
    HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL="${HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL:-}" \
    HARDCOVER_SOFTCOVER_EBOOK_API_KEY="${HARDCOVER_SOFTCOVER_EBOOK_API_KEY:-}" \
    HARDCOVER_SOFTCOVER_AUDIOBOOK_API_KEY="${HARDCOVER_SOFTCOVER_AUDIOBOOK_API_KEY:-}" \
    HARDCOVER_VALIDATION_TERM="$HARDCOVER_VALIDATION_TERM" \
    HARDCOVER_MIGRATION_MAX_BOOKS="$HARDCOVER_MIGRATION_MAX_BOOKS" \
    HARDCOVER_RATE_LIMIT_DELAY_MS="$HARDCOVER_RATE_LIMIT_DELAY_MS" \
    HARDCOVER_RATE_LIMIT_BATCH_SIZE="$HARDCOVER_RATE_LIMIT_BATCH_SIZE" \
    HARDCOVER_RATE_LIMIT_MAX_RETRIES="$HARDCOVER_RATE_LIMIT_MAX_RETRIES" \
    HARDCOVER_RATE_LIMIT_BACKOFF_BASE_MS="$HARDCOVER_RATE_LIMIT_BACKOFF_BASE_MS" \
    HARDCOVER_DEDUPE_TARGET_CACHE="$HARDCOVER_DEDUPE_TARGET_CACHE" \
    HARDCOVER_IDENTIFIER_FALLBACK="$HARDCOVER_IDENTIFIER_FALLBACK" \
    HARDCOVER_MATCH_CONCURRENCY="$HARDCOVER_MATCH_CONCURRENCY" \
    HARDCOVER_OPENLIBRARY_RECOVERY="$HARDCOVER_OPENLIBRARY_RECOVERY" \
    HARDCOVER_API_TIMEOUT_MS="$HARDCOVER_API_TIMEOUT_MS" \
    HARDCOVER_LOCAL_IMPORT="$HARDCOVER_LOCAL_IMPORT" \
    HARDCOVER_LOCAL_DB_IMPORT="$HARDCOVER_LOCAL_DB_IMPORT" \
    node "${SCRIPT_DIR}/bookshelf-hardcover-migration.mjs" "$migration_dir"

  if [ "$apply_rebuild" = "true" ]; then
    BOOKSHELF_EBOOKS_PORT="$LAB_EBOOK_PORT" \
      BOOKSHELF_AUDIOBOOKS_PORT="$LAB_AUDIOBOOK_PORT" \
      HARDCOVER_EBOOK_API_KEY="$LAB_EBOOK_API_KEY" \
      HARDCOVER_AUDIOBOOK_API_KEY="$LAB_AUDIOBOOK_API_KEY" \
      HARDCOVER_EBOOK_BASE_URL="http://127.0.0.1:${LAB_EBOOK_PORT}" \
      HARDCOVER_AUDIOBOOK_BASE_URL="http://127.0.0.1:${LAB_AUDIOBOOK_PORT}" \
      HARDCOVER_EBOOK_CONFIG_DIR="$LAB_TARGET_EBOOK_DIR" \
      HARDCOVER_AUDIOBOOK_CONFIG_DIR="$LAB_TARGET_AUDIOBOOK_DIR" \
      HARDCOVER_SOFTCOVER_EBOOK_BASE_URL="${HARDCOVER_SOFTCOVER_EBOOK_BASE_URL:-}" \
      HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL="${HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL:-}" \
      HARDCOVER_SOFTCOVER_EBOOK_API_KEY="${HARDCOVER_SOFTCOVER_EBOOK_API_KEY:-}" \
      HARDCOVER_SOFTCOVER_AUDIOBOOK_API_KEY="${HARDCOVER_SOFTCOVER_AUDIOBOOK_API_KEY:-}" \
      HARDCOVER_DEDUPE_TARGET_CACHE="$HARDCOVER_DEDUPE_TARGET_CACHE" \
      HARDCOVER_OPENLIBRARY_RECOVERY="$HARDCOVER_OPENLIBRARY_RECOVERY" \
      HARDCOVER_API_TIMEOUT_MS="$HARDCOVER_API_TIMEOUT_MS" \
      HARDCOVER_LOCAL_DB_IMPORT="$HARDCOVER_LOCAL_DB_IMPORT" \
      node "${SCRIPT_DIR}/bookshelf-hardcover-migration.mjs" --apply "$migration_dir"
    BOOKSHELF_EBOOKS_PORT="$LAB_EBOOK_PORT" \
      BOOKSHELF_AUDIOBOOKS_PORT="$LAB_AUDIOBOOK_PORT" \
      HARDCOVER_EBOOK_API_KEY="$LAB_EBOOK_API_KEY" \
      HARDCOVER_AUDIOBOOK_API_KEY="$LAB_AUDIOBOOK_API_KEY" \
      HARDCOVER_EBOOK_BASE_URL="http://127.0.0.1:${LAB_EBOOK_PORT}" \
      HARDCOVER_AUDIOBOOK_BASE_URL="http://127.0.0.1:${LAB_AUDIOBOOK_PORT}" \
      HARDCOVER_VALIDATION_TERM="$HARDCOVER_VALIDATION_TERM" \
      HARDCOVER_VALIDATION_LOOKUP_RETRIES="$HARDCOVER_VALIDATION_LOOKUP_RETRIES" \
      HARDCOVER_VALIDATION_LOOKUP_RETRY_DELAY_MS="$HARDCOVER_VALIDATION_LOOKUP_RETRY_DELAY_MS" \
      HARDCOVER_API_TIMEOUT_MS="$HARDCOVER_API_TIMEOUT_MS" \
      node "${SCRIPT_DIR}/bookshelf-hardcover-migration.mjs" --validate "$migration_dir"
  fi

  node "${SCRIPT_DIR}/bookshelf-hardcover-migration.mjs" --summary "$migration_dir"
  printf '%s\n' "$migration_dir" >"${LAB_DIR}/latest-migration-dir"
  echo "Migration lab reports: ${migration_dir}"
}

validate_lab() {
  require_command jq

  echo "ebook config/development:"
  curl -fsS -H "X-Api-Key: ${LAB_EBOOK_API_KEY}" \
    "http://127.0.0.1:${LAB_EBOOK_PORT}/api/v1/config/development" | jq .
  echo "ebook lookup count:"
  curl -fsS -G -H "X-Api-Key: ${LAB_EBOOK_API_KEY}" \
    --data-urlencode "term=${HARDCOVER_VALIDATION_TERM}" \
    "http://127.0.0.1:${LAB_EBOOK_PORT}/api/v1/book/lookup" | jq 'length'

  echo "audiobook config/development:"
  curl -fsS -H "X-Api-Key: ${LAB_AUDIOBOOK_API_KEY}" \
    "http://127.0.0.1:${LAB_AUDIOBOOK_PORT}/api/v1/config/development" | jq .
  echo "audiobook lookup count:"
  curl -fsS -G -H "X-Api-Key: ${LAB_AUDIOBOOK_API_KEY}" \
    --data-urlencode "term=${HARDCOVER_VALIDATION_TERM}" \
    "http://127.0.0.1:${LAB_AUDIOBOOK_PORT}/api/v1/book/lookup" | jq 'length'
}

latest_migration_dir() {
  if [ -f "${LAB_DIR}/latest-migration-dir" ]; then
    cat "${LAB_DIR}/latest-migration-dir"
    return
  fi

  find "${LAB_DIR}/backups" -path '*/hardcover-migration/migration-report.json' -print 2>/dev/null |
    sort |
    tail -n 1 |
    sed 's#/migration-report.json$##'
}

print_summary() {
  require_command jq

  local migration_dir
  migration_dir="$(latest_migration_dir)"

  if [ -z "$migration_dir" ] || [ ! -f "${migration_dir}/migration-report.json" ]; then
    echo "No migration report found under ${LAB_DIR}." >&2
    exit 1
  fi

  echo "Latest migration report: ${migration_dir}"
  jq -r '
    "status=\(.status // "unknown")",
    "matched=\(.counts.matched // 0)",
    "unmatched=\(.counts.unmatched // 0)",
    "ambiguous=\(.counts.ambiguous // 0)",
    "rebuildPayload=\(.counts.rebuildPayload // 0)",
    "rebuildBlocked=\(.counts.rebuildBlocked // 0)",
    "applied=\(.applyCounts.applied // 0)",
    "applyFailed=\(.applyCounts.failed // 0)",
    "validationOk=\(.validation.ok // false)"
  ' "${migration_dir}/migration-report.json"

  if [ -f "${migration_dir}/cutover-decision.json" ]; then
    jq -r '"cutoverReady=\(.ok)", "cutoverReasons=\((.reasons // []) | join(","))"' \
      "${migration_dir}/cutover-decision.json"
  fi
}

mode="${1:-report}"
case "$mode" in
  discover)
    discover_sources
    ;;
  prepare)
    prepare_lab
    ;;
  report)
    prepare_lab
    run_migration_report false
    ;;
  apply)
    prepare_lab
    run_migration_report true
    ;;
  resume)
    SOURCE_EBOOK_CONFIG_DIR="${SOURCE_EBOOK_CONFIG_DIR:-$LAB_SOURCE_EBOOK_DIR}"
    SOURCE_AUDIOBOOK_CONFIG_DIR="${SOURCE_AUDIOBOOK_CONFIG_DIR:-$LAB_SOURCE_AUDIOBOOK_DIR}"
    prepare_lab
    run_migration_dir "$(latest_migration_dir)" true
    ;;
  validate)
    validate_lab
    ;;
  summary)
    print_summary
    ;;
  down)
    if [ -f "${LAB_DIR}/.env" ]; then
      compose_lab down
    fi
    ;;
  clean)
    if [ -f "${LAB_DIR}/.env" ]; then
      compose_lab down
    fi
    rm -rf "$LAB_DIR"
    ;;
  -h | --help)
    usage
    ;;
  *)
    echo "Unknown mode: ${mode}" >&2
    usage >&2
    exit 2
    ;;
esac
