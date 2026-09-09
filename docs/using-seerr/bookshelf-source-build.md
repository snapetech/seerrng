---
title: Build BookshelfNG from Source
description: Build and run the BookshelfNG Readarr-compatible backend without Docker.
sidebar_position: 23
---

# Build BookshelfNG from Source

BookshelfNG is the Readarr-compatible backend that SeerrNG uses for ebook and
audiobook requests. It is a separate project from SeerrNG. This guide builds
BookshelfNG directly on a Linux host, without Docker, and then connects the
result to SeerrNG.

For SeerrNG itself, use the [SeerrNG source-build
guide](/getting-started/buildfromsource) instead.

:::warning

Source builds follow the BookshelfNG `develop` branch and are intended for
operators who are comfortable maintaining a local service. Use a pinned
BookshelfNG commit or a published image when you need a reproducible upgrade
path.

:::

## What this builds

The BookshelfNG repository contains a .NET backend and a React/Webpack
frontend. Its build script publishes the backend and places the compiled UI in
the same output tree:

```text
_output/net6.0/linux-x64/publish/Readarr
_output/UI/
```

The executable keeps the inherited `Readarr` name. That is expected for the
BookshelfNG fork and does not mean that the wrong project was built.

## Prerequisites

Install these tools on the host that will run BookshelfNG:

- Git
- .NET SDK 6.0.x, not only the .NET runtime
- Node.js 20.x
- Yarn Classic 1.22.x
- Bash, `curl`, and a C/C++ build toolchain for any native Node dependencies

The current repository pins .NET `6.0.428` and Node `20.19.4` in `mise.toml`,
and its package metadata pins Yarn `1.22.19`. If you use [mise](https://mise.jdx.dev/),
run `mise install` from the BookshelfNG checkout. Otherwise install equivalent
versions through your operating system or the upstream tool installers.

Check the active versions before starting:

```bash
dotnet --list-sdks | grep '^6\.'
node --version
yarn --version
```

If Yarn is missing or the wrong major version is active:

```bash
npm install --global yarn@1.22.19
```

## Clone the source

The maintained public fork is [snapetech/bookshelfng](https://github.com/snapetech/bookshelfng).
Its development branch is `develop`:

```bash
mkdir -p ~/src
cd ~/src
git clone --branch develop https://github.com/snapetech/bookshelfng.git
cd bookshelfng
```

For a reproducible build, replace the branch checkout with a reviewed commit:

```bash
git fetch --tags origin
git checkout <reviewed-commit-or-tag>
```

Do not put the BookshelfNG checkout inside SeerrNG's repository or reuse
SeerrNG's `config` directory. Keep the source and runtime data separate.

## Build a Linux x64 binary

For a normal Linux x64 host, build only the runtime you need:

```bash
./build.sh --backend --frontend -r linux-x64 -f net6.0
```

The command restores .NET and Yarn dependencies, publishes the backend, and
builds the frontend. Validate the expected output before installing it:

```bash
test -x _output/net6.0/linux-x64/publish/Readarr
test -d _output/UI
```

To build every runtime configured by the repository instead, omit `-r` and
`-f`:

```bash
./build.sh --backend --frontend
```

Use the runtime identifier that matches the host. The repository currently
configures `linux-x64`, `linux-musl-x64`, and `linux-musl-arm64`; a musl build
is generally intended for an Alpine-style environment. Do not copy a musl
binary onto a glibc host unless you have verified that host's compatibility.

## Run it in the foreground first

Run one instance with an explicit data directory before creating a service.
This keeps the generated database, `config.xml`, logs, and encryption keys out
of the source checkout:

```bash
mkdir -p "$HOME/.config/bookshelfng"

./_output/net6.0/linux-x64/publish/Readarr \
  -data="$HOME/.config/bookshelfng" \
  -nobrowser
```

The default HTTP port is `8787`. Open `http://127.0.0.1:8787` from the host,
complete the BookshelfNG setup, and stop the foreground process with
`Ctrl-C` when it is ready to be managed by systemd.

Do not expose the default HTTP listener directly to the public internet. Use a
firewall and an HTTPS reverse proxy, or configure BookshelfNG's own HTTPS
settings before allowing remote access.

## Configure Hardcover or softcover metadata

Choose the metadata mode deliberately. A new installation should normally use
native Hardcover metadata:

```env
HARDCOVER=true
HARDCOVER_NATIVE=true
HARDCOVER_AUTH=Bearer replace-with-your-hardcover-token
```

`HARDCOVER_API_KEY` can be used as the alternative token variable. The token
must be supplied at runtime; do not commit it to the checkout or put it in a
public service unit.

For an existing Readarr-compatible database that still uses Goodreads or
softcover IDs, keep the softcover-compatible path instead. Do not switch an
existing database to Hardcover by changing only the binary, image tag, or
`METADATA_URL`: provider-specific author, book, and edition IDs are not
portable. Use the [Hardcover migration runbook](./bookshelf-hardcover-migration.md)
before changing metadata providers.

## Install as a systemd service

The following example runs the built binary as an unprivileged service user.
Adjust paths to match the host, and stop the service before replacing its
installed files during an upgrade.

Create the user and directories:

```bash
id bookshelfng >/dev/null 2>&1 || \
  sudo useradd --system --home-dir /var/lib/bookshelfng --create-home \
    --shell /usr/sbin/nologin bookshelfng

sudo install -d -m 0755 /opt/bookshelfng
sudo install -d -o bookshelfng -g bookshelfng -m 0750 /var/lib/bookshelfng
sudo install -d -o root -g bookshelfng -m 0750 /etc/bookshelfng
sudo cp -a _output/net6.0/linux-x64/publish/. /opt/bookshelfng/
sudo chown -R root:root /opt/bookshelfng
```

Create `/etc/bookshelfng/bookshelfng.env` with `sudoedit`:

```env
HARDCOVER=true
HARDCOVER_NATIVE=true
HARDCOVER_AUTH="Bearer replace-with-your-hardcover-token"
```

Keep that file readable only by root and the service group:

```bash
sudo chown root:bookshelfng /etc/bookshelfng/bookshelfng.env
sudo chmod 0640 /etc/bookshelfng/bookshelfng.env
```

Create `/etc/systemd/system/bookshelfng.service`:

```ini
[Unit]
Description=BookshelfNG
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=bookshelfng
Group=bookshelfng
WorkingDirectory=/opt/bookshelfng
EnvironmentFile=/etc/bookshelfng/bookshelfng.env
ExecStart=/opt/bookshelfng/Readarr -data=/var/lib/bookshelfng -nobrowser
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

Enable it and inspect the first startup:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bookshelfng
sudo systemctl status bookshelfng
sudo journalctl -u bookshelfng -n 100 --no-pager
```

The service should answer on `http://127.0.0.1:8787`. If SeerrNG runs on the
same host, use that address in the service settings. If it runs on another
host, bind and firewall the listener intentionally instead of assuming that
`127.0.0.1` is reachable remotely.

## Run separate ebook and audiobook instances

Bookshelf supports one type of a given book per instance. If you need both
ebooks and audiobooks, run two instances with separate data directories and
ports:

```text
/var/lib/bookshelfng-ebooks       -> port 8787
/var/lib/bookshelfng-audiobooks   -> port 8788
```

Each instance needs its own `config.xml`, database, logs, and service unit.
Start the second instance once to create its configuration, stop it, change
its `<Port>` value from `8787` to `8788`, and then start it again. Never point
both instances at the same data directory.

In SeerrNG, add the same host twice under **Settings > Services** and set
**Book Format** to **Ebook** for port `8787` and **Audiobook** for port `8788`.
Mark one service of each format as the default when both-format requests are
needed. See the [Bookshelf backend guide](./bookshelf-backend.md) for the
format-specific root-folder and profile settings.

## Connect it to SeerrNG

After BookshelfNG is running:

1. Open **Settings > Services** in SeerrNG.
2. Add a **Bookshelf** service.
3. Set the host and port, for example `http://127.0.0.1:8787` for a
   same-host service.
4. Enter the API key shown in BookshelfNG.
5. Leave **URL Base** blank unless you configured one in BookshelfNG.
6. Select **Ebook** or **Audiobook** for the service.
7. Select the root folder, quality profile, and metadata profile returned by
   the connection test.
8. Enable **Scan** and, if desired, **Automatic Search**, then save.

For a direct source install, SeerrNG does not need to know that BookshelfNG was
built locally. It uses the same Readarr-compatible API as the published image.

## Upgrade a source build

Back up each BookshelfNG data directory before upgrading. Then rebuild and
replace the installed files:

```bash
sudo systemctl stop bookshelfng
sudo tar -C /var/lib -czf \
  "$HOME/bookshelfng-data-$(date +%Y%m%d-%H%M%S).tgz" bookshelfng

cd ~/src/bookshelfng
git fetch origin
git checkout develop
git pull --ff-only
./build.sh --backend --frontend -r linux-x64 -f net6.0

sudo cp -a _output/net6.0/linux-x64/publish/. /opt/bookshelfng/
sudo systemctl start bookshelfng
sudo journalctl -u bookshelfng -n 100 --no-pager
```

Keep the previous binary and data backup until ebook, audiobook, and
both-format requests have been tested through SeerrNG. If you are changing
from softcover metadata to Hardcover, follow the migration runbook instead of
treating this as a normal binary upgrade.

## Troubleshooting

### `dotnet` cannot find a compatible SDK

Install the .NET 6 SDK. A newer runtime or SDK alone does not guarantee that
the `net6.0` solution can restore and publish correctly.

### The UI is missing

The frontend must be built as part of the same checkout. Run:

```bash
yarn install --frozen-lockfile --network-timeout 120000
yarn run build --env production
```

Then confirm that `_output/UI` exists and rebuild the backend if necessary.

### The service exits immediately

Check the service log and the data-directory permissions:

```bash
sudo journalctl -u bookshelfng -n 200 --no-pager
sudo -u bookshelfng test -w /var/lib/bookshelfng
```

The service user must be able to write the database, `config.xml`, logs, and
data-protection keys.

### The second instance cannot start

Confirm that it has a different `-data` directory and that its `config.xml`
uses port `8788` rather than the default `8787`:

```bash
ss -ltnp | grep -E ':8787|:8788'
```

### Hardcover searches are empty

For native Hardcover mode, confirm that `HARDCOVER=true`, native mode is
enabled, and `HARDCOVER_AUTH` includes the `Bearer ` prefix. For compatibility
mode, verify the configured `METADATA_URL` and the proxy logs. A successful TCP
connection does not prove that metadata lookup is configured correctly.
