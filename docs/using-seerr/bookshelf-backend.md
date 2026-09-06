---
title: Bookshelf Backend
description: Deploy Bookshelf for ebook and audiobook requests.
sidebar_position: 21
---

# Bookshelf Backend

SeerrNG sends book requests to a Readarr-compatible Bookshelf API. New
deployments should use the Hardcover metadata backend. Existing Readarr or
softcover deployments should be backed up and inventoried before cutover because
Goodreads/softcover foreign IDs are provider-specific and cannot be safely
reused as Hardcover IDs.

[Chaptarr](https://github.com/Chaptarr/chaptarr) is a supported Readarr-
compatible alternative. SeerrNG sends the selected book format explicitly, so
Chaptarr can serve ebooks and audiobooks from one instance without a
provider-specific URL Base or API adapter.

### Chaptarr

Configure Chaptarr in **Settings > Services** as a Bookshelf server:

1. Add one service entry for each format you want to request. Set **Book
   Format** to **Ebook** or **Audiobook** to match the Chaptarr root folder and
   profiles selected below it.
2. Use Chaptarr's normal host, port, and API key. Leave **URL Base** blank
   unless you deliberately configured a URL Base in Chaptarr.
3. Select the format-specific root folder, quality profile, and metadata
   profile returned by the connection test.
4. Enable **Scan** after saving. Enable **Automatic Search** if approvals
   should start a Chaptarr search.

For a single Chaptarr instance that manages both formats, create two SeerrNG
service entries with the same connection details and different **Book Format**
values. Mark one entry of each format as the default. A **Both** request then
dispatches once to each entry.

SeerrNG sends Chaptarr the requested book identity and selected-book monitoring
intent. Chaptarr may still create unmonitored catalogue rows for other books by
the same author; only the requested format/book is marked for monitoring. This
is normal Chaptarr behaviour, not evidence that SeerrNG approved those other
books.

Pin the Chaptarr image to a tested version instead of relying on `latest`.
Compatibility was validated against the official Docker image reporting
`0.9.911.0`; Chaptarr is actively developed and its Readarr-compatible surface
can change between releases.

If a Chaptarr lookup is empty, first verify that the selected **Book Format**
has a writable root folder and matching quality/metadata profiles. If the
connection test succeeds but diagnosis reports incomplete metadata, check the
Chaptarr metadata provider and retry the lookup from its UI.

## Deployment Policy

### Readarr to Softcover to Hardcover Migration

Make Hardcover the default Bookshelf backend for new installs. For existing
Readarr or softcover users, provide an automatic in-place migration workflow
whose final result keeps the same Seerr-facing service endpoints where possible,
but rebuilds book metadata against Hardcover IDs instead of blindly reusing
Goodreads or softcover IDs.

Core policy:

- New install with no existing Readarr or Bookshelf config: create Hardcover
  ebook and audiobook instances.
- Existing Readarr or softcover config: back up, inventory, migrate matched
  books to Hardcover, then disable softcover after successful migration.
- Matching: strict automatic migration only; fuzzy matches go to an optional
  admin review report, not automatic cutover.
- Softcover becomes a legacy or backup backend, not the default path.

### Installer and Compose

- Change the default image from the pinned
  `ghcr.io/snapetech/bookshelfng:softcover@sha256:bea37ae5981406f7221e1fced4191a06167997c9777fc2a6a5aa6301a776b667`
  image to the pinned
  `ghcr.io/snapetech/bookshelfng:hardcover@sha256:867abb5a95d1556c30bd22389ea913755c9157323fac36159a691d5453f92636`
  image.
- Add an installer backend mode:

  ```env
  BOOKSHELF_BACKEND=auto|hardcover|softcover
  ```

  The default mode should be `auto`.
- In `auto` mode:
  - if no existing config or database exists, create fresh Hardcover instances;
  - if an existing Readarr or softcover config/database exists, run the
    migration flow.
- For fresh Hardcover installs:
  - use the pinned
    `ghcr.io/snapetech/bookshelfng:hardcover@sha256:867abb5a95d1556c30bd22389ea913755c9157323fac36159a691d5453f92636`
    image;
  - use the local rreading-glasses compatibility boundary by default;
  - pass `HARDCOVER_AUTH` to rreading-glasses;
  - enable the rreading-glasses and PostgreSQL Compose profile;
  - keep native Hardcover available as an explicit opt-in.
- Installer reruns rewrite the generated `.env` to match the resolved backend
  mode. Existing `.env` files are kept as timestamped `.env.bak-*` files, and
  the existing `RREADING_GLASSES_POSTGRES_PASSWORD` is preserved when present.
- `BOOKSHELF_METADATA_MODE` controls the metadata path:
  - `compatibility` (default for fresh Hardcover): local rreading-glasses and
    its PostgreSQL cache;
  - `native`: direct GraphQL from BookshelfNG, with no local proxy;
  - `hosted`: disable native mode and use the hosted `METADATA_URL` without a
    local proxy;
  - compatibility mode activates the rreading-glasses and PostgreSQL Compose
    profile, and points BookshelfNG at the local proxy.
- Existing installs that have `BOOKSHELF_METADATA_URL` set to
  `http://127.0.0.1:*` or already use the `rreading-glasses` Compose profile
  are detected as `compatibility` on rerun. Set the mode explicitly to change
  that behavior.
- Keep two instances:
  - ebook on `8787`;
  - audiobook on `8788`.

### Migration Flow

Add a migration command to the installer:

```bash
deploy/install-bookshelf-backend.sh --migrate-to-hardcover
```

`BOOKSHELF_BACKEND=auto` should invoke this automatically when an existing
Readarr or softcover config is detected.

Preflight:

- verify Docker, compose, image pull, config paths, database readability, and
  free disk space;
- require `sqlite3` when an existing `nzbdrone.db` is present, so migration does
  not silently produce an empty inventory;
- require enough backup destination space for the existing ebook, audiobook, and
  rreading-glasses data paths with a default 2x margin. Override with
  `MIN_BACKUP_FREE_MULTIPLIER` when needed;
- detect existing `config.xml`, API key, port, `nzbdrone.db`, root folders,
  quality profiles, metadata profiles, monitored books, editions, tags, and
  service type;
- write a timestamped backup before stopping or changing containers.
- write `backup-manifest.json` with source paths, resolved backend mode, image,
  metadata URL, and backup archive names.

Inventory:

- export every monitored book with title, author, ISBN-13, ISBN-10, ASIN,
  foreign IDs, selected edition, root folder, quality profile, metadata profile,
  tags, monitor/search flags, and service type.

Matching:

- query a temporary Hardcover Bookshelf instance using ISBN/ASIN first;
- accept exact title plus exact author only when ISBN/ASIN is missing;
- reject ambiguous, missing, or fuzzy-only matches;
- write:
  - `migration-report.json`;
  - `matched-books.json`;
  - `unmatched-books.json`;
  - `ambiguous-books.json`;
  - `rebuild-payload.json`;
  - `rebuild-blocked.json`.

The installer writes inventory and report files by default. If a temporary
Hardcover target is already running, set `HARDCOVER_EBOOK_API_KEY` and
`HARDCOVER_AUDIOBOOK_API_KEY` before migration to let the helper populate strict
match reports. Override `HARDCOVER_EBOOK_BASE_URL` and
`HARDCOVER_AUDIOBOOK_BASE_URL` when the temporary target is not on
`127.0.0.1:8787` and `127.0.0.1:8788`. Hardcover API calls time out after
15 seconds by default; override with `HARDCOVER_API_TIMEOUT_MS`.
Validation lookup uses `Foundation Isaac Asimov` by default; override with
`HARDCOVER_VALIDATION_TERM` when a deployment has a better smoke-test title.
For rehearsals, limit matching volume with `HARDCOVER_MIGRATION_MAX_BOOKS`.
When API keys are missing or lookup cannot produce a strict match,
`unmatched-books.json` still includes the source title, author, root folder,
profile IDs/names, monitored state, tag labels, and identifiers for manual
review.

Applying the generated rebuild payload is opt-in. Set
`APPLY_HARDCOVER_REBUILD=true` only after reviewing `matched-books.json`,
`unmatched-books.json`, `ambiguous-books.json`, `rebuild-payload.json`, and
`rebuild-blocked.json`.
Applied and failed adds are written to `applied-books.json` and
`apply-failures.json`. After apply, the helper writes `validation-report.json`
and marks `migration-report.json` as `validation_complete` or
`validation_failed` based on provider detection, lookup readiness, and whether
applied book IDs are visible in the target instance.

When applying matched books, source profile IDs are not treated as portable. The
helper carries source quality/metadata profile names into the rebuild payload,
remaps those names to target Hardcover profile IDs, and refuses an add when the
target profile or root folder is missing. Source tag IDs are also treated as
non-portable; the helper carries tag labels, resolves existing target tags by
label, and creates missing target tags before adding matched books.

Container cutover is gated by `cutover-decision.json`. Even when
`ALLOW_INCOMPLETE_HARDCOVER_CUTOVER=true` is set for development, the installer
refuses to continue unless validation completed successfully and no apply
failures or blocked rebuild items remain.

After report generation, the installer prints a concise migration summary with
match counts, apply counts, validation state, and cutover readiness. To reprint
that summary later:

```bash
node deploy/bookshelf-hardcover-migration.mjs --summary \
  /opt/bookshelf-backend/backups/20260518-145258/hardcover-migration
```

Rebuild:

- create a clean Hardcover config/database using the existing API key and port
  where possible;
- recreate root folders, profiles, metadata profiles, indexers, and download
  clients if they are exportable through the API or can be copied safely from
  database config tables;
- add matched books through the Hardcover Bookshelf API, preserving monitored
  state, root folder, quality profile, metadata profile, tags, and search
  policy.

Cutover:

- start Hardcover ebook and audiobook containers on the original ports;
- validate `/api/v1/config/development`, `/api/v1/book/lookup`, `/api/v1/book`,
  quality profiles, root folders, and request add/remove smoke tests;
- if validation passes, disable old softcover containers/configs but keep
  backups;
- if validation fails, restore the softcover backup and leave Seerr settings
  unchanged.

### SeerrNG Integration

- Extend Bookshelf diagnostics to classify backend provider:
  - `hardcover`;
  - `softcover`;
  - `unknown`.
- Surface the provider in **Settings > Services** diagnostics.
- Keep softcover hydration fallback for legacy users.
- Treat Hardcover as the recommended backend in docs and install paths.
- Keep Readarr-compatible API behavior in SeerrNG; do not require Seerr users
  to know provider internals.
- Add a warning when a Bookshelf service reports softcover/Goodreads metadata:
  `Legacy metadata backend. Hardcover is recommended for new installs.`

### Documentation Updates

- Replace the current Bookshelf backend guide with:
  - fresh Hardcover install path;
  - existing Readarr/softcover migration path;
  - softcover legacy fallback path;
  - rollback instructions;
  - matching policy and report interpretation.
- Document that direct ID reuse is unsafe:
  - `ForeignAuthorId`, `ForeignBookId`, and `ForeignEditionId` are
    provider-specific;
  - switching `METADATA_URL` alone is not migration.
- Document unsupported v1 migration items:
  - uncertain or fuzzy matches are not auto-applied;
  - historical activity/queue data may not be preserved unless verified safe;
  - Goodreads import lists are not guaranteed on Hardcover.

### Test Plan

Fresh install:

- no existing config path creates Hardcover instances by default;
- compatibility metadata is enabled by default and the rreading-glasses
  profile provides the shared PostgreSQL cache;
- explicit `BOOKSHELF_METADATA_MODE=native` disables the proxy and uses
  BookshelfNG's direct Hardcover provider;
- Seerr can add ebook, audiobook, and both-format requests.

Legacy softcover install:

- existing config triggers migration flow in `auto` mode;
- backup is created before mutation;
- matched books are recreated in Hardcover;
- unmatched/ambiguous books are reported and not auto-migrated;
- old softcover is disabled after successful validation.

Rollback:

- failed Hardcover validation restores original softcover config and ports;
- Seerr service settings remain usable.

Diagnostics:

- reports Hardcover vs Softcover;
- flags softcover as legacy;
- confirms lookup/add readiness for Hardcover.

Regression:

- existing softcover users can still opt into `BOOKSHELF_BACKEND=softcover`;
- existing Seerr book request tests continue passing;
- zero-valued service/profile IDs remain covered.
- migration helper pure logic is covered by
  `node --test deploy/bookshelf-hardcover-migration.test.mjs`.
- migration helper match, rebuild, apply, validation, and cutover readiness are
  covered against a mocked Bookshelf-compatible API in the same test file.
- live migration rehearsals can be run with
  `deploy/bookshelf-migration-lab.sh`, which copies source configs into an
  isolated lab, starts disposable Hardcover targets on ports `18787` and
  `18788`, and only imports books when run in `apply` mode.

### Assumptions

- Hardcover is the default for new users.
- Existing users get an automatic migration attempt, but only strict matches are
  applied.
- Fuzzy matches are report-only for v1 and can become an admin review UI later.
- After successful migration, softcover is disabled but backups are retained.
- The final user-facing service should continue to look like "Bookshelf" in
  SeerrNG, with provider details available only in diagnostics and docs.

## Why Bookshelf

The legacy `lscr.io/linuxserver/readarr` backend can be reachable and still
return unusable `/api/v1/book/lookup` records. A bad lookup usually has a title
and a foreign book ID, but no author object and no editions. SeerrNG refuses to
add those raw records because Bookshelf/Readarr can reject them or create broken
library entries.

Bookshelf with Hardcover should be the default path for new installs. Bookshelf
with `softcover` and `rreading-glasses` remains available as a legacy fallback
for existing deployments and environments that still need Goodreads-compatible
metadata.

## Architecture

Run separate Bookshelf instances for ebooks and audiobooks:

- `bookshelf-ebooks` on port `8787`
- `bookshelf-audiobooks` on port `8788`

BookshelfNG is the maintained Readarr-style application. It owns library
management, download clients, importing, file organization, and the
Readarr-compatible API that SeerrNG calls. rreading-glasses is a metadata
compatibility/proxy layer: it exposes the metadata API BookshelfNG expects,
translates requests to Hardcover, caches results in PostgreSQL, and
coalesces/rate-limits upstream work. Metadata has three deliberate deployment
modes:

| Mode | Bookshelf metadata path | rreading-glasses | Use it when |
| --- | --- | --- | --- |
| `compatibility` (default for fresh Hardcover) | BookshelfNG → local rreading-glasses → upstream | On, with PostgreSQL | A shared durable cache, centralized throttling, or a compatibility boundary |
| `native` (explicit opt-in) | BookshelfNG → Hardcover GraphQL | Off | The shortest direct Hardcover path |
| `hosted` | BookshelfNG → `METADATA_URL` such as `https://hardcover.bookinfo.pro` | Off | Native credentials are unavailable or a hosted compatibility endpoint is preferred |

Compatibility is the installer default because it keeps BookshelfNG decoupled
from Hardcover's GraphQL API and centralizes Hardcover authentication, caching,
request coalescing, and upstream throttling. One proxy and PostgreSQL cache can
serve both the ebook and audiobook instances. Existing local proxy installs are
detected and preserved on rerun.

Native remains an explicit alternative when the shortest direct path is more
valuable than the shared proxy boundary. Select it with
`BOOKSHELF_METADATA_MODE=native`.

### Native Hardcover failure behavior

Native mode intentionally has no hidden runtime failover. The request path is:

1. BookshelfNG checks its in-process metadata cache.
2. On a miss, it sends the GraphQL request directly to Hardcover using
   `HARDCOVER_AUTH`.
3. A successful response is mapped into BookshelfNG's normal metadata models
   and cached for later lookups.
4. If native mode is disabled, the same application falls back to
   `METADATA_URL`; switching to hosted or compatibility mode is explicit and
   visible in `.env`.

This avoids a partially working deployment that silently changes providers or
duplicates requests during an outage. The tradeoff is that native mode does
not provide rreading-glasses' durable cross-instance cache. A fresh search or
refresh still needs Hardcover, and an operator must select compatibility mode
if persistent proxy caching is required.

### Compatibility-mode outage behavior

In compatibility mode, rreading-glasses provides the older shared path:

1. BookshelfNG calls the local rreading-glasses endpoint on port `8790`.
2. rreading-glasses checks its in-memory cache and then its PostgreSQL-backed
   cache on localhost port `15433`.
3. Cached author, work, edition, or series responses can be served without a
   fresh upstream call until their cache lifetime expires.
4. A cache miss, expired entry, or free-text search still needs the configured
   upstream. The proxy is not an unlimited offline mirror.

The shared cache can help both Bookshelf instances and survives a proxy restart
when its PostgreSQL volume is healthy. It also adds two local failure points:
the proxy and its database. If either is unavailable, both instances lose this
metadata path. There is no automatic runtime failover from Hardcover to
Goodreads or OpenLibrary in either mode.

During a compatibility-mode outage, keep rreading-glasses and
`RREADING_GLASSES_POSTGRES_DIR` intact. The installer backs up that directory
when it exists. The proxy readiness check proves only that the local process is
serving; use `--validate-api`, an actual lookup, and the proxy logs to verify
upstream recovery.

For compatibility mode, provide `HARDCOVER_AUTH` with the `Bearer ` prefix;
the token is used by rreading-glasses. Native mode passes it to BookshelfNG.
Get a token from
https://hardcover.app/settings → Hardcover API. Hosted mode does not require a
local token for metadata, although Bookshelf's own Hardcover list-import
settings still need an API key when that feature is used.

For Goodreads/softcover mode, provide a Goodreads cookie via `COOKIE` if your
upstream requires one.

If Bookshelf is reachable but searches return no books, run the installer's
`--validate-api` check and inspect the lookup response, not just the TCP
connection test. Hardcover mode requires `HARDCOVER_AUTH` with the `Bearer `
prefix; softcover mode requires the Goodreads `COOKIE` when the upstream asks
for it.

Bookshelf supports only one type of a given book in a single instance. SeerrNG
therefore expects one default Bookshelf service for ebooks and a separate default
Bookshelf service for audiobooks when audiobook or both-format requests are used.

## Repository and Image

The public Snapetech fork is:

```text
https://github.com/snapetech/bookshelfng
```

The deployment compose defaults to the Snapetech image:

```text
ghcr.io/snapetech/bookshelfng:hardcover@sha256:867abb5a95d1556c30bd22389ea913755c9157323fac36159a691d5453f92636
```

The installer and deployment Compose file use an immutable BookshelfNG digest.
Update the digest deliberately when adopting a newer BookshelfNG build so
deployments are reproducible and rollbackable.

That image is built from the public `bookshelfng` fork and provides the native
Hardcover metadata backend. Fresh installs use the local rreading-glasses
compatibility path by default; set `BOOKSHELF_METADATA_MODE=native` to pass
`HARDCOVER_AUTH` directly to BookshelfNG. To force the legacy softcover path,
set `BOOKSHELF_BACKEND=softcover`; this switches the image to the pinned
`ghcr.io/snapetech/bookshelfng:softcover@sha256:bea37ae5981406f7221e1fced4191a06167997c9777fc2a6a5aa6301a776b667`
and keeps compatibility mode.
Softcover deployments use `COOKIE` when the Goodreads upstream requires it.

The image is published from GitHub Actions in the `snapetech/bookshelfng`
repository:

```bash
docker pull ghcr.io/snapetech/bookshelfng:softcover@sha256:bea37ae5981406f7221e1fced4191a06167997c9777fc2a6a5aa6301a776b667
```

If a pull returns `denied`, the package exists but is not anonymously readable.
Make it public in GitHub under **Packages > bookshelfng > Package settings >
Change visibility**, or authenticate Docker with a token that can read packages.
As a temporary fallback, set
`BOOKSHELF_IMAGE=ghcr.io/pennydreadful/bookshelf:softcover`; SeerrNG can hydrate
upstream softcover lookup results that contain `foreignEditionId` but return an
empty `editions` array.

## Known Good Versions

The validated SeerrNG backend migration build was:

```text
seerrng:bookshelf-fix-20260518f
```

The validated BookshelfNG fork includes these changes:

```text
bde894431 Return author and editions from book lookup
c416ad1af Add image publish workflow
d7dc505f8 Skip CI for documentation-only changes
0d600a564 Guard null Hardcover edition sub-objects
fd8abff6b Add sparse Hardcover metadata regression tests
5788f7c1c Pin patched transitive dependencies
```

Use the pinned `ghcr.io/snapetech/bookshelfng:softcover@sha256:bea37ae5981406f7221e1fced4191a06167997c9777fc2a6a5aa6301a776b667`
image for softcover once the GHCR package is public or the Docker host is
authenticated. If you need a fully anonymous pull before that package
visibility is corrected, use
`ghcr.io/pennydreadful/bookshelf:softcover` and rely on SeerrNG's softcover
hydration fallback.

## Paths

Keep the same media and download mount paths that download clients and Plex
already know about. If these paths change, imports and hardlinks can break.

The example compose uses:

```text
/data      -> media root
/download  -> download root
/downloads -> media root compatibility mount
/plex      -> Plex library root
/media/plex -> Plex library root compatibility mount
```

For the validated deployment, the important in-container paths were:

```text
/data/plex/books
/download/books
```

## Installer Script

The repository includes an installer helper:

```bash
deploy/install-bookshelf-backend.sh
```

For existing Readarr or softcover deployments, use the full migration runbook:

```text
docs/using-seerr/bookshelf-hardcover-migration.md
```

It does the following:

- validates Docker, Docker Compose, the compose template, and the Bookshelf
  image,
- copies `deploy/compose.bookshelf.yml` into an install directory,
- writes an `.env` file with a generated Postgres password,
- backs up existing Bookshelf/Readarr config directories,
- creates missing config/data directories,
- creates or patches each Bookshelf `config.xml` so the ebook instance binds
  port `8787` and the audiobook instance binds port `8788`,
- optionally stops an old Readarr container,
- starts the two Bookshelf instances with Docker Compose; starts
  rreading-glasses and Postgres only when
  `BOOKSHELF_METADATA_MODE=compatibility`,
- prints the Seerr settings and validation commands.

Preview the install without changing files or containers:

```bash
sudo deploy/install-bookshelf-backend.sh --dry-run
```

Validate an already-rendered install directory without starting containers:

```bash
sudo deploy/install-bookshelf-backend.sh --validate-only
```

Validate the Bookshelf APIs after startup:

```bash
sudo EBOOK_API_KEY=replace-me AUDIOBOOK_API_KEY=replace-me \
  deploy/install-bookshelf-backend.sh --validate-api --skip-pull --no-stop-readarr
```

Run it on the Docker host:

```bash
sudo INSTALL_DIR=/opt/bookshelf-backend \
  BOOKSHELF_EBOOKS_CONFIG_DIR=/mnt/datapool_lvm_media/readarr-config \
  BOOKSHELF_AUDIOBOOKS_CONFIG_DIR=/mnt/datapool_lvm_media/bookshelf-audiobooks-config \
  MEDIA_ROOT=/mnt/datapool_lvm_media \
  DOWNLOAD_ROOT=/mnt/datapool_lvm_media/download \
  PLEX_ROOT=/mnt/datapool_lvm_media/plex \
  deploy/install-bookshelf-backend.sh
```

To stop an existing Readarr container during migration:

```bash
sudo STOP_OLD_READARR_CONTAINER=readarr-host deploy/install-bookshelf-backend.sh
```

To keep an existing Readarr container running while preparing the new stack:

```bash
sudo STOP_OLD_READARR_CONTAINER=readarr-host \
  deploy/install-bookshelf-backend.sh --no-stop-readarr
```

To use the upstream image instead of the Snapetech fork:

```bash
sudo BOOKSHELF_IMAGE=ghcr.io/pennydreadful/bookshelf:softcover \
  deploy/install-bookshelf-backend.sh
```

If the image is already present locally or the registry requires authentication,
skip the pull step:

```bash
sudo deploy/install-bookshelf-backend.sh --skip-pull
```

## Manual Compose

Use the included compose file if you prefer manual setup:

```bash
mkdir -p /opt/bookshelf-backend
cp deploy/compose.bookshelf.yml /opt/bookshelf-backend/compose.yml
cd /opt/bookshelf-backend
```

Create `/opt/bookshelf-backend/.env`:

```env
PUID=1000
PGID=953
TZ=America/Regina

BOOKSHELF_BACKEND=hardcover
BOOKSHELF_IMAGE=ghcr.io/snapetech/bookshelfng:hardcover@sha256:867abb5a95d1556c30bd22389ea913755c9157323fac36159a691d5453f92636
BOOKSHELF_METADATA_MODE=compatibility
BOOKSHELF_METADATA_URL=http://127.0.0.1:8790
BOOKSHELF_HARDCOVER=true
BOOKSHELF_HARDCOVER_NATIVE=false
BOOKSHELF_HARDCOVER_AUTH=
BOOKSHELF_EBOOKS_CONFIG_DIR=/mnt/datapool_lvm_media/readarr-config
BOOKSHELF_AUDIOBOOKS_CONFIG_DIR=/mnt/datapool_lvm_media/bookshelf-audiobooks-config

MEDIA_ROOT=/mnt/datapool_lvm_media
DOWNLOAD_ROOT=/mnt/datapool_lvm_media/download
PLEX_ROOT=/mnt/datapool_lvm_media/plex

COMPOSE_PROFILES=rreading-glasses
HARDCOVER_AUTH=Bearer your-hardcover-api-token-here
RREADING_GLASSES_UPSTREAM=api.hardcover.app
RREADING_GLASSES_IMAGE=blampe/rreading-glasses:hardcover@sha256:3489e722a73c9cbab5b9ba530cf8a60c2280367fb03db1fb649261dfb064b52f
RREADING_GLASSES_POSTGRES_DIR=/mnt/datapool_lvm_media/rreading-glasses-postgres/data
RREADING_GLASSES_POSTGRES_PASSWORD=replace-with-a-long-random-password
```

For explicit native mode, use the same file with these metadata settings and a
token passed directly to BookshelfNG:

```env
BOOKSHELF_METADATA_MODE=native
BOOKSHELF_METADATA_URL=https://hardcover.bookinfo.pro
BOOKSHELF_HARDCOVER_NATIVE=true
BOOKSHELF_HARDCOVER_AUTH=Bearer your-hardcover-api-token-here
COMPOSE_PROFILES=
HARDCOVER_AUTH=Bearer your-hardcover-api-token-here
```

For Goodreads/softcover compatibility mode, use:

```env
BOOKSHELF_BACKEND=softcover
BOOKSHELF_IMAGE=ghcr.io/snapetech/bookshelfng:softcover@sha256:bea37ae5981406f7221e1fced4191a06167997c9777fc2a6a5aa6301a776b667
BOOKSHELF_METADATA_MODE=compatibility
BOOKSHELF_METADATA_URL=http://127.0.0.1:8790
BOOKSHELF_HARDCOVER_NATIVE=false
COMPOSE_PROFILES=rreading-glasses
RREADING_GLASSES_IMAGE=blampe/rreading-glasses:latest@sha256:dd996a1db19ac4ef18df47f1671f608c0f097ed43c4776ebde94dee20c6b43c8
RREADING_GLASSES_UPSTREAM=www.goodreads.com
COOKIE=your-goodreads-cookie-here
RREADING_GLASSES_POSTGRES_PASSWORD=replace-with-a-long-random-password
```

Start the stack:

```bash
docker compose pull
docker compose up -d
```

For a fresh manual setup, make sure each Bookshelf config directory has a
different port in `config.xml` before both containers run on host networking:

```xml
<!-- ebook config.xml -->
<Port>8787</Port>

<!-- audiobook config.xml -->
<Port>8788</Port>
```

If both instances bind `8787`, only one container can start successfully.

## Backups

Before replacing Readarr or moving config directories, back up:

- ebook Bookshelf/Readarr config directory,
- audiobook Bookshelf config directory, if it already exists,
- rreading-glasses Postgres data directory, if it already exists.

Example:

```bash
backup_dir=/mnt/datapool_lvm_media/backups/readarr-bookshelf-$(date +%Y%m%d-%H%M%S)
mkdir -p "$backup_dir"
tar -C /mnt/datapool_lvm_media -czf "$backup_dir/readarr-config.tgz" readarr-config
tar -C /mnt/datapool_lvm_media -czf "$backup_dir/bookshelf-audiobooks-config.tgz" bookshelf-audiobooks-config
```

Do not delete the old backup after first boot. Keep it until ebook, audiobook,
and both-format requests have been tested through SeerrNG.

## SeerrNG Configuration

In **Settings > Services**, add two Bookshelf services.

Ebook service:

```text
Hostname: kspls0, 127.0.0.1, or the Docker host name reachable by SeerrNG
Port: 8787
Book Format: Ebook
Quality Profile: eBook
Root Folder: /data/plex/books
Default Server: enabled
Enable Scan: enabled
Enable Automatic Search: your policy
```

Audiobook service:

```text
Hostname: kspls0, 127.0.0.1, or the Docker host name reachable by SeerrNG
Port: 8788
Book Format: Audiobook
Quality Profile: Spoken
Root Folder: /data/plex/books, unless you maintain a separate audiobook root
Default Server: enabled
Enable Scan: enabled
Enable Automatic Search: your policy
```

Use each instance's own API key from **Bookshelf > Settings > General >
Security**. Do not reuse a stale key unless the config directory was intentionally
migrated and the key is still valid.

## Metadata Source

Each Bookshelf instance should use:

```text
http://127.0.0.1:8790
```

Verify with:

```bash
curl -H "X-Api-Key: EBOOK_API_KEY" \
  http://127.0.0.1:8787/api/v1/config/development

curl -H "X-Api-Key: AUDIOBOOK_API_KEY" \
  http://127.0.0.1:8788/api/v1/config/development
```

Both responses should include:

```json
{
  "metadataSource": "http://127.0.0.1:8790"
}
```

## Lookup Validation

Run these against the Docker host:

```bash
curl -H "X-Api-Key: EBOOK_API_KEY" \
  "http://127.0.0.1:8787/api/v1/book/lookup?term=Foundation%20Isaac%20Asimov"

curl -H "X-Api-Key: AUDIOBOOK_API_KEY" \
  "http://127.0.0.1:8788/api/v1/book/lookup?term=Foundation%20Isaac%20Asimov"

curl -H "X-Api-Key: EBOOK_API_KEY" \
  "http://127.0.0.1:8787/api/v1/author/lookup?term=J.R.R.%20Tolkien"
```

With the pinned
`ghcr.io/snapetech/bookshelfng:softcover@sha256:bea37ae5981406f7221e1fced4191a06167997c9777fc2a6a5aa6301a776b667`
image, lookup results should include
nested `author` metadata and at least one `editions` entry. If you use upstream
Bookshelf and see `editions: []`, SeerrNG can still hydrate results that include
`foreignEditionId` and resolvable author metadata, but the Snapetech image is
the recommended fix.

## SeerrNG Diagnostic

The Bookshelf settings modal includes **Run Diagnostic**. It checks:

- backend unreachable,
- lookup returned no results,
- lookup returned incomplete/unusable results,
- backend rejected an add test,
- lookup is usable.

The API endpoint is:

```http
POST /api/v1/settings/readarr/diagnose
```

With a valid authenticated admin session, the body is the same Bookshelf settings
shape used by the service modal. Add `"testAdd": true` when you want SeerrNG to
attempt an add and immediately remove the test book without deleting files.

## Request Validation

After configuring both services:

1. Request an ebook for a known addable book.
2. Request an audiobook for a known addable book.
3. Request both formats for a known addable book.
4. Confirm the ebook request lands in `bookshelf-ebooks`.
5. Confirm the audiobook request lands in `bookshelf-audiobooks`.
6. Confirm each item uses the expected root folder and quality profile.
7. Confirm SeerrNG marks the request `COMPLETED`.

## Migration Lab

Use the lab runner to rehearse migration without writing to the source
Bookshelf/Readarr config. It copies source config directories into
`.bookshelf-migration-lab/source`, starts disposable Hardcover targets on
`18787` and `18788`, and writes migration reports under
`.bookshelf-migration-lab/backups`.

Discover visible local candidates:

```bash
deploy/bookshelf-migration-lab.sh discover
```

Report-only rehearsal:

```bash
SOURCE_EBOOK_CONFIG_DIR=/path/to/readarr-or-bookshelf-config \
HARDCOVER_MIGRATION_MAX_BOOKS=50 \
  deploy/bookshelf-migration-lab.sh report
```

Optional audiobook source:

```bash
SOURCE_EBOOK_CONFIG_DIR=/path/to/ebook-config \
SOURCE_AUDIOBOOK_CONFIG_DIR=/path/to/audiobook-config \
  deploy/bookshelf-migration-lab.sh report
```

Import strict matches into the disposable lab target only:

```bash
SOURCE_EBOOK_CONFIG_DIR=/path/to/ebook-config \
APPLY_IMPORT=true \
  deploy/bookshelf-migration-lab.sh apply
```

Print the latest lab report counts:

```bash
deploy/bookshelf-migration-lab.sh summary
```

Stop or remove the lab:

```bash
deploy/bookshelf-migration-lab.sh down
deploy/bookshelf-migration-lab.sh clean
```

If GHCR access is unavailable, the lab falls back to a local Bookshelf image
when one is present. It can also build a local Hardcover image from
`/home/keith/Documents/code/bookshelfng` when the base image is available.

## Rollback

If the migration fails:

1. Restore the generated backup:

   ```bash
   sudo BACKUP_DIR=/opt/bookshelf-backend/backups/20260518-145258 \
     deploy/install-bookshelf-backend.sh --restore-backup
   ```

   The restore command stops the rendered compose stack if
   `/opt/bookshelf-backend/compose.yml` exists, moves current config directories
   aside with a `.pre-restore-YYYYMMDD-HHMMSS` suffix, restores any backup
   tarballs present in `BACKUP_DIR`, and leaves Seerr settings unchanged. It can
   restore tarballs even when Docker is unavailable; in that case it skips
   compose shutdown and reports that explicitly.

2. Start the old Readarr container with the original mounts.
3. In SeerrNG, point the ebook service back to the old Readarr endpoint or
   disable book requests until Bookshelf is corrected.

Manual rollback is also possible:

1. Stop the Bookshelf stack:

   ```bash
   cd /opt/bookshelf-backend
   docker compose down
   ```

2. Restore the backed-up ebook config directory:

   ```bash
   rm -rf /mnt/datapool_lvm_media/readarr-config
   tar -C /mnt/datapool_lvm_media -xzf /path/to/readarr-config.tgz
   ```

3. Restore the audiobook config directory if it was changed:

   ```bash
   rm -rf /mnt/datapool_lvm_media/bookshelf-audiobooks-config
   tar -C /mnt/datapool_lvm_media -xzf /path/to/bookshelf-audiobooks-config.tgz
   ```

4. Restore rreading-glasses Postgres data if you need to preserve its cache:

   ```bash
   rm -rf /mnt/datapool_lvm_media/rreading-glasses-postgres/data
   tar -C /mnt/datapool_lvm_media/rreading-glasses-postgres \
     -xzf /path/to/rreading-glasses-postgres.tgz
   ```

Rollback does not require changing SeerrNG code. It only changes service
settings and backend containers.

## Troubleshooting

`backend_unreachable`:

- confirm the container is running,
- confirm SeerrNG can reach the host and port,
- confirm the API key is correct,
- confirm URL Base is empty unless Bookshelf is configured with one.

`lookup_empty`:

- check `BOOKSHELF_METADATA_MODE` in the generated `.env`;
- in native mode, confirm the Bookshelf image contains the native provider and
  `BOOKSHELF_HARDCOVER_AUTH` is present;
- in hosted mode, confirm `BOOKSHELF_METADATA_URL` is reachable;
- in compatibility mode, confirm rreading-glasses is running and Bookshelf
  `metadataSource` is `http://127.0.0.1:8790`;
- try an ISBN lookup such as `isbn:9780547928227`.

`lookup_incomplete`:

- confirm `/api/v1/author/lookup` works for the author,
- confirm the lookup result has `foreignEditionId`,
- update SeerrNG to a build that includes Bookshelf softcover hydration.

`backend_add_rejected`:

- check Bookshelf logs,
- confirm root folder and quality profile exist in that Bookshelf instance,
- confirm the selected root folder is writable inside the container,
- confirm download client paths match the container mounts.

Bulk request returns `serverId must be a positive integer`:

- update SeerrNG to a build that accepts zero-valued Servarr IDs in request
  overrides,
- confirm the service still exists in **Settings > Services**,
- retry the request after reloading the browser.

This can affect the first configured Bookshelf or Lidarr service because SeerrNG
stores service IDs starting at `0`. The backend must treat `0` as a valid
service/profile override value, not as a missing or invalid ID.

## Current Limitations

- Bulk book and music requests can still take a long time on large discographies
  or bibliographies. The modal shows submit progress and can retry failed items,
  but it does not yet offer a per-item backend preflight before submission.
- Music discography selection defaults to albums and can be filtered by release
  type. Review the selection before requesting singles, live albums,
  compilations, or other secondary release groups.
- Book requests rely on Bookshelf-compatible lookup metadata. The diagnostic
  can identify incomplete lookup results, but it does not yet run automatically
  before every request.
- Both-format book requests dispatch to two backend services. Check each
  Bookshelf instance when troubleshooting partial success.
