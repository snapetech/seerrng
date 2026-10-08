#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${CONFIG_DIRECTORY:-"$ROOT_DIR/config"}"
SETTINGS_FILE="$CONFIG_DIR/settings.json"
DB_FILE="$CONFIG_DIR/db/db.sqlite3"
PLEX_PREFS="${PLEX_PREFERENCES:-/var/lib/plex-standby-config/Library/Application Support/Plex Media Server/Preferences.xml}"
PLEX_PROXY_HOST="${PLEX_PROXY_HOST:-127.0.0.1}"
PLEX_PROXY_PORT="${PLEX_PROXY_PORT:-33240}"

if [[ ! -f "$PLEX_PREFS" ]]; then
  echo "Plex Preferences.xml not found: $PLEX_PREFS" >&2
  exit 1
fi

if [[ -L "$SETTINGS_FILE" || ! -f "$SETTINGS_FILE" ]]; then
  echo "Seerr settings file not found: $SETTINGS_FILE" >&2
  exit 1
fi

if [[ -L "$DB_FILE" || ! -f "$DB_FILE" ]]; then
  echo "Seerr sqlite database not found: $DB_FILE" >&2
  exit 1
fi

exec 3< <(PLEX_PREFS="$PLEX_PREFS" python3 - <<'PY'
import os
import sys
import xml.etree.ElementTree as ET

root = ET.parse(os.environ["PLEX_PREFS"]).getroot()
required = ["PlexOnlineToken", "ProcessedMachineIdentifier"]
missing = [key for key in required if not root.attrib.get(key)]
if missing:
    print(f"missing Plex preference fields: {', '.join(missing)}", file=sys.stderr)
    sys.exit(1)

print(root.attrib["PlexOnlineToken"])
print(root.attrib["ProcessedMachineIdentifier"])
print(root.attrib.get("FriendlyName") or "Plex")
PY
)

IFS= read -r PLEX_TOKEN <&3
IFS= read -r PLEX_MACHINE_ID <&3
IFS= read -r PLEX_NAME <&3
exec 3<&-

if [[ ! "$PLEX_PROXY_PORT" =~ ^[0-9]{1,5}$ ]] ||
  ((10#$PLEX_PROXY_PORT < 1 || 10#$PLEX_PROXY_PORT > 65535)); then
  echo "PLEX_PROXY_PORT must be an integer from 1 through 65535" >&2
  exit 2
fi
if [[ ! "$PLEX_TOKEN" =~ ^[A-Za-z0-9_-]+$ ]] ||
  (( ${#PLEX_TOKEN} < 1 || ${#PLEX_TOKEN} > 512 )); then
  echo "Plex Preferences.xml contains an invalid token" >&2
  exit 1
fi

printf 'X-Plex-Token: %s\n' "$PLEX_TOKEN" | curl -fsS --compressed --max-time 10 \
  -H @- \
  "http://${PLEX_PROXY_HOST}:${PLEX_PROXY_PORT}/library/sections" \
  >/dev/null

SETTINGS_FILE="$SETTINGS_FILE" \
PLEX_PROXY_HOST="$PLEX_PROXY_HOST" \
PLEX_PROXY_PORT="$PLEX_PROXY_PORT" \
PLEX_MACHINE_ID="$PLEX_MACHINE_ID" \
PLEX_NAME="$PLEX_NAME" \
python3 - <<'PY'
import json
import os
import stat
import tempfile
from pathlib import Path

path = Path(os.environ["SETTINGS_FILE"])
path_stat = path.lstat()
if stat.S_ISLNK(path_stat.st_mode) or not stat.S_ISREG(path_stat.st_mode):
    raise RuntimeError(f"refusing non-regular settings file: {path}")
settings = json.loads(path.read_text())
settings.setdefault("plex", {})
settings["plex"]["name"] = os.environ["PLEX_NAME"]
settings["plex"]["ip"] = os.environ["PLEX_PROXY_HOST"]
settings["plex"]["port"] = int(os.environ["PLEX_PROXY_PORT"])
settings["plex"]["useSsl"] = False
settings["plex"]["machineId"] = os.environ["PLEX_MACHINE_ID"]
output = (json.dumps(settings, indent=2) + "\n").encode()
fd, temporary_name = tempfile.mkstemp(
    dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
)
try:
    os.fchmod(fd, stat.S_IMODE(path_stat.st_mode))
    if hasattr(os, "fchown"):
        os.fchown(fd, path_stat.st_uid, path_stat.st_gid)
    with os.fdopen(fd, "wb") as temporary:
        temporary.write(output)
        temporary.flush()
        os.fsync(temporary.fileno())
    os.replace(temporary_name, path)
    directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
except BaseException:
    try:
        os.close(fd)
    except OSError:
        pass
    try:
        os.unlink(temporary_name)
    except FileNotFoundError:
        pass
    raise
PY

DB_FILE="$DB_FILE" PLEX_TOKEN="$PLEX_TOKEN" python3 - <<'PY'
import os
import sqlite3
import stat

db_path = os.environ["DB_FILE"]
db_stat = os.lstat(db_path)
if stat.S_ISLNK(db_stat.st_mode) or not stat.S_ISREG(db_stat.st_mode):
    raise RuntimeError(f"refusing non-regular sqlite database: {db_path}")

with sqlite3.connect(db_path) as conn:
    conn.execute(
        """
        update user
           set plexToken = ?,
               plexId = coalesce(plexId, 1)
         where plexToken is not null
            or id = 1
        """,
        (os.environ["PLEX_TOKEN"],),
    )
PY

echo "Relinked Seerr Plex settings to ${PLEX_NAME} via ${PLEX_PROXY_HOST}:${PLEX_PROXY_PORT}."
echo "Restart Seerr for running processes to pick up the updated settings."
