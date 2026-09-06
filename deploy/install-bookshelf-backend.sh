#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_COMPOSE="${SCRIPT_DIR}/compose.bookshelf.yml"
DEFAULT_BOOKSHELF_HARDCOVER_IMAGE="ghcr.io/snapetech/bookshelfng:hardcover@sha256:867abb5a95d1556c30bd22389ea913755c9157323fac36159a691d5453f92636"
DEFAULT_BOOKSHELF_SOFTCOVER_IMAGE="ghcr.io/snapetech/bookshelfng:softcover@sha256:bea37ae5981406f7221e1fced4191a06167997c9777fc2a6a5aa6301a776b667"
DEFAULT_RREADING_GLASSES_HARDCOVER_IMAGE="blampe/rreading-glasses:hardcover@sha256:3489e722a73c9cbab5b9ba530cf8a60c2280367fb03db1fb649261dfb064b52f"
DEFAULT_RREADING_GLASSES_SOFTCOVER_IMAGE="blampe/rreading-glasses:latest@sha256:dd996a1db19ac4ef18df47f1671f608c0f097ed43c4776ebde94dee20c6b43c8"
DEFAULT_HARDCOVER_METADATA_URL="https://hardcover.bookinfo.pro"
DEFAULT_SOFTCOVER_METADATA_URL="https://api.bookinfo.pro"

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
BOOKSHELF_METADATA_MODE="${BOOKSHELF_METADATA_MODE:-}"
BOOKSHELF_METADATA_URL="${BOOKSHELF_METADATA_URL:-}"
BOOKSHELF_IMAGE="${BOOKSHELF_IMAGE:-}"
BOOKSHELF_HARDCOVER="${BOOKSHELF_HARDCOVER:-}"
BOOKSHELF_HARDCOVER_NATIVE="${BOOKSHELF_HARDCOVER_NATIVE:-}"
BOOKSHELF_HARDCOVER_AUTH="${BOOKSHELF_HARDCOVER_AUTH:-}"
BOOKSHELF_HARDCOVER_API_URL="${BOOKSHELF_HARDCOVER_API_URL:-}"
RREADING_GLASSES_IMAGE="${RREADING_GLASSES_IMAGE:-}"
COMPOSE_PROFILES="${COMPOSE_PROFILES:-}"
HARDCOVER_AUTH="${HARDCOVER_AUTH:-${BOOKSHELF_HARDCOVER_AUTH:-${RREADING_GLASSES_HARDCOVER_AUTH:-}}}"
COOKIE="${COOKIE:-${RREADING_GLASSES_COOKIE:-}}"

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
  Fresh Hardcover installs default to the local rreading-glasses and PostgreSQL
  compatibility layer. Set BOOKSHELF_METADATA_MODE=native for direct Hardcover
  GraphQL; existing local-proxy installs are preserved on rerun.
  INSTALL_DIR
  BACKUP_DIR
  BOOKSHELF_IMAGE
  BOOKSHELF_BACKEND=auto|hardcover|softcover
  BOOKSHELF_METADATA_MODE=native|hosted|compatibility
  BOOKSHELF_METADATA_URL
  BOOKSHELF_HARDCOVER_NATIVE=true|false
  BOOKSHELF_HARDCOVER_AUTH (rendered native token; include Bearer prefix)
  BOOKSHELF_HARDCOVER_API_URL
  RREADING_GLASSES_IMAGE
  HARDCOVER_AUTH (required for native and compatibility Hardcover modes; include Bearer prefix)
  COOKIE (optional for softcover mode)
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

ensure_private_directory() {
  local directory="$1"
  local owner_id

  if [ "$DRY_RUN" = "true" ]; then
    run mkdir -p "$directory"
    return
  fi

  if [ -L "$directory" ]; then
    echo "Refusing to use a symlinked private directory: ${directory}" >&2
    exit 1
  fi

  mkdir -p "$directory"
  if [ ! -d "$directory" ] || [ -L "$directory" ]; then
    echo "Private path is not a regular directory: ${directory}" >&2
    exit 1
  fi

  owner_id="$(stat -c '%u' "$directory")"
  if [ "$owner_id" != "$(id -u)" ]; then
    echo "Private directory is owned by another user: ${directory}" >&2
    exit 1
  fi
  if find "$directory" -maxdepth 0 -perm /022 -print -quit | grep -q .; then
    echo "Private directory is group- or world-writable: ${directory}" >&2
    exit 1
  fi

  chmod 700 "$directory"
}

atomic_write_private_file() {
  local output_file="$1"
  local output_mode="${2:-600}"
  local output_directory
  local output_name
  local temporary_file

  output_directory="$(dirname "$output_file")"
  output_name="$(basename "$output_file")"
  temporary_file="$(mktemp "${output_directory}/.${output_name}.XXXXXX.tmp")"

  if ! cat >"$temporary_file"; then
    rm -f -- "$temporary_file"
    return 1
  fi
  if ! chmod "$output_mode" "$temporary_file" || ! mv -Tf -- "$temporary_file" "$output_file"; then
    rm -f -- "$temporary_file"
    return 1
  fi
}

validate_no_control_characters() {
  local name="$1"
  local value="$2"

  if [[ "$value" == *$'\n'* ]] || [[ "$value" == *$'\r'* ]] ||
    printf '%s' "$value" | LC_ALL=C grep -q '[[:cntrl:]]'; then
    echo "${name} must not contain control characters." >&2
    exit 2
  fi
}

validate_port() {
  local name="$1"
  local value="$2"

  if ! printf '%s' "$value" | grep -Eq '^[0-9]{1,5}$' ||
    [ "$((10#$value))" -lt 1 ] || [ "$((10#$value))" -gt 65535 ]; then
    echo "${name} must be an integer from 1 through 65535." >&2
    exit 2
  fi
}

validate_user_id() {
  local name="$1"
  local value="$2"

  if ! printf '%s' "$value" | grep -Eq '^[0-9]{1,10}$' ||
    [ "$((10#$value))" -gt 4294967294 ]; then
    echo "${name} must be an integer from 0 through 4294967294." >&2
    exit 2
  fi
}

validate_boolean() {
  local name="$1"
  local value="$2"

  if [ "$value" != "true" ] && [ "$value" != "false" ]; then
    echo "${name} must be true or false." >&2
    exit 2
  fi
}

validate_configuration() {
  local name

  case "$BOOKSHELF_METADATA_MODE" in
    native | hosted | compatibility)
      ;;
    *)
      echo "Invalid BOOKSHELF_METADATA_MODE: $BOOKSHELF_METADATA_MODE" >&2
      echo "Expected native, hosted, or compatibility." >&2
      exit 2
      ;;
  esac

  validate_port BOOKSHELF_EBOOKS_PORT "$BOOKSHELF_EBOOKS_PORT"
  validate_port BOOKSHELF_AUDIOBOOKS_PORT "$BOOKSHELF_AUDIOBOOKS_PORT"
  validate_port RREADING_GLASSES_PORT "$RREADING_GLASSES_PORT"
  validate_port RREADING_GLASSES_POSTGRES_PORT "$RREADING_GLASSES_POSTGRES_PORT"
  validate_user_id PUID "$PUID"
  validate_user_id PGID "$PGID"

  validate_boolean ALLOW_INCOMPLETE_HARDCOVER_CUTOVER "$ALLOW_INCOMPLETE_HARDCOVER_CUTOVER"
  validate_boolean APPLY_HARDCOVER_REBUILD "$APPLY_HARDCOVER_REBUILD"
  validate_boolean CLONE_EBOOKS_CONFIG_TO_AUDIOBOOKS "$CLONE_EBOOKS_CONFIG_TO_AUDIOBOOKS"
  validate_boolean HARDCOVER_LOCAL_DB_IMPORT "$HARDCOVER_LOCAL_DB_IMPORT"
  validate_boolean BOOKSHELF_HARDCOVER "$BOOKSHELF_HARDCOVER"
  validate_boolean BOOKSHELF_HARDCOVER_NATIVE "$BOOKSHELF_HARDCOVER_NATIVE"

  for name in \
    INSTALL_DIR BACKUP_DIR BOOKSHELF_EBOOKS_CONFIG_DIR \
    BOOKSHELF_AUDIOBOOKS_CONFIG_DIR RREADING_GLASSES_POSTGRES_DIR \
    MEDIA_ROOT DOWNLOAD_ROOT PLEX_ROOT TZ BOOKSHELF_IMAGE \
    BOOKSHELF_METADATA_MODE BOOKSHELF_METADATA_URL BOOKSHELF_HARDCOVER \
    BOOKSHELF_HARDCOVER_NATIVE BOOKSHELF_HARDCOVER_AUTH \
    BOOKSHELF_HARDCOVER_API_URL \
    COMPOSE_PROFILES STOP_OLD_READARR_CONTAINER \
    RREADING_GLASSES_IMAGE RREADING_GLASSES_POSTGRES_PASSWORD \
    HARDCOVER_AUTH COOKIE; do
    validate_no_control_characters "$name" "${!name:-}"
  done
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
  local existing_hardcover_auth
  local existing_metadata_mode
  local existing_metadata_url
  local existing_native
  local existing_profiles

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
      BOOKSHELF_IMAGE="$DEFAULT_BOOKSHELF_SOFTCOVER_IMAGE"
    else
      BOOKSHELF_IMAGE="$DEFAULT_BOOKSHELF_HARDCOVER_IMAGE"
    fi
  fi

  if [ -z "$BOOKSHELF_METADATA_MODE" ]; then
    existing_metadata_mode="$(env_file_value "${INSTALL_DIR}/.env" "BOOKSHELF_METADATA_MODE")"
    if [ -n "$existing_metadata_mode" ]; then
      BOOKSHELF_METADATA_MODE="$existing_metadata_mode"
    else
      existing_metadata_url="$(env_file_value "${INSTALL_DIR}/.env" "BOOKSHELF_METADATA_URL")"
      existing_native="$(env_file_value "${INSTALL_DIR}/.env" "BOOKSHELF_HARDCOVER_NATIVE")"
      existing_profiles="$(env_file_value "${INSTALL_DIR}/.env" "COMPOSE_PROFILES")"
      if [ -z "$BOOKSHELF_METADATA_URL" ] && [ -n "$existing_metadata_url" ]; then
        BOOKSHELF_METADATA_URL="$existing_metadata_url"
      fi
      if [ -z "$COMPOSE_PROFILES" ] && [ -n "$existing_profiles" ]; then
        COMPOSE_PROFILES="$existing_profiles"
      fi
      if [ "$existing_native" = "true" ] && [ "$BOOKSHELF_BACKEND_RESOLVED" = "hardcover" ]; then
        BOOKSHELF_METADATA_MODE="native"
      elif [ "$existing_profiles" = "rreading-glasses" ] ||
        [[ "$existing_metadata_url" == http://127.0.0.1:* ]] ||
        [[ "$existing_metadata_url" == http://localhost:* ]]; then
        # Preserve the pre-native installer behavior for an existing local
        # proxy deployment unless the operator explicitly selects a mode.
        BOOKSHELF_METADATA_MODE="compatibility"
      else
        # Keep the compatibility boundary as the default for fresh installs.
        # It centralizes upstream credentials, caching, and throttling for both
        # Bookshelf instances. Native mode remains an explicit opt-in.
        BOOKSHELF_METADATA_MODE="compatibility"
      fi
    fi
  fi

  case "$BOOKSHELF_METADATA_MODE" in
    native | hosted | compatibility)
      ;;
    *)
      echo "Invalid BOOKSHELF_METADATA_MODE: $BOOKSHELF_METADATA_MODE" >&2
      echo "Expected native, hosted, or compatibility." >&2
      exit 2
      ;;
  esac

  if [ "$BOOKSHELF_BACKEND_RESOLVED" = "softcover" ] &&
    [ "$BOOKSHELF_METADATA_MODE" = "native" ]; then
    echo "BOOKSHELF_METADATA_MODE=native requires BOOKSHELF_BACKEND=hardcover." >&2
    echo "Use compatibility mode for Goodreads/softcover metadata." >&2
    exit 2
  fi

  if [ "$BOOKSHELF_BACKEND_RESOLVED" = "softcover" ]; then
    BOOKSHELF_HARDCOVER="false"
    RREADING_GLASSES_UPSTREAM="www.goodreads.com"
  else
    BOOKSHELF_HARDCOVER="true"
    RREADING_GLASSES_UPSTREAM="api.hardcover.app"
  fi

  case "$BOOKSHELF_METADATA_MODE" in
    compatibility)
      if [ -z "$RREADING_GLASSES_IMAGE" ]; then
        if [ "$BOOKSHELF_BACKEND_RESOLVED" = "softcover" ]; then
          RREADING_GLASSES_IMAGE="$DEFAULT_RREADING_GLASSES_SOFTCOVER_IMAGE"
        else
          RREADING_GLASSES_IMAGE="$DEFAULT_RREADING_GLASSES_HARDCOVER_IMAGE"
        fi
      fi
      if [ -z "$BOOKSHELF_METADATA_URL" ]; then
        BOOKSHELF_METADATA_URL="http://127.0.0.1:${RREADING_GLASSES_PORT}"
      fi
      if [ "$BOOKSHELF_METADATA_URL" = "http://127.0.0.1:${RREADING_GLASSES_PORT}" ] ||
        [ "$BOOKSHELF_METADATA_URL" = "http://localhost:${RREADING_GLASSES_PORT}" ]; then
        COMPOSE_PROFILES="rreading-glasses"
      else
        # An explicitly supplied compatibility URL may point at a separately
        # managed proxy. Do not start or wait for a second local proxy.
        COMPOSE_PROFILES=""
      fi
      ;;
    hosted)
      COMPOSE_PROFILES=""
      if [ -z "$BOOKSHELF_METADATA_URL" ]; then
        if [ "$BOOKSHELF_BACKEND_RESOLVED" = "softcover" ]; then
          BOOKSHELF_METADATA_URL="$DEFAULT_SOFTCOVER_METADATA_URL"
        else
          BOOKSHELF_METADATA_URL="$DEFAULT_HARDCOVER_METADATA_URL"
        fi
      fi
      ;;
    native)
      COMPOSE_PROFILES=""
      if [ -z "$BOOKSHELF_METADATA_URL" ]; then
        if [ "$BOOKSHELF_BACKEND_RESOLVED" = "softcover" ]; then
          BOOKSHELF_METADATA_URL="$DEFAULT_SOFTCOVER_METADATA_URL"
        else
          # This is the compatibility URL used only when native mode is
          # disabled at runtime or explicitly replaced by hosted mode.
          BOOKSHELF_METADATA_URL="$DEFAULT_HARDCOVER_METADATA_URL"
        fi
      fi
      ;;
  esac

  if [ "$BOOKSHELF_BACKEND_RESOLVED" = "hardcover" ] && [ "$BOOKSHELF_METADATA_MODE" = "native" ]; then
    BOOKSHELF_HARDCOVER_NATIVE="true"
    BOOKSHELF_HARDCOVER_AUTH="${HARDCOVER_AUTH:-}"
  else
    BOOKSHELF_HARDCOVER_NATIVE="false"
    BOOKSHELF_HARDCOVER_AUTH=""
  fi

  # Native mode sends the token to BookshelfNG. Local compatibility mode sends
  # it only to rreading-glasses. Hosted mode has its own upstream credentials.
  if [ "$BOOKSHELF_BACKEND_RESOLVED" = "hardcover" ] &&
    { [ "$BOOKSHELF_METADATA_MODE" = "native" ] ||
      { [ "$BOOKSHELF_METADATA_MODE" = "compatibility" ] &&
        [ "$COMPOSE_PROFILES" = "rreading-glasses" ]; }; }; then
    existing_hardcover_auth="$(env_file_value "${INSTALL_DIR}/.env" "HARDCOVER_AUTH")"
    if [ -z "$existing_hardcover_auth" ]; then
      existing_hardcover_auth="$(env_file_value "${INSTALL_DIR}/.env" "RREADING_GLASSES_HARDCOVER_AUTH")"
    fi
    HARDCOVER_AUTH="${HARDCOVER_AUTH:-$existing_hardcover_auth}"
    if [ "$RESTORE_BACKUP" != "true" ] && [ -z "$HARDCOVER_AUTH" ]; then
      echo "HARDCOVER_AUTH is required for native or local compatibility Hardcover mode." >&2
      echo "Get a token from https://hardcover.app/settings and include the Bearer prefix." >&2
      exit 2
    fi
  fi

  if [ -n "$HARDCOVER_AUTH" ] && [[ "$HARDCOVER_AUTH" != Bearer\ * ]]; then
    echo "HARDCOVER_AUTH must start with 'Bearer '." >&2
    exit 2
  fi

  if [ "$BOOKSHELF_METADATA_MODE" = "native" ]; then
    BOOKSHELF_HARDCOVER_AUTH="$HARDCOVER_AUTH"
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
  local archive_path="${BACKUP_DIR}/${label}.tgz"
  local temporary_archive

  if [ -e "$path" ]; then
    ensure_private_directory "$BACKUP_DIR"
    if [ "$DRY_RUN" = "true" ]; then
      run tar -C "$(dirname "$path")" -czf "$archive_path" "$(basename "$path")"
    else
      if [ -e "$archive_path" ] || [ -L "$archive_path" ]; then
        echo "Backup archive already exists: ${archive_path}" >&2
        exit 1
      fi
      temporary_archive="$(mktemp "${BACKUP_DIR}/.${label}.XXXXXX.tmp")"
      if ! tar -C "$(dirname "$path")" -czf "$temporary_archive" "$(basename "$path")"; then
        rm -f -- "$temporary_archive"
        exit 1
      fi
      chmod 600 "$temporary_archive"
      if ! ln -- "$temporary_archive" "$archive_path"; then
        rm -f -- "$temporary_archive"
        echo "Failed to publish backup archive without overwriting a path: ${archive_path}" >&2
        exit 1
      fi
      rm -f -- "$temporary_archive"
    fi
    echo "Backed up $path to ${archive_path}"
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

restore_path() (
  local archive="$1"
  local target_path="$2"
  local label="$3"
  local archive_listing
  local archive_root=""
  local member
  local normalized_member
  local parent_dir
  local pre_restore_path
  local staging_dir=""

  # Invoked by the RETURN trap below.
  # shellcheck disable=SC2329
  cleanup_restore_staging() {
    if [ -n "$staging_dir" ]; then
      rm -rf -- "$staging_dir"
    fi
    if [ -n "${archive_listing:-}" ]; then
      rm -f -- "$archive_listing"
    fi
  }
  trap cleanup_restore_staging EXIT

  if [ ! -f "$archive" ]; then
    echo "No ${label} archive at ${archive}; skipping restore"
    return
  fi

  parent_dir="$(dirname "$target_path")"
  archive_listing="$(mktemp)"
  if ! tar -tzf "$archive" >"$archive_listing"; then
    echo "Cannot read restore archive: ${archive}" >&2
    exit 1
  fi

  while IFS= read -r member; do
    normalized_member="${member%/}"
    if [ -z "$normalized_member" ] ||
      [ "${normalized_member#/}" != "$normalized_member" ] ||
      [ "${normalized_member#./}" != "$normalized_member" ] ||
      [ "${normalized_member%/.}" != "$normalized_member" ] ||
      [ "${normalized_member%/..}" != "$normalized_member" ] ||
      [[ "/${normalized_member}/" == *"/./"* ]] ||
      [[ "/${normalized_member}/" == *"/../"* ]] ||
      [[ "$normalized_member" == *"//"* ]]; then
      echo "Unsafe path in restore archive ${archive}: ${member}" >&2
      exit 1
    fi

    if [ -z "$archive_root" ]; then
      archive_root="${normalized_member%%/*}"
      if [ -z "$archive_root" ] || [ "$(basename "$archive_root")" != "$archive_root" ]; then
        echo "Invalid restore root in ${archive}: ${archive_root}" >&2
        exit 1
      fi
    elif [ "${normalized_member%%/*}" != "$archive_root" ]; then
      echo "Restore archive must contain exactly one top-level directory: ${archive}" >&2
      exit 1
    fi
  done <"$archive_listing"

  if [ -z "$archive_root" ]; then
    echo "Cannot determine restore root for ${archive}" >&2
    exit 1
  fi

  if [ "$DRY_RUN" = "true" ]; then
    run mkdir -p "$parent_dir"
    run tar -C "$parent_dir" --no-same-owner --no-same-permissions -xzf "$archive"
    echo "Would restore ${label} from ${archive} to ${target_path}"
    return
  fi

  run mkdir -p "$parent_dir"
  staging_dir="$(mktemp -d "${parent_dir}/.seerr-restore.XXXXXX")"
  chmod 700 "$staging_dir"
  tar -C "$staging_dir" \
    --no-same-owner \
    --no-same-permissions \
    --delay-directory-restore \
    -xzf "$archive"

  if [ ! -d "${staging_dir}/${archive_root}" ] ||
    [ -L "${staging_dir}/${archive_root}" ] ||
    find "$staging_dir" -mindepth 1 \( -type l -o -type p -o -type b -o -type c -o -type s \) -print -quit | grep -q . ||
    find "$staging_dir" -type f -links +1 -print -quit | grep -q .; then
    echo "Restore archive contains unsafe filesystem entries: ${archive}" >&2
    exit 1
  fi

  pre_restore_path="${target_path}.pre-restore-$(date +%Y%m%d-%H%M%S)-$$"

  if [ -e "$target_path" ] || [ -L "$target_path" ]; then
    if [ -e "$pre_restore_path" ] || [ -L "$pre_restore_path" ]; then
      echo "Pre-restore destination already exists: ${pre_restore_path}" >&2
      exit 1
    fi
    mv -T -- "$target_path" "$pre_restore_path"
  fi

  if ! mv -T -- "${staging_dir}/${archive_root}" "$target_path"; then
    if [ -e "$pre_restore_path" ] || [ -L "$pre_restore_path" ]; then
      mv -T -- "$pre_restore_path" "$target_path"
    fi
    echo "Failed to install restored ${label} at ${target_path}" >&2
    exit 1
  fi

  echo "Restored ${label} from ${archive} to ${target_path}"
)

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

  ensure_private_directory "$BACKUP_DIR"
  atomic_write_private_file "$manifest_file" <<EOF
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "installDir": "$(json_escape "$INSTALL_DIR")",
  "backendMode": "$(json_escape "$BOOKSHELF_BACKEND")",
  "resolvedBackendMode": "$(json_escape "$BOOKSHELF_BACKEND_RESOLVED")",
  "metadataMode": "$(json_escape "$BOOKSHELF_METADATA_MODE")",
  "bookshelfImage": "$(json_escape "$BOOKSHELF_IMAGE")",
  "metadataUrl": "$(json_escape "$BOOKSHELF_METADATA_URL")",
  "nativeHardcover": $([ "$BOOKSHELF_HARDCOVER_NATIVE" = "true" ] && printf 'true' || printf 'false'),
  "composeProfiles": "$(json_escape "$COMPOSE_PROFILES")",
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

  if [ -L "$config_file" ] || { [ -e "$config_file" ] && [ ! -f "$config_file" ]; }; then
    echo "Refusing to write a non-regular Bookshelf config: ${config_file}" >&2
    exit 1
  fi

  if [ ! -f "$config_file" ]; then
    if [ "$DRY_RUN" = "true" ]; then
      echo "Would create ${label} Bookshelf config.xml with port ${port}."
      return
    fi

    api_key="$(generate_password | cut -c 1-32)"
    atomic_write_private_file "$config_file" <<EOF
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
    if [ "$(id -u)" = "0" ]; then
      chown "$PUID:$PGID" "$config_file"
    fi
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

  chmod 600 "$config_file"
  if [ "$(id -u)" = "0" ]; then
    chown "$PUID:$PGID" "$config_file"
  fi

  echo "Ensured ${label} Bookshelf config.xml uses port ${port}."
}

write_env_file() {
  local env_file="${INSTALL_DIR}/.env"
  local env_backup
  local existing_postgres_password

  if [ "$DRY_RUN" = "true" ]; then
    echo "Would write ${env_file}"
    return
  fi

  existing_postgres_password="$(env_file_value "$env_file" "RREADING_GLASSES_POSTGRES_PASSWORD")"
  RREADING_GLASSES_POSTGRES_PASSWORD="${RREADING_GLASSES_POSTGRES_PASSWORD:-${existing_postgres_password:-$(generate_password)}}"
  validate_no_control_characters RREADING_GLASSES_POSTGRES_PASSWORD "$RREADING_GLASSES_POSTGRES_PASSWORD"

  if [ -f "$env_file" ]; then
    env_backup="${env_file}.bak-$(date +%Y%m%d-%H%M%S)-$$"
    atomic_write_private_file "$env_backup" <"$env_file"
  fi

  atomic_write_private_file "$env_file" <<EOF
PUID=${PUID}
PGID=${PGID}
TZ=${TZ}

BOOKSHELF_BACKEND=${BOOKSHELF_BACKEND_RESOLVED}
BOOKSHELF_METADATA_MODE=${BOOKSHELF_METADATA_MODE}
BOOKSHELF_IMAGE=${BOOKSHELF_IMAGE}
BOOKSHELF_METADATA_URL=${BOOKSHELF_METADATA_URL}
BOOKSHELF_HARDCOVER=${BOOKSHELF_HARDCOVER}
BOOKSHELF_HARDCOVER_NATIVE=${BOOKSHELF_HARDCOVER_NATIVE}
BOOKSHELF_HARDCOVER_AUTH=${BOOKSHELF_HARDCOVER_AUTH:-}
BOOKSHELF_HARDCOVER_API_URL=${BOOKSHELF_HARDCOVER_API_URL:-}
BOOKSHELF_EBOOKS_PORT=${BOOKSHELF_EBOOKS_PORT}
BOOKSHELF_AUDIOBOOKS_PORT=${BOOKSHELF_AUDIOBOOKS_PORT}
BOOKSHELF_EBOOKS_CONFIG_DIR=${BOOKSHELF_EBOOKS_CONFIG_DIR}
BOOKSHELF_AUDIOBOOKS_CONFIG_DIR=${BOOKSHELF_AUDIOBOOKS_CONFIG_DIR}
BOOKSHELF_EBOOKS_CONTAINER_NAME=bookshelf-ebooks
BOOKSHELF_AUDIOBOOKS_CONTAINER_NAME=bookshelf-audiobooks

MEDIA_ROOT=${MEDIA_ROOT}
DOWNLOAD_ROOT=${DOWNLOAD_ROOT}
PLEX_ROOT=${PLEX_ROOT}
COMPOSE_PROFILES=${COMPOSE_PROFILES}

RREADING_GLASSES_CONTAINER_NAME=rreading-glasses
RREADING_GLASSES_IMAGE=${RREADING_GLASSES_IMAGE}
RREADING_GLASSES_PORT=${RREADING_GLASSES_PORT}
RREADING_GLASSES_UPSTREAM=${RREADING_GLASSES_UPSTREAM}
HARDCOVER_AUTH=${HARDCOVER_AUTH:-}
COOKIE=${COOKIE:-}
RREADING_GLASSES_POSTGRES_CONTAINER_NAME=rreading-glasses-postgres
RREADING_GLASSES_POSTGRES_DIR=${RREADING_GLASSES_POSTGRES_DIR}
RREADING_GLASSES_POSTGRES_HOST=127.0.0.1
RREADING_GLASSES_POSTGRES_PORT=${RREADING_GLASSES_POSTGRES_PORT}
RREADING_GLASSES_POSTGRES_DB=rreading-glasses
RREADING_GLASSES_POSTGRES_USER=rreading
RREADING_GLASSES_POSTGRES_PASSWORD=${RREADING_GLASSES_POSTGRES_PASSWORD}
EOF
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

  atomic_write_private_file "$output_file" <<EOF
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

migrate_to_hardcover() (
  local migration_dir="${BACKUP_DIR}/hardcover-migration"

  # Migration inventories include complete source database rows and may carry
  # indexer, download-client, and API credentials.
  umask 077

  echo "Preparing Hardcover migration inventory."
  backup_path "$BOOKSHELF_EBOOKS_CONFIG_DIR" "bookshelf-ebooks-config"
  backup_path "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" "bookshelf-audiobooks-config"
  backup_path "$RREADING_GLASSES_POSTGRES_DIR" "rreading-glasses-postgres"
  write_backup_manifest
  ensure_private_directory "$migration_dir"

  write_bookshelf_inventory "ebook" "$BOOKSHELF_EBOOKS_CONFIG_DIR" "${migration_dir}/ebook-inventory.json"
  write_bookshelf_inventory "audiobook" "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" "${migration_dir}/audiobook-inventory.json"

  if [ "$DRY_RUN" = "true" ]; then
    echo "Would write migration report files under ${migration_dir}"
    return
  fi

  atomic_write_private_file "${migration_dir}/migration-report.json" <<EOF
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
  for empty_output in \
    matched-books.json \
    unmatched-books.json \
    ambiguous-books.json \
    rebuild-payload.json \
    rebuild-blocked.json \
    applied-books.json \
    apply-failures.json \
    apply-failure-summary.json \
    validation-report.json; do
    printf '[]\n' | atomic_write_private_file "${migration_dir}/${empty_output}"
  done
  printf '{"ok":false,"reasons":["validation_not_run"]}\n' |
    atomic_write_private_file "${migration_dir}/cutover-decision.json"

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
)

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

    if [ "$COMPOSE_PROFILES" = "rreading-glasses" ]; then
      if docker manifest inspect "$RREADING_GLASSES_IMAGE" >/dev/null 2>&1; then
        echo "rreading-glasses image is reachable: $RREADING_GLASSES_IMAGE"
      else
        echo "Warning: cannot inspect rreading-glasses image: $RREADING_GLASSES_IMAGE" >&2
        echo "Authenticate Docker if the image registry requires credentials." >&2
      fi
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
  if [ "$DRY_RUN" = "true" ]; then
    run cp "$SOURCE_COMPOSE" "${INSTALL_DIR}/compose.yml"
  else
    atomic_write_private_file "${INSTALL_DIR}/compose.yml" 644 <"$SOURCE_COMPOSE"
  fi
  write_env_file
}

validate_compose() {
  if [ "$DRY_RUN" = "true" ] && [ ! -f "${INSTALL_DIR}/compose.yml" ]; then
      RREADING_GLASSES_POSTGRES_PASSWORD="${RREADING_GLASSES_POSTGRES_PASSWORD:-dry-run-password}" \
      PUID="$PUID" \
      PGID="$PGID" \
      TZ="$TZ" \
      BOOKSHELF_IMAGE="$BOOKSHELF_IMAGE" \
      BOOKSHELF_METADATA_URL="$BOOKSHELF_METADATA_URL" \
      BOOKSHELF_HARDCOVER="$BOOKSHELF_HARDCOVER" \
      BOOKSHELF_HARDCOVER_NATIVE="$BOOKSHELF_HARDCOVER_NATIVE" \
      BOOKSHELF_HARDCOVER_AUTH="$BOOKSHELF_HARDCOVER_AUTH" \
      BOOKSHELF_HARDCOVER_API_URL="$BOOKSHELF_HARDCOVER_API_URL" \
      BOOKSHELF_EBOOKS_PORT="$BOOKSHELF_EBOOKS_PORT" \
      BOOKSHELF_AUDIOBOOKS_PORT="$BOOKSHELF_AUDIOBOOKS_PORT" \
      BOOKSHELF_EBOOKS_CONFIG_DIR="$BOOKSHELF_EBOOKS_CONFIG_DIR" \
      BOOKSHELF_AUDIOBOOKS_CONFIG_DIR="$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" \
      MEDIA_ROOT="$MEDIA_ROOT" \
      DOWNLOAD_ROOT="$DOWNLOAD_ROOT" \
      PLEX_ROOT="$PLEX_ROOT" \
      RREADING_GLASSES_POSTGRES_DIR="$RREADING_GLASSES_POSTGRES_DIR" \
      RREADING_GLASSES_POSTGRES_PORT="$RREADING_GLASSES_POSTGRES_PORT" \
      RREADING_GLASSES_PORT="$RREADING_GLASSES_PORT" \
      RREADING_GLASSES_IMAGE="$RREADING_GLASSES_IMAGE" \
      RREADING_GLASSES_UPSTREAM="$RREADING_GLASSES_UPSTREAM" \
      HARDCOVER_AUTH="$HARDCOVER_AUTH" \
      COOKIE="$COOKIE" \
      COMPOSE_PROFILES="$COMPOSE_PROFILES" \
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

wait_for_bookshelf() {
  local service_name="$1"
  local port="$2"
  local _attempt

  require_command curl
  for _attempt in $(seq 1 60); do
    if curl -fsS --max-time 2 "http://127.0.0.1:${port}/ping" >/dev/null 2>&1; then
      echo "${service_name} Bookshelf is ready on port ${port}."
      return
    fi
    sleep 2
  done

  echo "${service_name} Bookshelf did not become ready on port ${port}." >&2
  (
    cd "$INSTALL_DIR"
    compose_cmd logs --tail=120 "$service_name" >&2 || true
  )
  exit 1
}

wait_for_metadata_proxy() {
  local _attempt

  require_command curl
  for _attempt in $(seq 1 60); do
    if curl -fsS --max-time 2 \
      "http://127.0.0.1:${RREADING_GLASSES_PORT}/swagger.json" >/dev/null 2>&1; then
      echo "rreading-glasses is ready on port ${RREADING_GLASSES_PORT}."
      return
    fi
    sleep 2
  done

  echo "rreading-glasses did not become ready on port ${RREADING_GLASSES_PORT}." >&2
  (
    cd "$INSTALL_DIR"
    compose_cmd logs --tail=120 rreading-glasses rreading-glasses-postgres >&2 || true
  )
  exit 1
}

print_summary() {
  local proxy_status

  if [ "$COMPOSE_PROFILES" = "rreading-glasses" ]; then
    proxy_status="enabled via Compose profile rreading-glasses"
  else
    proxy_status="not started by this deployment"
  fi

  cat <<EOF

Bookshelf backend deployment summary:
  Install dir:              ${INSTALL_DIR}
  Compose file:             ${INSTALL_DIR}/compose.yml
  Env file:                 ${INSTALL_DIR}/.env
  Backups:                  ${BACKUP_DIR}
  Bookshelf image:          ${BOOKSHELF_IMAGE}
  Backend mode:             ${BOOKSHELF_BACKEND} -> ${BOOKSHELF_BACKEND_RESOLVED}
  Metadata mode:            ${BOOKSHELF_METADATA_MODE}
  Native Hardcover:         ${BOOKSHELF_HARDCOVER_NATIVE}
  rreading-glasses:         ${proxy_status}
  rreading-glasses image:   ${RREADING_GLASSES_IMAGE}
  rreading-glasses upstream: ${RREADING_GLASSES_UPSTREAM}
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

validate_configuration
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
backup_path "$RREADING_GLASSES_POSTGRES_DIR" "rreading-glasses-postgres"
write_backup_manifest

run mkdir -p "$BOOKSHELF_EBOOKS_CONFIG_DIR" "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR"
if [ "$COMPOSE_PROFILES" = "rreading-glasses" ]; then
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
    wait_for_bookshelf bookshelf-ebooks "$BOOKSHELF_EBOOKS_PORT"
    wait_for_bookshelf bookshelf-audiobooks "$BOOKSHELF_AUDIOBOOKS_PORT"
    if [ "$COMPOSE_PROFILES" = "rreading-glasses" ]; then
      wait_for_metadata_proxy
    fi
  )
else
  echo "Dry run complete; containers were not changed."
fi

if [ "$VALIDATE_API" = "true" ] && [ "$DRY_RUN" != "true" ]; then
  validate_bookshelf_api
fi

print_summary
