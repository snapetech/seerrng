---
sidebar_position: 20
---

# Music and Books Alpha Validation

SeerrNG adds early music and book request flows on top of Seerr's video request
system. This page is the validation checklist for alpha builds.

## Required Backends

- Lidarr for music requests.
- Bookshelf for book requests. SeerrNG currently talks to Bookshelf through the
  Readarr-compatible API surface. See the
  [Bookshelf Backend](/using-seerr/bookshelf-backend) guide. One BookshelfNG
  instance can manage both formats; use separate SeerrNG service entries that
  point to the same URL when both ebook and audiobook routing are enabled.
- Jellyfin, Plex, or Emby for the inherited media-server integration. Jellyfin
  and Plex music libraries can provide music availability when albums expose
  MusicBrainz metadata; Plex artist libraries can also be classified as
  Audiobooks. Lidarr remains the music automation and fallback availability
  source. See [media-server library setup](/using-seerr/settings/mediaserver)
  for Plex library classification and scanning.

## Configuration Checklist

1. Add a Lidarr server in **Settings > Services**.
2. Add a Bookshelf service entry for ebooks in **Settings > Services**.
3. If testing audiobooks or both-format requests, add an audiobook service
   entry. Point it to the same BookshelfNG URL and API key, and set its format
   to **Audiobook**.
4. Mark one Lidarr server as default.
5. Mark one Bookshelf ebook server as default.
6. If testing audiobooks or both-format requests, mark the audiobook service
   entry as default for that format.
7. Enable sync on the Lidarr and Bookshelf services being tested.
8. Confirm the root folder, quality profile, metadata profile, and tags returned
   by each test connection are the values expected by the backend.
9. If testing Jellyfin or Plex music availability, sync the media-server
   libraries and confirm the albums expose a MusicBrainz release-group or
   album ID.
10. If testing Plex audiobook availability, sync the Plex libraries, select
    **Reclassify as an Audiobooks library** for the artist library, enable it,
    and start a manual scan.

## Music Validation

For playlist-to-music request setup and provider limitations, see the
[Playlist Requests](/using-seerr/playlist-requests) guide.

Run these against a real Lidarr instance:

1. Search globally for an album.
2. Open the music detail page.
3. Request the album with default settings.
4. Request another album with advanced overrides.
5. Approve a pending music request.
6. Confirm the album is added in Lidarr with the expected root folder, quality
   profile, metadata profile, and tags.
7. If the download uses an external tagging or staging workflow such as Picard,
   confirm Request Status remains at **Importing** while that work is pending.
   Seerr uses recent Lidarr history when a fast download leaves the live queue
   between polls, so a confirmed Grabbed event must not fall back to
   **Searching**.
8. Confirm the request moves directly to **Available** after Lidarr reports the
   album files. Active requests are checked independently of the broad Lidarr
   scan; enabling scan additionally discovers existing catalogue items at
   startup and during scheduled scans.
9. Remove the item from SeerrNG and confirm Lidarr removal behavior is expected.
10. Retry a failed music request and confirm it dispatches again.

When testing **Request Discography**, include an environment where the default
Lidarr service ID is `0`. The bulk request backend must accept `serverId: 0`;
otherwise SeerrNG rejects the request before it reaches Lidarr.

Jellyfin music scans use the MusicBrainz release-group ID as the canonical album
identity. If Jellyfin exposes only a MusicBrainz album/release ID, SeerrNG
resolves it through MusicBrainz. Albums without either ID are skipped; run a
Lidarr scan when Lidarr is the authoritative availability source.

Plex music scans use the same MusicBrainz identity rules. Plex reports music
and audiobook libraries with the same artist-library type, so SeerrNG initially
classifies them as Music. Reclassifying an artist library as Audiobooks in
**Settings > Media Server** persists across library syncs and renames.

## Book Validation

Run these against a real Bookshelf instance:

1. Search globally for a book.
2. Open the book detail page.
3. Confirm the ISBN candidate list matches the expected editions.
4. Request an ebook with automatic edition matching.
5. Request an ebook with a specific ISBN/edition selected.
6. Request an audiobook if an audiobook Bookshelf service entry is configured.
7. Request **Both** if ebook and audiobook service entries are configured;
   they can point to the same BookshelfNG instance.
8. Approve pending book requests.
9. Confirm Bookshelf receives the expected root folder, quality profile,
   metadata profile, tags, and monitored state.
10. Trigger a Bookshelf scan in SeerrNG.
11. Confirm ebook and audiobook service links are preserved separately.
12. Remove the item from SeerrNG and confirm both ebook and audiobook backend
    entries are removed when both exist.
13. Retry a failed book request and confirm partial service links are preserved
    when one side already succeeded.

When testing **Request Bibliography**, include an environment where one Bookshelf
service ID is `0`. Book, audiobook, and both-format bulk requests must accept
that service override and dispatch each format to its configured service entry.

## Identity Checks

For every book mismatch, capture:

- Open Library work ID.
- Open Library edition ID.
- ISBN-10 and ISBN-13 candidates shown by SeerrNG.
- Bookshelf lookup term used, when visible in logs.
- Bookshelf foreign book ID and foreign edition ID.
- Whether the requested format was ebook, audiobook, or both.

Known alpha limitation: SeerrNG normalizes valid ISBN-10 values to ISBN-13 and
uses Open Library work/edition IDs plus ISBNs for identity. It does not yet have
a dedicated Hardcover or Bookshelf-native identity provider.

## Pass Criteria

An alpha build is ready for wider tester use when:

- Music requests can be created, approved, scanned, retried, and removed against
  a real Lidarr instance.
- Book requests can be created, approved, scanned, retried, and removed against
  a real Bookshelf instance.
- Audiobook and both-format book requests behave correctly when separate
  Bookshelf defaults are configured.
- Request cards, request lists, notifications, and status badges point users to
  the correct SeerrNG and backend pages.
- No request flow requires entering TMDB, MusicBrainz, Open Library, ISBN, or
  backend IDs manually in normal use.
