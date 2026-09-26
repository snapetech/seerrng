---
title: Comics Backend
description: Configure ComicVine, Mylar3, and Kapowarr for comic requests.
sidebar_position: 24
---

# Comics Backend

SeerrNG discovers comics through [ComicVine](https://comicvine.gamespot.com/)
and dispatches requests to either [Mylar3](https://github.com/mylar3/mylar3)
or [Kapowarr](https://github.com/Casvt/Kapowarr). Both backends can be
configured at the same time. Users with advanced request permission can choose
any configured instance when more than one is available; other requests go to
the single default instance across both backends.

## ComicVine API Key

Comic discovery and requests require a free ComicVine API key, independent of
any key configured inside Mylar3 or Kapowarr themselves.

1. Sign in or create an account at
   [comicvine.gamespot.com](https://comicvine.gamespot.com/).
2. Generate an API key from your ComicVine account settings.
3. In SeerrNG, open **Settings > General** and enter the key under **Comics
   Metadata > ComicVine API Key**.

Until this key is configured, the Comics Discover page returns no results,
`GET /api/v1/discover/comics` responds with an empty result set rather than an
error, and the Comics category in global Search has no catalog results.

With a key configured, global Search includes a **Comics** category backed by
ComicVine. Use the main search query to find volume titles; the category also
lets you narrow matches by title, aliases, publisher, or start year.

## Choosing a backend

| | Mylar3 | Kapowarr |
| --- | --- | --- |
| API style | Legacy query-string (`?apikey=&cmd=`) | Modern JSON REST |
| Acquisition | Usenet and torrent indexers | Direct-download only (GetComics and mirror hosts) today; no usenet/torrent indexer yet |
| Extra containers | None | Requires a companion FlareSolverr container |
| Recommendation | Default choice | Secondary/fallback option |

Mylar3 is the recommended default. Kapowarr's only indexer today,
GetComics.org, has a known, unresolved upstream bug where direct-from-site
downloads (as opposed to its mirror hosts such as MediaFire) frequently fail.
Mirror-host downloads are generally reliable; direct-site downloads are not.

Both backends need their own, separately configured ComicVine API key for
their own internal search — this is unrelated to the SeerrNG-level key above,
and only affects features SeerrNG does not use (SeerrNG's own ComicVine client
handles discovery; the backends are only asked to add and track already-
identified comics).

## Mylar3 setup

1. Deploy Mylar3 (for example `lscr.io/linuxserver/mylar3`).
2. In SeerrNG, open **Settings > Services** and add a Mylar3 server.
3. Enter its hostname, port, and API key (**Mylar3 > Settings > General >
   Security**).
4. If Mylar3 should be the default comics destination, mark this instance as
   the default across your configured Mylar3 and Kapowarr servers.
5. Enable **Sync** to bring already-owned comics into SeerrNG as available.

## Kapowarr setup

Kapowarr requires a companion [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr)
container to get past Cloudflare on GetComics.org and its mirror hosts. This
is a real second-container deployment requirement, not optional polish:

```yaml
services:
  kapowarr:
    image: mrcas/kapowarr:latest
    ports:
      - '5656:5656'
    volumes:
      - ./kapowarr-db:/app/db
      - ./kapowarr-downloads:/app/temp_downloads

  flaresolverr:
    image: ghcr.io/flaresolverr/flaresolverr:latest
    ports:
      - '8191:8191'
```

Point Kapowarr's FlareSolverr setting at the `flaresolverr` container, then:

1. In SeerrNG, open **Settings > Services** and add a Kapowarr server.
2. Enter its hostname, port, and API key (**Kapowarr > Settings > General**).
3. Select a **Root Folder** — Kapowarr requires one; SeerrNG's connection test
   lists the root folders Kapowarr already knows about.
4. If Kapowarr should be the default comics destination, mark this instance as
   the default across your configured Mylar3 and Kapowarr servers.
5. Enable **Sync** to bring already-owned comics into SeerrNG as available.

## Configuration checklist

1. Add a ComicVine API key in **Settings > General**.
2. Add a Mylar3 and/or Kapowarr server in **Settings > Services**.
3. Mark one server across the combined Mylar3 and Kapowarr list as the
   default. Requests without an explicitly selected server use this instance.
4. Enable **Sync** on each service you want scanned into SeerrNG's local
   availability data.
5. Set a default comic request quota in **Settings > Users** if you want to
   limit comic requests per user.
6. To give one user a different limit, open that user's profile settings and
   enable **Override Global Limit** under **Comic Request Limit**. Clear the
   override to return to the global limit.

## Known limitations

This is a first-pass integration; the following is a deliberate scope cut, not
a bug:

- No per-request root-folder or profile picker. Users with advanced request
  permission can choose a comic server when multiple instances are configured;
  other requests use a configured default.
- Comic issue reports support the **Other** category only. Users with **Create
  Issues** can report problems for an available tracked comic; users with
  **View Issues** or **Manage Issues** can see open reports on comic details.

Users with **Manage Blocklist** can blocklist a comic from its detail page or
Discover card. Comic entries appear in the **Comics** filter on the Blocklist
page, where they can be removed.

Non-Plex users can add a comic to their SeerrNG watchlist from its detail page
or card. Users with **Auto-Request** and **Auto-Request Comics** can turn on
**Auto-Request Comics** in their profile to submit a comic request when they
add it to that watchlist.

Users with **Manage Requests** permission can open **Manage Comic** from a
tracked comic's details page. Administrators can open the comic in its backend,
remove it from the backend, mark it available, or clear its SeerrNG data.

Cancelling an active comic request removes it from Kapowarr's download queue
directly. Mylar3 has no equivalent API to cancel an individual in-progress
download (the same limitation LazyLibrarian has for magazines), so cancelling
an active Mylar-backed request fails with an error; wait for it to reach a
terminal status, or remove the download manually in Mylar3 or the download
client first.

Comic requests dispatched to Kapowarr show live download progress (percent,
size, and status) on the Requests page and in Manage, the same as other media
types. Mylar3 has no API for reading an in-progress download's status, so a
Mylar-backed request still moves through requested, approved, and available,
just without a live progress bar in between.

## Troubleshooting

`No default Mylar or Kapowarr server is configured`:

- confirm at least one Mylar3 or Kapowarr server is added in **Settings >
  Services** and marked as the default.

Comic Discover page is empty:

- confirm a ComicVine API key is set in **Settings > General**.
- confirm the key is valid by checking the browser network tab for a 503 from
  `/api/v1/discover/comics`.

Kapowarr requests fail or time out:

- confirm the FlareSolverr container is running and reachable from Kapowarr.
- if a request appears to fail but the comic shows up in Kapowarr's own
  library shortly after, this is expected: a slow add can outlast SeerrNG's
  client-side timeout, and a retried dispatch resolves against the
  already-created volume instead of failing.
- for downloads that fail specifically from GetComics.org's direct link
  (not a mirror host), see the known GetComics reliability issue above —
  this is an upstream Kapowarr/indexer limitation, not a SeerrNG bug.
