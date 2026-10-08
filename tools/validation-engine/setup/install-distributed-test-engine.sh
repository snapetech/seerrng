#!/usr/bin/env bash
# SeerrNG Distributed Test Engine Linux Installer
# Version: 0.2.0
#
# Installs or configures one Linux controller or one Linux node. The engine is
# installed with its repository-relative module layout intact; command entries
# are direct symlinks to the real executable scripts, never launch wrappers.
# Network registration and configuration-file writes belong to runner modes.
set -Eeuo pipefail

SCRIPT_VERSION="0.2.0"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ENGINE_SOURCE_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd -P)"
DEPENDENCY_PROFILE_SUFFIX='-test-suite-dependancies.cfg'

INSTALL_ROOT=""
APP_DIR="/usr/local/lib/seerrng-test-engine"
COMMAND_PATH="/usr/local/bin/seerrng-test-engine"
SETUP_COMMAND_PATH="/usr/local/sbin/seerrng-test-engine-setup"
CONFIG_DIR="/etc/seerrng-test-engine"
STATE_DIR="/var/lib/seerrng-test-engine"
LOG_DIR="/var/log/seerrng-test-engine"
SYSTEMD_DIR="/etc/systemd/system"
SYSTEMCTL_BIN="systemctl"
ACTION="menu"
STARTUP_CHOICE=""
CONFIGURE_NOW=""
SERVICE_USER="root"
ASSUME_YES=0
PLAN_ONLY=0
TEST_ROOT_ACTIVE=0
NODE_AUTOMATIC_DEFERRED_MESSAGE='automatic node startup is deferred; verified application provisioning is required before an explicit --app ID=ABSOLUTE_ROOT binding can be started'

INSTALLED_RUNNER=""
INSTALLED_SETUP=""
LEGACY_INSTALLED_RUNNER=""
LEGACY_INSTALLED_SETUP=""
OLDER_INSTALLED_SETUP=""
MANAGED_MARKER=""
ROLE_FILE=""
STARTUP_FILE=""
# The configure runner modes atomically write the selected absolute config path
# here only after a valid configuration or accepted node registration. Service
# modes refuse to start unless this marker resolves exactly one config file.
ACTIVE_CONFIG_MARKER=""
SOURCE_FILES=()
SOURCE_RELATIVE_PATHS=()
SOURCE_MODES=()
SELECTED_PROFILE_FILE=""
ACTIVE_CONFIG_PATH=""
INSTALLED_ROLE=""
APPLICATION_ENTRY_IDS=()
APPLICATION_IDS=()
APPLICATION_NAMES=()
APPLICATION_PROFILE_PATHS=()
SELECTED_APPLICATION_ARGS=()
PLANNED_APPLICATION_ENTRY_IDS=()
PLANNED_APPLICATION_NAMES=()
PLANNED_DEPENDENCY_NAMES=()
PLANNED_DEPENDENCY_VERSIONS=()
CONTROLLER_NODE_NUMBERS=()
CONTROLLER_NODE_NAMES=()
CONTROLLER_NODE_CPUS=()
CONTROLLER_NODE_AVAILABLE_THREADS=()
CONTROLLER_NODE_THREAD_RULES=()
CONTROLLER_NODE_MINIMUM_THREADS=()

RESET=$'\033[0m'
GREEN=$'\033[38;5;40m'
MAGENTA=$'\033[1;35m'
CYAN=$'\033[1;36m'
ORANGE=$'\033[38;5;208m'
GRAY=$'\033[38;5;244m'
WHITE=$'\033[38;5;255m'
RED=$'\033[38;5;196m'

if [[ ! -t 1 ]]; then
  RESET=""
  GREEN=""
  MAGENTA=""
  CYAN=""
  ORANGE=""
  GRAY=""
  WHITE=""
  RED=""
fi

usage() {
  cat <<'EOF'
SeerrNG Distributed Test Engine Linux Installer v0.2.0

Usage:
  install-distributed-test-engine.sh
  install-distributed-test-engine.sh --action ACTION [options]

Actions:
  menu                  Show the interactive menu (default)
  install-controller    Install the controller runner
  configure-controller  Configure the installed controller
  install-node          Install a node runner
  configure-node        Configure and register the installed node
  manage-applications   List, add, or delete controller applications
  install-dependencies  Install or repair application test dependencies

Options:
  --engine-source-root PATH  Source tree containing bin/ and
                             tools/validation-engine/runtime/
  --startup MODE             manual, or automatic for a controller
  --configure-now VALUE      yes or no after an install (default: ask, yes)
  --service-user USER        Linux account used by an automatic service
  --yes                      Approve the displayed install/configure plan
  --plan                     Display actions without changing files or services
  --install-root PATH        Prefix every default path for disposable testing;
                             systemd is never invoked when this is set
  --app-dir PATH             Installed application directory
  --command-path PATH        User command symlink
  --setup-command-path PATH  Installer command symlink
  --config-dir PATH          Configuration directory
  --state-dir PATH           Persistent state and timing-history directory
  --log-dir PATH             Runtime log directory
  --systemd-dir PATH         systemd unit directory
  --systemctl PATH           systemctl executable
  --help                     Show this help

Default production paths:
  Application:   /usr/local/lib/seerrng-test-engine
  Command:       /usr/local/bin/seerrng-test-engine
  Setup command: /usr/local/sbin/seerrng-test-engine-setup
  Configuration: /etc/seerrng-test-engine
  State:         /var/lib/seerrng-test-engine
  Logs:          /var/log/seerrng-test-engine

The controller configuration is named
test-suite-multi-computer-<GitHub username>.cfg. A node configuration is named
test-suite-multi-computer-node-##.cfg. Configure Node asks for the controller IP
and port; no temporary or bootstrap key is used. The accepted controller returns
the cluster key as part of the runner-owned registration result. If the selected
Node number is occupied, Configure Node displays a preserve-or-overwrite choice;
no installer launch option is required and --yes never selects overwrite.

After a successful configure operation, the runner atomically writes the exact
active configuration path to <state directory>/active-config. Controller and
node services resolve only that marker; they never guess among config files.

The installed layout preserves bin/ and tools/validation-engine/runtime/ below
the application directory. The user command links directly to
bin/run-local-validation.mjs and the setup command links directly to this
installer at tools/validation-engine/setup/install-distributed-test-engine.sh.

Each supported application owns one repository profile named
<appname>-test-suite-dependancies.cfg. The controller records the descriptive
application name and absolute profile path; nodes fetch selected requirements
from the controller rather than keeping copied application profiles.

Automatic controller startup is available through systemd. Automatic node
startup is deferred until verified application provisioning can supply explicit
--app ID=ABSOLUTE_ROOT bindings. A manually started node always requires those
bindings on its foreground command.
EOF
}

fail() {
  printf '\n%s[ERROR]%s %s\n' "$RED" "$RESET" "$*" >&2
  exit 1
}

info() {
  printf '  %s%-20s%s %s\n' "$GRAY" "$1" "$RESET" "$2"
}

print_section() {
  printf '\n%s%s%s\n' "$CYAN" "$1" "$RESET"
}

clear_screen() {
  [[ -t 1 ]] && printf '\033[2J\033[H'
  return 0
}

print_header() {
  clear_screen
  printf '%s╔══════════════════════════════════════════════════════╗%s\n' "$MAGENTA" "$RESET"
  printf '%s║%s %sSeerrNG Distributed Test Engine Setup%s               %s║%s\n' \
    "$MAGENTA" "$RESET" "$GREEN" "$RESET" "$MAGENTA" "$RESET"
  printf '%s╚══════════════════════════════════════════════════════╝%s\n' "$MAGENTA" "$RESET"
  print_section 'DESCRIPTION'
  printf '  Install and configure one Linux controller or independently addressed node.\n'
  printf '  Configuration remains runner-owned; this menu does not implement a second protocol.\n\n'
  info 'Version:' "$SCRIPT_VERSION"
  info 'Platform:' 'Linux only'
}

read_menu_choice() {
  local prompt="$1" key
  printf '%s' "$prompt"
  if [[ -t 0 ]]; then
    IFS= read -rsn1 key
    printf '\n'
  else
    IFS= read -r key || key=""
  fi
  REPLY="${key:0:1}"
}

prompt_value() {
  local label="$1" default_value="${2:-}" value
  if [[ -n "$default_value" ]]; then
    printf '  %s%s%s [%s]: ' "$ORANGE" "$label" "$RESET" "$default_value"
  else
    printf '  %s%s%s: ' "$ORANGE" "$label" "$RESET"
  fi
  IFS= read -r value
  REPLY="${value:-$default_value}"
}

prompt_yes_no() {
  local prompt="$1" default_answer="$2" answer suffix
  if (( ASSUME_YES == 1 )); then
    REPLY="yes"
    return 0
  fi
  [[ "$default_answer" == "yes" ]] && suffix='[Y/n]' || suffix='[y/N]'
  printf '  %s %s: ' "$prompt" "$suffix"
  IFS= read -r answer
  answer="${answer,,}"
  if [[ -z "$answer" ]]; then
    REPLY="$default_answer"
  elif [[ "$answer" == "y" || "$answer" == "yes" ]]; then
    REPLY="yes"
  else
    REPLY="no"
  fi
}

prompt_node_overwrite() {
  local node_id="$1"
  printf '  %s1%s  Preserve the existing Node %s registration\n' "$ORANGE" "$RESET" "$node_id"
  printf '  %s2%s  Overwrite Node %s with this computer\n\n' "$ORANGE" "$RESET" "$node_id"
  read_menu_choice '  Selection [1-2, default 1]: '
  [[ "$REPLY" == '2' ]]
}

valid_profile_application_name() {
  local value="$1"
  (( ${#value} >= 1 && ${#value} <= 64 )) || return 1
  [[ "$value" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]
}

valid_application_text() {
  local value="$1"
  (( ${#value} >= 1 && ${#value} <= 256 )) || return 1
  [[ "$value" != *$'\t'* && "$value" != *$'\r'* && "$value" != *$'\n'* ]]
}

validate_dependency_profile_file() {
  local profile_path="$1" expected_application_id="${2:-}" filename application_id
  validate_absolute_safe_path 'dependency profile' "$profile_path"
  [[ -f "$profile_path" && ! -L "$profile_path" ]] \
    || fail "dependency profile must be a regular file: $profile_path"
  filename="$(basename -- "$profile_path")"
  [[ "$filename" == *"$DEPENDENCY_PROFILE_SUFFIX" ]] \
    || fail "dependency profile filename must end with $DEPENDENCY_PROFILE_SUFFIX"
  application_id="${filename%"$DEPENDENCY_PROFILE_SUFFIX"}"
  valid_profile_application_name "$application_id" \
    || fail "dependency profile application name is invalid: $filename"
  [[ -z "$expected_application_id" || "$application_id" == "$expected_application_id" ]] \
    || fail "dependency profile filename must be ${expected_application_id}${DEPENDENCY_PROFILE_SUFFIX}"
}

choose_dependency_profile_file() {
  local current="${1:-$PWD}" answer index selected
  local -a folders profiles
  current="$(readlink -f -- "$current")"
  [[ -d "$current" && ! -L "$current" ]] \
    || fail "profile navigator start directory is unavailable: $current"

  while true; do
    mapfile -t folders < <(find "$current" -mindepth 1 -maxdepth 1 -type d -printf '%p\n' | sort)
    mapfile -t profiles < <(find "$current" -mindepth 1 -maxdepth 1 -type f \
      -name "*${DEPENDENCY_PROFILE_SUFFIX}" -printf '%p\n' | sort)

    print_header
    print_section 'SELECT APPLICATION DEPENDENCY PROFILE'
    info 'Current folder:' "$current"
    printf '  Select a repository-owned %s file.\n' "$DEPENDENCY_PROFILE_SUFFIX"
    print_section 'FOLDERS'
    printf '  %sP%s    %s..%s\n' "$ORANGE" "$RESET" "$WHITE" "$RESET"
    for index in "${!folders[@]}"; do
      printf '  %sD%d%s   %s%s/%s\n' \
        "$ORANGE" "$((index + 1))" "$RESET" "$WHITE" \
        "$(basename -- "${folders[$index]}")" "$RESET"
    done
    (( ${#folders[@]} > 0 )) || printf '       %s(none)%s\n' "$GRAY" "$RESET"

    print_section 'DEPENDENCY PROFILES'
    for index in "${!profiles[@]}"; do
      printf '  %sF%d%s   %s%s%s\n' \
        "$ORANGE" "$((index + 1))" "$RESET" "$WHITE" \
        "$(basename -- "${profiles[$index]}")" "$RESET"
    done
    (( ${#profiles[@]} > 0 )) || printf '       %s(none)%s\n' "$GRAY" "$RESET"

    print_section 'ACTIONS'
    printf '  %sM%s    Enter an absolute profile path manually\n' "$ORANGE" "$RESET"
    printf '  %s0%s    Cancel\n\n' "$ORANGE" "$RESET"
    prompt_value 'Selection (P, D#, F#, M, or 0)' ''
    answer="${REPLY^^}"
    case "$answer" in
      P)
        current="$(readlink -f -- "$current/..")"
        ;;
      D[1-9]|D[1-9][0-9])
        index=$((10#${answer:1} - 1))
        (( index >= 0 && index < ${#folders[@]} )) \
          || { printf '\n%s[INVALID INPUT]%s Folder selection is unavailable.\n' "$RED" "$RESET"; continue; }
        current="${folders[$index]}"
        ;;
      F[1-9]|F[1-9][0-9])
        index=$((10#${answer:1} - 1))
        (( index >= 0 && index < ${#profiles[@]} )) \
          || { printf '\n%s[INVALID INPUT]%s Profile selection is unavailable.\n' "$RED" "$RESET"; continue; }
        selected="$(readlink -f -- "${profiles[$index]}")"
        validate_dependency_profile_file "$selected"
        SELECTED_PROFILE_FILE="$selected"
        return 0
        ;;
      M)
        prompt_value 'Absolute dependency profile path' ''
        selected="$(readlink -f -- "$REPLY" 2>/dev/null || true)"
        [[ -n "$selected" ]] || fail "dependency profile path could not be resolved: $REPLY"
        validate_dependency_profile_file "$selected"
        SELECTED_PROFILE_FILE="$selected"
        return 0
        ;;
      0)
        SELECTED_PROFILE_FILE=""
        return 1
        ;;
      *)
        printf '\n%s[INVALID INPUT]%s Choose P, D#, F#, M, or 0.\n' "$RED" "$RESET"
        ;;
    esac
  done
}

pause_menu() {
  [[ "$ACTION" == "menu" ]] || return 0
  printf '\n  Press %sENTER%s to return to the menu: ' "$ORANGE" "$RESET"
  IFS= read -r _
}

validate_absolute_safe_path() {
  local label="$1" value="$2"
  [[ "$value" == /* ]] || fail "$label must be an absolute path: $value"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* && "$value" != *$'\t'* ]] \
    || fail "$label contains unsupported control characters"
  [[ "$value" != *' '* ]] || fail "$label cannot contain spaces: $value"
}

apply_install_root() {
  [[ -n "$INSTALL_ROOT" ]] || return 0
  validate_absolute_safe_path '--install-root' "$INSTALL_ROOT"
  INSTALL_ROOT="${INSTALL_ROOT%/}"
  APP_DIR="$INSTALL_ROOT/usr/local/lib/seerrng-test-engine"
  COMMAND_PATH="$INSTALL_ROOT/usr/local/bin/seerrng-test-engine"
  SETUP_COMMAND_PATH="$INSTALL_ROOT/usr/local/sbin/seerrng-test-engine-setup"
  CONFIG_DIR="$INSTALL_ROOT/etc/seerrng-test-engine"
  STATE_DIR="$INSTALL_ROOT/var/lib/seerrng-test-engine"
  LOG_DIR="$INSTALL_ROOT/var/log/seerrng-test-engine"
  SYSTEMD_DIR="$INSTALL_ROOT/etc/systemd/system"
  TEST_ROOT_ACTIVE=1
}

refresh_derived_paths() {
  INSTALLED_RUNNER="$APP_DIR/bin/run-local-validation.mjs"
  INSTALLED_SETUP="$APP_DIR/tools/validation-engine/setup/install-distributed-test-engine.sh"
  LEGACY_INSTALLED_RUNNER="$APP_DIR/seerrng-test-engine"
  LEGACY_INSTALLED_SETUP="$APP_DIR/tools/validation-engine/install-distributed-test-engine.sh"
  OLDER_INSTALLED_SETUP="$APP_DIR/install-distributed-test-engine.sh"
  MANAGED_MARKER="$APP_DIR/.managed-by-seerrng-test-engine-installer"
  ROLE_FILE="$STATE_DIR/installed-role"
  STARTUP_FILE="$STATE_DIR/startup-mode"
  ACTIVE_CONFIG_MARKER="$STATE_DIR/active-config"
}

validate_paths() {
  validate_absolute_safe_path '--app-dir' "$APP_DIR"
  validate_absolute_safe_path '--command-path' "$COMMAND_PATH"
  validate_absolute_safe_path '--setup-command-path' "$SETUP_COMMAND_PATH"
  validate_absolute_safe_path '--config-dir' "$CONFIG_DIR"
  validate_absolute_safe_path '--state-dir' "$STATE_DIR"
  validate_absolute_safe_path '--log-dir' "$LOG_DIR"
  validate_absolute_safe_path '--systemd-dir' "$SYSTEMD_DIR"
  [[ "$APP_DIR" != "/" && "$CONFIG_DIR" != "/" && "$STATE_DIR" != "/" && "$LOG_DIR" != "/" ]] \
    || fail 'an installation directory cannot be the filesystem root'
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is unavailable: $1"
}

linux_preflight() {
  local kernel bash_major node_major
  kernel="$(uname -s 2>/dev/null || true)"
  [[ "$kernel" == "Linux" ]] || fail "this installer supports Linux only; detected: ${kernel:-unknown}"
  bash_major="${BASH_VERSINFO[0]:-0}"
  (( bash_major >= 4 )) || fail 'Bash 4 or newer is required'

  require_command install
  require_command awk
  require_command basename
  require_command chmod
  require_command date
  require_command dirname
  require_command ln
  require_command mv
  require_command mktemp
  require_command readlink
  require_command rm
  require_command sha256sum
  require_command find
  require_command grep
  require_command sort
  require_command git
  require_command node
  require_command pnpm

  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
  [[ "$node_major" == "24" ]] || fail "Node.js 24.x is required; detected: $(node --version 2>/dev/null || printf 'unknown')"

  if (( TEST_ROOT_ACTIVE == 0 && EUID != 0 )); then
    fail 'production installation and configuration must run as root'
  fi
}

print_hardware_summary() {
  local cpu_name logical_threads
  cpu_name="$(awk -F ':' '/model name|Hardware|Processor/ {sub(/^[[:space:]]+/, "", $2); print $2; exit}' /proc/cpuinfo 2>/dev/null || true)"
  logical_threads="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
  [[ -n "$cpu_name" ]] || cpu_name='Unknown; runner admission will verify it'
  [[ "$logical_threads" =~ ^[0-9]+$ ]] || logical_threads='Unknown; runner admission will verify it'
  info 'CPU:' "$cpu_name"
  info 'Logical threads:' "$logical_threads"
}

confirm_plan() {
  local operation="$1"
  (( PLAN_ONLY == 0 )) || return 0
  prompt_yes_no "$operation" 'no'
  [[ "$REPLY" == "yes" ]]
}

safe_install_directory() {
  if [[ -L "$MANAGED_MARKER" ]]; then
    fail "application ownership marker is invalid and was preserved: $MANAGED_MARKER"
  elif [[ -e "$MANAGED_MARKER" && ! -f "$MANAGED_MARKER" ]]; then
    fail "application ownership marker is invalid and was preserved: $MANAGED_MARKER"
  elif [[ -L "$APP_DIR" ]]; then
    fail "application directory is a symbolic link and was preserved: $APP_DIR"
  elif [[ -d "$APP_DIR" && ! -e "$MANAGED_MARKER" ]]; then
    if find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
      fail "application directory contains an unknown installation and was preserved: $APP_DIR"
    fi
  elif [[ -e "$APP_DIR" && ! -d "$APP_DIR" ]]; then
    fail "application path is occupied by a non-directory and was preserved: $APP_DIR"
  fi
}

safe_symlink() {
  local target="$1" link_path="$2" legacy_target="${3:-}" older_target="${4:-}"
  local parent temporary current
  parent="$(dirname -- "$link_path")"
  if [[ -L "$link_path" ]]; then
    current="$(readlink -- "$link_path")"
    if [[ "$current" == "$target" ]]; then
      return 0
    fi
    [[ -e "$MANAGED_MARKER" \
      && ( "$current" == "$legacy_target" || "$current" == "$older_target" ) ]] \
      || fail "command path is an unrelated symlink and was preserved: $link_path -> $current"
    temporary="$parent/.seerrng-link.$$"
    ln -s -- "$target" "$temporary"
    mv -Tf -- "$temporary" "$link_path"
    return 0
  fi
  [[ ! -e "$link_path" ]] \
    || fail "command path is occupied by an unrelated file and was preserved: $link_path"
  install -d -m 0755 "$parent"
  temporary="$parent/.seerrng-link.$$"
  ln -s -- "$target" "$temporary"
  mv -T -- "$temporary" "$link_path"
}

verify_symlink_target_available() {
  local target="$1" link_path="$2" legacy_target="${3:-}" older_target="${4:-}" current
  if [[ -L "$link_path" ]]; then
    current="$(readlink -- "$link_path")"
    if [[ "$current" == "$target" ]]; then
      return 0
    fi
    [[ -e "$MANAGED_MARKER" \
      && ( "$current" == "$legacy_target" || "$current" == "$older_target" ) ]] \
      || fail "command path is an unrelated symlink and was preserved: $link_path -> $current"
  else
    [[ ! -e "$link_path" ]] \
      || fail "command path is occupied by an unrelated file and was preserved: $link_path"
  fi
}

build_source_manifest() {
  local source relative nullglob_was_set=0
  local -a runtime_sources=()

  validate_absolute_safe_path '--engine-source-root' "$ENGINE_SOURCE_ROOT"
  [[ -d "$ENGINE_SOURCE_ROOT" && ! -L "$ENGINE_SOURCE_ROOT" ]] \
    || fail "engine source root is unavailable or is not a regular directory: $ENGINE_SOURCE_ROOT"

  SOURCE_RELATIVE_PATHS=(
    'bin/run-local-validation.mjs'
    'bin/local-validation.mjs'
    'bin/platform-tools.mjs'
  )
  SOURCE_MODES=('0755' '0644' '0644')
  SOURCE_FILES=()
  for relative in "${SOURCE_RELATIVE_PATHS[@]}"; do
    source="$ENGINE_SOURCE_ROOT/$relative"
    [[ -f "$source" && ! -L "$source" ]] \
      || fail "required engine source file is unavailable or is not a regular file: $source"
    SOURCE_FILES+=("$source")
  done

  [[ -d "$ENGINE_SOURCE_ROOT/tools/validation-engine/runtime" \
    && ! -L "$ENGINE_SOURCE_ROOT/tools/validation-engine/runtime" ]] \
    || fail "engine runtime source directory is unavailable or is not a regular directory"
  shopt -q nullglob && nullglob_was_set=1
  shopt -s nullglob
  runtime_sources=("$ENGINE_SOURCE_ROOT"/tools/validation-engine/runtime/*.mjs)
  (( nullglob_was_set == 1 )) || shopt -u nullglob
  (( ${#runtime_sources[@]} > 0 )) || fail 'engine runtime source contains no .mjs modules'
  for source in "${runtime_sources[@]}"; do
    [[ -f "$source" && ! -L "$source" ]] \
      || fail "engine runtime source is not a regular file: $source"
    relative="${source#"$ENGINE_SOURCE_ROOT/"}"
    SOURCE_FILES+=("$source")
    SOURCE_RELATIVE_PATHS+=("$relative")
    SOURCE_MODES+=('0644')
  done

  source="$ENGINE_SOURCE_ROOT/tools/validation-engine/setup/install-distributed-test-engine.sh"
  [[ -f "$source" && ! -L "$source" ]] \
    || fail "installer source is unavailable or is not a regular file: $source"
  SOURCE_FILES+=("$source")
  SOURCE_RELATIVE_PATHS+=('tools/validation-engine/setup/install-distributed-test-engine.sh')
  SOURCE_MODES+=('0755')
}

validate_managed_layout() {
  local directory destination relative
  for directory in \
    "$APP_DIR/bin" \
    "$APP_DIR/tools" \
    "$APP_DIR/tools/validation-engine" \
    "$APP_DIR/tools/validation-engine/runtime" \
    "$APP_DIR/tools/validation-engine/setup"; do
    [[ ! -L "$directory" ]] \
      || fail "managed application path is a symbolic link and was preserved: $directory"
    [[ ! -e "$directory" || -d "$directory" ]] \
      || fail "managed application directory is occupied and was preserved: $directory"
  done
  for relative in "${SOURCE_RELATIVE_PATHS[@]}"; do
    destination="$APP_DIR/$relative"
    [[ ! -L "$destination" ]] \
      || fail "managed application file is a symbolic link and was preserved: $destination"
    [[ ! -e "$destination" || -f "$destination" ]] \
      || fail "managed application file is occupied and was preserved: $destination"
  done
}

backup_managed_application() {
  local backup_dir backup_parent destination index relative timestamp
  local -a changed_indexes=()
  for index in "${!SOURCE_FILES[@]}"; do
    destination="$APP_DIR/${SOURCE_RELATIVE_PATHS[$index]}"
    [[ -e "$destination" ]] || continue
    [[ "$(sha256sum "${SOURCE_FILES[$index]}" | awk '{print $1}')" \
      == "$(sha256sum "$destination" | awk '{print $1}')" ]] || changed_indexes+=("$index")
  done
  (( ${#changed_indexes[@]} > 0 )) || return 0

  prompt_yes_no 'Replace changed managed engine files after preserving their current contents?' 'no'
  [[ "$REPLY" == 'yes' ]] || fail 'managed engine update was cancelled'
  timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
  backup_parent="$STATE_DIR/install-backups"
  install -d -m 0750 "$backup_parent"
  backup_dir="$(mktemp -d "$backup_parent/$timestamp.XXXXXX")"
  for index in "${changed_indexes[@]}"; do
    relative="${SOURCE_RELATIVE_PATHS[$index]}"
    destination="$APP_DIR/$relative"
    install -d -m 0750 "$backup_dir/$(dirname -- "$relative")"
    install -m "${SOURCE_MODES[$index]}" "$destination" "$backup_dir/$relative"
  done
}

write_atomic_text() {
  local destination="$1" mode="$2" content="$3" parent temporary
  parent="$(dirname -- "$destination")"
  install -d -m 0750 "$parent"
  temporary="$(mktemp "$parent/.seerrng-write.XXXXXX")"
  printf '%s' "$content" >"$temporary"
  chmod "$mode" "$temporary"
  mv -f -- "$temporary" "$destination"
}

install_atomic_file() {
  local source="$1" destination="$2" mode="$3" parent temporary source_real destination_real
  source_real="$(readlink -f -- "$source")"
  destination_real="$(readlink -f -- "$destination" 2>/dev/null || true)"
  [[ -z "$destination_real" || "$source_real" != "$destination_real" ]] || return 0
  parent="$(dirname -- "$destination")"
  install -d -m 0755 "$parent"
  temporary="$(mktemp "$parent/.seerrng-file.XXXXXX")"
  install -m "$mode" "$source" "$temporary"
  mv -f -- "$temporary" "$destination"
}

install_source_manifest() {
  local index
  for index in "${!SOURCE_FILES[@]}"; do
    install_atomic_file \
      "${SOURCE_FILES[$index]}" \
      "$APP_DIR/${SOURCE_RELATIVE_PATHS[$index]}" \
      "${SOURCE_MODES[$index]}"
  done
}

service_name_for_role() {
  printf 'seerrng-test-engine-%s.service' "$1"
}

service_mode_for_role() {
  [[ "$1" == 'controller' ]] && printf '%s' '--distributed-controller-service' || printf '%s' '--distributed-node'
}

print_manual_node_start_command() {
  print_section 'MANUAL NODE START'
  printf '  Verified application provisioning is required before this node can serve tests.\n'
  printf '  Replace ID=ABSOLUTE_ROOT with each explicit application binding, then run:\n\n'
  printf '  %s --distributed-node --active-config-marker %s --state-root %s --log-root %s --app ID=ABSOLUTE_ROOT\n' \
    "$COMMAND_PATH" "$ACTIVE_CONFIG_MARKER" "$STATE_DIR" "$LOG_DIR"
}

write_service_unit() {
  local role="$1" unit_path service_mode user_line content
  [[ "$role" != 'node' ]] \
    || fail "$NODE_AUTOMATIC_DEFERRED_MESSAGE"
  unit_path="$SYSTEMD_DIR/$(service_name_for_role "$role")"
  service_mode="$(service_mode_for_role "$role")"
  user_line=""
  [[ -z "$SERVICE_USER" ]] || user_line="User=$SERVICE_USER"
  content="# Managed by SeerrNG Distributed Test Engine Installer v$SCRIPT_VERSION
[Unit]
Description=SeerrNG Distributed Test Engine ${role^}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
$user_line
ExecStart=$COMMAND_PATH $service_mode --active-config-marker $ACTIVE_CONFIG_MARKER --state-root $STATE_DIR --log-root $LOG_DIR
Restart=on-failure
RestartSec=5s
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
"

  if [[ -e "$unit_path" ]] && ! grep -q '^# Managed by SeerrNG Distributed Test Engine Installer' "$unit_path"; then
    fail "systemd unit is not installer-owned and was preserved: $unit_path"
  fi
  write_atomic_text "$unit_path" 0644 "$content"
}

install_runner_role() {
  local role="$1" startup existing_role unit_path
  build_source_manifest

  startup="$STARTUP_CHOICE"
  if [[ -z "$startup" ]]; then
    print_section 'STARTUP'
    if [[ "$role" == 'node' ]]; then
      printf '  Automatic node startup is deferred until verified application provisioning\n'
      printf '  can supply an explicit --app ID=ABSOLUTE_ROOT binding.\n'
      printf '  The current installer sets up the node for manual foreground startup.\n'
      startup='manual'
    else
      printf '  %s1%s  Start automatically at boot with systemd\n' "$ORANGE" "$RESET"
      printf '  %s2%s  Start manually\n\n' "$ORANGE" "$RESET"
      read_menu_choice '  Selection [1-2, default 2]: '
      case "$REPLY" in
        1) startup='automatic' ;;
        ''|2) startup='manual' ;;
        *) fail 'startup selection must be 1 or 2' ;;
      esac
    fi
  fi

  if [[ "$role" == 'node' && "$startup" == 'automatic' ]]; then
    fail "$NODE_AUTOMATIC_DEFERRED_MESSAGE; select manual startup"
  fi

  if [[ "$startup" == 'automatic' ]]; then
    command -v "$SYSTEMCTL_BIN" >/dev/null 2>&1 \
      || (( TEST_ROOT_ACTIVE == 1 )) \
      || fail "systemd startup was selected but systemctl is unavailable: $SYSTEMCTL_BIN"
    [[ "$SERVICE_USER" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] \
      || fail "service user is invalid: $SERVICE_USER"
    if (( TEST_ROOT_ACTIVE == 0 )); then
      id -u "$SERVICE_USER" >/dev/null 2>&1 \
        || fail "service user does not exist: $SERVICE_USER"
    fi
  fi

  print_header
  print_section "INSTALL ${role^^}"
  info 'Engine source:' "$ENGINE_SOURCE_ROOT"
  info 'Application:' "$APP_DIR"
  info 'Command:' "$COMMAND_PATH"
  info 'Configuration:' "$CONFIG_DIR"
  info 'State:' "$STATE_DIR"
  info 'Logs:' "$LOG_DIR"
  info 'Startup:' "$startup"
  [[ "$startup" != 'automatic' ]] || info 'Service account:' "$SERVICE_USER"

  if (( PLAN_ONLY == 1 )); then
    printf '\n%s[PLAN COMPLETE]%s No files or services were changed.\n' "$GREEN" "$RESET"
    return 0
  fi
  confirm_plan "Install this $role?" || {
    printf '\n%s[CANCELLED]%s Nothing was changed.\n' "$MAGENTA" "$RESET"
    return 0
  }

  safe_install_directory
  validate_managed_layout
  verify_symlink_target_available "$INSTALLED_RUNNER" "$COMMAND_PATH" "$LEGACY_INSTALLED_RUNNER"
  verify_symlink_target_available \
    "$INSTALLED_SETUP" "$SETUP_COMMAND_PATH" "$LEGACY_INSTALLED_SETUP" "$OLDER_INSTALLED_SETUP"
  if [[ -f "$ROLE_FILE" ]]; then
    existing_role="$(<"$ROLE_FILE")"
    [[ "$existing_role" == "$role" ]] \
      || fail "this installation is already assigned as $existing_role and was preserved"
  fi
  if [[ "$startup" == 'automatic' ]]; then
    unit_path="$SYSTEMD_DIR/$(service_name_for_role "$role")"
    if [[ -e "$unit_path" ]] && ! grep -q '^# Managed by SeerrNG Distributed Test Engine Installer' "$unit_path"; then
      fail "systemd unit is not installer-owned and was preserved: $unit_path"
    fi
  fi

  install -d -m 0755 \
    "$APP_DIR/bin" \
    "$APP_DIR/tools/validation-engine/runtime" \
    "$(dirname -- "$COMMAND_PATH")" \
    "$(dirname -- "$SETUP_COMMAND_PATH")"
  install -d -m 0750 "$CONFIG_DIR" "$STATE_DIR" "$LOG_DIR"
  : >"$MANAGED_MARKER"
  chmod 0644 "$MANAGED_MARKER"
  backup_managed_application
  install_source_manifest

  safe_symlink "$INSTALLED_RUNNER" "$COMMAND_PATH" "$LEGACY_INSTALLED_RUNNER"
  safe_symlink \
    "$INSTALLED_SETUP" "$SETUP_COMMAND_PATH" "$LEGACY_INSTALLED_SETUP" "$OLDER_INSTALLED_SETUP"
  write_atomic_text "$ROLE_FILE" 0644 "$role"$'\n'
  write_atomic_text "$STARTUP_FILE" 0644 "$startup"$'\n'

  if [[ "$startup" == 'automatic' ]]; then
    write_service_unit "$role"
    if (( TEST_ROOT_ACTIVE == 0 )); then
      "$SYSTEMCTL_BIN" daemon-reload
    else
      printf '\n%s[TEST ROOT]%s systemd was not invoked.\n' "$ORANGE" "$RESET"
    fi
  fi

  printf '\n%s[INSTALLED]%s %s runner installation completed.\n' "$GREEN" "$RESET" "${role^}"

  local configure_answer="$CONFIGURE_NOW"
  if [[ -z "$configure_answer" ]]; then
    prompt_yes_no "Configure the $role now?" 'yes'
    configure_answer="$REPLY"
  fi
  if [[ "$configure_answer" == 'yes' ]]; then
    if [[ "$role" == 'controller' ]]; then
      configure_controller
    else
      configure_node
    fi
  else
    printf '  Configuration remains incomplete; no service was started.\n'
    [[ "$role" != 'node' ]] || print_manual_node_start_command
  fi
}

validate_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( 10#$1 >= 1 && 10#$1 <= 65535 ))
}

valid_github_username() {
  local value="$1"
  (( ${#value} >= 1 && ${#value} <= 39 )) || return 1
  [[ "$value" =~ ^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$ ]]
}

valid_thread_rule() {
  [[ "$1" =~ ^([1-9][0-9]*|(([2-9]|[1-9][0-9]+)?n)([+-][1-9][0-9]*)?)$ ]]
}

valid_minimum_thread_count() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]] && (( 10#$1 <= 256 ))
}

valid_ip_address() {
  node -e \
    'process.exit(require("node:net").isIP(process.argv[1]) === 0 ? 1 : 0)' \
    "$1"
}

require_installed_role() {
  local expected="$1" actual
  [[ -x "$COMMAND_PATH" ]] || fail "runner is not installed: $COMMAND_PATH"
  [[ -f "$ROLE_FILE" ]] || fail 'installation role is missing; run Install Controller or Install Node first'
  actual="$(<"$ROLE_FILE")"
  [[ "$actual" == "$expected" ]] || fail "installed role is $actual, not $expected"
}

require_installed_runner() {
  [[ -x "$COMMAND_PATH" ]] || fail "runner is not installed: $COMMAND_PATH"
  [[ -f "$ROLE_FILE" ]] || fail 'installation role is missing; run Install Controller or Install Node first'
  INSTALLED_ROLE="$(<"$ROLE_FILE")"
  [[ "$INSTALLED_ROLE" == 'controller' || "$INSTALLED_ROLE" == 'node' ]] \
    || fail "installed role is invalid: $INSTALLED_ROLE"
}

require_active_config_path() {
  local marker_text
  [[ -f "$ACTIVE_CONFIG_MARKER" && ! -L "$ACTIVE_CONFIG_MARKER" ]] \
    || fail "active configuration marker is unavailable: $ACTIVE_CONFIG_MARKER"
  marker_text="$(<"$ACTIVE_CONFIG_MARKER")"
  [[ "$marker_text" != *$'\n'* && "$marker_text" != *$'\r'* ]] \
    || fail 'active configuration marker must contain exactly one path'
  validate_absolute_safe_path 'active configuration' "$marker_text"
  [[ -f "$marker_text" && ! -L "$marker_text" ]] \
    || fail "active configuration is unavailable: $marker_text"
  ACTIVE_CONFIG_PATH="$marker_text"
}

load_supported_applications() {
  local json_file parsed_file entry_id application_id application_name profile_path
  require_installed_runner
  require_active_config_path
  json_file="$(mktemp)"
  parsed_file="$(mktemp)"
  if ! "$COMMAND_PATH" \
    --distributed-applications \
    --active-config-marker "$ACTIVE_CONFIG_MARKER" \
    --json >"$json_file"; then
    rm -f -- "$json_file" "$parsed_file"
    fail 'the controller application list could not be read'
  fi
  if ! node -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        !Array.isArray(value.applications)) throw new Error("invalid application list");
    for (const entry of value.applications) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
          typeof entry.entryId !== "string" ||
          typeof entry.applicationId !== "string" ||
          typeof entry.name !== "string" ||
          typeof entry.profilePath !== "string" ||
          [entry.entryId, entry.applicationId, entry.name, entry.profilePath].some((item) => /[\t\r\n]/.test(item)))
        throw new Error("invalid application entry");
      process.stdout.write(`${entry.entryId}\t${entry.applicationId}\t${entry.name}\t${entry.profilePath}\n`);
    }
  ' "$json_file" >"$parsed_file"; then
    rm -f -- "$json_file" "$parsed_file"
    fail 'the controller returned an invalid application list'
  fi
  rm -f -- "$json_file"

  APPLICATION_ENTRY_IDS=()
  APPLICATION_IDS=()
  APPLICATION_NAMES=()
  APPLICATION_PROFILE_PATHS=()
  while IFS=$'\t' read -r entry_id application_id application_name profile_path; do
    [[ -n "$entry_id" ]] || continue
    [[ "$entry_id" =~ ^(0[1-9]|[1-9][0-9])$ ]] \
      || { rm -f -- "$parsed_file"; fail "controller returned an invalid application entry id: $entry_id"; }
    valid_application_text "$application_id" \
      || { rm -f -- "$parsed_file"; fail 'controller returned an invalid application id'; }
    valid_application_text "$application_name" \
      || { rm -f -- "$parsed_file"; fail 'controller returned an invalid application name'; }
    APPLICATION_ENTRY_IDS+=("$entry_id")
    APPLICATION_IDS+=("$application_id")
    APPLICATION_NAMES+=("$application_name")
    APPLICATION_PROFILE_PATHS+=("$profile_path")
  done <"$parsed_file"
  rm -f -- "$parsed_file"
}

load_controller_nodes() {
  local json_file parsed_file node_number computer_name cpu_name available_threads thread_rule minimum_threads
  require_installed_role 'controller'
  require_active_config_path
  json_file="$(mktemp)"
  parsed_file="$(mktemp)"
  if ! "$COMMAND_PATH" \
    --distributed-node-thread-policy \
    --active-config-marker "$ACTIVE_CONFIG_MARKER" \
    --json >"$json_file"; then
    rm -f -- "$json_file" "$parsed_file"
    fail 'the enrolled node list could not be read'
  fi
  if ! node -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        !Array.isArray(value.nodes)) throw new Error("invalid node list");
    const safe = (item) => typeof item === "string" && item.length > 0 && !/[\t\r\n]/.test(item);
    for (const node of value.nodes) {
      if (!node || typeof node !== "object" || Array.isArray(node) ||
          !/^(0[1-9]|[1-9][0-9])$/.test(node.nodeNumber) ||
          !safe(node.computerName) || !safe(node.cpuName) ||
          !Number.isSafeInteger(node.availableThreads) || node.availableThreads < 1 ||
          !(node.threads === null || safe(node.threads)) ||
          !(node.minimumThreadCount === null ||
            (Number.isSafeInteger(node.minimumThreadCount) && node.minimumThreadCount >= 1)))
        throw new Error("invalid enrolled node");
      process.stdout.write(`${node.nodeNumber}\t${node.computerName}\t${node.cpuName}\t${node.availableThreads}\t${node.threads ?? ""}\t${node.minimumThreadCount ?? ""}\n`);
    }
  ' "$json_file" >"$parsed_file"; then
    rm -f -- "$json_file" "$parsed_file"
    fail 'the runner returned an invalid enrolled node list'
  fi
  rm -f -- "$json_file"

  CONTROLLER_NODE_NUMBERS=()
  CONTROLLER_NODE_NAMES=()
  CONTROLLER_NODE_CPUS=()
  CONTROLLER_NODE_AVAILABLE_THREADS=()
  CONTROLLER_NODE_THREAD_RULES=()
  CONTROLLER_NODE_MINIMUM_THREADS=()
  while IFS=$'\t' read -r node_number computer_name cpu_name available_threads thread_rule minimum_threads; do
    [[ -n "$node_number" ]] || continue
    CONTROLLER_NODE_NUMBERS+=("$node_number")
    CONTROLLER_NODE_NAMES+=("$computer_name")
    CONTROLLER_NODE_CPUS+=("$cpu_name")
    CONTROLLER_NODE_AVAILABLE_THREADS+=("$available_threads")
    CONTROLLER_NODE_THREAD_RULES+=("$thread_rule")
    CONTROLLER_NODE_MINIMUM_THREADS+=("$minimum_threads")
  done <"$parsed_file"
  rm -f -- "$parsed_file"
}

configure_controller_node_policy() {
  local answer index node_number thread_rule minimum_threads current_rule current_minimum
  load_controller_nodes
  (( ${#CONTROLLER_NODE_NUMBERS[@]} > 0 )) \
    || fail 'no enrolled nodes are available for thread-policy assignment'
  print_header
  print_section 'ENROLLED NODE THREAD POLICY'
  for index in "${!CONTROLLER_NODE_NUMBERS[@]}"; do
    current_rule="${CONTROLLER_NODE_THREAD_RULES[$index]:-unassigned}"
    current_minimum="${CONTROLLER_NODE_MINIMUM_THREADS[$index]:-unassigned}"
    printf '  %s%d%s  Node %s - %s\n' \
      "$ORANGE" "$((index + 1))" "$RESET" \
      "${CONTROLLER_NODE_NUMBERS[$index]}" "${CONTROLLER_NODE_NAMES[$index]}"
    printf '      %s; %s available threads; policy %s (minimum %s)\n' \
      "${CONTROLLER_NODE_CPUS[$index]}" \
      "${CONTROLLER_NODE_AVAILABLE_THREADS[$index]}" \
      "$current_rule" "$current_minimum"
  done
  printf '\n'
  prompt_value 'Node selection number' ''
  answer="$REPLY"
  [[ "$answer" =~ ^[1-9][0-9]*$ ]] \
    || fail 'node selection must be a listed number'
  index=$((10#$answer - 1))
  (( index >= 0 && index < ${#CONTROLLER_NODE_NUMBERS[@]} )) \
    || fail 'node selection is unavailable'
  node_number="${CONTROLLER_NODE_NUMBERS[$index]}"
  current_rule="${CONTROLLER_NODE_THREAD_RULES[$index]:-n-1}"
  current_minimum="${CONTROLLER_NODE_MINIMUM_THREADS[$index]:-1}"
  prompt_value 'Node threads (n, n-1, 2n, or a number)' "$current_rule"
  thread_rule="${REPLY//[[:space:]]/}"
  valid_thread_rule "$thread_rule" || fail 'node thread setting is invalid'
  prompt_value 'Minimum thread count' "$current_minimum"
  minimum_threads="$REPLY"
  valid_minimum_thread_count "$minimum_threads" \
    || fail 'minimum thread count must be from 1 through 256'

  print_section 'THREAD POLICY PLAN'
  info 'Node:' "$node_number - ${CONTROLLER_NODE_NAMES[$index]}"
  info 'Threads:' "$thread_rule"
  info 'Minimum threads:' "$minimum_threads"
  if (( PLAN_ONLY == 0 )); then
    confirm_plan 'Assign this node thread policy?' || {
      printf '\n%s[CANCELLED]%s Node thread policy was not changed.\n' "$MAGENTA" "$RESET"
      return 0
    }
  fi
  run_or_plan "$COMMAND_PATH" \
    --distributed-node-thread-policy \
    --active-config-marker "$ACTIVE_CONFIG_MARKER" \
    --node-id "$node_number" \
    --thread-rule "$thread_rule" \
    --minimum-thread-count "$minimum_threads"
  printf '\n%s[CONFIGURED]%s Node %s thread policy completed.\n' \
    "$GREEN" "$RESET" "$node_number"
}

print_controller_applications() {
  local index
  load_supported_applications
  print_header
  print_section 'SUPPORTED APPLICATIONS'
  if (( ${#APPLICATION_IDS[@]} == 0 )); then
    printf '  %sNo applications are configured.%s\n' "$GRAY" "$RESET"
    return 0
  fi
  for index in "${!APPLICATION_IDS[@]}"; do
    printf '  %s%d%s  %s%s%s (%s)\n' \
      "$ORANGE" "$((index + 1))" "$RESET" "$WHITE" \
      "${APPLICATION_NAMES[$index]}" "$RESET" "${APPLICATION_IDS[$index]}"
    printf '      %sEntry %s%s\n' "$GRAY" "${APPLICATION_ENTRY_IDS[$index]}" "$RESET"
    printf '      %s%s%s\n' "$GRAY" "${APPLICATION_PROFILE_PATHS[$index]}" "$RESET"
  done
}

add_controller_application() {
  local profile_application_name application_id application_name
  require_installed_role 'controller'
  require_active_config_path
  choose_dependency_profile_file "$PWD" || return 0
  profile_application_name="$(basename -- "$SELECTED_PROFILE_FILE")"
  profile_application_name="${profile_application_name%"$DEPENDENCY_PROFILE_SUFFIX"}"
  validate_dependency_profile_file "$SELECTED_PROFILE_FILE" "$profile_application_name"

  print_header
  print_section 'ADD SUPPORTED APPLICATION'
  info 'Dependency profile:' "$SELECTED_PROFILE_FILE"
  prompt_value 'Application ID (product and version)' ''
  application_id="$REPLY"
  valid_application_text "$application_id" \
    || fail 'application ID must name the product and version'
  prompt_value 'Descriptive instance name' "$application_id"
  application_name="$REPLY"
  valid_application_text "$application_name" \
    || fail 'descriptive instance name is invalid'
  confirm_plan "Add $application_name to the controller?" || {
    printf '\n%s[CANCELLED]%s Supported applications were not changed.\n' "$MAGENTA" "$RESET"
    return 0
  }
  run_or_plan "$COMMAND_PATH" \
    --distributed-app-add \
    --active-config-marker "$ACTIVE_CONFIG_MARKER" \
    --application-id "$application_id" \
    --application-name "$application_name" \
    --dependency-profile "$SELECTED_PROFILE_FILE" \
    --json
  printf '\n%s[ADDED]%s %s is available to the controller.\n' \
    "$GREEN" "$RESET" "$application_name"
}

delete_controller_application() {
  local answer index entry_id application_name
  load_supported_applications
  print_header
  print_section 'DELETE SUPPORTED APPLICATION'
  if (( ${#APPLICATION_IDS[@]} == 0 )); then
    printf '  %sNo applications are configured.%s\n' "$GRAY" "$RESET"
    return 0
  fi
  for index in "${!APPLICATION_IDS[@]}"; do
    printf '  %s%d%s  %s%s%s (%s)\n' \
      "$ORANGE" "$((index + 1))" "$RESET" "$WHITE" \
      "${APPLICATION_NAMES[$index]}" "$RESET" "${APPLICATION_IDS[$index]}"
  done
  printf '  %s0%s  Cancel\n\n' "$ORANGE" "$RESET"
  prompt_value 'Application number to delete' ''
  answer="$REPLY"
  [[ "$answer" != '0' ]] || return 0
  [[ "$answer" =~ ^[1-9][0-9]*$ ]] \
    || fail 'application selection must be a listed number'
  index=$((10#$answer - 1))
  (( index >= 0 && index < ${#APPLICATION_IDS[@]} )) \
    || fail 'application selection is unavailable'
  entry_id="${APPLICATION_ENTRY_IDS[$index]}"
  application_name="${APPLICATION_NAMES[$index]}"
  prompt_yes_no "Delete $application_name from supported applications?" 'no'
  [[ "$REPLY" == 'yes' ]] || {
    printf '\n%s[CANCELLED]%s Supported applications were not changed.\n' "$MAGENTA" "$RESET"
    return 0
  }
  run_or_plan "$COMMAND_PATH" \
    --distributed-app-delete \
    --active-config-marker "$ACTIVE_CONFIG_MARKER" \
    --application "$entry_id" \
    --json
  printf '\n%s[DELETED]%s %s was removed from supported applications.\n' \
    "$GREEN" "$RESET" "$application_name"
}

manage_controller_applications() {
  require_installed_role 'controller'
  while true; do
    print_header
    print_section 'CONTROLLER APPLICATIONS'
    printf '  %s1%s  List Supported Applications\n' "$ORANGE" "$RESET"
    printf '  %s2%s  Add Supported Application\n' "$ORANGE" "$RESET"
    printf '  %s3%s  Delete Supported Application\n' "$ORANGE" "$RESET"
    printf '  %s0%s  Return\n\n' "$ORANGE" "$RESET"
    read_menu_choice '  Selection [0-3]: '
    case "$REPLY" in
      1) print_controller_applications; pause_menu ;;
      2) add_controller_application; pause_menu ;;
      3) delete_controller_application; pause_menu ;;
      0) return 0 ;;
      *)
        printf '\n%s[INVALID INPUT]%s Select 0, 1, 2, or 3.\n' "$RED" "$RESET"
        pause_menu
        ;;
    esac
  done
}

select_application_entries() {
  local answer token index
  local -a tokens=()
  local -A selected=()
  load_supported_applications
  print_header
  print_section 'SELECT APPLICATIONS'
  (( ${#APPLICATION_ENTRY_IDS[@]} > 0 )) \
    || fail 'no supported applications are configured'
  for index in "${!APPLICATION_ENTRY_IDS[@]}"; do
    printf '  %s%d%s  %s%s%s (%s, entry %s)\n' \
      "$ORANGE" "$((index + 1))" "$RESET" "$WHITE" \
      "${APPLICATION_NAMES[$index]}" "$RESET" "${APPLICATION_IDS[$index]}" \
      "${APPLICATION_ENTRY_IDS[$index]}"
  done
  printf '\n'
  prompt_value 'One or more application numbers, separated by commas' ''
  answer="${REPLY//[[:space:]]/}"
  [[ -n "$answer" ]] || fail 'at least one application must be selected'
  IFS=',' read -r -a tokens <<<"$answer"
  SELECTED_APPLICATION_ARGS=()
  for token in "${tokens[@]}"; do
    [[ "$token" =~ ^[1-9][0-9]*$ ]] \
      || fail "application selection is invalid: $token"
    index=$((10#$token - 1))
    (( index >= 0 && index < ${#APPLICATION_ENTRY_IDS[@]} )) \
      || fail "application selection is unavailable: $token"
    [[ -z "${selected[$index]:-}" ]] || continue
    selected[$index]=1
    SELECTED_APPLICATION_ARGS+=(--application "${APPLICATION_ENTRY_IDS[$index]}")
  done
}

load_dependency_plan() {
  local dependency_name="${1:-}" json_file parsed_file record first second
  local -a selection_arguments=("${SELECTED_APPLICATION_ARGS[@]}")
  (( ${#selection_arguments[@]} > 0 )) \
    || fail 'dependency planning requires an application selection'
  json_file="$(mktemp)"
  parsed_file="$(mktemp)"
  local -a command=("$COMMAND_PATH" \
    --distributed-dependency-plan \
    --active-config-marker "$ACTIVE_CONFIG_MARKER" \
    "${selection_arguments[@]}")
  [[ -z "$dependency_name" ]] || command+=(--dependency-name "$dependency_name")
  command+=(--json)
  if ! "${command[@]}" >"$json_file"; then
    rm -f -- "$json_file" "$parsed_file"
    fail 'the dependency plan could not be resolved'
  fi
  if ! node -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        !Array.isArray(value.selectedApplications) || !Array.isArray(value.dependencies))
      throw new Error("invalid dependency plan");
    const safe = (item) => typeof item === "string" && item.length > 0 && !/[\t\r\n]/.test(item);
    for (const entry of value.selectedApplications) {
      if (!entry || typeof entry !== "object" || !safe(entry.entryId) ||
          !safe(entry.applicationId) || !safe(entry.name))
        throw new Error("invalid selected application");
      process.stdout.write(`A\t${entry.entryId}\t${entry.name}\n`);
    }
    for (const dependency of value.dependencies) {
      if (!dependency || typeof dependency !== "object" ||
          !safe(dependency.name) || !safe(dependency.version))
        throw new Error("invalid dependency requirement");
      process.stdout.write(`D\t${dependency.name}\t${dependency.version}\n`);
    }
  ' "$json_file" >"$parsed_file"; then
    rm -f -- "$json_file" "$parsed_file"
    fail 'the controller returned an invalid dependency plan'
  fi
  rm -f -- "$json_file"

  PLANNED_APPLICATION_ENTRY_IDS=()
  PLANNED_APPLICATION_NAMES=()
  PLANNED_DEPENDENCY_NAMES=()
  PLANNED_DEPENDENCY_VERSIONS=()
  while IFS=$'\t' read -r record first second; do
    case "$record" in
      A)
        [[ "$first" =~ ^(0[1-9]|[1-9][0-9])$ ]] \
          || { rm -f -- "$parsed_file"; fail 'dependency plan contains an invalid application entry'; }
        PLANNED_APPLICATION_ENTRY_IDS+=("$first")
        PLANNED_APPLICATION_NAMES+=("$second")
        ;;
      D)
        PLANNED_DEPENDENCY_NAMES+=("$first")
        PLANNED_DEPENDENCY_VERSIONS+=("$second")
        ;;
      '') ;;
      *)
        rm -f -- "$parsed_file"
        fail 'dependency plan contains an unknown record'
        ;;
    esac
  done <"$parsed_file"
  rm -f -- "$parsed_file"
  (( ${#PLANNED_APPLICATION_ENTRY_IDS[@]} > 0 )) \
    || fail 'dependency plan selected no applications'
  (( ${#PLANNED_DEPENDENCY_NAMES[@]} > 0 )) \
    || fail 'dependency plan contains no requirements'
}

print_dependency_plan() {
  local index
  print_section 'APPLICATIONS'
  for index in "${!PLANNED_APPLICATION_ENTRY_IDS[@]}"; do
    printf '  %s%s%s (entry %s)\n' "$WHITE" \
      "${PLANNED_APPLICATION_NAMES[$index]}" "$RESET" \
      "${PLANNED_APPLICATION_ENTRY_IDS[$index]}"
  done
  print_section 'DEPENDENCIES'
  for index in "${!PLANNED_DEPENDENCY_NAMES[@]}"; do
    info "${PLANNED_DEPENDENCY_NAMES[$index]}:" "${PLANNED_DEPENDENCY_VERSIONS[$index]}"
  done
}

select_manual_dependency() {
  local answer index
  print_header
  print_section 'SELECT ONE DEPENDENCY'
  for index in "${!PLANNED_DEPENDENCY_NAMES[@]}"; do
    printf '  %s%d%s  %s%s%s (%s)\n' \
      "$ORANGE" "$((index + 1))" "$RESET" "$WHITE" \
      "${PLANNED_DEPENDENCY_NAMES[$index]}" "$RESET" \
      "${PLANNED_DEPENDENCY_VERSIONS[$index]}"
  done
  printf '  %s0%s  Cancel\n\n' "$ORANGE" "$RESET"
  prompt_value 'Dependency number' ''
  answer="$REPLY"
  [[ "$answer" != '0' ]] || return 1
  [[ "$answer" =~ ^[1-9][0-9]*$ ]] \
    || fail 'dependency selection must be a listed number'
  index=$((10#$answer - 1))
  (( index >= 0 && index < ${#PLANNED_DEPENDENCY_NAMES[@]} )) \
    || fail 'dependency selection is unavailable'
  REPLY="${PLANNED_DEPENDENCY_NAMES[$index]}"
}

install_planned_dependencies() {
  # Fixed, dependency-specific installers are added only after the application
  # profile names, versions, and approved sources are known. Never execute a
  # repository-supplied command or treat a dependency name as a shell command.
  fail 'dependency installer adapters are not configured for this profile yet'
}

install_test_dependencies() {
  local manual_dependency=""
  require_installed_runner
  require_active_config_path
  while true; do
    print_header
    print_section 'APPLICATION TEST DEPENDENCIES'
    printf '  %s1%s  Select One or More Applications\n' "$ORANGE" "$RESET"
    printf '  %s2%s  Install All Supported Applications\n' "$ORANGE" "$RESET"
    printf '  %s3%s  Manual Dependency Installation\n' "$ORANGE" "$RESET"
    printf '  %s0%s  Return\n\n' "$ORANGE" "$RESET"
    read_menu_choice '  Selection [0-3]: '
    case "$REPLY" in
      1)
        select_application_entries
        load_dependency_plan
        break
        ;;
      2)
        SELECTED_APPLICATION_ARGS=(--all-applications)
        load_dependency_plan
        break
        ;;
      3)
        SELECTED_APPLICATION_ARGS=(--all-applications)
        load_dependency_plan
        select_manual_dependency || return 0
        manual_dependency="$REPLY"
        load_dependency_plan "$manual_dependency"
        break
        ;;
      0) return 0 ;;
      *)
        printf '\n%s[INVALID INPUT]%s Select 0, 1, 2, or 3.\n' "$RED" "$RESET"
        pause_menu
        ;;
    esac
  done

  print_header
  print_section 'DEPENDENCY INSTALLATION PLAN'
  print_dependency_plan
  confirm_plan 'Install or repair these test dependencies?' || {
    printf '\n%s[CANCELLED]%s No dependencies were changed.\n' "$MAGENTA" "$RESET"
    return 0
  }
  if (( PLAN_ONLY == 1 )); then
    printf '\n%s[PLAN COMPLETE]%s No dependencies were changed.\n' "$GREEN" "$RESET"
    return 0
  fi
  install_planned_dependencies
}

maybe_enable_service() {
  local role="$1" startup unit
  [[ -f "$STARTUP_FILE" ]] || return 0
  startup="$(<"$STARTUP_FILE")"
  [[ "$startup" == 'automatic' ]] || return 0
  [[ "$role" != 'node' ]] \
    || fail "$NODE_AUTOMATIC_DEFERRED_MESSAGE"
  unit="$(service_name_for_role "$role")"
  if (( TEST_ROOT_ACTIVE == 1 )); then
    printf '  Test root: service activation skipped for %s.\n' "$unit"
    return 0
  fi
  "$SYSTEMCTL_BIN" enable --now "$unit"
}

run_or_plan() {
  local -a command=("$@")
  if (( PLAN_ONLY == 1 )); then
    printf '  Planned runner invocation:'
    printf ' %q' "${command[@]}"
    printf '\n'
    return 0
  fi
  "${command[@]}"
}

configure_controller() {
  local github_username controller_name listen_address listen_port thread_rule minimum_threads action
  local config_file existing_option=()
  require_installed_role 'controller'
  if [[ -f "$ACTIVE_CONFIG_MARKER" && ! -L "$ACTIVE_CONFIG_MARKER" ]]; then
    print_header
    print_section 'CONFIGURE CONTROLLER'
    printf '  %s1%s  Update Controller Settings\n' "$ORANGE" "$RESET"
    printf '  %s2%s  Assign Enrolled Node Thread Policy\n' "$ORANGE" "$RESET"
    printf '  %s0%s  Return\n\n' "$ORANGE" "$RESET"
    read_menu_choice '  Selection [0-2, default 1]: '
    action="${REPLY:-1}"
    case "$action" in
      1) ;;
      2) configure_controller_node_policy; return 0 ;;
      0) return 0 ;;
      *) fail 'controller configuration selection must be 0, 1, or 2' ;;
    esac
  fi
  print_header
  print_section 'CONTROLLER HARDWARE'
  print_hardware_summary
  print_section 'CONTROLLER SETTINGS'

  prompt_value 'GitHub username' ''
  github_username="$REPLY"
  valid_github_username "$github_username" || fail 'GitHub username is invalid'
  prompt_value 'Controller name or description' ''
  controller_name="$REPLY"
  [[ -n "$controller_name" ]] || fail 'controller name cannot be empty'
  prompt_value 'Controller IP address' ''
  listen_address="$REPLY"
  valid_ip_address "$listen_address" || fail 'controller IP address must be an IPv4 or IPv6 address'
  prompt_value 'Controller port' '62021'
  listen_port="$REPLY"
  validate_port "$listen_port" || fail 'controller port must be between 1 and 65535'
  prompt_value 'Controller threads (n, n-1, 2n, or a number)' '2n'
  thread_rule="${REPLY//[[:space:]]/}"
  valid_thread_rule "$thread_rule" || fail 'controller thread setting is invalid'
  prompt_value 'Minimum thread count' '1'
  minimum_threads="$REPLY"
  valid_minimum_thread_count "$minimum_threads" \
    || fail 'minimum thread count must be from 1 through 256'

  config_file="$CONFIG_DIR/test-suite-multi-computer-$github_username.cfg"
  if [[ -e "$config_file" ]]; then
    prompt_yes_no 'Update this existing controller configuration?' 'no'
    [[ "$REPLY" == 'yes' ]] || fail 'existing controller configuration was preserved'
    existing_option=(--allow-existing-config-update)
  fi

  print_section 'CONFIGURATION PLAN'
  info 'Configuration:' "$config_file"
  info 'Name:' "$controller_name"
  info 'Listen address:' "$listen_address"
  info 'Port:' "$listen_port"
  info 'Threads:' "$thread_rule"
  info 'Minimum threads:' "$minimum_threads"
  printf '  CPU name and available logical threads are detected and written by the runner.\n'
  printf '  The shared cluster key is generated once and written at the bottom of the file.\n'

  if (( PLAN_ONLY == 0 )); then
    confirm_plan 'Apply this controller configuration?' || {
      printf '\n%s[CANCELLED]%s Controller configuration was not changed.\n' "$MAGENTA" "$RESET"
      return 0
    }
  fi

  run_or_plan "$COMMAND_PATH" \
    --distributed-configure-controller \
    --config-file "$config_file" \
    --profile "$github_username" \
    --controller-name "$controller_name" \
    --listen-address "$listen_address" \
    --listen-port "$listen_port" \
    --thread-rule "$thread_rule" \
    --minimum-thread-count "$minimum_threads" \
    --active-config-marker "$ACTIVE_CONFIG_MARKER" \
    --state-root "$STATE_DIR" \
    --log-root "$LOG_DIR" \
    "${existing_option[@]}"

  (( PLAN_ONLY == 1 )) || maybe_enable_service 'controller'
  printf '\n%s[CONFIGURED]%s Controller configuration completed.\n' "$GREEN" "$RESET"
}

configure_node() {
  local node_id node_name listen_address listen_port controller_address controller_port
  local config_file first_status retry_status startup
  local existing_option=()
  local -a command=()
  require_installed_role 'node'
  if [[ -f "$STARTUP_FILE" ]]; then
    startup="$(<"$STARTUP_FILE")"
    [[ "$startup" != 'automatic' ]] \
      || fail "$NODE_AUTOMATIC_DEFERRED_MESSAGE; reinstall with manual startup"
  fi
  print_header
  print_section 'NODE HARDWARE'
  print_hardware_summary
  printf '  Thread allocation is assigned only from Configure Controller.\n'
  print_section 'NODE SETTINGS'

  prompt_value 'Node number (01-99)' ''
  node_id="$REPLY"
  [[ "$node_id" =~ ^(0[1-9]|[1-9][0-9])$ ]] || fail 'node number must use two digits from 01 through 99'
  prompt_value 'Node name or description' ''
  node_name="$REPLY"
  [[ -n "$node_name" ]] || fail 'node name cannot be empty'
  prompt_value 'Node IP address' ''
  listen_address="$REPLY"
  valid_ip_address "$listen_address" || fail 'node IP address must be an IPv4 or IPv6 address'
  prompt_value 'Node listening port' '62021'
  listen_port="$REPLY"
  validate_port "$listen_port" || fail 'node port must be between 1 and 65535'
  prompt_value 'Controller IP address' ''
  controller_address="$REPLY"
  valid_ip_address "$controller_address" || fail 'controller IP address must be an IPv4 or IPv6 address'
  prompt_value 'Controller port' '62021'
  controller_port="$REPLY"
  validate_port "$controller_port" || fail 'controller port must be between 1 and 65535'

  config_file="$CONFIG_DIR/test-suite-multi-computer-node-$node_id.cfg"
  if [[ -e "$config_file" ]]; then
    prompt_yes_no 'Update this existing local node configuration?' 'no'
    [[ "$REPLY" == 'yes' ]] || fail 'existing node configuration was preserved'
    existing_option=(--allow-existing-config-update)
  fi

  print_section 'REGISTRATION PLAN'
  info 'Configuration:' "$config_file"
  info 'Node:' "$node_id - $node_name"
  info 'Node endpoint:' "$listen_address:$listen_port"
  info 'Controller:' "$controller_address:$controller_port"
  printf '  No key is required to request registration. The controller validates the\n'
  printf '  node number and returns the shared cluster key only after acceptance.\n'

  if (( PLAN_ONLY == 0 )); then
    confirm_plan 'Register and configure this node?' || {
      printf '\n%s[CANCELLED]%s Node registration was not attempted.\n' "$MAGENTA" "$RESET"
      return 0
    }
  fi

  command=("$COMMAND_PATH" \
    --distributed-configure-node \
    --config-file "$config_file" \
    --node-id "$node_id" \
    --node-name "$node_name" \
    --listen-address "$listen_address" \
    --listen-port "$listen_port" \
    --controller-address "$controller_address" \
    --controller-port "$controller_port" \
    --active-config-marker "$ACTIVE_CONFIG_MARKER" \
    --state-root "$STATE_DIR" \
    --log-root "$LOG_DIR")

  if (( PLAN_ONLY == 1 )); then
    run_or_plan "${command[@]}" "${existing_option[@]}"
  else
    if "${command[@]}" "${existing_option[@]}"; then
      first_status=0
    else
      first_status=$?
    fi

    if (( first_status != 0 && first_status != 20 )); then
      return "$first_status"
    fi

    if (( first_status == 20 )); then
      print_section 'NODE NUMBER CONFLICT'
      printf '  The controller reports that Node %s is already occupied.\n' "$node_id"
      if ! prompt_node_overwrite "$node_id"; then
        printf '  Existing controller registration was preserved.\n' >&2
        return 20
      fi

      if "${command[@]}" --allow-existing-config-update --overwrite-node; then
        retry_status=0
      else
        retry_status=$?
      fi
      (( retry_status == 0 )) || return "$retry_status"
    fi
  fi

  (( PLAN_ONLY == 1 )) || maybe_enable_service 'node'
  printf '\n%s[CONFIGURED]%s Node registration and configuration completed.\n' "$GREEN" "$RESET"
  print_manual_node_start_command
}

show_menu() {
  while true; do
    print_header
    printf '\n  Install the runner first, then configure it. Installation offers to\n'
    printf '  continue directly into configuration so the required step is not missed.\n'
    print_section 'ACTIONS'
    printf '  %s1%s  Install Controller\n' "$ORANGE" "$RESET"
    printf '  %s2%s  Configure Controller\n' "$ORANGE" "$RESET"
    printf '  %s3%s  Install Node\n' "$ORANGE" "$RESET"
    printf '  %s4%s  Configure Node\n' "$ORANGE" "$RESET"
    printf '  %s5%s  Manage Supported Applications\n' "$ORANGE" "$RESET"
    printf '  %s6%s  Install or Repair Test Dependencies\n' "$ORANGE" "$RESET"
    printf '  %s0%s  Exit\n\n' "$ORANGE" "$RESET"
    read_menu_choice '  Selection [0-6]: '
    case "$REPLY" in
      1) install_runner_role 'controller'; pause_menu ;;
      2) configure_controller; pause_menu ;;
      3) install_runner_role 'node'; pause_menu ;;
      4) configure_node; pause_menu ;;
      5) manage_controller_applications; pause_menu ;;
      6) install_test_dependencies; pause_menu ;;
      0) return 0 ;;
      *)
        printf '\n%s[INVALID INPUT]%s Select 0, 1, 2, 3, 4, 5, or 6.\n' "$RED" "$RESET"
        pause_menu
        ;;
    esac
  done
}

parse_arguments() {
  while (( $# > 0 )); do
    case "$1" in
      --action)
        shift; (( $# > 0 )) || fail '--action requires a value'; ACTION="$1" ;;
      --engine-source-root)
        shift; (( $# > 0 )) || fail '--engine-source-root requires a path'; ENGINE_SOURCE_ROOT="$1" ;;
      --startup)
        shift; (( $# > 0 )) || fail '--startup requires manual or automatic'; STARTUP_CHOICE="$1" ;;
      --configure-now)
        shift; (( $# > 0 )) || fail '--configure-now requires yes or no'; CONFIGURE_NOW="$1" ;;
      --service-user)
        shift; (( $# > 0 )) || fail '--service-user requires a value'; SERVICE_USER="$1" ;;
      --yes) ASSUME_YES=1 ;;
      --plan) PLAN_ONLY=1 ;;
      --install-root)
        shift
        (( $# > 0 )) || fail '--install-root requires a path'
        INSTALL_ROOT="$1"
        apply_install_root
        ;;
      --app-dir)
        shift; (( $# > 0 )) || fail '--app-dir requires a path'; APP_DIR="$1" ;;
      --command-path)
        shift; (( $# > 0 )) || fail '--command-path requires a path'; COMMAND_PATH="$1" ;;
      --setup-command-path)
        shift; (( $# > 0 )) || fail '--setup-command-path requires a path'; SETUP_COMMAND_PATH="$1" ;;
      --config-dir)
        shift; (( $# > 0 )) || fail '--config-dir requires a path'; CONFIG_DIR="$1" ;;
      --state-dir)
        shift; (( $# > 0 )) || fail '--state-dir requires a path'; STATE_DIR="$1" ;;
      --log-dir)
        shift; (( $# > 0 )) || fail '--log-dir requires a path'; LOG_DIR="$1" ;;
      --systemd-dir)
        shift; (( $# > 0 )) || fail '--systemd-dir requires a path'; SYSTEMD_DIR="$1" ;;
      --systemctl)
        shift; (( $# > 0 )) || fail '--systemctl requires a path'; SYSTEMCTL_BIN="$1" ;;
      --help|-h) usage; exit 0 ;;
      *) fail "unknown option: $1" ;;
    esac
    shift
  done

  case "$ACTION" in
    menu|install-controller|configure-controller|install-node|configure-node|manage-applications|install-dependencies) ;;
    *) fail "unsupported action: $ACTION" ;;
  esac
  [[ -z "$STARTUP_CHOICE" || "$STARTUP_CHOICE" == 'manual' || "$STARTUP_CHOICE" == 'automatic' ]] \
    || fail '--startup must be manual or automatic'
  [[ -z "$CONFIGURE_NOW" || "$CONFIGURE_NOW" == 'yes' || "$CONFIGURE_NOW" == 'no' ]] \
    || fail '--configure-now must be yes or no'
}

main() {
  parse_arguments "$@"
  refresh_derived_paths
  validate_paths
  linux_preflight

  case "$ACTION" in
    menu) show_menu ;;
    install-controller) install_runner_role 'controller' ;;
    configure-controller) configure_controller ;;
    install-node) install_runner_role 'node' ;;
    configure-node) configure_node ;;
    manage-applications) manage_controller_applications ;;
    install-dependencies) install_test_dependencies ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
