<p align="center">
  <img src="./public/logo_full.svg" alt="SeerrNG" style="margin: 20px 0" />
</p>

<p align="center">
  <img src="https://github.com/snapetech/seerrng/actions/workflows/ci.yml/badge.svg" alt="SeerrNG CI" />
  <a href="https://github.com/snapetech/seerrng/blob/main/LICENSE"><img src="https://img.shields.io/github/license/snapetech/seerrng" alt="License" /></a>
  <a href="https://discord.gg/5PyXBfvS6T"><img src="https://img.shields.io/badge/support-Discord-5865F2?logo=discord&logoColor=white" alt="Support on Discord" /></a>
</p>

<p align="center">
  Support SeerrNG development through
  <a href="https://www.paypal.com/donate/?business=donations%40snape.tech">PayPal</a> or
  <a href="https://ko-fi.com/snapetech">Ko-fi</a>.
</p>

# SeerrNG

SeerrNG is a self-hosted request and discovery app for personal media libraries. It extends the Seerr/Jellyseerr/Overseerr lineage beyond movies and TV into music, books, comics, magazines, emulation ROMs, and PC games while keeping the familiar request approval workflow for Plex, Jellyfin, Emby, and automation-service users.

This fork is maintained by snapetech. Upstream Seerr remains the base project for inherited video, user, server, and deployment behavior; SeerrNG-specific work focuses on multi-format media requests, service routing, caching, and fork-owned packaging/docs. See [NOTICE.md](./NOTICE.md) for attribution rules.

## Contents

- [What SeerrNG Does](#what-seerrng-does)
- [Project Status](#project-status)
- [Documentation and feature guides](#documentation)
  - [Choose available media categories](https://snapetech.github.io/seerrng/using-seerr/settings/media-categories/)
  - [Software requests: ROMs and PC games](https://snapetech.github.io/seerrng/using-seerr/software-acquisition/)
  - [Request Status and Download copy](https://snapetech.github.io/seerrng/using-seerr/request-status/)
  - [Books, authors, and series](https://snapetech.github.io/seerrng/using-seerr/books-and-series/)
  - [Configure services](https://snapetech.github.io/seerrng/using-seerr/settings/services/)
- [Screenshots](#screenshots)
- [Install](#install)
  - [Docker](#docker)
  - [Docker Compose](#docker-compose)
  - [Unraid](#unraid)
  - [Linux packages](#linux-packages)
- [Required Setup](#required-setup)
- [Bookshelf and Hardcover](#bookshelf-and-hardcover)
- [Environment Variables](#environment-variables)
- [Caching and Performance](#caching-and-performance)
- [Development](#development)
- [Testing Real Integrations](#testing-real-integrations)
- [Legal Use](#legal-use)
- [Support](#support)
- [Contributing](#contributing)
- [Attribution](#attribution)

## What SeerrNG Does

- Requests and approvals for movies, shows, music, ebooks, audiobooks, and combined ebook/audiobook book requests.
- Media-server integration with Plex, Jellyfin, and Emby.
- Automation service integration with Radarr, Sonarr, Lidarr, and Bookshelf/Readarr-compatible APIs.
- Music discovery and metadata through MusicBrainz, ListenBrainz, Cover Art Archive, TheAudioDB, and archive-backed artwork sources.
- Book discovery and identity matching through Open Library, ISBN-10/ISBN-13 normalization, foreign book IDs, and edition IDs.
- Separate ebook and audiobook service routing so both formats can be requested, approved, scanned, retried, and removed independently.
- One BookshelfNG instance can manage both formats on the same book record.
  When both formats are enabled, their separate SeerrNG service entries can
  point to the same BookshelfNG URL and API key; separate app instances are
  not required.
- Catalog browsing and requests for Retro and Modern emulation systems and PC games for Windows, Linux, and macOS, with QuestarrNG and ROMarrNG handling acquisition.
- Administrator-controlled availability switches for each supported category, including separate ebook, audiobook, Retro, Modern, and PC Games controls.
- Bookshelf backend diagnostics that classify Hardcover, softcover/Goodreads, and unknown metadata providers.
- Hardcover-first Bookshelf deployment and migration tooling for existing Readarr or softcover libraries.
- Resumable, layered Readarr/softcover-to-Hardcover migration with strict matching, softcover metadata recovery, validation, cutover checks, and an opt-in deterministic local-record fallback for books Hardcover cannot import.
- Watchlists, blocklists, request quotas, override rules, permissions, notifications, issue reporting, and request management.
- Authenticated **Download copy** links in Request Status for verified movie, TV, book, comic, magazine, ROM, and PC game files.
- Request lifecycle tracking and availability notifications link users back to the matching Request Status item, where available files can be selected and saved.
- Browser, service-worker, API, DNS, avatar, and image-proxy caching tuned for faster refreshes and tab restores.

## Project Status

SeerrNG is active fork work. Movie and TV behavior is inherited and generally stable. Music and book support is usable but should still be treated as evolving, especially around provider matching and real-world Bookshelf/Readarr edge cases.

Current focus:

- Stabilizing Lidarr request, scan, retry, and removal flows.
- Stabilizing Bookshelf ebook, audiobook, and both-format request flows.
- Making the Bookshelf Hardcover migration path safe, repeatable, and visible to administrators.
- Keeping image/API caching fast without blocking the visible page during refreshes.
- Replacing upstream branding and docs with SeerrNG-owned assets and guidance.
- Hardening request validation, notification settings, permission bounds, and service inputs.
- Supporting ROM and PC game catalog, acquisition, status tracking, notifications, and download delivery through QuestarrNG and ROMarrNG. SeerrNG does not install, launch, or play games; general desktop applications remain outside the supported catalog.

Release notes are maintained in [`CHANGELOG.md`](./CHANGELOG.md). User-facing
pull requests add a concise release-note fragment under
[`release-notes/`](./release-notes/README.md); the release workflow publishes
those notes to GitHub Releases and the Discord release announcement.
Fragments capture the affected audience, product area, required action, and
breaking-change status, and CI shows the exact release-note preview during
review.
The historical tag coverage and audit method are documented in
[`docs/maintainers/release-history-audit.md`](./docs/maintainers/release-history-audit.md).
The in-app version check compares against published stable tags from the
SeerrNG fork, not the upstream Seerr repository.

## Documentation

The [SeerrNG documentation site](https://snapetech.github.io/seerrng/) covers
installation, setup, user workflows, and integrations. These guides are useful
starting points:

- [Install SeerrNG](https://snapetech.github.io/seerrng/getting-started/)
- [Install on Unraid](https://snapetech.github.io/seerrng/getting-started/third-parties/unraid)
- [Find books, authors, and series](https://snapetech.github.io/seerrng/using-seerr/books-and-series/)
- [Track requests and status history](https://snapetech.github.io/seerrng/using-seerr/request-status/)
- [Browse and request emulation games and PC games](https://snapetech.github.io/seerrng/using-seerr/software-acquisition/)
- [Download verified files from Request Status](https://snapetech.github.io/seerrng/using-seerr/request-status/)
- [Use media detail and playback controls](https://snapetech.github.io/seerrng/using-seerr/media-details-and-playback/)
- [Configure media-server libraries, including Plex Music and Audiobooks](https://snapetech.github.io/seerrng/using-seerr/settings/mediaserver)
- [Enable built-in HTTPS](https://snapetech.github.io/seerrng/using-seerr/advanced/built-in-tls/)
- [Configure notifications](https://snapetech.github.io/seerrng/using-seerr/notifications/)
- [Hide requested or available media](https://snapetech.github.io/seerrng/using-seerr/settings/general)
- [Choose which media categories are available](https://snapetech.github.io/seerrng/using-seerr/settings/media-categories/)
- [Configure Bookshelf](https://snapetech.github.io/seerrng/using-seerr/bookshelf-backend/)
- [Bookshelf metadata sources](https://snapetech.github.io/seerrng/using-seerr/bookshelf-metadata-sources/)
- [Configure override rules](https://snapetech.github.io/seerrng/using-seerr/override-rules/)
- [Manage users and request preferences](https://snapetech.github.io/seerrng/using-seerr/users/editing-users/)
- [REST API reference](https://snapetech.github.io/seerrng/api/seerr-api/)

## Screenshots

### Discover

<img src="./public/readme-discover-covers.jpg" alt="SeerrNG Discover page" width="100%" />

### Books

<img src="./public/readme-books-covers.jpg" alt="SeerrNG Books page" width="100%" />

### Music

<img src="./public/readme-music-covers.jpg" alt="SeerrNG Music page" width="100%" />

## Install

### Docker

The main container image is published from this repository:

```bash
docker run -d \
  --name seerrng \
  -e LOG_LEVEL=info \
  -e PORT=5055 \
  -p 5055:5055 \
  -v /path/to/seerrng/config:/app/config \
  --restart unless-stopped \
  ghcr.io/snapetech/seerrng:main
```

Open `http://localhost:5055` and complete setup.

### Docker Compose

```yaml
services:
  seerrng:
    image: ghcr.io/snapetech/seerrng:main
    container_name: seerrng
    environment:
      LOG_LEVEL: info
      PORT: 5055
      # Optional overrides; SeerrNG includes a default TMDB application key.
      TMDB_API_KEY: ${TMDB_API_KEY}
      TMDB_READ_ACCESS_TOKEN: ${TMDB_READ_ACCESS_TOKEN}
    ports:
      - 5055:5055
    volumes:
      - /path/to/seerrng/config:/app/config
    restart: unless-stopped
```

### Unraid

Install SeerrNG from Community Applications with the [Unraid template](https://raw.githubusercontent.com/snapetech/seerrng/main/packaging/unraid/seerrng.xml). It uses the stable `latest` image, maps HTTP port `5055` and optional HTTPS port `5056`, and persists `/app/config`. The image runs as UID/GID `1000:1000`, so make the selected appdata directory writable by that user before the first start.

### Linux Packages

This repo includes release workflows and packaging metadata for tarball, Debian, RPM, AppImage, Flatpak, Snap, AUR, PPA, and COPR style distribution. These packages install SeerrNG as a standalone service; Lidarr, Bookshelf, and other automation/media servers are optional external services configured inside SeerrNG. Use the GitHub releases for generated artifacts when available.

## Required Setup

SeerrNG needs the same base setup as Seerr for video libraries, plus optional services for music and books.

Core:

- A Plex, Jellyfin, or Emby server.
- Radarr for movie automation.
- Sonarr for TV automation.
- SQLite or PostgreSQL for the application database.

Music:

- Lidarr server configured in **Settings > Services**.
- Root folder, quality profile, metadata profile, and tags configured from the Lidarr service settings.
- A default Lidarr server if users should be able to request music without choosing a service each time.
- Jellyfin and Plex music libraries can also be enabled in **Settings > Media
  Server**; albums need MusicBrainz metadata for SeerrNG to match existing
  media. Plex artist libraries can be reclassified as Audiobooks for audiobook
  availability. Lidarr remains the music automation and fallback source.

Books:

- Bookshelf or another Readarr-compatible service configured in **Settings > Services**. New deployments should use the Hardcover-backed Bookshelf image.
- One BookshelfNG instance can manage both ebooks and audiobooks. Add two SeerrNG service entries with the same connection details and mark one as ebook-capable and one as audiobook-capable.
- Separate defaults for ebook and audiobook so **Both** format requests can route to each format.
- Existing Readarr or softcover/Goodreads libraries should be migrated before switching to Hardcover metadata. The service settings modal links directly to the Bookshelf Hardcover migration runbook.

Software requests:

- QuestarrNG provides the IGDB catalog and acquisition for PC game requests.
- ROMarrNG is also required for emulation requests. In **Settings > Services > Software Acquisition**, connect each provider and assign supported ROMarrNG systems to **Retro** or **Modern** before users can request them.
- Software requests support global and per-user quotas. Requesters can withdraw their own requests before approval; provider-wide cancellation after approval is not available across both integrations.
- Provider hostnames and ports must be reachable from the SeerrNG server or container. Use each provider's SeerrNG integration API key; keys stay server-side.
- See the [software requests guide](https://snapetech.github.io/seerrng/using-seerr/software-acquisition/) for provider setup, request targets, status, retries, notifications, and downloads. See [Request Status](https://snapetech.github.io/seerrng/using-seerr/request-status/) for the shared Download copy workflow.

## Bookshelf and Hardcover

SeerrNG treats Bookshelf as the recommended backend for book requests. The
default deployment path uses the Snapetech BookshelfNG fork with Hardcover
metadata:

```text
ghcr.io/snapetech/bookshelfng:hardcover
```

The stable `hardcover` and `softcover` tags are published only from
BookshelfNG's `main` release workflow, so SeerrNG follows the newest released
BookshelfNG build. Set `BOOKSHELF_IMAGE` to a digest-pinned reference when a
reproducible or rollbackable deployment is required.

### BookshelfNG and rreading-glasses

These components solve different problems. Fresh Hardcover installs use the
rreading-glasses compatibility boundary by default; native Hardcover remains an
explicit opt-in:

If Docker is not an option, see the [BookshelfNG source-build
guide](./docs/using-seerr/bookshelf-source-build.md) for a direct Linux build,
systemd service, metadata configuration, and SeerrNG connection.

- **BookshelfNG** is the maintained Readarr-style application. It manages the
  library, download clients, imports, file organization, and the
  Readarr-compatible API that SeerrNG uses.
- **rreading-glasses** is a compatibility/proxy layer. In compatibility mode,
  it exposes the metadata API BookshelfNG expects, translates requests to
  Hardcover or Goodreads, caches results in PostgreSQL, and coalesces or
  rate-limits upstream work.

Hardcover metadata modes are:

| Mode | Path | Local proxy | Best for |
| --- | --- | --- | --- |
| `compatibility` (default for fresh Hardcover installs) | BookshelfNG → rreading-glasses → upstream | On, with PostgreSQL | A durable shared cache, centralized throttling, or a compatibility boundary |
| `native` (explicit opt-in) | BookshelfNG → Hardcover GraphQL | Off | The simplest direct Hardcover deployment |
| `hosted` | BookshelfNG → `METADATA_URL` | Off | A hosted compatibility endpoint without local state |

Compatibility mode is the installer default because it keeps BookshelfNG
decoupled from Hardcover's GraphQL API and centralizes authentication, caching,
request coalescing, and upstream throttling. One proxy and PostgreSQL cache can
serve one or more BookshelfNG instances; one instance is enough for ebooks and
audiobooks. Existing installs that already use the local
proxy are preserved as compatibility mode on installer reruns.

Native mode remains useful when the shortest direct request path is more
valuable than the shared proxy boundary. Select it explicitly with
`BOOKSHELF_METADATA_MODE=native`.

There is no automatic runtime failover between modes. Compatibility mode is
not an unlimited offline mirror: cache misses, expired entries, searches, and
new metadata still need Hardcover. Its proxy and database are additional local
failure points, but the PostgreSQL cache survives proxy restarts.

For compatibility mode, provide `HARDCOVER_AUTH` with the `Bearer ` prefix; the
token is consumed by rreading-glasses rather than BookshelfNG. Native mode
passes the same token to BookshelfNG. Hosted mode does not require a local token for metadata,
although Bookshelf's own Hardcover list-import settings still need an API key
when that feature is used.

#### Hardcover API token requirement

Self-hosted `compatibility` and `native` modes require a Hardcover API token
from an account you control. Create one in [Hardcover account API
settings](https://hardcover.app/account/api). For compatibility mode, set
`HARDCOVER_AUTH`; for managed native mode, set `BOOKSHELF_HARDCOVER_AUTH` or
save the token in BookshelfNG **Settings > Metadata** when no environment
value overrides it. Hosted mode uses its configured metadata endpoint and does
not require a local Hardcover token for searches or lookups.

Any token configured on a self-hosted BookshelfNG or rreading-glasses service is
used server-side by all SeerrNG users connected to it. A shared hosted endpoint
such as `hardcover.bookinfo.pro` manages its own upstream access; changing the
local BookshelfNG token does not replace the hosted service's credential. To
use a personal token, configure a self-hosted native or compatibility service
with the token for that mode. The Hardcover list-import feature also requires
its configured API key.

### Compatibility-mode outage behavior

In compatibility mode, a metadata request follows this path:

1. BookshelfNG calls the local `rreading-glasses` endpoint; it does not call
   Hardcover directly.
2. rreading-glasses checks its in-memory cache and then its PostgreSQL-backed
   cache.
3. A cached, still-valid author, work, edition, or series response can be
   returned without contacting Hardcover.
4. A cache miss, expired entry, or free-text search needs an upstream request;
   successful responses are written back to the shared cache.

This gives connected Bookshelf instances a shared cache, coalesces concurrent
work, and centralizes rate limiting. A short Hardcover outage can therefore leave
already-cached direct lookups usable, and a proxy restart does not discard the
cache when the PostgreSQL volume is healthy. It does not make the system an
unlimited offline mirror: searches, recommendations, new metadata, and expired
entries still depend on Hardcover, and the current proxy does not promise
stale-if-error responses.

The proxy and PostgreSQL database are shared local dependencies. If either is
down, connected Bookshelf instances lose this metadata path. There is no
automatic runtime failover to Goodreads or OpenLibrary. Keep the proxy data volume while
troubleshooting; use `--validate-api`, an actual lookup, and proxy logs after
recovery. Native mode has a smaller local failure surface but only per-process
caching, so a fresh search or uncached refresh still needs Hardcover.

Legacy softcover/Goodreads deployments remain supported for existing users:

```text
ghcr.io/snapetech/bookshelfng:softcover
```

Do not convert an existing Readarr or softcover database to Hardcover by only
changing the image tag or `METADATA_URL`. Goodreads/softcover author, book, and
edition IDs are not portable to Hardcover. Use the migration flow below.

### Bookshelf Installer

Fresh deployments run one combined BookshelfNG process and one database for
ebooks and audiobooks. SeerrNG still needs two service entries because it
routes **Book** and **Audiobook** requests separately; point both entries to
the same BookshelfNG URL and API key. The installer remembers this choice.

Existing audiobook databases keep the split two-process layout on reruns. The
installer does not merge databases. Select `--single-instance` only after
migrating any separate audiobook database; the helper refuses to ignore one.
Use `--split-instances` when separate BookshelfNG settings or databases are
desired:

```bash
deploy/install-bookshelf-backend.sh
```

Useful modes:

```bash
deploy/install-bookshelf-backend.sh --dry-run
deploy/install-bookshelf-backend.sh --validate-only
deploy/install-bookshelf-backend.sh --validate-api
deploy/install-bookshelf-backend.sh --split-instances
deploy/install-bookshelf-backend.sh --migrate-to-hardcover
deploy/install-bookshelf-backend.sh --restore-backup
```

Use `--single-instance` to explicitly choose the combined deployment. Fresh
installs already choose it by default.

Set `BOOKSHELF_BACKEND=auto|hardcover|softcover` to choose the backend policy.
`auto` creates a Hardcover-backed BookshelfNG deployment for fresh installs
and invokes the migration flow when an existing Readarr/softcover config is
detected without a saved backend choice.

### Hardcover Migration

The migration toolchain is first-class for existing book libraries:

```bash
deploy/install-bookshelf-backend.sh --migrate-to-hardcover
node deploy/bookshelf-hardcover-migration.mjs --summary /path/to/hardcover-migration
node deploy/bookshelf-hardcover-migration.mjs --validate /path/to/hardcover-migration
node deploy/bookshelf-hardcover-migration.mjs --cutover-check /path/to/hardcover-migration
node deploy/bookshelf-hardcover-migration.mjs --reconcile-local /path/to/hardcover-migration
```

The migration is layered:

- inventory source Readarr/Bookshelf SQLite databases;
- strictly match native Hardcover records by ISBN/ASIN/title/author;
- preserve root folders, quality profiles, metadata profiles, tags, monitored state, and search policy;
- resume from checkpoints and skip previously applied records;
- retry transient target errors and de-duplicate bad target metadata cache rows;
- pre-create missing authors where Hardcover can resolve them;
- optionally query a softcover Bookshelf endpoint to recover title/author/edition metadata, then remap that profile back through Hardcover;
- query OpenLibrary for alternate title/author/ISBN profiles, then remap those candidates back through Hardcover;
- query Google Books and the Library of Congress for additional migration recovery profiles, then remap only strict matches through Hardcover;
- optionally call a configured Apify Actor to search Goodreads-compatible catalogs when the open APIs do not return useful metadata;
- optionally create deterministic local Bookshelf records for the books Hardcover still cannot import.

These catalogs support **normal BookshelfNG search and metadata lookups**, as
well as migration recovery. SeerrNG merges BookshelfNG results with its
Open Library results and carries each Bookshelf result's source identity
through details and book requests. The optional split deployment enables
Library of Congress on the audiobook instance by default to coordinate request
pacing across processes. A single BookshelfNG instance uses one catalog
selection for both formats. Google Books and Europeana are added when their API
keys are configured. Apify remains
operator-enabled. A provider result does not need a numeric Goodreads ID. See
the [metadata source support matrix](./docs/using-seerr/bookshelf-metadata-sources.md)
for setup, coverage, limits, and identity details.

Migration record states:

- `native`: Bookshelf rows backed by Hardcover book, author, and edition IDs.
- `shadow local`: Hardcover-shaped rows using stable `local:*` IDs when Hardcover has no acceptable entry yet.
- `reconciled`: former shadow rows promoted in place after Hardcover later resolves them.

The final fallback is explicit:

```bash
APPLY_HARDCOVER_REBUILD=true \
HARDCOVER_LOCAL_DB_IMPORT=true \
deploy/install-bookshelf-backend.sh --migrate-to-hardcover
```

or:

```bash
node deploy/bookshelf-hardcover-migration.mjs --apply --local-db-import \
  /path/to/hardcover-migration
```

Local fallback records use stable IDs such as `local:ebook:1076`. They are
visible through the Bookshelf API and count toward validation, but they are not
native Hardcover metadata records. Run `--reconcile-local` later to promote
shadow records in place when Hardcover can resolve them, without creating a
duplicate book.

Reconciliation writes `local-reconciliation-report.json` and updates
`applied-books.json` so promoted rows are marked `reconciledFromLocal: true`.

See:

- [Bookshelf backend guide](./docs/using-seerr/bookshelf-backend.md)
- [Bookshelf Hardcover migration runbook](./docs/using-seerr/bookshelf-hardcover-migration.md)

### Migration Lab

Use the lab runner to rehearse a migration without touching production config:

```bash
SOURCE_EBOOK_CONFIG_DIR=/path/to/source/ebook \
SOURCE_AUDIOBOOK_CONFIG_DIR=/path/to/source/audiobook \
deploy/bookshelf-migration-lab.sh apply
```

To rehearse the full 100% completion path:

```bash
HARDCOVER_LOCAL_DB_IMPORT=true \
SOURCE_EBOOK_CONFIG_DIR=/path/to/source/ebook \
SOURCE_AUDIOBOOK_CONFIG_DIR=/path/to/source/audiobook \
deploy/bookshelf-migration-lab.sh apply
```

The validated lab run imported `2115 / 2115` books with `0` failures using the
full layered chain.

## Environment Variables

Common runtime variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port. Defaults to `5055`. |
| `LOG_LEVEL` | Server log level. |
| `CONFIG_DIRECTORY` | Alternate config directory for non-container installs. |
| `TMDB_API_KEY` | Optional TMDB v3 API key override. SeerrNG uses its bundled application key when this is unset. |
| `TMDB_READ_ACCESS_TOKEN` | Optional TMDB v4 bearer-token override. When set, it takes precedence over `TMDB_API_KEY`. |
| `SEARCH_CREDIT_CONCURRENCY` | Maximum concurrent TMDB credit lookups per server process during movie/TV searches; defaults to `10` and is capped at `40`. |
| `METRICS_ENABLED` | Enables the Prometheus `/metrics` endpoint when set to `true`. |
| `METRICS_AUTH_TOKEN` | Long random bearer token required by `/metrics` when metrics are enabled. |
| `OIDC_ALLOW_PRIVATE_ADDRESSES` | Allows server-side OIDC requests to private network addresses. Required only for an intentionally internal identity provider. |
| `OIDC_ALLOW_INSECURE` | Allows non-HTTPS OIDC provider requests. |
| `SEERR_EXTERNAL_READ_ONLY` | Blocks mutating requests to external automation APIs when enabled. Useful for test/lab environments. Production refuses to start with this enabled unless explicitly allowed. |
| `SEERR_ALLOW_PRODUCTION_EXTERNAL_READ_ONLY` | Allows `SEERR_EXTERNAL_READ_ONLY` in production for an intentional read-only clone. Do not set this on the writable request.snape.tech deployment. |
| `SEERR_REQUIRE_PUBLIC_SETUP_HOSTS` | Rejects private/LAN Jellyfin or Emby hostnames during the first-run setup wizard. Disabled by default because nearly all self-hosted media servers are on a LAN; see [Network settings](docs/using-seerr/settings/network.md). |
| `SEERR_ALLOW_PRIVATE_NOTIFICATION_URLS` | Allows Discord/Slack/webhook/ntfy/Gotify notification URLs to target private/internal addresses. Needed only if your notification receiver also runs on your LAN. Disabled by default. |
| `SEERR_ALLOW_PRIVATE_PUSH_ENDPOINTS` | Allows web push subscription endpoints to target private/internal addresses. Disabled by default; the browser push service is normally public. |
| `SEERR_TLS_MODE` | Explicit environment override selecting `disabled` (default), `self-signed`, or `provided` for direct HTTPS. Self-signed/provided modes serve HTTPS on `SEERR_HTTPS_PORT`; HTTP redirects only when the redirect setting is enabled. See [Built-in HTTPS](docs/using-seerr/advanced/built-in-tls.mdx). |
| `SEERR_HTTPS_PORT` | HTTPS listener port when `SEERR_TLS_MODE` is `self-signed` or `provided`. Defaults to `5056` and must differ from `PORT`. |
| `SEERR_TLS_HOSTS` | Comma-separated DNS names/IP addresses included in generated self-signed certificates and accepted for HTTP-to-HTTPS redirects. Defaults to `localhost,127.0.0.1,::1`. |
| `SEERR_TLS_CERT_FILE` / `SEERR_TLS_KEY_FILE` | PEM certificate and matching private key used when `SEERR_TLS_MODE=provided`. The certificate must include DNS/IP subject alternative names. |
| `SEERR_TLS_CA_FILE` | Optional PEM CA bundle passed to the Node TLS context in `provided` mode; serve intermediates in the certificate file itself. |
| `SEERR_HTTP_REDIRECT_TO_HTTPS` | Environment override for the saved HTTP behavior when built-in TLS is enabled. Set `true` for 308 redirects; set `false` to keep an HTTP upgrade/recovery response while HTTPS is verified. |
| `SEERR_ALLOW_HTTP_AUTH` | Explicitly permits browser sessions over direct HTTP when `SEERR_TLS_MODE=disabled`. Disabled by default; mutually exclusive with TLS and warns about session-cookie interception. |
| `SEERR_SKIP_DB_MIGRATIONS` | Skips automatically running database migrations at startup in production. Only relevant when migrations are run out-of-band (e.g. `pnpm migration:run`, or a prepared Cypress test database). |
| `JELLYFIN_TYPE` | One-time settings-migration hint. Set to `emby` before the first start after upgrading if your existing configuration was saved as `Jellyfin` but the server is actually Emby; relabels the stored media server type and can be unset afterward. |

### First-run browser transport

The setup page will not allow a media-server login until the active browser
transport can persist a session. On a direct installation, choose built-in
self-signed HTTPS or a provided certificate, save the choice, restart SeerrNG,
and then open the HTTPS address. If HTTPS must remain disabled on a trusted
LAN, enable `SEERR_ALLOW_HTTP_AUTH=true` (or the matching **Allow authenticated
sessions over HTTP** option), acknowledge the warning, save, and restart.

If a previous attempt saved Jellyfin details but did not establish a session,
restart after correcting the transport and use `/login` to sign in again. Do
not submit the setup hostname a second time. See [Built-in HTTPS and HTTP
authentication modes](docs/using-seerr/advanced/built-in-tls.mdx) for the
status check and reverse-proxy requirements.

Use deployment secrets, `.env` files, or container environment variables. Do not commit private TMDB, Plex, Jellyfin, Emby, Radarr, Sonarr, Lidarr, Bookshelf, SMTP, or notification credentials.

Bookshelf deployment and migration variables live on the helper scripts rather
than the SeerrNG runtime container. Common ones include:

| Variable | Purpose |
| --- | --- |
| `BOOKSHELF_BACKEND` | `auto`, `hardcover`, or `softcover`. |
| `BOOKSHELF_IMAGE` | Override the Bookshelf image. Hardcover mode uses the stable Snapetech `main` release tag by default; use a digest to pin it. |
| `BOOKSHELF_METADATA_MODE` | `compatibility` (default for fresh Hardcover), `native`, or `hosted`. |
| `BOOKSHELF_METADATA_URL` | Compatibility or hosted metadata URL. Native Hardcover uses it only when native mode is disabled. |
| `BOOKSHELF_HARDCOVER_NATIVE` | Rendered Bookshelf flag; the installer sets it from `BOOKSHELF_METADATA_MODE`. |
| `BOOKSHELF_HARDCOVER_AUTH` | Native-mode token passed to BookshelfNG; compatibility mode passes `HARDCOVER_AUTH` to rreading-glasses instead. |
| `BOOKSHELF_HARDCOVER_API_URL` | Optional native Hardcover GraphQL base URL. Defaults to `https://api.hardcover.app`. |
| `BOOKSHELF_METADATA_SOURCES` | Legacy shared runtime override. When supplied to the installer it applies to both services; otherwise the per-service values take precedence. |
| `BOOKSHELF_EBOOKS_METADATA_SOURCES` | Ebook source list; defaults to `gutendex,googlebooks,europeana`. Google Books and Europeana run only when their keys are configured. |
| `BOOKSHELF_AUDIOBOOKS_METADATA_SOURCES` | Audiobook source list; defaults to `loc,gutendex,googlebooks,europeana`. Google Books and Europeana run only when their keys are configured. |
| `GOOGLE_BOOKS_API_KEY` | Optional Google Books runtime/migration key; Google Books is skipped without it. |
| `EUROPEANA_API_KEY` | Optional Europeana runtime key; a free registered key is required, and runtime search uses openly reusable text records. |
| `HARDCOVER_APIFY_GOODREADS_ACTOR` / `HARDCOVER_APIFY_TOKEN` | Optional runtime/migration Goodreads-compatible Actor; usage may be metered. |
| `HARDCOVER_APIFY_GOODREADS_INPUT_TEMPLATE` | Optional Apify Actor JSON input template containing `{{query}}`. |
| `HARDCOVER_AUTH` | Hardcover API token. The installer passes it to native BookshelfNG by default, or to rreading-glasses in compatibility mode; include the `Bearer ` prefix. |
| `COOKIE` | Optional Goodreads cookie for softcover mode. |
| `BOOKSHELF_EBOOKS_CONFIG_DIR` | Ebook Bookshelf/Readarr config directory. |
| `BOOKSHELF_AUDIOBOOKS_CONFIG_DIR` | Audiobook Bookshelf/Readarr config directory. |
| `HARDCOVER_EBOOK_API_KEY` / `HARDCOVER_AUDIOBOOK_API_KEY` | API keys for target Hardcover Bookshelf instances. |
| `HARDCOVER_SOFTCOVER_EBOOK_BASE_URL` / `HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL` | Optional softcover recovery endpoints. |
| `HARDCOVER_OPENLIBRARY_RECOVERY` | Enables OpenLibrary-assisted native Hardcover remapping. Defaults to `true`. |
| `HARDCOVER_GOOGLEBOOKS_RECOVERY` | Enables Google Books recovery for migration/reconciliation. Defaults to `true`; `GOOGLE_BOOKS_API_KEY` is required by Google's public API. |
| `HARDCOVER_LOC_RECOVERY` | Enables Library of Congress catalog recovery for migration/reconciliation. Defaults to `true`. |
| `HARDCOVER_APIFY_GOODREADS_ACTOR` / `HARDCOVER_APIFY_TOKEN` | Optional Apify Actor adapter for Goodreads-compatible recovery. Actor runs may be metered; set a JSON `HARDCOVER_APIFY_GOODREADS_INPUT_TEMPLATE` containing `{{query}}` when the Actor uses a different input schema. |
| `HARDCOVER_APIFY_API_BASE_URL` | Apify API base URL; defaults to `https://api.apify.com`. |
| `HARDCOVER_GOOGLEBOOKS_BASE_URL` / `HARDCOVER_LOC_BASE_URL` | Override provider API bases for controlled deployments and tests. |
| `HARDCOVER_LOCAL_DB_IMPORT` | Enables deterministic local DB fallback after API and softcover recovery fail. |
| `HARDCOVER_MATCH_CONCURRENCY` | Match report lookup concurrency. |
| `HARDCOVER_API_TIMEOUT_MS` | Target API timeout for migration requests. |

### Cypress Runtime Config

Cypress test seeding uses `cypress/config/settings.cypress.json`, which is intentionally a test-only configuration and does not include live Radarr, Sonarr, Lidarr, or Bookshelf settings.

By default, `pnpm cypress:prepare` and `pnpm cypress:start` use `CONFIG_DIRECTORY=cypress/runtime-config` so test seeding cannot overwrite the live `config/settings.json`. Do not point `CONFIG_DIRECTORY` at the live `config` directory for Cypress runs. If you intentionally need to reset live settings with Cypress data, set `SEERR_ALLOW_LIVE_CONFIG_OVERWRITE=true`; otherwise the prep script refuses to overwrite a live config that already has automation services configured.

## Caching and Performance

SeerrNG has several cache layers. They are designed to make repeat browsing, page refreshes, and tab restores fast while keeping media data reasonably fresh.

- **Service worker runtime cache** keeps cacheable API responses, static assets, avatars, and image proxy responses available to the browser.
- **Stale-while-revalidate API responses** let cacheable pages populate quickly while background requests refresh data.
- **Image proxy cache** stores supported external images under the config cache directory and returns browser validators for efficient `304 Not Modified` responses.
- **Visible-first warmup** warms images for visible titles before below-the-fold content.
- **Hidden-tab restraint** skips image warmup while the tab is hidden so returning to the tab does not flood the app with stale work.
- **Host caches** cover TMDB, MusicBrainz, ListenBrainz, Open Library, Cover Art Archive, TheAudioDB, Radarr, Sonarr, Lidarr, Readarr/Bookshelf, DNS, and image metadata where supported.
- **Jobs & Cache settings** expose cache stats and flush controls.

If SeerrNG runs behind a reverse proxy, do not blanket-strip cache headers or force `Cache-Control: no-store` on `/imageproxy/*`, `/avatarproxy/*`, `/sw.js`, static assets, or cacheable API responses. App pages and sensitive routes can remain non-cacheable.

## Development

Requirements:

- Node.js matching the repo/tooling version.
- `pnpm`.
- SQLite for local development, or PostgreSQL if testing that backend.

Install dependencies:

```bash
pnpm install
```

Run the development server:

```bash
pnpm dev
```

Useful commands:

```bash
pnpm typecheck
pnpm typecheck:client
pnpm typecheck:server
pnpm lint
pnpm test
pnpm build
pnpm --dir gen-docs build
```

Migration-specific checks:

```bash
node --test deploy/bookshelf-hardcover-migration.test.mjs
bash -n deploy/bookshelf-migration-lab.sh deploy/install-bookshelf-backend.sh
deploy/bookshelf-migration-lab.sh discover
```

API docs are served by a running local install at:

```text
http://localhost:5055/api-docs
```

## Testing Real Integrations

For music and book changes, test against real services when possible:

- Add a Lidarr server, set it as default, request an album, approve it, scan it, retry failure cases, and remove it.
- Add a Bookshelf/Readarr-compatible ebook server, request a book by search result and specific edition/ISBN, approve it, scan it, retry it, and remove it.
- Add an audiobook Bookshelf service entry pointing to the same instance as the ebook entry, then test audiobook-only and both-format requests.
- Run `deploy/bookshelf-migration-lab.sh apply` against a copied source Bookshelf/Readarr config before changing migration code.
- Validate migration cutover with `node deploy/bookshelf-hardcover-migration.mjs --cutover-check <migration-dir>`.
- Confirm request cards, request detail pages, notifications, and backend links point to the correct SeerrNG and service pages.

See [docs/using-seerr/music-and-books-alpha.md](./docs/using-seerr/music-and-books-alpha.md) for the current hands-on test checklist.

See [docs/using-seerr/playlist-requests.md](./docs/using-seerr/playlist-requests.md) for playlist provider setup and the user import workflow.

## Legal Use

SeerrNG is intended for lawful personal media management. The project does not provide media, does not bypass DRM, and does not condone piracy or copyright infringement. Users are responsible for complying with the laws, licenses, and service terms that apply in their region.

## Support

- Discord: https://discord.gg/5PyXBfvS6T
- Issues: https://github.com/snapetech/seerrng/issues
- Discussions: https://github.com/snapetech/seerrng/discussions

Use upstream Seerr documentation when you need background on inherited deployment or video-library behavior, but report SeerrNG-specific music, book, cache, packaging, and branding issues in this repository.

## Contributing

Contributions should target SeerrNG behavior and this repository's current branch layout. Before opening a pull request:

- Keep fork attribution intact.
- Avoid reintroducing upstream-only branding.
- Add or update tests for request, validation, service-routing, cache, and scanner behavior.
- Run the relevant typecheck/test commands.
- Disclose AI assistance as required by [CONTRIBUTING.md](./CONTRIBUTING.md).

## Attribution

SeerrNG builds on Seerr, Jellyseerr, and Overseerr. Inherited code, documentation, and design remain credited to their original contributors. Fork-specific changes are credited to snapetech and SeerrNG contributors unless otherwise noted. See [NOTICE.md](./NOTICE.md) for the full attribution policy.
