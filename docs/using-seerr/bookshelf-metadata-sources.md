---
title: Bookshelf Metadata Sources and Migration Recovery
description: Supported metadata paths, recovery providers, configuration, caching, and source identity behavior.
sidebar_position: 23
---

# Bookshelf Metadata Sources and Migration Recovery

This page separates three capabilities that are easy to conflate:

1. **Bookshelf runtime metadata** powers normal searches, author pages, book
   details, edition lookups, and imports.
2. **SeerrNG migration recovery** reads an existing Readarr/Bookshelf library,
   searches metadata sources for missing records, and maps safe matches to a
   new Hardcover-backed library.
3. **Local fallback records** preserve a book in Bookshelf when a native
   Hardcover record cannot be safely resolved.

Google Books, Library of Congress, Gutendex, Internet Archive, NDL Search,
Europeana, and Apify Goodreads-compatible search can also serve normal
BookshelfNG runtime searches when enabled. SeerrNG receives provider-qualified
IDs through configured Bookshelf/Readarr services and preserves the service
and source identity through search, details, and book requests.

## Support matrix

| Source or path | Ordinary Bookshelf search/details | Migration recovery | Authentication and cost | Notes |
| --- | --- | --- | --- | --- |
| Hardcover native | Yes, in the `hardcover` image when `HARDCOVER=true` | Yes; primary target for remapping | Hardcover token; subject to Hardcover service availability and limits | Create a token in [Hardcover account API settings](https://hardcover.app/account/api), then set it in BookshelfNG **Settings > Metadata** or with `HARDCOVER_AUTH` / `HARDCOVER_API_KEY`. Bookshelf-native Hardcover IDs are used for works, authors, and editions. |
| rreading-glasses / compatible `METADATA_URL` | Yes, when configured as the Bookshelf metadata endpoint | Yes, when configured as a Bookshelf/Softcover recovery endpoint | Depends on the hosted or self-hosted endpoint | A compatible endpoint must implement the API Bookshelf expects. |
| Goodreads-compatible / Softcover | Yes, through the compatible Bookshelf mode/image | Yes, when its endpoint is configured | Provider-specific; Goodreads no longer issues public API keys | Legacy Goodreads IDs remain provider-specific and cannot be converted by changing the image tag. |
| Open Library | Yes; SeerrNG queries it directly alongside configured Bookshelf services | Yes | No key for basic API access; observe Open Library's published low-volume request policy | Search results provide a fallback when a Bookshelf source is unavailable, subject to SeerrNG's provider deadline. |
| Google Books | Yes, enable in BookshelfNG **Settings > Metadata** and enter a Google Books API key; SeerrNG uses it through BookshelfNG | Yes | Public data requires a Google API key; no user OAuth is needed for this search | Can supply identifiers, descriptions, publisher, language, dates, page count, and cover URL. |
| Library of Congress | Yes, enabled by default in BookshelfNG and toggleable in **Settings > Metadata**; SeerrNG uses it through BookshelfNG | Yes | Public JSON API; no key; requests are paced to one per 3.2 seconds per Bookshelf process | Available language metadata is retained for BookshelfNG's edition-language profiles. The `/books/` endpoint searches LoC's digitized collection and is not the complete LoC book catalog. |
| Gutendex / Project Gutenberg | Yes, enabled by default in BookshelfNG and toggleable in **Settings > Metadata**; SeerrNG uses it through BookshelfNG | No | No key; Gutendex is open source and can be self-hosted; the shared endpoint is a third-party service | Literature-focused catalog with multiple languages and stable Gutenberg ebook IDs. Edition/ISBN metadata is limited; rights metadata describes US copyright status. |
| Internet Archive | Yes, opt-in in BookshelfNG **Settings > Metadata**; SeerrNG uses it through BookshelfNG | No | Public search and metadata need no key; rights and terms vary by item | Text collection records use stable Archive item IDs. Edition identity and artwork vary widely. |
| NDL Search | Yes, opt-in in BookshelfNG **Settings > Metadata**; SeerrNG uses it through BookshelfNG | No | No API key; use terms can require an application depending on use and source catalog | Metadata only: NDL ended its thumbnail service on March 31, 2026. SeerrNG book details display an NDL Search API source link for credit. Operators must check source-specific terms and inform NDL about continuous use. |
| Goodreads-compatible Apify Actor | Yes, opt-in in BookshelfNG **Settings > Metadata**; SeerrNG uses it through BookshelfNG | Optional migration adapter | Apify token required; Actor availability and pricing depend on its publisher | Actor schemas differ. Supply a JSON input template that contains `{{query}}`. |
| Europeana | Yes, enable in BookshelfNG **Settings > Metadata** and enter a Europeana API key; SeerrNG uses it through BookshelfNG | Not wired into the migration helper | Free API key; results are limited to openly reusable text records; provider terms apply | Europeana is a runtime search source only; it does not replace Hardcover or merge records into the primary catalog. |
| OpenBD | No | Not wired into the migration helper | API v1 was discontinued; no current version is integrated | The historical service was ISBN lookup rather than free-text catalog search. Verify any successor API before relying on it. |

“Free” describes access to some API operations, not an unlimited-service
guarantee or a blanket license for returned metadata and images. Google applies
quotas; Open Library asks applications to respect its request policy; Europeana
requires a free registered key; NDL Search conditions vary by provider; and
Apify can charge for Actor compute or results. Check each provider's current
terms and limits before operating at scale.

Goodreads stopped issuing new public developer keys and has retired or
restricted access to its public API. The adapter described here calls an
Apify Actor selected by the operator; it is not an official Goodreads API
client. See the [Goodreads Developers notice](https://www.goodreads.com/group/show/8095-goodreads-developers),
[Apify run Actor API](https://docs.apify.com/api/v2/acts-runs-post), and
[Apify dataset items API](https://docs.apify.com/api/v2/actor-run-get-dataset-items).

## Runtime metadata behavior

BookshelfNG has two broad runtime paths:

- The Hardcover image can use BookshelfNG's native Hardcover provider. Native
  provider IDs are kept in Bookshelf's work, author, and edition fields.
- A Readarr-compatible metadata endpoint can be selected with `METADATA_URL`;
  in the Hardcover image, setting `HARDCOVER_NATIVE=false` selects that path.
  This endpoint must implement the BookInfo-compatible search and detail
  behavior Bookshelf expects.
- The active runtime catalogs and optional Google Books, Europeana, and Apify
  credentials are configured per BookshelfNG instance in **Settings >
  Metadata**. The Hardcover token can also be saved there for native Hardcover
  mode. Credential inputs are write-only: the API returns whether a value is
  present, never the saved key or token. A non-empty environment value takes
  precedence over the saved value. A custom `BOOKSHELF_METADATA_SOURCES`
  value overrides the saved catalog selection; installer-managed default lists
  leave catalog choices editable in the UI.
- A standalone Hardcover image queries LOC and Gutendex alongside Hardcover
  by default. It also queries Google Books and Europeana when their API keys
  are configured. Internet Archive and NDL Search are opt-in, while a selected
  Apify Goodreads-compatible Actor is queried only when explicitly enabled.
  `BOOKSHELF_METADATA_SOURCES` replaces these defaults; setting it to an empty
  value disables all additional Bookshelf catalogs. The bundled SeerrNG
  installer currently offers an optional split deployment with LOC enabled on
  the audiobook process to coordinate request pacing. A single BookshelfNG
  instance uses one source selection for both formats. Per-process overrides
  `BOOKSHELF_EBOOKS_METADATA_SOURCES` and
  `BOOKSHELF_AUDIOBOOKS_METADATA_SOURCES` apply only to the split deployment.
  See the BookshelfNG README for credentials, cache lifetimes, request pacing,
  and the Actor input template.

SeerrNG merges Open Library search results with results from configured
BookshelfNG services. Each Bookshelf result uses a service-qualified SeerrNG ID
that wraps the Bookshelf foreign ID. Details are resolved through that same
service, and request admission carries the identity into Bookshelf lookup;
ISBNs are retained as cross-source matching identifiers when available.
Google volume IDs, LOC record identifiers, Europeana record IDs, and Apify
Actor record IDs are not coerced into Goodreads integers or Open Library keys.
In SeerrNG, **Settings > Metadata** continues to select TMDB/TVDB for series
and anime; its book-catalog panel points administrators to the connected
BookshelfNG instances, where book sources and credentials are actually applied.

The compatibility proxy's cache is distinct from migration recovery's file
cache. The former serves runtime metadata requests. The latter is a local
JSON artifact inside the migration directory and is only used by the migration
helper.

## Migration recovery flow

For each unmatched source record, the migration helper:

1. Searches configured Softcover/Goodreads-compatible data when available.
2. Searches Open Library using title, author, and identifiers.
3. Searches Google Books and the Library of Congress.
4. Optionally runs a configured Apify Actor against a title/author query and,
   when present, at most one ISBN query.
5. Uses recovered profiles as candidate search terms against the target
   Hardcover Bookshelf API.
6. Imports only candidates that pass strict identity matching. A provider hit
   by itself does not authorize a remap.
7. Leaves unresolved records in the unmatched report or creates an explicitly
   enabled local Bookshelf fallback record.

The providers are best-effort: an unavailable source is logged and the helper
continues with other recovery providers. Open Library can be disabled with
`HARDCOVER_OPENLIBRARY_RECOVERY=false`; Google Books and LOC have independent
switches. Apify is disabled unless both its Actor ID and token are configured.

Recovered local metadata is kept on the migration source record. The direct
SQLite fallback writes the available description, publisher, page count,
language, release date, and cover URL into the Bookshelf record where the
database schema provides those fields. A later successful native match can
reconcile a shadow local record in place, preserving the library row instead
of creating a duplicate.

## Default sources and keyed catalogs

Library of Congress is queried by default in a standalone BookshelfNG
deployment and needs no API key. Its public JSON API enforces rate limits;
Bookshelf paces requests to one per 3.2 seconds per process and caches
successful search/detail responses for one day. A single process handles both
ebook and audiobook formats. The optional split SeerrNG deployment enables LOC
on one process to coordinate pacing across the two. Google Books and Europeana
run when keys are available. Set `BOOKSHELF_EBOOKS_METADATA_SOURCES` and
`BOOKSHELF_AUDIOBOOKS_METADATA_SOURCES` for per-service overrides, or use the
legacy `BOOKSHELF_METADATA_SOURCES` variable as a shared override when running
the installer.
Set both per-service variables to an empty value to disable the additional
catalogs in both containers.

Google Books is enabled automatically when its API key is present. Public API
requests require a project key; no OAuth user authorization is needed. The key
is free to create, but API usage is subject to Google quota and terms.

Europeana is enabled automatically when its API key is present. The key is
available without charge after account registration. Runtime search filters
to text records with open reuse status; metadata and cover availability still
vary by contributing institution. Europeana is strongest as a multilingual
cultural heritage fallback, not as a complete current-book catalog.
See Europeana's [Search API](https://europeana.atlassian.net/wiki/spaces/EF/pages/2385739812/Search+API+Documentation),
[Record API](https://europeana.atlassian.net/wiki/spaces/EF/pages/2385674279/Record+API+Documentation),
and [API key registration](https://pro.europeana.eu/page/get-api) guidance.

Gutendex is enabled by default in BookshelfNG and needs no API key. It indexes
Project Gutenberg's literature catalog, not the full commercial book market.
Books use Project Gutenberg ebook IDs; author names, languages, summaries, and
available format links are retained when present. Gutendex is an
[open-source API](https://github.com/garethbjohnson/gutendex), and its hosted
`gutendex.com` instance is run by a third party. The source project's API says
its copyright field describes status in the United States; check the rights
notice for each work before treating a text as public domain elsewhere.

Internet Archive is opt-in with `internetarchive`. It searches public text
items and resolves records through the [Item Metadata API](https://archive.org/developers/metadata.html).
No key is required for public search or metadata reads. Archive identifiers
are not edition identifiers, and creator/ISBN/cover fields vary by item.

NDL Search is opt-in with `ndl` and adds Japanese and participating-library
records. It uses NDL's [OpenSearch API](https://ndlsearch.ndl.go.jp/en/help/api/specifications)
for search and SRU for record details. Requests are paced to one per second
per BookshelfNG process and cached for a day. NDL ended its thumbnail service
on March 31, 2026, so these records provide metadata only; see the [thumbnail
service notice](https://ndlsearch.ndl.go.jp/news/20260401_thumbnail). The API
does not need a key, but usage and reuse permissions depend on the contributing
data provider. NDL asks continuous users to contact it, requires an NDL Search
API credit, and may require prior application for commercial or for-profit use.
SeerrNG displays an NDL Search API source link on matching book details;
operators must also apply any provider-specific credit or application rules.
See NDL's [English API terms](https://ndlsearch.ndl.go.jp/en/help/api/).

```env
GOOGLE_BOOKS_API_KEY=your-google-books-api-key
EUROPEANA_API_KEY=your-europeana-api-key
HARDCOVER_LOC_RECOVERY=true
```

To override runtime defaults, set `BOOKSHELF_METADATA_SOURCES` on a standalone
BookshelfNG container or use the ebook/audiobook-specific source variables in
the SeerrNG installer. Supported values are `googlebooks`, `loc`, `gutendex`,
`internetarchive`, `ndl`, `europeana`, and `apify-goodreads`; use a
comma-separated list. An explicitly
empty value disables additional runtime catalogs for the relevant instance.
These runtime variables are separate from the migration switches shown below.
`HARDCOVER_AUTH`, `GOOGLE_BOOKS_API_KEY`, `EUROPEANA_API_KEY`, and the Apify
credential variables remain supported for deployments that prefer environment
configuration. The Settings page shows when environment values are controlling
the active setting. Migration-recovery variables such as
`HARDCOVER_GOOGLEBOOKS_BASE_URL` and Apify migration options only affect the
one-off migration helper; they are not runtime Bookshelf settings.

Without `GOOGLE_BOOKS_API_KEY`, Google Books recovery logs that it is skipped.
The helper queries up to 10 Google Books volumes and 10 LOC results per query.
Google/LOC response profiles are cached for 30 days in
`<migration-directory>/catalog-cache.json`. The cache contains bibliographic
metadata and image URLs, not provider credentials. Keep the migration
directory private if the source catalog contains sensitive library data.

Use `HARDCOVER_GOOGLEBOOKS_BASE_URL` and `HARDCOVER_LOC_BASE_URL` only for a
controlled compatible endpoint or test server. Normal deployments should use
the default public API origins.

## Configure the Apify Goodreads-compatible adapter

Goodreads' public developer API is unavailable to new integrations. The
optional Apify adapter runs an Actor that you select; SeerrNG does not provide,
operate, or guarantee a particular scraper.

```env
HARDCOVER_APIFY_GOODREADS_ACTOR=publisher~goodreads-scraper
HARDCOVER_APIFY_TOKEN=your-apify-token
```

The default Actor input is:

```json
{"searchQueries":["TITLE AUTHOR"],"maxItems":10}
```

The helper replaces every literal `{{query}}` in the configured JSON template
with a JSON-escaped query string. Example for an Actor that expects `queries`
and `resultsLimit`:

```env
HARDCOVER_APIFY_GOODREADS_INPUT_TEMPLATE={"queries":[{{query}}],"resultsLimit":10}
```

The template must be valid JSON after replacement and contain `{{query}}`.
It may not exceed 16,384 characters. Actor IDs may use `publisher~actor-name`
or an actor ID. Actor output fields are normalized from common names such as
`title`, `fullTitle`, `author`, `authors`, `isbn13`, `description`,
`coverImage`, and `goodreadsId`; unsupported Actor output shapes are ignored
rather than treated as matches.

Actor results are cached for seven days. The adapter makes no more than two
Actor runs per source item (title/author and one ISBN when available). Each
Actor can still have its own runtime, result, and platform charges. Review the
Actor's code, input schema, output schema, privacy behavior, and pricing before
using it with a library. Do not put a Goodreads password or session cookie in
the Apify token field.

## Local fallback identity and reconciliation

Local fallbacks are ordinary Bookshelf database/API records with deterministic
local IDs, for example `local:ebook:1076`; ISBN-backed synthetic entries may
also use an `isbn:` foreign ID. They are **not Hardcover catalog entries** and
do not appear in Hardcover itself. The fallback is opt-in because it writes
directly to a Bookshelf SQLite database when API adds cannot preserve a book.

To enable it for a reviewed migration:

```bash
APPLY_HARDCOVER_REBUILD=true \\
HARDCOVER_LOCAL_DB_IMPORT=true \\
deploy/install-bookshelf-backend.sh --migrate-to-hardcover
```

Keep backups and run the normal migration validation before cutover. Later,
`--reconcile-local` retries strict native Hardcover matching and promotes
eligible local rows in place. See the [migration runbook](./bookshelf-hardcover-migration.md)
for preflight, backup, review, validation, restore, and cutover steps.

## Migration variables

These variables are read by `deploy/bookshelf-hardcover-migration.mjs`, not
by the SeerrNG runtime server:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HARDCOVER_OPENLIBRARY_RECOVERY` | `true` | Enable Open Library recovery. |
| `HARDCOVER_GOOGLEBOOKS_RECOVERY` | `true` | Enable Google Books recovery. |
| `GOOGLE_BOOKS_API_KEY` | unset | Required to use Google Books public data search; no OAuth user token is needed. |
| `HARDCOVER_LOC_RECOVERY` | `true` | Enable Library of Congress recovery. |
| `HARDCOVER_APIFY_GOODREADS_ACTOR` | unset | Apify Actor ID; leaves the adapter disabled when empty. |
| `HARDCOVER_APIFY_TOKEN` | unset | Bearer token used for Apify API calls. |
| `HARDCOVER_APIFY_GOODREADS_INPUT_TEMPLATE` | `{"searchQueries":[{{query}}],"maxItems":10}` | Actor-specific JSON input template. |
| `HARDCOVER_APIFY_API_BASE_URL` | `https://api.apify.com` | Apify API origin; must remain the official HTTPS API host. |
| `HARDCOVER_GOOGLEBOOKS_BASE_URL` | `https://www.googleapis.com` | Google Books API origin override. |
| `HARDCOVER_LOC_BASE_URL` | `https://www.loc.gov` | LOC API origin override. |
| `HARDCOVER_LOCAL_DB_IMPORT` | `false` | Enable direct local Bookshelf SQLite fallback after API recovery fails. |

To see all migration and deployment settings, see the [Bookshelf backend
guide](./bookshelf-backend.md) and the [migration runbook](./bookshelf-hardcover-migration.md).

## Future provider candidates

OpenBD is not integrated. Its official 2023 notice says API v1 was
discontinued; its original ISBN-only contract would not provide ordinary
free-text search. See the [OpenBD discontinuation notice](https://openbd.jp/news/20230725.html).

The [Google Books API](https://developers.google.com/books/docs/v1/using)
requires an API key or OAuth token to identify public API requests; this
adapter uses an API key and does not access private user data. The
[Library of Congress JSON API](https://www.loc.gov/apis/json-and-yaml/) needs
no API key, but is rate limited and the `/books/` endpoint covers digitized
books rather than the entire LoC catalog. [Open Library's API policy](https://openlibrary.org/developers/api)
asks clients to cache, identify themselves, and keep use low-volume; it states
that the API is not intended as a high-traffic third-party data backend.

Gutendex, Internet Archive, and NDL Search are runtime Bookshelf sources, but
they are not wired into the Hardcover migration helper. NDL Search supplies
metadata only because its thumbnail service ended March 31, 2026; see the
[official notice](https://ndlsearch.ndl.go.jp/news/20260401_thumbnail).
Europeana is also available for runtime search when `EUROPEANA_API_KEY` is
configured, but is not part of migration recovery.
