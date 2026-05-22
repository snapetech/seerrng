#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_COMPOSE="${SCRIPT_DIR}/compose.bookshelf.yml"

DRY_RUN=false
VALIDATE_ONLY=false
VALIDATE_API=false
SKIP_PULL=false
NO_STOP_READARR=false
MIGRATE_TO_HARDCOVER=false
RESTORE_BACKUP=false
ALLOW_INCOMPLETE_HARDCOVER_CUTOVER="${ALLOW_INCOMPLETE_HARDCOVER_CUTOVER:-false}"
APPLY_HARDCOVER_REBUILD="${APPLY_HARDCOVER_REBUILD:-false}"
HARDCOVER_LOCAL_DB_IMPORT="${HARDCOVER_LOCAL_DB_IMPORT:-false}"
MIN_BACKUP_FREE_MULTIPLIER="${MIN_BACKUP_FREE_MULTIPLIER:-2}"

INSTALL_DIR="${INSTALL_DIR:-/opt/bookshelf-backend}"
BACKUP_DIR="${BACKUP_DIR:-${INSTALL_DIR}/backups/$(date +%Y%m%d-%H%M%S)}"

BOOKSHELF_EBOOKS_CONFIG_DIR="${BOOKSHELF_EBOOKS_CONFIG_DIR:-/mnt/datapool_lvm_media/readarr-config}"
BOOKSHELF_AUDIOBOOKS_CONFIG_DIR="${BOOKSHELF_AUDIOBOOKS_CONFIG_DIR:-/mnt/datapool_lvm_media/bookshelf-audiobooks-config}"
RREADING_GLASSES_POSTGRES_DIR="${RREADING_GLASSES_POSTGRES_DIR:-/mnt/datapool_lvm_media/rreading-glasses-postgres/data}"

MEDIA_ROOT="${MEDIA_ROOT:-/mnt/datapool_lvm_media}"
DOWNLOAD_ROOT="${DOWNLOAD_ROOT:-/mnt/datapool_lvm_media/download}"
PLEX_ROOT="${PLEX_ROOT:-/mnt/datapool_lvm_media/plex}"
TZ="${TZ:-America/Regina}"
PUID="${PUID:-1000}"
PGID="${PGID:-953}"

BOOKSHELF_EBOOKS_PORT="${BOOKSHELF_EBOOKS_PORT:-8787}"
BOOKSHELF_AUDIOBOOKS_PORT="${BOOKSHELF_AUDIOBOOKS_PORT:-8788}"
RREADING_GLASSES_PORT="${RREADING_GLASSES_PORT:-8790}"
RREADING_GLASSES_POSTGRES_PORT="${RREADING_GLASSES_POSTGRES_PORT:-15433}"
BOOKSHELF_BACKEND="${BOOKSHELF_BACKEND:-auto}"
BOOKSHELF_HARDCOVER_METADATA_URL="${BOOKSHELF_HARDCOVER_METADATA_URL:-https://hardcover.bookinfo.pro}"
BOOKSHELF_SOFTCOVER_METADATA_URL="${BOOKSHELF_SOFTCOVER_METADATA_URL:-http://127.0.0.1:${RREADING_GLASSES_PORT}}"
BOOKSHELF_METADATA_URL="${BOOKSHELF_METADATA_URL:-}"
BOOKSHELF_IMAGE="${BOOKSHELF_IMAGE:-}"
COMPOSE_PROFILES="${COMPOSE_PROFILES:-}"

STOP_OLD_READARR_CONTAINER="${STOP_OLD_READARR_CONTAINER:-}"
CLONE_EBOOKS_CONFIG_TO_AUDIOBOOKS="${CLONE_EBOOKS_CONFIG_TO_AUDIOBOOKS:-false}"

usage() {
  cat <<EOF
Usage: $0 [options]

Deploy a two-instance Bookshelf backend for SeerrNG ebook and audiobook requests.

Options:
  --dry-run          Print the actions that would be taken without changing files
                    or starting containers.
  --validate-only    Validate commands, paths, compose config, and image pull
                    availability without changing files or starting containers.
  --validate-api     After startup, validate Bookshelf development config and
                    lookup endpoints. Set EBOOK_API_KEY and AUDIOBOOK_API_KEY.
  --skip-pull        Do not run docker compose pull before starting containers.
  --no-stop-readarr  Ignore STOP_OLD_READARR_CONTAINER even if it is set.
  --migrate-to-hardcover
                    Back up and inventory an existing Readarr/softcover config,
                    then write migration report files for Hardcover cutover.
  --allow-local-db-import
                    Permit the final deterministic local DB fallback for books
                    Hardcover cannot import through the API.
  --restore-backup   Restore config directories from BACKUP_DIR tarballs and
                    stop the rendered compose stack if present.
  -h, --help         Show this help text.

Common environment overrides:
  INSTALL_DIR
  BACKUP_DIR
  BOOKSHELF_IMAGE
  BOOKSHELF_BACKEND=auto|hardcover|softcover
  BOOKSHELF_METADATA_URL
  BOOKSHELF_EBOOKS_CONFIG_DIR
  BOOKSHELF_AUDIOBOOKS_CONFIG_DIR
  RREADING_GLASSES_POSTGRES_DIR
  MEDIA_ROOT
  DOWNLOAD_ROOT
  PLEX_ROOT
  STOP_OLD_READARR_CONTAINER
  CLONE_EBOOKS_CONFIG_TO_AUDIOBOOKS=true
  ALLOW_INCOMPLETE_HARDCOVER_CUTOVER=true
  APPLY_HARDCOVER_REBUILD=true
  HARDCOVER_EBOOK_API_KEY
  HARDCOVER_AUDIOBOOK_API_KEY
  HARDCOVER_EBOOK_BASE_URL
  HARDCOVER_AUDIOBOOK_BASE_URL
  HARDCOVER_DEDUPE_TARGET_CACHE=true
  HARDCOVER_VALIDATION_LOOKUP_RETRIES=3
  HARDCOVER_VALIDATION_LOOKUP_RETRY_DELAY_MS=10000
  HARDCOVER_SOFTCOVER_EBOOK_BASE_URL
  HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL
  HARDCOVER_SOFTCOVER_EBOOK_API_KEY
  HARDCOVER_SOFTCOVER_AUDIOBOOK_API_KEY
  HARDCOVER_OPENLIBRARY_RECOVERY=true
  HARDCOVER_API_TIMEOUT_MS=15000
  HARDCOVER_MIGRATION_MAX_BOOKS
  HARDCOVER_LOCAL_DB_IMPORT=true
  MIN_BACKUP_FREE_MULTIPLIER=2
  EBOOK_API_KEY
  AUDIOBOOK_API_KEY
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      ;;
    --validate-only)
      VALIDATE_ONLY=true
      DRY_RUN=true
      ;;
    --validate-api)
      VALIDATE_API=true
      ;;
    --skip-pull)
      SKIP_PULL=true
      ;;
    --no-stop-readarr)
      NO_STOP_READARR=true
      ;;
    --migrate-to-hardcover)
      MIGRATE_TO_HARDCOVER=true
      ;;
    --allow-local-db-import)
      HARDCOVER_LOCAL_DB_IMPORT=true
      ;;
    --restore-backup)
      RESTORE_BACKUP=true
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [ "$RESTORE_BACKUP" = "true" ]; then
  SKIP_PULL=true
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

run() {
  if [ "$DRY_RUN" = "true" ]; then
    printf 'DRY RUN:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi

  "$@"
}

compose_cmd() {
  docker compose "$@"
}

has_existing_bookshelf_config() {
  [ -f "${BOOKSHELF_EBOOKS_CONFIG_DIR}/config.xml" ] ||
    [ -f "${BOOKSHELF_EBOOKS_CONFIG_DIR}/nzbdrone.db" ] ||
    [ -f "${BOOKSHELF_EBOOKS_CONFIG_DIR}/readarr.db" ] ||
    [ -f "${BOOKSHELF_AUDIOBOOKS_CONFIG_DIR}/config.xml" ] ||
    [ -f "${BOOKSHELF_AUDIOBOOKS_CONFIG_DIR}/nzbdrone.db" ] ||
    [ -f "${BOOKSHELF_AUDIOBOOKS_CONFIG_DIR}/readarr.db" ]
}

resolve_backend() {
  case "$BOOKSHELF_BACKEND" in
    auto)
      if has_existing_bookshelf_config; then
        BOOKSHELF_BACKEND_RESOLVED=hardcover
        MIGRATE_TO_HARDCOVER=true
      else
        BOOKSHELF_BACKEND_RESOLVED=hardcover
      fi
      ;;
    hardcover | softcover)
      BOOKSHELF_BACKEND_RESOLVED="$BOOKSHELF_BACKEND"
      ;;
    *)
      echo "Invalid BOOKSHELF_BACKEND: $BOOKSHELF_BACKEND" >&2
      echo "Expected auto, hardcover, or softcover." >&2
      exit 2
      ;;
  esac

  if [ -z "$BOOKSHELF_IMAGE" ]; then
    if [ "$BOOKSHELF_BACKEND_RESOLVED" = "softcover" ]; then
      BOOKSHELF_IMAGE="ghcr.io/snapetech/bookshelfng:softcover"
    else
      BOOKSHELF_IMAGE="ghcr.io/snapetech/bookshelfng:hardcover"
    fi
  fi

  if [ -z "$BOOKSHELF_METADATA_URL" ]; then
    if [ "$BOOKSHELF_BACKEND_RESOLVED" = "softcover" ]; then
      BOOKSHELF_METADATA_URL="$BOOKSHELF_SOFTCOVER_METADATA_URL"
    else
      BOOKSHELF_METADATA_URL="$BOOKSHELF_HARDCOVER_METADATA_URL"
    fi
  fi

  if [ "$BOOKSHELF_BACKEND_RESOLVED" = "softcover" ] && [ -z "$COMPOSE_PROFILES" ]; then
    COMPOSE_PROFILES=softcover
  fi
}

generate_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    date +%s%N | sha256sum | awk '{print $1}'
  fi
}

env_file_value() {
  local env_file="$1"
  local key="$2"

  if [ ! -f "$env_file" ]; then
    return 0
  fi

  sed -n "s#^${key}=##p" "$env_file" | tail -n 1
}

backup_path() {
  local path="$1"
  local label="$2"

  if [ -e "$path" ]; then
    run mkdir -p "$BACKUP_DIR"
    run tar -C "$(dirname "$path")" -czf "${BACKUP_DIR}/${label}.tgz" "$(basename "$path")"
    echo "Backed up $path to ${BACKUP_DIR}/${label}.tgz"
  else
    echo "No existing $label path at $path; skipping backup"
  fi
}

path_size_kb() {
  local path="$1"

  if [ ! -e "$path" ]; then
    printf '0'
    return
  fi

  du -sk "$path" 2>/dev/null | awk '{print $1}'
}

available_kb_for_path() {
  local path="$1"
  local probe_path="$path"

  while [ ! -e "$probe_path" ] && [ "$probe_path" != "/" ]; do
    probe_path="$(dirname "$probe_path")"
  done

  df -Pk "$probe_path" | awk 'NR == 2 {print $4}'
}

check_backup_space() {
  local backup_parent
  local required_kb available_kb ebook_kb audiobook_kb rreading_kb

  if ! printf '%s' "$MIN_BACKUP_FREE_MULTIPLIER" | grep -Eq '^[1-9][0-9]*$'; then
    echo "MIN_BACKUP_FREE_MULTIPLIER must be a positive integer." >&2
    exit 2
  fi

  if ! command -v du >/dev/null 2>&1 || ! command -v df >/dev/null 2>&1; then
    echo "Warning: cannot verify backup free space because du or df is unavailable." >&2
    return
  fi

  backup_parent="$(dirname "$BACKUP_DIR")"
  run mkdir -p "$backup_parent"

  ebook_kb="$(path_size_kb "$BOOKSHELF_EBOOKS_CONFIG_DIR")"
  audiobook_kb="$(path_size_kb "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR")"
  rreading_kb="$(path_size_kb "$RREADING_GLASSES_POSTGRES_DIR")"
  required_kb=$(((ebook_kb + audiobook_kb + rreading_kb) * MIN_BACKUP_FREE_MULTIPLIER))
  available_kb="$(available_kb_for_path "$backup_parent")"

  if [ "$required_kb" -gt 0 ] && [ "$available_kb" -lt "$required_kb" ]; then
    echo "Insufficient free space for backup." >&2
    echo "Backup destination: ${backup_parent}" >&2
    echo "Required: ${required_kb} KiB, available: ${available_kb} KiB" >&2
    exit 1
  fi

  echo "Backup free space check passed: ${available_kb} KiB available, ${required_kb} KiB required."
}

validate_migration_sources() {
  local found_db=false
  local db_file

  for db_file in \
    "${BOOKSHELF_EBOOKS_CONFIG_DIR}/nzbdrone.db" \
    "${BOOKSHELF_EBOOKS_CONFIG_DIR}/readarr.db" \
    "${BOOKSHELF_AUDIOBOOKS_CONFIG_DIR}/nzbdrone.db" \
    "${BOOKSHELF_AUDIOBOOKS_CONFIG_DIR}/readarr.db"; do
    if [ -f "$db_file" ]; then
      found_db=true
      if [ ! -r "$db_file" ]; then
        echo "Migration database is not readable: ${db_file}" >&2
        exit 1
      fi
    fi
  done

  if [ "$found_db" = "true" ]; then
    require_command sqlite3
  else
    echo "Warning: no nzbdrone.db/readarr.db found in existing Bookshelf config paths; inventory will contain config metadata only." >&2
  fi
}

restore_path() {
  local archive="$1"
  local target_path="$2"
  local label="$3"
  local parent_dir
  local restore_name

  if [ ! -f "$archive" ]; then
    echo "No ${label} archive at ${archive}; skipping restore"
    return
  fi

  parent_dir="$(dirname "$target_path")"
  restore_name="$(tar -tzf "$archive" | head -n 1 | cut -d / -f 1)"

  if [ -z "$restore_name" ]; then
    echo "Cannot determine restore root for ${archive}" >&2
    exit 1
  fi

  run mkdir -p "$parent_dir"

  if [ -e "$target_path" ]; then
    run mv "$target_path" "${target_path}.pre-restore-$(date +%Y%m%d-%H%M%S)"
  fi

  run tar -C "$parent_dir" -xzf "$archive"

  if [ "$restore_name" != "$(basename "$target_path")" ]; then
    run mv "${parent_dir}/${restore_name}" "$target_path"
  fi

  echo "Restored ${label} from ${archive} to ${target_path}"
}

restore_backup() {
  if [ ! -d "$BACKUP_DIR" ]; then
    echo "BACKUP_DIR does not exist: $BACKUP_DIR" >&2
    exit 1
  fi

  if [ -f "${INSTALL_DIR}/compose.yml" ]; then
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
      (
        cd "$INSTALL_DIR"
        run docker compose down
      )
    else
      echo "Docker Compose is not available; skipping compose down for restore" >&2
    fi
  else
    echo "No rendered compose file at ${INSTALL_DIR}/compose.yml; skipping compose down"
  fi

  restore_path "${BACKUP_DIR}/bookshelf-ebooks-config.tgz" "$BOOKSHELF_EBOOKS_CONFIG_DIR" "ebook config"
  restore_path "${BACKUP_DIR}/bookshelf-audiobooks-config.tgz" "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" "audiobook config"
  restore_path "${BACKUP_DIR}/rreading-glasses-postgres.tgz" "$RREADING_GLASSES_POSTGRES_DIR" "rreading-glasses Postgres data"

  echo "Restore complete. Seerr settings were not changed."
}

write_backup_manifest() {
  local manifest_file="${BACKUP_DIR}/backup-manifest.json"

  if [ "$DRY_RUN" = "true" ]; then
    echo "Would write ${manifest_file}"
    return
  fi

  mkdir -p "$BACKUP_DIR"
  cat >"$manifest_file" <<EOF
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "installDir": "$(json_escape "$INSTALL_DIR")",
  "backendMode": "$(json_escape "$BOOKSHELF_BACKEND")",
  "resolvedBackendMode": "$(json_escape "$BOOKSHELF_BACKEND_RESOLVED")",
  "bookshelfImage": "$(json_escape "$BOOKSHELF_IMAGE")",
  "metadataUrl": "$(json_escape "$BOOKSHELF_METADATA_URL")",
  "paths": {
    "ebookConfig": "$(json_escape "$BOOKSHELF_EBOOKS_CONFIG_DIR")",
    "audiobookConfig": "$(json_escape "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR")",
    "rreadingGlassesPostgres": "$(json_escape "$RREADING_GLASSES_POSTGRES_DIR")"
  },
  "archives": {
    "ebookConfig": "bookshelf-ebooks-config.tgz",
    "audiobookConfig": "bookshelf-audiobooks-config.tgz",
    "rreadingGlassesPostgres": "rreading-glasses-postgres.tgz"
  }
}
EOF
  echo "Wrote ${manifest_file}"
}

ensure_bookshelf_config() {
  local config_dir="$1"
  local port="$2"
  local label="$3"
  local config_file="${config_dir}/config.xml"
  local api_key

  run mkdir -p "$config_dir"

  if [ ! -f "$config_file" ]; then
    if [ "$DRY_RUN" = "true" ]; then
      echo "Would create ${label} Bookshelf config.xml with port ${port}."
      return
    fi

    api_key="$(generate_password | cut -c 1-32)"
    cat >"$config_file" <<EOF
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
    echo "Created ${label} Bookshelf config.xml with port ${port}."
    return
  fi

  if grep -q '<Port>.*</Port>' "$config_file"; then
    run sed -i "s#<Port>.*</Port>#<Port>${port}</Port>#" "$config_file"
  else
    run sed -i "s#</Config>#  <Port>${port}</Port>\\n</Config>#" "$config_file"
  fi

  if ! grep -q '<ApiKey>.*</ApiKey>' "$config_file"; then
    api_key="$(generate_password | cut -c 1-32)"
    run sed -i "s#</Config>#  <ApiKey>${api_key}</ApiKey>\\n</Config>#" "$config_file"
  fi

  echo "Ensured ${label} Bookshelf config.xml uses port ${port}."
}

write_env_file() {
  local env_file="${INSTALL_DIR}/.env"
  local existing_postgres_password

  if [ "$DRY_RUN" = "true" ]; then
    echo "Would write ${env_file}"
    return
  fi

  existing_postgres_password="$(env_file_value "$env_file" "RREADING_GLASSES_POSTGRES_PASSWORD")"
  RREADING_GLASSES_POSTGRES_PASSWORD="${RREADING_GLASSES_POSTGRES_PASSWORD:-${existing_postgres_password:-$(generate_password)}}"

  if [ -f "$env_file" ]; then
    cp "$env_file" "${env_file}.bak-$(date +%Y%m%d-%H%M%S)"
  fi

  cat >"$env_file" <<EOF
PUID=${PUID}
PGID=${PGID}
TZ=${TZ}

BOOKSHELF_BACKEND=${BOOKSHELF_BACKEND_RESOLVED}
COMPOSE_PROFILES=${COMPOSE_PROFILES}
BOOKSHELF_IMAGE=${BOOKSHELF_IMAGE}
BOOKSHELF_METADATA_URL=${BOOKSHELF_METADATA_URL}
BOOKSHELF_EBOOKS_CONFIG_DIR=${BOOKSHELF_EBOOKS_CONFIG_DIR}
BOOKSHELF_AUDIOBOOKS_CONFIG_DIR=${BOOKSHELF_AUDIOBOOKS_CONFIG_DIR}
BOOKSHELF_EBOOKS_CONTAINER_NAME=bookshelf-ebooks
BOOKSHELF_AUDIOBOOKS_CONTAINER_NAME=bookshelf-audiobooks

MEDIA_ROOT=${MEDIA_ROOT}
DOWNLOAD_ROOT=${DOWNLOAD_ROOT}
PLEX_ROOT=${PLEX_ROOT}

RREADING_GLASSES_CONTAINER_NAME=rreading-glasses
RREADING_GLASSES_PORT=${RREADING_GLASSES_PORT}
RREADING_GLASSES_UPSTREAM=www.goodreads.com
RREADING_GLASSES_POSTGRES_CONTAINER_NAME=rreading-glasses-postgres
RREADING_GLASSES_POSTGRES_DIR=${RREADING_GLASSES_POSTGRES_DIR}
RREADING_GLASSES_POSTGRES_HOST=127.0.0.1
RREADING_GLASSES_POSTGRES_PORT=${RREADING_GLASSES_POSTGRES_PORT}
RREADING_GLASSES_POSTGRES_DB=rreading-glasses
RREADING_GLASSES_POSTGRES_USER=rreading
RREADING_GLASSES_POSTGRES_PASSWORD=${RREADING_GLASSES_POSTGRES_PASSWORD}
EOF
  chmod 600 "$env_file"
  echo "Wrote ${env_file}"
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

extract_config_value() {
  local config_file="$1"
  local key="$2"

  if [ ! -f "$config_file" ]; then
    return 0
  fi

  sed -n "s#.*<${key}>\\(.*\\)</${key}>.*#\\1#p" "$config_file" | head -n 1
}

sqlite_table_json() {
  local db_file="$1"
  local table_name="$2"

  if [ ! -r "$db_file" ] || ! command -v sqlite3 >/dev/null 2>&1; then
    printf '[]'
    return
  fi

  if ! sqlite3 -readonly "$db_file" \
    "select 1 from sqlite_master where type = 'table' and name = '${table_name}' limit 1;" \
    2>/dev/null | grep -q 1; then
    printf '[]'
    return
  fi

  sqlite3 -readonly -json "$db_file" \
    "select * from ${table_name};" 2>/dev/null || printf '[]'
}

write_bookshelf_inventory() {
  local service_type="$1"
  local config_dir="$2"
  local output_file="$3"
  local config_file="${config_dir}/config.xml"
  local db_file="${config_dir}/nzbdrone.db"
  local api_key port metadata_source books_json editions_json authors_json author_metadata_json
  local root_folders_json quality_profiles_json metadata_profiles_json tags_json
  local indexers_json download_clients_json

  api_key="$(extract_config_value "$config_file" "ApiKey")"
  port="$(extract_config_value "$config_file" "Port")"
  metadata_source="$(extract_config_value "$config_file" "MetadataSource")"

  if [ ! -f "$db_file" ] && [ -f "${config_dir}/readarr.db" ]; then
    db_file="${config_dir}/readarr.db"
  fi

  if [ "$DRY_RUN" = "true" ]; then
    echo "Would write ${output_file}"
    return
  fi

  books_json="$(sqlite_table_json "$db_file" "Books")"
  editions_json="$(sqlite_table_json "$db_file" "Editions")"
  authors_json="$(sqlite_table_json "$db_file" "Authors")"
  author_metadata_json="$(sqlite_table_json "$db_file" "AuthorMetadata")"
  root_folders_json="$(sqlite_table_json "$db_file" "RootFolders")"
  quality_profiles_json="$(sqlite_table_json "$db_file" "QualityProfiles")"
  metadata_profiles_json="$(sqlite_table_json "$db_file" "MetadataProfiles")"
  tags_json="$(sqlite_table_json "$db_file" "Tags")"
  indexers_json="$(sqlite_table_json "$db_file" "Indexers")"
  download_clients_json="$(sqlite_table_json "$db_file" "DownloadClients")"

  cat >"$output_file" <<EOF
{
  "serviceType": "$(json_escape "$service_type")",
  "configDir": "$(json_escape "$config_dir")",
  "configXml": {
    "exists": $([ -f "$config_file" ] && echo true || echo false),
    "port": "$(json_escape "$port")",
    "apiKeyPresent": $([ -n "$api_key" ] && echo true || echo false),
    "metadataSource": "$(json_escape "$metadata_source")"
  },
  "database": {
    "path": "$(json_escape "$db_file")",
    "exists": $([ -f "$db_file" ] && echo true || echo false),
    "readable": $([ -r "$db_file" ] && echo true || echo false)
  },
  "books": ${books_json:-[]},
  "editions": ${editions_json:-[]},
  "authors": ${authors_json:-[]},
  "authorMetadata": ${author_metadata_json:-[]},
  "rootFolders": ${root_folders_json:-[]},
  "qualityProfiles": ${quality_profiles_json:-[]},
  "metadataProfiles": ${metadata_profiles_json:-[]},
  "tags": ${tags_json:-[]},
  "indexers": ${indexers_json:-[]},
  "downloadClients": ${download_clients_json:-[]}
}
EOF
}

migrate_to_hardcover() {
  local migration_dir="${BACKUP_DIR}/hardcover-migration"

  echo "Preparing Hardcover migration inventory."
  backup_path "$BOOKSHELF_EBOOKS_CONFIG_DIR" "bookshelf-ebooks-config"
  backup_path "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" "bookshelf-audiobooks-config"
  backup_path "$RREADING_GLASSES_POSTGRES_DIR" "rreading-glasses-postgres"
  write_backup_manifest
  run mkdir -p "$migration_dir"

  write_bookshelf_inventory "ebook" "$BOOKSHELF_EBOOKS_CONFIG_DIR" "${migration_dir}/ebook-inventory.json"
  write_bookshelf_inventory "audiobook" "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" "${migration_dir}/audiobook-inventory.json"

  if [ "$DRY_RUN" = "true" ]; then
    echo "Would write migration report files under ${migration_dir}"
    return
  fi

  cat >"${migration_dir}/migration-report.json" <<EOF
{
  "backendTarget": "hardcover",
  "status": "inventory_ready",
  "message": "Backups and source inventory were created. Strict matching, optional rebuild apply, and validation reports are available. Container cutover remains gated until validation passes.",
  "source": {
    "ebookConfigDir": "$(json_escape "$BOOKSHELF_EBOOKS_CONFIG_DIR")",
    "audiobookConfigDir": "$(json_escape "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR")"
  },
  "outputs": {
    "ebookInventory": "ebook-inventory.json",
    "audiobookInventory": "audiobook-inventory.json",
    "matchedBooks": "matched-books.json",
    "unmatchedBooks": "unmatched-books.json",
    "ambiguousBooks": "ambiguous-books.json",
    "rebuildPayload": "rebuild-payload.json",
    "rebuildBlocked": "rebuild-blocked.json",
    "appliedBooks": "applied-books.json",
    "applyFailures": "apply-failures.json",
    "applyFailureSummary": "apply-failure-summary.json",
    "validationReport": "validation-report.json",
    "cutoverDecision": "cutover-decision.json"
  }
}
EOF
  printf '[]\n' >"${migration_dir}/matched-books.json"
  printf '[]\n' >"${migration_dir}/unmatched-books.json"
  printf '[]\n' >"${migration_dir}/ambiguous-books.json"
  printf '[]\n' >"${migration_dir}/rebuild-payload.json"
  printf '[]\n' >"${migration_dir}/rebuild-blocked.json"
  printf '[]\n' >"${migration_dir}/applied-books.json"
  printf '[]\n' >"${migration_dir}/apply-failures.json"
  printf '[]\n' >"${migration_dir}/apply-failure-summary.json"
  printf '[]\n' >"${migration_dir}/validation-report.json"
  printf '{"ok":false,"reasons":["validation_not_run"]}\n' >"${migration_dir}/cutover-decision.json"

  if command -v node >/dev/null 2>&1; then
      BOOKSHELF_EBOOKS_PORT="$BOOKSHELF_EBOOKS_PORT" \
      BOOKSHELF_AUDIOBOOKS_PORT="$BOOKSHELF_AUDIOBOOKS_PORT" \
      BOOKSHELF_EBOOKS_CONFIG_DIR="$BOOKSHELF_EBOOKS_CONFIG_DIR" \
      BOOKSHELF_AUDIOBOOKS_CONFIG_DIR="$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" \
      HARDCOVER_SOFTCOVER_EBOOK_BASE_URL="${HARDCOVER_SOFTCOVER_EBOOK_BASE_URL:-}" \
      HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL="${HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL:-}" \
      HARDCOVER_SOFTCOVER_EBOOK_API_KEY="${HARDCOVER_SOFTCOVER_EBOOK_API_KEY:-}" \
      HARDCOVER_SOFTCOVER_AUDIOBOOK_API_KEY="${HARDCOVER_SOFTCOVER_AUDIOBOOK_API_KEY:-}" \
      node "${SCRIPT_DIR}/bookshelf-hardcover-migration.mjs" "$migration_dir"

    if [ "$APPLY_HARDCOVER_REBUILD" = "true" ]; then
        BOOKSHELF_EBOOKS_PORT="$BOOKSHELF_EBOOKS_PORT" \
        BOOKSHELF_AUDIOBOOKS_PORT="$BOOKSHELF_AUDIOBOOKS_PORT" \
        BOOKSHELF_EBOOKS_CONFIG_DIR="$BOOKSHELF_EBOOKS_CONFIG_DIR" \
        BOOKSHELF_AUDIOBOOKS_CONFIG_DIR="$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" \
        HARDCOVER_SOFTCOVER_EBOOK_BASE_URL="${HARDCOVER_SOFTCOVER_EBOOK_BASE_URL:-}" \
        HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL="${HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL:-}" \
        HARDCOVER_SOFTCOVER_EBOOK_API_KEY="${HARDCOVER_SOFTCOVER_EBOOK_API_KEY:-}" \
        HARDCOVER_SOFTCOVER_AUDIOBOOK_API_KEY="${HARDCOVER_SOFTCOVER_AUDIOBOOK_API_KEY:-}" \
        HARDCOVER_LOCAL_DB_IMPORT="$HARDCOVER_LOCAL_DB_IMPORT" \
        node "${SCRIPT_DIR}/bookshelf-hardcover-migration.mjs" --apply "$migration_dir"
      BOOKSHELF_EBOOKS_PORT="$BOOKSHELF_EBOOKS_PORT" \
        BOOKSHELF_AUDIOBOOKS_PORT="$BOOKSHELF_AUDIOBOOKS_PORT" \
        BOOKSHELF_EBOOKS_CONFIG_DIR="$BOOKSHELF_EBOOKS_CONFIG_DIR" \
        BOOKSHELF_AUDIOBOOKS_CONFIG_DIR="$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" \
        node "${SCRIPT_DIR}/bookshelf-hardcover-migration.mjs" --validate "$migration_dir"
    fi

    node "${SCRIPT_DIR}/bookshelf-hardcover-migration.mjs" --summary "$migration_dir"
  else
    echo "Node.js is not available; strict matching was skipped." >&2
  fi

  echo "Wrote Hardcover migration report files to ${migration_dir}"
}

preflight() {
  require_command docker

  if ! docker compose version >/dev/null 2>&1; then
    echo "Missing required docker compose plugin." >&2
    exit 1
  fi

  if [ ! -f "$SOURCE_COMPOSE" ]; then
    echo "Cannot find compose template: $SOURCE_COMPOSE" >&2
    exit 1
  fi

  if [ ! -d "$MEDIA_ROOT" ]; then
    echo "Warning: MEDIA_ROOT does not exist yet: $MEDIA_ROOT" >&2
  fi
  if [ ! -d "$DOWNLOAD_ROOT" ]; then
    echo "Warning: DOWNLOAD_ROOT does not exist yet: $DOWNLOAD_ROOT" >&2
  fi
  if [ ! -d "$PLEX_ROOT" ]; then
    echo "Warning: PLEX_ROOT does not exist yet: $PLEX_ROOT" >&2
  fi

  if [ "$SKIP_PULL" != "true" ]; then
    if docker manifest inspect "$BOOKSHELF_IMAGE" >/dev/null 2>&1; then
      echo "Bookshelf image is reachable: $BOOKSHELF_IMAGE"
    else
      echo "Warning: cannot inspect Bookshelf image: $BOOKSHELF_IMAGE" >&2
      echo "If this is a private GHCR package, authenticate Docker or make the package public." >&2
    fi
  fi

  if [ "$VALIDATE_ONLY" != "true" ] && [ "$RESTORE_BACKUP" != "true" ]; then
    check_backup_space
  fi

  if [ "$MIGRATE_TO_HARDCOVER" = "true" ]; then
    validate_migration_sources
  fi
}

render_compose_inputs() {
  run mkdir -p "$INSTALL_DIR"
  run cp "$SOURCE_COMPOSE" "${INSTALL_DIR}/compose.yml"
  write_env_file
}

validate_compose() {
  if [ "$DRY_RUN" = "true" ] && [ ! -f "${INSTALL_DIR}/compose.yml" ]; then
      COMPOSE_PROFILES="$COMPOSE_PROFILES" \
      RREADING_GLASSES_POSTGRES_PASSWORD="${RREADING_GLASSES_POSTGRES_PASSWORD:-dry-run-password}" \
      PUID="$PUID" \
      PGID="$PGID" \
      TZ="$TZ" \
      BOOKSHELF_IMAGE="$BOOKSHELF_IMAGE" \
      BOOKSHELF_METADATA_URL="$BOOKSHELF_METADATA_URL" \
      BOOKSHELF_EBOOKS_CONFIG_DIR="$BOOKSHELF_EBOOKS_CONFIG_DIR" \
      BOOKSHELF_AUDIOBOOKS_CONFIG_DIR="$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" \
      MEDIA_ROOT="$MEDIA_ROOT" \
      DOWNLOAD_ROOT="$DOWNLOAD_ROOT" \
      PLEX_ROOT="$PLEX_ROOT" \
      RREADING_GLASSES_POSTGRES_DIR="$RREADING_GLASSES_POSTGRES_DIR" \
      RREADING_GLASSES_POSTGRES_PORT="$RREADING_GLASSES_POSTGRES_PORT" \
      RREADING_GLASSES_PORT="$RREADING_GLASSES_PORT" \
      docker compose -f "$SOURCE_COMPOSE" config >/dev/null
    echo "Compose template is valid."
    return
  fi

  (
    cd "$INSTALL_DIR"
    compose_cmd config >/dev/null
  )
  echo "Compose config is valid."
}

validate_bookshelf_api() {
  local ebook_base="http://127.0.0.1:${BOOKSHELF_EBOOKS_PORT}/api/v1"
  local audiobook_base="http://127.0.0.1:${BOOKSHELF_AUDIOBOOKS_PORT}/api/v1"
  local validation_term="${HARDCOVER_VALIDATION_TERM:-Foundation Isaac Asimov}"

  require_command curl

  if [ -z "${EBOOK_API_KEY:-}" ] || [ -z "${AUDIOBOOK_API_KEY:-}" ]; then
    echo "Skipping API validation because EBOOK_API_KEY and AUDIOBOOK_API_KEY are not both set." >&2
    return 0
  fi

  echo "Validating ebook Bookshelf API on ${ebook_base}"
  curl -fsS -H "X-Api-Key: ${EBOOK_API_KEY}" \
    "${ebook_base}/config/development" >/dev/null
  curl -fsS -G -H "X-Api-Key: ${EBOOK_API_KEY}" \
    --data-urlencode "term=${validation_term}" \
    "${ebook_base}/book/lookup" >/dev/null

  echo "Validating audiobook Bookshelf API on ${audiobook_base}"
  curl -fsS -H "X-Api-Key: ${AUDIOBOOK_API_KEY}" \
    "${audiobook_base}/config/development" >/dev/null
  curl -fsS -G -H "X-Api-Key: ${AUDIOBOOK_API_KEY}" \
    --data-urlencode "term=${validation_term}" \
    "${audiobook_base}/book/lookup" >/dev/null

  echo "Bookshelf API validation passed."
}

print_summary() {
  cat <<EOF

Bookshelf backend deployment summary:
  Install dir:              ${INSTALL_DIR}
  Compose file:             ${INSTALL_DIR}/compose.yml
  Env file:                 ${INSTALL_DIR}/.env
  Backups:                  ${BACKUP_DIR}
  Bookshelf image:          ${BOOKSHELF_IMAGE}
  Backend mode:             ${BOOKSHELF_BACKEND} -> ${BOOKSHELF_BACKEND_RESOLVED}
  Compose profiles:         ${COMPOSE_PROFILES:-none}
  Ebook config:             ${BOOKSHELF_EBOOKS_CONFIG_DIR}
  Audiobook config:         ${BOOKSHELF_AUDIOBOOKS_CONFIG_DIR}
  rreading-glasses data:    ${RREADING_GLASSES_POSTGRES_DIR}
  Metadata URL:             ${BOOKSHELF_METADATA_URL}
  Ebook Bookshelf port:     ${BOOKSHELF_EBOOKS_PORT}
  Audiobook Bookshelf port: ${BOOKSHELF_AUDIOBOOKS_PORT}

Seerr service settings:
  Ebook Bookshelf hostname: 127.0.0.1 or the Docker host name reachable by Seerr
  Ebook Bookshelf port:     ${BOOKSHELF_EBOOKS_PORT}
  Audiobook Bookshelf port: ${BOOKSHELF_AUDIOBOOKS_PORT}

After Bookshelf finishes first boot:
  1. Open each Bookshelf instance and copy its API key from Settings > General > Security.
  2. In Seerr, add one Bookshelf service with Book Format = Ebook and port ${BOOKSHELF_EBOOKS_PORT}.
  3. Add a second Bookshelf service with Book Format = Audiobook and port ${BOOKSHELF_AUDIOBOOKS_PORT}.
  4. Mark each as default for its own format.
  5. Use the Run Diagnostic button in Seerr's Bookshelf service modal.

Optional validation commands, after replacing API keys:
  curl -H 'X-Api-Key: EBOOK_API_KEY' 'http://127.0.0.1:${BOOKSHELF_EBOOKS_PORT}/api/v1/config/development'
  curl -H 'X-Api-Key: EBOOK_API_KEY' 'http://127.0.0.1:${BOOKSHELF_EBOOKS_PORT}/api/v1/book/lookup?term=Foundation%20Isaac%20Asimov'
  curl -H 'X-Api-Key: AUDIOBOOK_API_KEY' 'http://127.0.0.1:${BOOKSHELF_AUDIOBOOKS_PORT}/api/v1/book/lookup?term=Foundation%20Isaac%20Asimov'
EOF
}

resolve_backend

if [ "$RESTORE_BACKUP" = "true" ]; then
  restore_backup
  exit 0
fi

preflight
render_compose_inputs
validate_compose

if [ "$VALIDATE_ONLY" = "true" ]; then
  print_summary
  exit 0
fi

if [ "$MIGRATE_TO_HARDCOVER" = "true" ]; then
  migrate_to_hardcover
  if [ "$ALLOW_INCOMPLETE_HARDCOVER_CUTOVER" != "true" ]; then
    echo "Hardcover migration reports are ready; container cutover is not enabled yet."
    echo "Set APPLY_HARDCOVER_REBUILD=true to apply matched books to a prepared Hardcover target."
    echo "Set ALLOW_INCOMPLETE_HARDCOVER_CUTOVER=true only for development cutover dry runs."
    print_summary
    exit 0
  fi

  if command -v node >/dev/null 2>&1; then
    node "${SCRIPT_DIR}/bookshelf-hardcover-migration.mjs" --cutover-check "${BACKUP_DIR}/hardcover-migration"
  else
    echo "Cannot verify Hardcover cutover readiness because Node.js is not available." >&2
    exit 1
  fi
fi

backup_path "$BOOKSHELF_EBOOKS_CONFIG_DIR" "bookshelf-ebooks-config"
backup_path "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" "bookshelf-audiobooks-config"
if [ "$BOOKSHELF_BACKEND_RESOLVED" = "softcover" ]; then
  backup_path "$RREADING_GLASSES_POSTGRES_DIR" "rreading-glasses-postgres"
fi
write_backup_manifest

run mkdir -p "$BOOKSHELF_EBOOKS_CONFIG_DIR" "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR"
if [ "$BOOKSHELF_BACKEND_RESOLVED" = "softcover" ]; then
  run mkdir -p "$RREADING_GLASSES_POSTGRES_DIR"
fi

if [ "$CLONE_EBOOKS_CONFIG_TO_AUDIOBOOKS" = "true" ] && [ -d "$BOOKSHELF_EBOOKS_CONFIG_DIR" ] && [ -z "$(find "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  run cp -a "${BOOKSHELF_EBOOKS_CONFIG_DIR}/." "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR/"
  echo "Cloned ebook config into audiobook config directory."
fi

ensure_bookshelf_config "$BOOKSHELF_EBOOKS_CONFIG_DIR" "$BOOKSHELF_EBOOKS_PORT" "ebook"
ensure_bookshelf_config "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" "$BOOKSHELF_AUDIOBOOKS_PORT" "audiobook"

if [ "$NO_STOP_READARR" != "true" ] && [ -n "$STOP_OLD_READARR_CONTAINER" ]; then
  run docker stop "$STOP_OLD_READARR_CONTAINER" >/dev/null 2>&1 || true
  echo "Stopped old Readarr container: $STOP_OLD_READARR_CONTAINER"
fi

if [ "$DRY_RUN" != "true" ]; then
  (
    cd "$INSTALL_DIR"
    if [ "$SKIP_PULL" != "true" ]; then
      compose_cmd pull
    fi
    compose_cmd up -d
  )
else
  echo "Dry run complete; containers were not changed."
fi

if [ "$VALIDATE_API" = "true" ] && [ "$DRY_RUN" != "true" ]; then
  validate_bookshelf_api
fi

print_summary
