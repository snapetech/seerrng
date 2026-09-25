# Third-Party Client Compatibility

SeerrNG is compatible with third-party Jellyfin/Emby clients that integrate with Jellyseerr/Seerr APIs. This document describes how that compatibility works, which endpoints are used, and how you can extend client support to the new media types (music and books) that SeerrNG provides.

## Supported Clients

### Wholphin (Android TV)

[Wholphin](https://github.com/damontecres/Wholphin) is an OSS Android TV client for Jellyfin with built-in Seerr integration. It generates its API client from the Seerr OpenAPI spec (`seerr-api.yml`).

**How it integrates:**
- Configures a Seerr/Jellyseerr URL in the app settings
- Authenticates via cookie (Plex/Jellyfin/Local login) or API key (`X-Api-Key` header)
- Uses the OpenAPI-generated client to call Seerr discovery, search, and detail endpoints
- Only supports movies and TV shows currently

**Endpoints used:**
- `GET /search` — search for content
- `GET /discover/movies`, `GET /discover/tv`, `GET /discover/trending` — discovery
- `GET /discover/movies/upcoming`, `GET /discover/tv/upcoming` — upcoming content
- `GET /movie/{id}/similar`, `GET /tv/{id}/similar` — similar content
- `GET /person/{id}/combined_credits` — person filmography
- `GET /movie/{id}`, `GET /tv/{id}` — detail pages
- `GET /settings/public` — server status and configuration
- `GET /imageproxy/tmdb` — cached images (when `cacheImages` is enabled)

### Moonfin (Android TV, Fire TV, Mobile, Desktop)

[Moonfin](https://github.com/Moonfin-Client) is a multi-platform Flutter client for Jellyfin and Emby. It has a deeper Seerr integration including full request management.

**Two connection modes:**

1. **Direct mode**: User configures a Jellyseerr/Seerr URL and API key. The client makes direct API calls.
2. **Moonfin Proxy mode**: Uses the companion Jellyfin server plugin (`moonfin-server`) to proxy API calls through Jellyfin with SSO authentication.

**Endpoints used (in addition to Wholphin's):**
- `GET /discover/genreslider/movie`, `GET /discover/genreslider/tv` — genre discovery
- `GET /movie/{id}/recommendations`, `GET /tv/{id}/recommendations` — recommendations
- `GET /person/{id}` — person details
- `GET /request`, `POST /request`, `DELETE /request/{id}` — request management
- `GET /service/radarr`, `GET /service/radarr/{id}` — Radarr server info
- `GET /service/sonarr`, `GET /service/sonarr/{id}` — Sonarr server info
- `GET /settings/radarr`, `GET /settings/sonarr` — admin settings
- `POST /settings/main/regenerate` — API key management
- `GET /auth/me` — current user info
- `GET /status`, `GET /status/appdata` — server status
- Handles CSRF protection (`XSRF-TOKEN` cookie) for state-changing requests

## API Response Shapes

SeerrNG maintains backward compatibility with the standard Seerr API response shapes:

### Pagination

All list endpoints use the same pagination format:

```json
{
  "page": 1,
  "totalPages": 20,
  "totalResults": 200,
  "results": [...]
}
```

### Media Status

The `mediaInfo` object on each result follows the standard Seerr format:

```json
{
  "id": 123,
  "tmdbId": 456,
  "status": 5,
  "requests": [...]
}
```

Status values:
- `1` = UNKNOWN
- `2` = PENDING
- `3` = PROCESSING
- `4` = PARTIALLY_AVAILABLE
- `5` = AVAILABLE
- `6` = DELETED

## SeerrNG Media Type Extensions

SeerrNG extends the Seerr API with new media types. These new result types appear in mixed-content endpoints and have their own dedicated endpoints.

### New Media Types

| mediaType | Schema | Source |
|-----------|--------|--------|
| `book` | `BookResult` | Open Library |
| `album` | `MusicResult` | MusicBrainz / ListenBrainz |
| `artist` | `ArtistResult` | MusicBrainz |

### BookResult Schema

```json
{
  "id": "OL27448W",
  "mediaType": "book",
  "title": "Book Title",
  "author": "Author Name",
  "authorId": "OL23919A",
  "firstPublishYear": 1965,
  "posterPath": "/path/to/cover.jpg",
  "isbn13": "9780441478125",
  "editionId": "OL8934157M",
  "mediaInfo": { "..." }
}
```

### MusicResult Schema

```json
{
  "mbId": "f5093c06-23e3-404f-aeaa-40f72885ee3a",
  "mediaType": "music",
  "title": "Album Title",
  "artist": "Artist Name",
  "artistMbId": "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d",
  "posterPath": "/path/to/cover.jpg",
  "releaseDate": "2024-01-15",
  "mediaInfo": { "..." }
}
```

### ArtistResult Schema

```json
{
  "id": "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d",
  "mediaType": "artist",
  "name": "Artist Name",
  "type": "Person",
  "artistThumb": "/path/to/thumb.jpg",
  "artistBackdrop": "/path/to/backdrop.jpg"
}
```

## Endpoints by Media Type

### Movie/TV (standard — fully compatible)

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /search` | Required | Search across all media types (movie, tv, person, album, artist, book) |
| `GET /discover/movies` | Required | Discover/popular movies |
| `GET /discover/tv` | Required | Discover/popular TV shows |
| `GET /discover/trending` | Required | Trending (TMDB) |
| `GET /discover/movies/upcoming` | Required | Upcoming movies |
| `GET /discover/tv/upcoming` | Required | Upcoming TV shows |
| `GET /movie/{id}` | Required | Movie details |
| `GET /tv/{id}` | Required | TV show details |
| `GET /movie/{id}/similar` | Required | Similar movies |
| `GET /tv/{id}/similar` | Required | Similar TV shows |
| `GET /movie/{id}/recommendations` | Required | Movie recommendations |
| `GET /tv/{id}/recommendations` | Required | TV recommendations |
| `GET /person/{id}` | Required | Person details |
| `GET /person/{id}/combined_credits` | Required | Person filmography |

### Music (SeerrNG extension)

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /discover/music` | Required | Music discovery (ListenBrainz/MusicBrainz) |
| `GET /music/{mbId}` | Required | Album details |
| `GET /music/{mbId}/artist` | Required | Artist for album |
| `GET /music/{mbId}/artist-discography` | Required | Artist discography |
| `GET /music/{mbId}/artist-similar` | Required | Similar artists |
| `GET /artist/{mbId}` | Required | Artist details |

Query parameters for `/discover/music`:
- `page` (number, default: 1)
- `days` (7, 14, 30, 90 — default: 14)
- `sortBy` (ranked, popular.week, popular.month, popular.year, listen_count.desc, release_date.desc, release_date.asc)
- `genre` (string, e.g. "jazz")
- `releaseType` (string, e.g. "Album")
- `query` (string, for album search)
- `primaryReleaseDateGte`, `primaryReleaseDateLte` (date strings)
- `shuffleSeed` (string, max 128 chars)

### Books (SeerrNG extension)

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /discover/books` | Required | Book discovery (Open Library) |
| `GET /book/search` | Required | Direct book search |
| `GET /book/{openLibraryId}` | Required | Book details |
| `GET /author/{openLibraryId}` | Required | Author details |
| `GET /author/{openLibraryId}/works` | Required | Author's works |

Query parameters for `/discover/books`:
- `page` (number, default: 1)
- `query` (string, default: "subject:fiction")
- `subject` (string, e.g. "fiction", "science")
- `sortBy` (ranked, newest, oldest, random, rating, editions)
- `shuffleSeed` (string, max 128 chars)

### Services (SeerrNG extension)

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /service/lidarr` | Required | List Lidarr servers |
| `GET /service/lidarr/{id}` | Required | Lidarr server details |
| `GET /service/comic` | Required | List Mylar3 and Kapowarr destinations |
| `GET /service/magazine` | Required | List LazyLibrarian destinations |
| `GET /service/readarr` | Required | List Bookshelf servers |
| `GET /service/readarr/{id}` | Required | Bookshelf server details |

### Requests (extended for new types)

The `POST /request` endpoint supports new `mediaType` values:

| mediaType | Service | Description |
|-----------|---------|-------------|
| `movie` | Radarr | Movie request |
| `tv` | Sonarr | TV request |
| `music` | Lidarr | Album request (uses `mbId`) |
| `ebook` | Bookshelf | Book request |
| `audiobook` | Bookshelf | Audiobook request |

Music requests use `mediaId` with the MusicBrainz release group ID (string).

Book requests use additional fields:
- Book format: `ebook`, `audiobook`, or `both`
- Author ID, ISBN-13, edition ID

## Using the `type` Filter on Search

SeerrNG adds a `type` query parameter to `GET /search` for filtering results by media type:

```
GET /api/v1/search?query=kind+of+blue&type=album
GET /api/v1/search?query=dune&type=book
GET /api/v1/search?query=inception&type=movie
```

Valid values: `movie`, `tv`, `person`, `album`, `artist`, `book`

When omitted, all types are returned.

## OpenAPI Spec

The full OpenAPI spec is available at the repository root:

```
seerr-api.yml
```

Third-party clients can generate API clients from this spec. The spec includes all standard Seerr endpoints plus the SeerrNG extensions for music, books, Lidarr, and Readarr.

## Adding Music and Book Support to a Client

To add music or book discovery to a third-party client that currently supports only movies/TV:

### Step 1: Handle New Media Types in Search

The `GET /search` endpoint now returns results with `mediaType: "album"`, `"artist"`, and `"book"`. Your client should:

- Map these new media types to appropriate UI components
- Ignore types it doesn't understand (fail gracefully)

### Step 2: Add Discovery Rows

Add discovery rows using the dedicated endpoints:

```
GET /api/v1/discover/music?sortBy=popular.week
GET /api/v1/discover/books?subject=science+fiction&sortBy=ranked
```

Both return the standard pagination format:
```json
{
  "page": 1,
  "totalPages": 5,
  "totalResults": 100,
  "results": [...]
}
```

### Step 3: Add Detail Pages

For books:
```
GET /api/v1/book/{openLibraryWorkId}
```

For music:
```
GET /api/v1/music/{musicbrainzReleaseGroupId}
```

### Step 4: Add Request Support

For books, use `POST /api/v1/request` with:
```json
{
  "mediaId": "OL27448W",
  "mediaType": "ebook",
  "bookFormat": "ebook"
}
```

For music, use:
```json
{
  "mediaId": "f5093c06-23e3-404f-aeaa-40f72885ee3a",
  "mediaType": "music"
}
```

### Step 5: Register with Book/Music Services

To make requests work, the SeerrNG instance must have Bookshelf (for books) and Lidarr (for music) configured. The client can check service availability via:

```
GET /api/v1/service/lidarr
GET /api/v1/service/readarr
```

## Known Client Limitations

### Wholphin
- Generated from static OpenAPI spec — needs regeneration to pick up new types
- Only has UI for movies/TV; would need new fragments for books/music
- Uses `SeerrItemType.MOVIE` and `SeerrItemType.TV` enums; unknown types are handled gracefully

### Moonfin
- Uses `ignoreUnknownKeys = true` in its JSON decoder — handles new fields safely
- Already has ebook/audiobook reader built in
- Would need new DTOs and UI screens for book/music discovery
- Has `jellyseerrRows` user preferences that could be extended with music/book row configs
