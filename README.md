<p align="center">
  <img src="./public/logo_full.svg" alt="SeerrNG" style="margin: 20px 0" />
</p>

<p align="center">
  <img src="https://github.com/snapetech/seerrng/actions/workflows/ci.yml/badge.svg" alt="SeerrNG CI" />
  <a href="https://github.com/snapetech/seerrng/blob/main/LICENSE"><img src="https://img.shields.io/github/license/snapetech/seerrng" alt="License" /></a>
  <a href="https://discord.gg/2N42G4RJCU"><img src="https://img.shields.io/badge/support-Discord-5865F2?logo=discord&logoColor=white" alt="Support on Discord" /></a>
</p>

# SeerrNG

SeerrNG is a self-hosted request and discovery app for personal media libraries. It extends the Seerr/Jellyseerr/Overseerr lineage beyond movies and TV into music, ebooks, and audiobooks while keeping the familiar request approval workflow for Plex, Jellyfin, Emby, Radarr, and Sonarr users.

This fork is maintained by snapetech. Upstream Seerr remains the base project for inherited video, user, server, and deployment behavior; SeerrNG-specific work focuses on multi-format media requests, service routing, caching, and fork-owned packaging/docs. See [NOTICE.md](./NOTICE.md) for attribution rules.

## What SeerrNG Does

- Requests and approvals for movies, shows, music, ebooks, audiobooks, and combined ebook/audiobook book requests.
- Media-server integration with Plex, Jellyfin, and Emby.
- Automation service integration with Radarr, Sonarr, Lidarr, and Bookshelf/Readarr-compatible APIs.
- Music discovery and metadata through MusicBrainz, ListenBrainz, Cover Art Archive, TheAudioDB, and archive-backed artwork sources.
- Book discovery and identity matching through Open Library, ISBN-10/ISBN-13 normalization, foreign book IDs, and edition IDs.
- Separate ebook and audiobook service routing so both formats can be requested, approved, scanned, retried, and removed independently.
- Bookshelf backend diagnostics that classify Hardcover, softcover/Goodreads, and unknown metadata providers.
- Hardcover-first Bookshelf deployment and migration tooling for existing Readarr or softcover libraries.
- Resumable, layered Readarr/softcover-to-Hardcover migration with strict matching, softcover metadata recovery, validation, cutover checks, and an opt-in deterministic local-record fallback for books Hardcover cannot import.
- Watchlists, blocklists, request quotas, override rules, permissions, notifications, issue reporting, and request management.
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
      TMDB_API_KEY: ${TMDB_API_KEY}
      TMDB_READ_ACCESS_TOKEN: ${TMDB_READ_ACCESS_TOKEN}
    ports:
      - 5055:5055
    volumes:
      - /path/to/seerrng/config:/app/config
    restart: unless-stopped
```

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

Books:

- Bookshelf or another Readarr-compatible service configured in **Settings > Services**. New deployments should use the Hardcover-backed Bookshelf image.
- One service marked as ebook-capable for ebook requests.
- Optional second service marked as audiobook-capable for audiobook requests.
- Separate defaults for ebook and audiobook if both-format requests should work cleanly.
- Existing Readarr or softcover/Goodreads libraries should be migrated before switching to Hardcover metadata. The service settings modal links directly to the Bookshelf Hardcover migration runbook.

## Bookshelf and Hardcover

SeerrNG treats Bookshelf as the recommended backend for book requests. The
default deployment path uses the Snapetech BookshelfNG fork with Hardcover
metadata:

```text
ghcr.io/snapetech/bookshelfng:hardcover
```

Legacy softcover/Goodreads deployments remain supported for existing users:

```text
ghcr.io/snapetech/bookshelfng:softcover
```

Do not convert an existing Readarr or softcover database to Hardcover by only
changing the image tag or `METADATA_URL`. Goodreads/softcover author, book, and
edition IDs are not portable to Hardcover. Use the migration flow below.

### Bookshelf Installer

The deployment helper creates a two-instance Bookshelf stack for ebook and
audiobook requests:

```bash
deploy/install-bookshelf-backend.sh
```

Useful modes:

```bash
deploy/install-bookshelf-backend.sh --dry-run
deploy/install-bookshelf-backend.sh --validate-only
deploy/install-bookshelf-backend.sh --validate-api
deploy/install-bookshelf-backend.sh --migrate-to-hardcover
deploy/install-bookshelf-backend.sh --restore-backup
```

Set `BOOKSHELF_BACKEND=auto|hardcover|softcover` to choose the backend policy.
`auto` creates Hardcover instances for fresh installs and invokes the migration
flow when an existing Readarr/softcover config is detected.

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
- optionally create deterministic local Bookshelf records for the books Hardcover still cannot import.

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
| `TMDB_API_KEY` | TMDB v3 API key. |
| `TMDB_READ_ACCESS_TOKEN` | TMDB v4 bearer token. |
| `SEERR_EXTERNAL_READ_ONLY` | Blocks mutating requests to external automation APIs when enabled. Useful for test/lab environments. Production refuses to start with this enabled unless explicitly allowed. |
| `SEERR_ALLOW_PRODUCTION_EXTERNAL_READ_ONLY` | Allows `SEERR_EXTERNAL_READ_ONLY` in production for an intentional read-only clone. Do not set this on the writable request.snape.tech deployment. |

Use deployment secrets, `.env` files, or container environment variables. Do not commit private TMDB, Plex, Jellyfin, Emby, Radarr, Sonarr, Lidarr, Bookshelf, SMTP, or notification credentials.

Bookshelf deployment and migration variables live on the helper scripts rather
than the SeerrNG runtime container. Common ones include:

| Variable | Purpose |
| --- | --- |
| `BOOKSHELF_BACKEND` | `auto`, `hardcover`, or `softcover`. |
| `BOOKSHELF_IMAGE` | Override the Bookshelf image. Defaults to `ghcr.io/snapetech/bookshelfng:hardcover` for Hardcover mode. |
| `BOOKSHELF_EBOOKS_CONFIG_DIR` | Ebook Bookshelf/Readarr config directory. |
| `BOOKSHELF_AUDIOBOOKS_CONFIG_DIR` | Audiobook Bookshelf/Readarr config directory. |
| `HARDCOVER_EBOOK_API_KEY` / `HARDCOVER_AUDIOBOOK_API_KEY` | API keys for target Hardcover Bookshelf instances. |
| `HARDCOVER_SOFTCOVER_EBOOK_BASE_URL` / `HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL` | Optional softcover recovery endpoints. |
| `HARDCOVER_OPENLIBRARY_RECOVERY` | Enables OpenLibrary-assisted native Hardcover remapping. Defaults to `true`. |
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
- Add a separate audiobook Bookshelf service and test audiobook-only plus both-format requests.
- Run `deploy/bookshelf-migration-lab.sh apply` against a copied source Bookshelf/Readarr config before changing migration code.
- Validate migration cutover with `node deploy/bookshelf-hardcover-migration.mjs --cutover-check <migration-dir>`.
- Confirm request cards, request detail pages, notifications, and backend links point to the correct SeerrNG and service pages.

See [docs/using-seerr/music-and-books-alpha.md](./docs/using-seerr/music-and-books-alpha.md) for the current hands-on test checklist.

## Legal Use

SeerrNG is intended for lawful personal media management. The project does not provide media, does not bypass DRM, and does not condone piracy or copyright infringement. Users are responsible for complying with the laws, licenses, and service terms that apply in their region.

## Support

- Discord: https://discord.gg/2N42G4RJCU
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
