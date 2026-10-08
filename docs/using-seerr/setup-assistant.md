---
title: Cross-platform setup assistant
description: Set up Docker apps or connect native and remote services to SeerrNG.
sidebar_position: 5
---

# Cross-platform setup assistant

The setup assistant runs on Windows, macOS, and Linux with Node.js 24.15.0 or
newer in the 24.x line. Docker is only required for Compose stack generation
and Docker network discovery. The assistant does not install or configure
Docker, native applications, or operating-system services.

## Run the assistant

You can download the standalone assistant without cloning the full SeerrNG
repository. It uses Node.js built-ins and does not need an npm install.

On Windows, open PowerShell and run:

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/snapetech/seerrng/main/scripts/setup-assistant.mjs -OutFile setup-assistant.mjs
node .\setup-assistant.mjs
```

On macOS or Linux, run:

```sh
curl --fail --location https://raw.githubusercontent.com/snapetech/seerrng/main/scripts/setup-assistant.mjs --output setup-assistant.mjs
node ./setup-assistant.mjs
```

You can also run the script directly from a SeerrNG source checkout:

```text
node scripts/setup-assistant.mjs
```

Choose a starter profile, confirm the output directory, and optionally let the
assistant start the stack after it writes the files. It writes files only; it
does not install apps or configure API keys. To select a profile and output
location directly:

```text
node scripts/setup-assistant.mjs --profile movies-tv --output ./my-media-stack
```

For unattended file generation, add `--yes`; the assistant will write the
files but will not start containers. Add `--start` to explicitly start the
generated stack with Docker Compose.

If SeerrNG is already installed, generate only the companion apps on a shared
Docker network:

```text
node scripts/setup-assistant.mjs --profile movies-tv --apps -seerrng --network seerrng-shared --output ./media-apps
```

The generated guide includes the commands to create the shared network and
attach your existing SeerrNG container to it. The assistant does not scan
Docker networks or containers to guess which SeerrNG instance you mean. This
mode requires SeerrNG to run in a Docker container on the same Docker host;
native or remote SeerrNG installs need a separately reachable app address.

## Connect native or remote apps

Use manual connection mode when SeerrNG or its companion apps are installed
from native archives, Linux packages, package managers, Unraid templates, or
other non-Compose methods. It does not call Docker or inspect operating-system
processes. It creates the same import file from an explicit hostname and the
selected apps’ common default ports; you can override ports interactively.

```text
node scripts/setup-assistant.mjs --connections
```

Select app IDs from the menu, enter a hostname or IPv4 address that SeerrNG can
reach, and confirm each port. The assistant writes
`seerrng-connections.json` and `CONNECTIONS.md` into
`./seerrng-connections`. Enter values non-interactively with:

```text
node scripts/setup-assistant.mjs --connections --apps radarr,sonarr,prowlarr --host media.example.net --output ./seerrng-connections --yes
```

The report supports SeerrNG integrations for Radarr, Sonarr, Lidarr,
BookshelfNG, ChaptarrNG, Prowlarr, LazyLibrarian, Mylar3, Kapowarr, BackIssue,
ROMarrNG, and QuestarrNG. qBittorrent has no SeerrNG service form, so it is not
included. BookshelfNG and ChaptarrNG require two SeerrNG entries, one for Books
and one for Audiobooks.

`localhost` is relative to the machine or container where SeerrNG runs. Use it
only when SeerrNG and the target app share a network namespace. If SeerrNG runs
in Docker and the app runs directly on its host, use an address reachable from
inside the SeerrNG container. On Linux Docker Engine this may require a
host-gateway mapping or a routable host address. On Docker Desktop, verify
`host.docker.internal` resolves from inside the SeerrNG container. For apps on
another machine, use that machine’s LAN DNS name or IP. Ensure the app listens
on an interface reachable by SeerrNG and that the firewall permits its port.

Manual reports work across SeerrNG’s supported Windows x64/ARM64, macOS
x64/ARM64, and Linux deployments, including Debian, RPM, AppImage, Flatpak,
Snap, PPA, COPR, and AUR packages. Companion apps may support fewer operating
systems or architectures; install them using their own supported method. The
connection workflow itself does not depend on how either service was installed.

For a quick reachability check, probe common app ports on one host:

```text
node scripts/setup-assistant.mjs --probe-host media.example.net --output ./seerrng-connections
```

The probe makes TCP connection attempts only to the selected host and the
catalog’s distinct default ports, with at most four attempts at a time. It does
not send HTTP requests, inspect processes, scan a subnet, or use credentials.
An open port is not proof of app identity; unique default-port matches become
suggestions for SeerrNG’s **Test** action. Ports shared by multiple apps are
reported as ambiguous and omitted from the import file. The probe cannot find
custom ports; use manual mode to enter them. You can restrict the probe to
selected app IDs with `--apps radarr,sonarr`.

Use `--detect --output ./my-media-stack` to report which containers Docker
Compose currently sees in that generated stack. To discover supported apps
already attached to a particular Docker network, name that network explicitly:

```text
node scripts/setup-assistant.mjs --discover --network seerrng-shared
```

Add `--output ./connection-report` to write `CONNECTIONS.md` and
`seerrng-connections.json` with the detected app names, Compose hostnames,
container ports, and states. The assistant inspects only the named network and
refuses networks with more than 64 attached containers. It recognizes known
images and Compose service labels; custom images without a matching service
label may not be identified. The report contains no API keys or container
environment values. Enter each app's API key in SeerrNG, then use the existing
**Test** action to verify the connection and load its options before saving.

In SeerrNG, open **Settings → Services** and choose **Import detected
connections** to load `seerrng-connections.json`. Detected hostnames and ports
prefill matching add forms, including Prowlarr and software acquisition
settings. Saved service addresses are left unchanged. API keys remain blank;
enter each key in the corresponding app and use **Test** so SeerrNG validates
the API and loads profiles, root folders, or provider capabilities. Imported
suggestions stay in memory until you clear them or reload SeerrNG.

The report starts with each app’s common web port. Confirm custom ports, SSL,
and reverse-proxy paths in the target app. Enter API keys manually. **Test** is
the live API probe: it verifies that SeerrNG can reach the selected service
with the supplied credentials and loads its profiles, root folders, or
capabilities before saving.

After choosing a profile, enter app IDs to add or prefix an ID with `-` to
remove it. For example, add `lidarr` to a Movies and TV profile or enter
`-qbittorrent` to omit its download client. Available app IDs are `seerrng`,
`radarr`, `sonarr`, `lidarr`, `bookshelf`,
`chaptarrng`, `prowlarr`, `qbittorrent`, `lazylibrarian`, `mylar3`, `kapowarr`,
`backissue`, `romarrng`, and `questarrng`.

Use `--list-profiles` to see the available profiles. Each generated folder
contains `compose.yaml` and `SETUP.md`. Review both before starting the stack.
The output files are never overwritten; choose another output directory when
you want to regenerate them.

## Starter profiles

| Profile | Included apps |
| --- | --- |
| `movies-tv` | SeerrNG, Radarr, Sonarr, Prowlarr, qBittorrent |
| `books` | SeerrNG, BookshelfNG, Prowlarr, qBittorrent |
| `books-chaptarrng` | SeerrNG, ChaptarrNG, Prowlarr, qBittorrent |
| `music` | SeerrNG, Lidarr, Prowlarr, qBittorrent |
| `comics` | SeerrNG, Mylar3 |
| `magazines` | SeerrNG, LazyLibrarian, Prowlarr, qBittorrent |
| `software` | SeerrNG, QuestarrNG, ROMarrNG, qBittorrent |
| `media-library` | SeerrNG, Radarr, Sonarr, Lidarr, BookshelfNG, Prowlarr, qBittorrent |
| `all-media` | SeerrNG, Radarr, Sonarr, Lidarr, BookshelfNG, Mylar3, LazyLibrarian, QuestarrNG, ROMarrNG, Prowlarr, qBittorrent |

These profiles are examples, not required SeerrNG dependencies. Choose a
smaller profile when you want fewer containers. BookshelfNG and ChaptarrNG are
alternatives for book automation; Mylar3, Kapowarr, and BackIssue are
alternatives for comics. The `all-media` profile chooses BookshelfNG and
Mylar3; add or remove providers with `--apps` for a different choice. For
example, replace BookshelfNG with ChaptarrNG using
`--profile books --apps -bookshelf,chaptarrng`, or add BackIssue as an
alternative with `--profile comics --apps -mylar3,backissue`. Connect only the
comic provider you want to use as the default destination. BackIssue currently
publishes a linux/amd64 image; on ARM64 hosts, choose Mylar3 or Kapowarr unless
you have enabled and verified x86 emulation.

The software profile includes both NG services because QuestarrNG handles PC
game requests and ROMarrNG handles emulation requests. Assign each supported
ROMarrNG system to Retro or Modern in SeerrNG's Software Acquisition settings.
If you need separate destinations, such as independent HD and 4K libraries,
add separately named services and give them distinct host ports and
configuration volumes in your Compose file.

## Link the apps

After starting a new stack, open SeerrNG at `http://localhost:5055` and
complete its first run. After discovering an existing network, open the URL for
your existing SeerrNG instance. In **Settings → Services**, add each supported media service and copy its
API key from that app. Configure Prowlarr under **Settings → Prowlarr** and
QuestarrNG or ROMarrNG under **Settings → Services → Software Acquisition**.
Select **Test** before saving; SeerrNG will validate the connection and load
the available profiles and root folders. Enter the Docker
Compose service name as the hostname (for example, `radarr`) when SeerrNG and
that app are in the generated stack. Use each app's listed container port, not
the host's published port. For BookshelfNG or ChaptarrNG, add two connections
to the same hostname and port: one with Book format and one with Audiobook
format. For emulation requests, assign supported ROMarrNG systems to **Retro**
or **Modern**.

Credentials are entered in SeerrNG's existing forms and are not generated,
copied between apps, or placed in the generated files. A successful connection
test does not save the service; review its options and save it explicitly.

## Storage and network behavior

The generated stack uses Docker named volumes for persistent app configuration,
media, and downloads when the selected apps need them. Media container paths
vary by app; the generated `SETUP.md` lists each mount so you can set matching
root folders. Apps in one generated stack share the `downloads` volume. Docker
manages where these volumes live on each operating system; back them up before
migrating the stack.

When qBittorrent is included, its first-start temporary `admin` password is
printed in its container log. Sign in at `http://localhost:8080` and set a
permanent password in the Web UI settings before connecting download clients.

Web ports bind to `127.0.0.1` so the interfaces are local to the Docker host by
default. When qBittorrent is included, it also publishes peer traffic on TCP
and UDP port `6881` on the Docker host for torrent transfers. To reach SeerrNG or an app's web
interface from another device, edit that service's host-side bind address after
reviewing your network and authentication setup. The app-to-app connections use
Compose DNS and remain inside the Compose network.

If one of the default host ports is already in use, set the corresponding
`*_HOST_PORT` variable in a `.env` file in the generated folder. The app-to-app
addresses and container ports in the guide do not change. For qBittorrent peer
traffic, set `QBITTORRENT_PEER_PORT` to change its host port.

The assistant does not configure indexers, download-client categories, media
root folders, quality profiles, TLS, or reverse proxies. Configure those in
the relevant app before relying on requests. ChaptarrNG is an alternative to
BookshelfNG; select one provider per format to avoid duplicate acquisitions.
After saving ROMarrNG, assign supported systems to **Retro** or **Modern** in
SeerrNG. Additional dashboards, monitoring, and update controllers remain
outside this acquisition-focused catalog.
