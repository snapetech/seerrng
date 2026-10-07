#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <private-key-file>" >&2
  exit 1
fi

key_file="$1"
[[ -f "$key_file" && ! -L "$key_file" ]] || {
  echo "ERROR: private key must be a regular, non-symlink file." >&2
  exit 1
}

ssh_dir="${HOME:?HOME is required}/.ssh"
[[ ! -L "$ssh_dir" ]] || {
  echo "ERROR: refusing symlink SSH directory: $ssh_dir" >&2
  exit 1
}
mkdir -p -- "$ssh_dir"
chmod 700 "$ssh_dir"

key_destination="$ssh_dir/aur"
config_destination="$ssh_dir/aur_config"
known_hosts_destination="$ssh_dir/aur_known_hosts"
for destination in "$key_destination" "$config_destination" "$known_hosts_destination"; do
  [[ ! -e "$destination" && ! -L "$destination" ]] || {
    echo "ERROR: refusing to replace existing SSH file: $destination" >&2
    exit 1
  }
done

key_temporary="$(mktemp "$ssh_dir/.aur-key.XXXXXX")"
config_temporary="$(mktemp "$ssh_dir/.aur-config.XXXXXX")"
known_hosts_temporary="$(mktemp "$ssh_dir/.aur-known-hosts.XXXXXX")"
cleanup() {
  rm -f -- "$key_temporary" "$config_temporary" "$known_hosts_temporary"
}
trap cleanup EXIT

cp -- "$key_file" "$key_temporary"
chmod 600 "$key_temporary"

cat >"$known_hosts_temporary" <<'EOF'
aur.archlinux.org ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEuBKrPzbawxA/k2g6NcyV5jmqwJ2s+zpgZGZ7tpLIcN
EOF
expected_fingerprint='SHA256:RFzBCUItH9LZS0cKB5UE6ceAYhBD5C8GeOBip8Z11+4'
actual_fingerprint="$(ssh-keygen -lf "$known_hosts_temporary" -E sha256 | awk '{print $2}')"
[[ "$actual_fingerprint" == "$expected_fingerprint" ]] || {
  echo "ERROR: pinned AUR host key fingerprint mismatch." >&2
  exit 1
}

cat >"$config_temporary" <<'EOF'
Host aur.archlinux.org
  HostName aur.archlinux.org
  User aur
  IdentityFile ~/.ssh/aur
  IdentitiesOnly yes
  UserKnownHostsFile ~/.ssh/aur_known_hosts
  GlobalKnownHostsFile /dev/null
  StrictHostKeyChecking yes
  BatchMode yes
  PasswordAuthentication no
  KbdInteractiveAuthentication no
EOF

chmod 600 "$config_temporary" "$known_hosts_temporary"
mv -- "$key_temporary" "$key_destination"
mv -- "$config_temporary" "$config_destination"
mv -- "$known_hosts_temporary" "$known_hosts_destination"
