# NG Ecosystem Integration Plan

Build plan for connecting SeerrNG to the Snapetech projects it does not use yet
(IPTV Tunerr, TorrentNG, slskdN/slskr), and to fork capabilities it ignores in
projects it already integrates (BookshelfNG, ChaptarrNG, ROMarrNG, QuestarrNG).

Written 2026-10-06. Endpoint facts were read from each project's source or docs
on that date; re-check them before starting a phase. Confidence labels follow
`AGENTS.md`.

Read `AGENTS.md`, `docs/maintainers/ui-style-standard.md`, and
`docs/maintainers/ui-fix-it.md` before implementing any phase. This plan does
not override their verification or UI rules.

## Ground rules

1. **SeerrNG stays the request layer.** It must not take ownership away from
   the *arr apps or from the companion app. Writes go only to surfaces the
   companion exposes for automation: recorder rules, wishlist entries, tags,
   categories, and limits.
2. **Every integration is optional.** If a service is not configured, it is
   simply absent. It must never produce an error or a blank panel.
3. **Negotiate capabilities first.** Follow the existing contract pattern in
   `server/api/software/questarrng.ts` and `romarrng.ts`, together with their
   `*.contract.test.ts` files. Read the companion's capability or health
   endpoint, then gate each feature on what it reports.
4. **No live targets in tests.** Use contract tests with recorded fixtures.
   Live checks run only against disposable local instances (see "Testing
   without home infrastructure").
5. **Each phase ships separately**, with a release-note fragment under
   `release-notes/`.

## Progress log

Branch: `feat/ng-ecosystem-integration`. Status values: `done` (code and
automated checks written and run), `built` (code written, not yet run against a
real service), `pending`, `blocked`. Targeted local checks and cumulative-gate
results are recorded in the progress table. A failed required gate blocks
finalization. Nothing here has had a live round-trip or human visual acceptance
yet.

| Item | Status | Notes |
| --- | --- | --- |
| Plan: Phase 1 expanded to qBittorrent, Transmission, Deluge | done | |
| 0.1 Push channel (download progress) | done | `GET /api/v1/live/downloads` SSE (`server/routes/live.ts`). Scoped to download progress; request-status events are not pushed yet (see 0.1 remainder). |
| 0.2 Settings pattern | done | `liveDownloads` settings section; admin routes `server/routes/settings/downloadClients.ts` (GET, PUT, `/test`, `/status`). |
| 1 Adapters: qBittorrent, Transmission, Deluge, TorrentNG | done | `server/api/downloadClients/*`; protocol tests against local fake servers (12 tests). Not run against real clients. |
| 1 Shared poller | done | `server/lib/liveDownloads.ts`; polls only subscribed hashes while a browser is connected (4 tests). |
| 1 SSE route + OpenAPI | done | Route test with a fake qBittorrent server and real HTTP stream (3 tests); `seerr-api.yml` paths and schemas added. |
| 1 Browser store + overlay | done | `src/utils/liveDownloadStore.ts`, `src/hooks/useLiveDownload.ts` (6 tests); used by `DownloadBlock` and `StatusBadge`. |
| 1 Follow-up: user-scoped live IDs and stale-value clearing | blocked | Focused progress checks: 36/36 on Node 26.10.0; changed-file ESLint and Prettier pass. Two cumulative attempts reached native TypeScript and failed before JavaScript/tooling: attempt 1 had 2,952 tests (2,947 pass, 1 fail, 4 skip); attempt 2 had 2,952 tests (2,945 pass, 3 fail, 4 skip) across 599 suites, with `GET /discover/books` marked failed. Focused auth/override reruns passed 145/145, and the complete discovery route file passed 124/124, so the cumulative-only failures still need their exact assertions isolated. Continue investigating before finalization; live client round-trip and desktop/narrow review remain pending. |
| 1 Settings UI | built | `SettingsDownloadClients.tsx` on Settings → Services; no new CSS families. Needs desktop/narrow human review. |
| 1 Docs + release note | done | `docs/using-seerr/live-download-progress.md`, `release-notes/2026-10-06-live-download-progress.md`. |
| 1 Stall signal for Download Recovery | pending | |
| 1 Pre-approval free-space check | pending | Needs TorrentNG `/api/v1/storage`; other clients do not expose per-root free space the same way. |
| 1 Per-category tags / ratio groups | pending | Would be the first write to a client; needs a maintainer decision. |
| 2 Worktree | done | Phase 2 is on branch `feat/ng-phase2-tunerr` in worktree `~/Code/seerrng-phase2` because another editor is changing Phase 1 in `~/Code/seerrng`. Merge back to main when both are done. |
| 2 Tunerr auth | done (no fork change) | The deck accepts HTTP Basic auth and proxies `/api/*` to the tuner from localhost. Requires `IPTV_TUNERR_WEBUI_ALLOW_LAN=1`. Resolves open question 1. |
| 2 Guide index | done | Streaming XMLTV parser + title index over the tuner's `/guide.xml` (`server/lib/liveTv/`). The capsules API caps at 250 rows, so it is not used. 13 unit tests. |
| 2 RecordingRequest entity + migrations | done | SQLite and Postgres migrations `1791040000000`; SQLite migration test. Postgres migration not run locally. |
| 2 Live TV API + sync job | done | `/api/v1/live-tv/*`, `/api/v1/settings/tunerr`, `live-tv-sync` job. Integration test against a fake deck and guide (4 tests), OpenAPI validator test (5), settings parser (5). |
| 2 UI | built | On Live TV button + dialog on movie/series pages, `/recordings` page, Settings → Services section. Component test (4). Needs human visual review. No sidebar entry yet (sidebar links cannot be conditional on settings today). |
| 2 Tunerr fork: rule-driven recorder | done (local branch) | `~/Code/iptvtunerr` branch `feat/seerrng-recording-rules` (commit `0440d64`, not pushed): `title_equals`, `start_after`/`start_before`, response-only `features`, `catchup-daemon -rules-only`. 6 new Go tests; `go test ./...` passed. Tunerr `scripts/verify` not run (local Go 1.27 `gofmt` flags vendored files). Operators must run the recorder with `-rules-only`. |
| 2 Live check: deck proxy + Basic auth from another host | pending | Verified from Tunerr source only; needs a local Tunerr run. |
| 3 slskdN client + settings | done | `server/api/slskdn.ts` (X-API-Key), per-feature probes (wishlist, library health, SongID); `/api/v1/settings/slskdn`. Endpoints read from `~/slskdn-current` source. |
| 3 Track requests | done | `TrackRequest` entity + migrations `1791050000000`, wishlist-backed search with approval, `soulseek-sync` job, `/api/v1/soulseek/track-requests*`. Integration test against a fake slskdN. |
| 3 Album fixes (library health) | done | Release group → releases via MusicBrainz, then slskdN issues per release; remediation only for that album's auto-fixable issues. Manager-only. |
| 3 SongID | done | `/api/v1/soulseek/songid`; results readable only by the requester or a manager (in-memory owner map, lost on restart). Album candidates resolved to release groups. |
| 3 UI | built | Bulk dialog Soulseek card for unmatched playlist tracks, `/track-requests`, `/identify`, album Library Health button, Settings section. Component test for the bulk-dialog card. Needs human visual review. |
| 3 Peer previews | not started | Open question 3 (legal/permission decision) still applies. |
| 3 slskdN download progress in live progress | pending | slskdN transfers are not torrents; needs a separate adapter. |
| 4 Goodreads lists in External Request List Sync | already present | SeerrNG already supports Goodreads lists (`ExternalRequestListProvider = 'imdb' \| 'goodreads'`). Hardcover want-to-read is not supported (needs a per-user Hardcover token). |
| 4 ChaptarrNG direct download shown | done | Generalized: admins see the *arr queue's download client name (and protocol is carried) for every download. Non-admin projection drops it (test). |
| 4 ROMarrNG DAT verification | done | ROMarrNG local branch `feat/seerrng-dat-verification` (commit `06a6a67`, not pushed): `datVerified` per asset + `assetDatVerification` capability; 2 new pytest tests; ROMarrNG suite 2206 passed, 1 pre-existing failure (`test_json_request_bodies_are_bounded_before_parsing`, also fails on clean HEAD here). SeerrNG shows a DAT Verified badge on available ROM requests. |
| 4 ROMarrNG collections / 1G1R full-set requests | pending | Needs new ROMarrNG contract endpoints for collections; not started. |
| 4 BookshelfNG series-pack search, M4B option | pending | Needs BookshelfNG contract exposure; not started. |
| 4 QuestarrNG RomM/Playnite state into My Games | pending | Needs QuestarrNG contract exposure; not started. |
| 5 Fastest-source routing design | done (awaiting approval) | [fastest-source-routing-design.md](./fastest-source-routing-design.md). Recommends offer-then-race for Live TV; no code until approved. |
| 6 Swipe discovery (ReadMeABook-inspired) | built | `/swipe` for movies, series, and books; `SwipeDecision`/`SwipeProfile` + migrations `1791070000000`; optional Claude ordering via `@anthropic-ai/sdk` 0.131.0 (structured output, server-side refusal fallback). Server tests (14) + client tests (5). Needs human visual review, especially drag feel on touch devices. |
| 2 Sports "follow my team" | done | `SportsFollow` entity + migrations `1791060000000`; Live TV Sync maps Tunerr `/v1/sports/events` matches to the nearest guide airing and creates normal recording requests; cancelled games are not re-requested. Integration test against the fake Tunerr. UI: Followed Teams on Recordings. |
| 2 Recently aired shelf, channel requests, Plex→Jellyfin users | pending | |
| 2 Recording notifications | pending | Requests do not notify yet. |

Local test note: on macOS, run server tests with a non-symlinked `TMPDIR`
(the logger rejects `/var` symlinks), for example
`TMPDIR=/private/tmp/seerrng-test node server/test/index.mts <file>`. The
cumulative gate used cached Node 24.19.0 and pnpm 10.24.0 with
`TMPDIR=/private/tmp`. Discovery found 99 Vitest files, 391 TypeScript node-test
files, 56 JavaScript node-test files, and 32 tooling files, with zero platform
exclusions; the JavaScript and tooling lanes were not executed after the
TypeScript failure.

## Testing without home infrastructure

There is no home network and no IPTV subscription on the laptop.

| Service | How to test locally |
| --- | --- |
| Tunerr | Run `iptv-tunerr` locally against a **fixture M3U and XMLTV** served from a local static HTTP server, using a short guide with programmes a few minutes in the future. Recording a real stream is out of scope locally. Verify that rules are created, previewed, and listed, not that video is captured. Do not repeat Tunerr calls that fail: record the failure and move on. |
| TorrentNG | Run `torrentngd` locally on loopback with a public Linux ISO magnet. This is the same setup used for the TorrentNG README screenshots. |
| slskdN | Mocked contract tests only, unless Soulseek credentials are available. Library-health tests can use a local music directory fixture. |
| Forks | Use each fork's existing SeerrNG smoke scripts and contract fixtures. |

---

## Phase 0: Shared foundations

The live-progress and Tunerr phases need these first.

### 0.1 Server-to-browser push channel
SeerrNG has no SSE or WebSocket push today. Search `server/` and `src/` for
`EventSource` or `WebSocket`: neither appears. Download progress comes from the
`download-sync` cron job (`server/job/schedule.ts`, around line 516).

- [ ] Add an authenticated SSE endpoint, `GET /api/v1/events`. It sends
      per-user filtered events: request status changes, download progress, and
      recording state.
- [ ] Add an in-process event hub. Producers are the cron jobs today, then the
      TorrentNG and slskdN subscribers.
- [ ] The client hook subscribes once per tab and falls back to the existing
      polling if the connection drops.
- [ ] Check that compression and caching middleware, the service worker, and
      any reverse-proxy docs don't buffer SSE.
- **Done when:** a request status change appears in an open Request Status
  page within 2 s, without reloading the page.

### 0.2 Companion service settings pattern
- [ ] Add settings entries for `tunerr`, `torrentng`, and `slskdn` (slskr uses
      the same API family) in `server/lib/settings/index.ts`. Model them on
      `softwareAcquisition` (around line 600): URL, API key, enabled flag, and
      the last capability snapshot.
- [ ] Add a settings UI with a **Test** button that runs the capability
      handshake and lists the supported features.
- [ ] Update `docs/using-seerr/companion-services.md` with each new service.

---

## Phase 1: Live download progress (TorrentNG, qBittorrent, Transmission, Deluge)

Value: high. Risk: low (read-only against the download clients).

Scope (expanded 2026-10-06): the same live-progress feature works directly
against qBittorrent, Transmission, and Deluge, not only TorrentNG. Each client
is a read-only adapter behind one interface:

| Client | API used | Auth |
| --- | --- | --- |
| qBittorrent | `POST /api/v2/auth/login`, `GET /api/v2/torrents/info?hashes=a\|b` | `SID` cookie |
| Transmission | `POST /transmission/rpc` `torrent-get` with `ids: [hashes]` | Basic auth + `X-Transmission-Session-Id` (409 handshake) |
| Deluge | `POST /json` `auth.login`, `web.connected`, `core.get_torrents_status` | `_session_id` cookie |
| TorrentNG | `GET /api/v1/torrents/:hash`, `GET /api/v1/torrents/live?hashes=` | `Authorization: Bearer <token>` |

Design:
- The browser sends the download IDs it already holds (from authorized
  request/media responses) to `GET /api/v1/live/downloads?ids=…` (SSE). A
  40/64-hex info hash is unguessable, so knowing it is proof the user was
  allowed to see that download. Non-hash IDs (Usenet) are ignored.
- One shared server poller queries each enabled client only while at least
  one browser is subscribed, for only the subscribed hashes, at the configured
  interval (default 3 s). There is no client traffic when nobody is watching.
- The UI overlays live percent, speed, ETA, and peers on the existing
  `DownloadBlock` and status badge progress. With no clients configured, or if
  the stream drops, it falls back to the existing `download-sync` polling.

Verified endpoints, from TorrentNG `docs/API.md` (high confidence):

- `GET /health`: liveness and capability manifest
- `GET /api/v1/events`: server-sent torrent changes; resume with
  `last_known_revision`
- `GET /api/v1/torrents/live?hashes=…`: live rates for up to 128 hashes
- `GET /api/v1/torrents/:hash` and `GET /api/v1/torrents/:hash/files`
- `GET /api/v1/jobs`, `GET /api/v1/tracker-health`
- `GET /api/v1/storage` and `POST /api/v1/storage/plan`
- `GET/POST /api/v1/categories`, `PATCH /api/v1/torrents/:hash/tags`,
  `GET/POST /api/v1/ratio-groups`

TorrentNG can also act as the front end for an existing qBittorrent,
Transmission, Deluge, or rTorrent install. Users get this phase without running
the TorrentNG Engine (`torrentngd`).

### Join key
The *arr queue items SeerrNG already stores carry a `downloadId`
(`downloadStatus[].downloadId`). For torrent clients that ID is the info hash.
Moderate confidence: confirm for each *arr and protocol. Usenet IDs will not
match, and those requests keep cron polling.

### Tasks
- [ ] `server/api/torrentng.ts`: client with handshake, live lookup, and an
      SSE subscriber that reconnects using `last_known_revision`.
- [ ] Subscriber: map hash → request, then publish progress events to the
      Phase 0 event hub.
- [ ] Request Status: live percentage, speed, ETA, and seed/peer counts.
- [ ] `Download Recovery` job: use `tracker-health` and the per-torrent seed
      count as a stall signal (for example, no seeds for N hours), rather than
      time alone.
- [ ] Admin approval panel: show free space on the target storage root from
      `/api/v1/storage` and warn when the estimated size is larger. Base the
      estimate on the release size reported by the *arr app.
- [ ] Optional admin setting: per-category tag or ratio group applied to
      SeerrNG-originated torrents. This writes TorrentNG metadata only.
- [ ] Contract tests: `server/api/torrentng.contract.test.ts` with recorded
      `/health`, `/torrents/live`, and SSE fixtures.
- **Done when:** with a local `torrentngd` and a mocked Radarr queue that
  returns the ISO hash, Request Status shows live progress through SSE.

---

## Phase 2: IPTV Tunerr as a Live TV and recording provider

Value: very high. Risk: medium. It needs changes in the Tunerr fork.

Verified Tunerr routes, from `internal/tuner/server.go` and
`server_diagnostics_recordings.go` (high confidence):

- `GET /guide.xml`: merged XMLTV
- `GET /guide/capsules.json`, `GET /guide/highlights.json`,
  `GET /guide/health.json`
- `GET /lineup.json`, `GET /channels/report.json`
- `GET /recordings/rules.json`
- `POST /recordings/rules.json` with
  `{action: upsert|replace|delete|toggle, rule, rules, rule_id, enabled}`
- `POST /recordings/rules/preview.json`
- `GET /recordings/history.json`, `GET /recordings/recorder.json`
- `GET /v1/sports/events`, `/v1/sports/status`, `/v1/sports/automation`
- `GET /virtual-channels/preview.json`, `/virtual-channels/channel-detail.json`,
  and `/programming/*`

The `RecordingRule` fields are `id`, `name`, `enabled`, `include_lanes`,
`include_channel_ids`, `include_guide_numbers`, `include_tvg_ids`,
`include_categories`, `states`, and `title_contains`.

### Known gaps in the Tunerr fork (do these first)
1. **Auth for service-to-service calls: unknown.** Rule writes are gated by
       `operatorUIAllowed()`, and how that check works was not confirmed.
       Tunerr needs an API key or service token that SeerrNG can send. Model it
       on ChaptarrNG's restricted SeerrNG key.
2. **No way to record a single airing.** Rules match on title text, channels,
       and categories, and have no start/stop window. Add optional
       `start_after`, `stop_before`, and `programme_id` fields, or a separate
       one-shot recording endpoint.
3. **No external IDs in guide data.** Matching to TMDB is fuzzy (title, plus
       year or episode). Add optional `tmdb_id`, `tvdb_id`, and `imdb_id` fields
       to capsules wherever XMLTV `episode-num`/`credits` data allows.
4. **Capability manifest.** Add a `GET /v1/capabilities` endpoint, or reuse
       `/deck/setup-doctor.json`, so SeerrNG can gate features.
5. **Completion signal.** Recorder history must report the output path, so
       SeerrNG can mark a request available and link the file.

### SeerrNG tasks
- [ ] **New entity `RecordingRequest`** and `RecordingRequestStatusEvent`,
      following the separate-entity pattern of `SoftwareRequest`. Do not add a
      value to `MediaType`, because recordings are not library media.
- [ ] Guide sync job: fetch `/guide/capsules.json` on a schedule, cache it, and
      match it to TMDB using exact external IDs first, then title + year.
      Record the confidence of each match.
- [ ] **"On Live TV" panel** on movie and TV detail pages: the next airings,
      with **Watch live** (deep link to the media server's Live TV) and
      **Record**.
- [ ] Record flow: go through the normal approval, quota, and permission path.
      Add a permission `REQUEST_RECORDING` and a quota bucket. On approval,
      upsert a Tunerr rule named `seerrng:<requestId>`. Then poll recorder
      history, or push it into the event hub, and update status. On
      completion, notify the user and link the request into Request Status.
- [ ] Series recording: a single rule with `title_contains` plus channel
      constraints, which the user can cancel from Request Status. Cancelling
      sends a `delete` rule action.
- [ ] **Follow my team (sports):** a user setting that stores followed teams.
      A job reads `/v1/sports/events` and creates scoped rules for each
      upcoming game. This needs Tunerr's sports automation to be configured.
- [ ] **"Recently aired" shelf** on Discover, built from catch-up capsules.
      It appears only when Tunerr publishes catch-up content to the user's
      media server.
- [ ] Admin: a channel-health summary from `/channels/report.json` in the
      Tunerr settings page, to help troubleshoot "why did my recording fail".
- [ ] Later (separate PR): **channel requests**. Users request a virtual
      channel built from library collections. Approval creates a Tunerr
      programming recipe through `/programming/*`. Design this only after the
      programming write API is confirmed.
- [ ] Later: **Plex → Jellyfin user migration**, reusing Tunerr's
      Plex-user/OIDC export to bulk-create linked SeerrNG users.
- [ ] Contract tests with fixture `guide.xml`, capsules, and rules responses.
- **Done when:** against a local Tunerr fed a fixture M3U/XMLTV, a user can
  request a recording of a fixture programme. After admin approval, the
  matching rule appears in `GET /recordings/rules.json` and
  `/recordings/rules/preview.json` shows the match. Live capture is not
  testable on the laptop; record it as an outstanding live verification.

---

## Phase 3: slskdN / slskr direct integration

Value: high for music users. Risk: medium. Lidarr stays the primary music path,
and slskdN covers what Lidarr cannot.

Verified slskdN controllers, from `~/slskdn-current/src/slskd/` (high
confidence that the routes exist; request and response schemas still need to be
read):

- `LibraryHealth/API/LibraryHealthController.cs`, under
  `api/v{n}/library/health`: `POST scans`, `GET scans/{id}`, `GET summary`,
  `GET dashboard`, `GET issues`, `GET issues/by-type`. Most are admin-only.
- A `POST remediate` route exists. Confirm which controller owns it and its
  body.
- `Wishlist/API/Controllers/WishlistController.cs`, under
  `api/v{n}/wishlist`: CRUD, `PUT bulk-filter`, `POST {id}/search`.
- `POST artist/{artistId}/discography-coverage/wishlist`
- `SongID/API/SongIdController.cs`, under `api/v{n}/songid`:
  `GET capabilities`, `POST runs` (admin), `GET runs`, `GET runs/{id}`.
- Stream routes: `api/v{n}/streams`, `peer-streams`, `mesh-streams`.

slskr has its own `/api/v0/*` surface. Its README claims compatibility with
slskd/slskdN workflows, but that is unverified for these routes. Gate each
feature on capabilities, not on which project is running.

### Tasks
- [ ] `server/api/slskdn.ts` client with capability detection, and a settings
      entry from Phase 0.2.
- [ ] **Track-level requests.** A playlist import (`playlist-requests.md`)
      sends tracks Lidarr cannot match, and singles or non-album tracks, to
      the slskdN wishlist when it is configured. Request Status shows them as
      their own items.
- [ ] **Quality-fix requests.** Add an audio-quality issue type on albums, such
      as "transcode / fake lossless / missing tracks". When an admin resolves
      the issue, it triggers slskdN remediation for that album. A nightly job
      imports `library/health/issues` as admin-visible suggestions.
- [ ] **"What's this song?"** Users submit a link, clip, or text. SeerrNG
      creates a SongID run and polls it. The result is shown as a
      MusicBrainz-matched album with the normal Request button. `POST runs` is
      admin-only, so either proxy it under a SeerrNG permission or ask the fork
      for a scoped key.
- [ ] **Preview before requesting:** play from a peer or mesh stream on music
      detail pages, only when the capability is reported. Check the legal and
      permission implications with the maintainer before shipping.
- [ ] Download progress for slskdN transfers goes into the Phase 0 event hub.
- **Done when:** contract tests pass for the wishlist, library health, and
  SongID fixtures. Live verification needs Soulseek credentials and is recorded
  as outstanding if they are unavailable.

---

## Phase 4: Unused capabilities in forks SeerrNG already integrates

Value: medium to high. Risk: low. Each item is a small, separate PR.

None of these appear in `server/` or `src/` today.

- [ ] **BookshelfNG series-pack search.** Add a "Request entire series" action
      on series pages. See BookshelfNG `docs/series-pack-search.md`.
- [ ] **Goodreads and Hardcover want-to-read lists** as sources for the
      existing per-user External Request List Sync (`ExternalRequestList`
      entity). BookshelfNG already imports Goodreads lists; decide whether
      SeerrNG reads the list directly or delegates the import to BookshelfNG.
- [ ] **BookshelfNG M4B merging** as a per-request audiobook option, shown only
      when the capability is reported.
- [ ] **ChaptarrNG direct ebook download.** Show "direct source" as the
      acquisition path in Request Status, with the faster expected time.
- [ ] **ROMarrNG DAT verification.** Show verified / bad dump / unknown status
      on software requests and in the download list.
- [ ] **ROMarrNG collections and 1G1R ("one game, one ROM") sets.** Add a
      "Request full set" action that is admin-approval only, with a size
      estimate and quota impact shown before approval.
- [ ] **QuestarrNG RomM and Playnite state into My Games.** Mark entries
      "installed" or "in library" automatically
      (`docs/using-seerr/game-library.md`).
- For each item: confirm the fork exposes it through its SeerrNG contract. If
  it does not, add the contract field in the fork first.

---

## Phase 5: Route each request to its fastest source

Value: very high. Risk: high. Start only after Phases 1–3 are stable.

When a request is approved, check the configured sources in order and use the
fastest one that is available:

1. Tunerr: airing within N hours, or available as catch-up. Offer to record.
2. Direct sources: ChaptarrNG direct download for ebooks; slskdN for tracks.
3. Normal *arr search.

- [ ] An admin-defined source order for each category, with an opt-out per
      request.
- [ ] Request Status shows which source was chosen and why.
- [ ] Must not double-acquire. If an earlier source fulfils the request, cancel
      or never start the later ones. Reuse the safe-cancel semantics in
      `RequestDispatchOutbox` and the ChaptarrNG pending-import fences.
- Produce a written design document and get maintainer approval before any
  code.

---

## Open questions for the maintainer

1. How should SeerrNG authenticate to Tunerr: a new service key in the fork, or
   reuse of an existing mechanism? Unknown, because `operatorUIAllowed()` was
   not read.
2. Should recordings count against an existing quota or a new one?
3. Should slskdN previews ship at all, given they stream from third-party
   peers?
4. Should the single-airing recording support be built in Tunerr first (single
   airings in the fork) or worked around in SeerrNG with narrow title and
   channel rules?

## Provenance: ideas borrowed from ReadMeABook

ReadMeABook (`kikootwo/ReadMeABook`) is AGPL-3.0; SeerrNG is MIT. Phase 6 took
only feature-level ideas from ReadMeABook's public README and documentation
(a swipe stack for recommendations, right-to-request, left/up with undo,
per-user preferences, optional AI ordering). No ReadMeABook source code, CSS,
copy, assets, or the "BookDate" name were used; every SeerrNG file was written
independently. Design differences: SeerrNG decks come from its own catalogs
(so cards are always requestable), AI is optional and only reorders, and the
feature covers movies, series, and books.
