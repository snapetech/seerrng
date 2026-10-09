# SeerrNG market research: dependencies, alternatives, feature gaps

Date: 2026-10-06; book-integration clarification updated 2026-10-08

## Method and limits

- **Dependency inventory:** read from repo code (`server/api`, `server/lib`, `server/api/downloadClients`, `server/api/servarr`, `server/api/comics`, `server/api/software`), `docs/maintainers/upstreams.md`, `docs/maintainers/ng-ecosystem-integration-plan.md`, `docs/using-seerr/companion-services.md`, and an outbound-hostname count of `server/` and `src/`. Confidence: **high**.
- **Fork feature facts:** WebFetch summaries of each fork's GitHub README, produced by a small model. Confidence: **moderate**. Not checked against source or a running instance.
- **Local Tunerr facts:** read from `~/Code/iptvtunerr/README.md`. Confidence: **high** for what the README claims.
- **Alternatives:** WebSearch results, mostly aggregator pages (AlternativeTo, selfhostyourself, vendor blogs), plus a few official sites. Confidence: **low to moderate** per entry, noted inline.
- **"Exhaustive" scope:** the candidate catalog below is exhaustive for named alternatives that surfaced in research. It is not a guaranteed complete census. Full feature lists are verified only for forks and the main alternatives per category. Long-tail entries get one line, and unsourced features are marked `?` (unknown).
- **Excluded:** npm framework libraries (Next, Express, TypeORM, React). They are a different question from the service dependencies.

---

## 1. SeerrNG dependency inventory

### 1a. Snapetech NG forks and owned projects

| Project | Forked from | Role in SeerrNG | Confidence |
|---|---|---|---|
| SeerrNG | Seerr (upstream default branch `develop`) | Request and discovery layer | high |
| BookshelfNG | Bookshelf (Readarr revival), with Prowlarr components | Ebook and audiobook manager, Readarr-compatible API, Hardcover-native | moderate |
| ChaptarrNG | Chaptarr (Readarr-derived) | Ebook and audiobook manager, format-scoped requests, service-key contract | moderate |
| QuestarrNG | Doezer/Questarr | PC game acquisition, IGDB catalog, RomM and Playnite routing | moderate |
| ROMarrNG | BlizzHacker/romarr (unofficial fork) | ROM acquisition, No-Intro/Redump DAT verification, 1G1R | moderate |
| slskdN | slskd | Soulseek wishlist, SongID, library health | moderate |
| TorrentNG | None; own built-in engine `torrentngd` (Rust) plus adapters for other clients | Download progress adapter | moderate |
| IPTV Tunerr | README states no upstream. The ecosystem plan calls it "the Tunerr fork" | Live TV, guide, recording rules | high (README), fork status unknown |
| SeerrNG Jellyfin Bridge | Own | Jellyfin sign-in plugin | high |

### 1b. Non-fork services SeerrNG calls

| Category | Services | Notes | Confidence |
|---|---|---|---|
| Movie/TV acquisition | Radarr, Sonarr, Prowlarr | `server/api/servarr`, `prowlarr.ts` | high |
| Music acquisition | Lidarr, slskdN (via Soulseek) | Lidarr is the only music *arr in code | high |
| Book acquisition | Readarr (`servarr/readarr.ts`), BookshelfNG, ChaptarrNG | **Readarr upstream archived 27 Jun 2025** (per ElfHosted blog, a single source) | moderate |
| Magazines | LazyLibrarian | `lazylibrarian.ts` | high |
| Comics | Mylar3, Kapowarr, BackIssue, ComicVine | `server/api/comics/` | high |
| Download clients | qBittorrent, Transmission, Deluge, TorrentNG | **No Usenet client adapter** (SABnzbd and NZBGet are reached only through the *arrs) | high |
| Media servers | Plex, Jellyfin, Emby, Audiobookshelf, Tautulli (Plex stats) | | high |
| Movie/TV metadata | TMDB, TVDB, TVmaze, Trakt, Simkl, MDBList, AniList, Rotten Tomatoes, IMDb (proxy), fanart.tv, Wikidata | | high (code); moderate (fanart.tv usage) |
| Music metadata | MusicBrainz, Cover Art Archive, TheAudioDB, Discogs, Spotify, ListenBrainz, YouTube | | high |
| Book metadata | Hardcover (`api.hardcover.app`), Open Library, Google Books, Goodreads (list import), Europeana, NDL Japan, Internet Archive, Library of Congress (via BookshelfNG) | Goodreads public API closed in 2020 (high) | high |
| Games | IGDB, Steam, RomM and Playnite (via QuestarrNG) | | high |
| Reader delivery | Grimmory, BookOrbit (OPDS and Komga) | | high |
| Live TV | IPTV Tunerr (HDHomeRun-style tuner plus XMLTV) | | high |
| Notifications | Discord, Telegram, Pushover, Pushbullet, Gotify, ntfy, Slack, email (SMTP), webhook, Web Push | 10 native agents | high |
| AI ordering | Anthropic Claude, OpenAI, Ollama, LM Studio (OpenAI-compatible) | Swipe ordering only | high |
| Identity and other | Plex.tv, Jellyfin sign-in, OIDC, Gravatar, GitHub API, Prometheus, OTLP (BookshelfNG) | | moderate |

Roughly 70 external services in total.

---

## 2. Alternatives catalog by category

Status tags come from the research. `?` means not found.

### 2.1 Request and front-end layer
- **Seerr**: merged successor of Overseerr and Jellyseerr; SeerrNG's upstream. Moderate.
- **Overseerr, Jellyseerr**: merged into Seerr. Moderate.
- **Ombi**: maintenance mode; Plex and Emby; forwards music requests to Lidarr. Moderate.
- **Petio**: Plex-only request UI; Sonarr and Radarr integration. Activity `?`.
- **Reiverr**: plugin-based; Jellyfin, Radarr, Sonarr; TMDB discovery. Moderate.
- **Doplarr, Requestrr** (Discord request bots), **MediaManager**: named in results only. Status `?`.

### 2.2 Book acquisition
- **Readarr**: archived 27 Jun 2025; metadata backend offline. Moderate (single source).
- **Bookshelf**: revival, upstream of BookshelfNG. Moderate.
- **BookshelfNG**: Hardcover image, ebook and audiobook in one instance, qBittorrent 5.2, native MyAnonamouse indexer, Calibre Content Server and BookLore upload, optional M4B merge, series-pack search, telemetry removed. Moderate.
- **Chaptarr**: community fork of Readarr; own metadata pipeline; multi-edition; narrator-aware; MP3 to M4B. Moderate.
- **ChaptarrNG**: fork of Chaptarr; format-scoped requests; durable pending imports with cancel; restricted service key; PostgreSQL optional; built-in direct-download indexer. Moderate.
- **LazyLibrarian**: books and magazines; Unraid template exists. High (repo audit).

### 2.3 Ebook and audiobook libraries and readers
- **Grimmory**: successor to BookLore; audiobooks (M4B, M4A, MP3, OPUS); OPDS; Kobo and KOReader sync; BookDrop ingestion; OIDC. Moderate, with a vendor-blog source.
- **BookLore**: original project; Grimmory migrates its library. Moderate.
- **BookOrbit**: SeerrNG delivery target. Features `?` (not verified externally).
- **Calibre-Web Automated**: Calibre-database front end with auto-ingest; Kindle and Kobo delivery. Moderate.
- **Kavita**: mixed ebook, comic and manga; OPDS. Moderate.
- **Komga**: comics; API used by Grimmory. Moderate.
- **Audiobookshelf**: audiobooks and podcasts; already integrated. Moderate.

### 2.4 Music acquisition and libraries
- **Lidarr**: the only music *arr; SeerrNG depends on it. High.
- **Headphones**: open-source music automation; Usenet via SABnzbd or torrents. Moderate.
- **slskd / slskdN**: Soulseek daemon with REST API on port 5030; Lidarr config. Moderate.
- **beets**: tagging against MusicBrainz; not an acquirer. Moderate.
- **Navidrome**: music-only server, Subsonic API, transcoding. Moderate.
- Jellyfin music is basic compared with a dedicated server. Moderate.

### 2.5 Movie and TV acquisition
- **Radarr, Sonarr**: active upstreams. Status not re-verified in this session.
- **Whisparr, Bazarr**: from memory, not verified this session.

### 2.6 Live TV and DVR
- **IPTV Tunerr**: HDHomeRun-style tuner; guide merge and repair; failover and host ranking; catch-up libraries; owned-media virtual channels; migration tooling. High (README).
- **Threadfin**: maintained successor to xTeVe; filters and renames M3U channels. Moderate.
- **xTeVe**: stalled since Aug 2024. Moderate.
- **Dispatcharr**: IPTV stream and EPG manager, arr-style. Moderate.
- **Tunarr**: custom channels from Plex, Jellyfin or Emby; HDHR emulation; M3U. Moderate.
- **ErsatzTV**: maintenance mode. Moderate.
- **Channels DVR**: commercial DVR; $80 per year or $8 per month (as of Feb 2025); requires HDHomeRun hardware. Moderate.
- **HDHomeRun DVR service**: $35 per year. Moderate.
- **Tvheadend**: DVB server with documented HTTP API; scheduled recording. Moderate.
- **NextPVR**: Windows-first; Linux and macOS support. Moderate.
- **GB PVR**: Windows. Low.

### 2.7 Torrent clients
- **qBittorrent 5.2.3** (Jul 2026): WebUI, RSS automation, API. Moderate.
- **Transmission 4.1.3** (Jun 2026): watch directories, WebUI. Moderate.
- **Deluge**: plugin system; daemon and WebUI. Moderate.
- **rTorrent 0.16.21** (Aug 2026): CLI, XML-RPC. Moderate.
- **aria2**: multi-protocol downloader, not BitTorrent-only. Moderate.
- **TorrentNG**: built-in Rust engine plus adapters; token auth; backup and restore; pre-1.0; AGPL-3.0-or-later or commercial. Moderate.
- **Real-Debrid**: supported by ROMarrNG. Moderate.

### 2.8 Usenet clients
- **SABnzbd**: actively maintained; 5.0 in beta; RSS and *arr integration. Moderate.
- **NZBGet**: original author stopped in 2022; community fork at v26.0. Moderate.

### 2.9 Indexer managers
- **Prowlarr**: torrent and Usenet; syncs *arrs. Moderate.
- **Jackett**: manual per-app setup. Moderate.
- **NZBHydra2**: Usenet meta-search with deeper stats. Moderate.

### 2.10 Game libraries and launchers
- **Playnite**: open-source Windows launcher with extensions (Steam, GOG, Epic, EA, Battle.net, emulators). Moderate.
- **RomM**: self-hosted ROM library; scan, enrich, play. Moderate.
- **Retrom**: ROM library scan and metadata. Moderate.
- **Gaseous**: ROM server with in-browser emulation. Moderate.
- **Lutris**, **Heroic Games Launcher**, **GOG Galaxy**: launchers. Moderate.
- **Cartridge** is a consumer of ROMarr, not an alternative. Moderate.

### 2.11 ROM acquisition
- **ROMarrNG**, and its upstream **romarr** (BlizzHacker). Moderate.
- No other ROM acquirer surfaced. The library managers (RomM, Retrom, Gaseous) do not acquire. Completeness: low.

### 2.12 PC game acquisition
- **QuestarrNG**, and its upstream **Questarr** (Doezer), an *arr-style game manager on IGDB. Active on GitHub. Moderate.

### 2.13 Comics
- **BackIssue**: ComicVine-based; RSS watching; weekly calendar; Usenet and torrent built in; plugin catalog; browser reader; Android companion; multi-user roles. Moderate (vendor site).
- **Mylar3**: watchlists; Usenet and torrent; Python and SQLite; last commit about six months earlier. Low (single source).
- **Kapowarr**: *arr-style comic manager. Low (single source, age unclear).
- **ComicTagger**: metadata tagger with VerseDB and Metron plugins. Moderate.

### 2.14 Comic metadata
- **ComicVine**: GameSpot-owned API. Moderate.
- **Metron**: community database with REST API, started as an alternative to ComicVine. Moderate.
- **Grand Comics Database**: since 1994. API `?`.

### 2.15 Movie and TV metadata and tracking
- **TMDB**: primary. High.
- **TVDB**, **TVmaze** (free; already in code), **Trakt**, **Simkl**, **MDBList**, **AniList**: all already integrated in SeerrNG except where noted. High (code).
- **Letterboxd**: films only, no TV; detailed statistics $49 per year. Moderate. No SeerrNG integration.
- **Moviebase**: syncs with Trakt. Moderate.
- **OMDb**, **IMDb** (no official public API): from memory. Low.

### 2.16 Music metadata
- **MusicBrainz**, **Cover Art Archive**, **TheAudioDB**, **Discogs**, **Spotify**, **ListenBrainz**: all in SeerrNG. High (code).
- **Last.fm, Deezer, Apple Music**: from memory; not in SeerrNG. Low.

### 2.17 Book metadata
- **Hardcover**: GraphQL; native in BookshelfNG. High.
- **Open Library**: about 20M works, free. Moderate.
- **Google Books**: covers and descriptions. Moderate.
- **Goodreads**: public API closed in 2020. High.
- **StoryGraph**: no public API. `?`
- **Librario**: aggregator over Google Books, ISBNDB and Hardcover; new. Low.
- **Library of Congress, Europeana, NDL, Gutendex, Internet Archive**: used by BookshelfNG or SeerrNG. Moderate.

### 2.18 Game metadata
- **IGDB**: Twitch-owned; used by SeerrNG and QuestarrNG. High.
- **RAWG**: free. Moderate.
- **MobyGames**: freemium. Moderate.
- **ScreenScraper, TheGamesDB, OpenVGDB, RetroAchievements, Ludusavi, libretro DATs**: ROM-side metadata. Moderate (via ROMarrNG README).
- **Steam** (store and community): SeerrNG uses. High.

### 2.19 Watch statistics
- **Tautulli**: Plex only. Moderate.
- **Jellystat**: free and open-source Jellyfin statistics, per-user analytics. Moderate.
- **Streamystats**, **JellyWatch / EmbyWatch**: detail `?`.

### 2.20 Media servers
- **Plex**: proprietary. One 2026 source says lifetime pass went from $249.99 to $749.99 in July 2026. Low; verify before citing.
- **Jellyfin**: GPL-2.0, free; video, music, photos, live TV. Moderate.
- **Emby**: proprietary freemium. Moderate.
- **Kodi**: player, not server. Moderate.
- **Navidrome**: music only. Moderate.
- **Audiobookshelf**: audiobooks and podcasts. Moderate.
- **Immich**: photos. Moderate.

### 2.21 Notifications
- **Apprise**: Python library and CLI; 120+ services via URLs; self-hostable API. Moderate.
- **ntfy**: topic-based pub/sub; email, CLI and webhook delivery. Moderate.
- **Gotify**: app-token model; persistent message history. Moderate.
- **Pushover**: $5 one-time per platform. Moderate.
- Matrix, Signal, Mattermost, Home Assistant: not verified.

### 2.22 AI providers
- **Anthropic Claude**, **OpenAI**: in SeerrNG. High.
- **Ollama**: OpenAI-compatible endpoint on port 11434. Moderate.
- **LM Studio**: OpenAI- and Anthropic-compatible on port 1234. Moderate.
- **llama.cpp (llama-server)**: OpenAI-compatible; CLI-first. Moderate.
- **vLLM**: named in results; not verified.

### 2.23 Soulseek clients
- **slskd**: C# daemon; REST API; Docker; Prowlarr-compatible. Moderate.
- **Nicotine+**: desktop; version 3.3.10 (Mar 2025). Moderate.
- **SoulseekQt**: official client, dated Qt UI. Moderate.
- **slskr**: no information found. Unknown.

---

## 3. Feature comparison: forks against their alternatives

Legend: ✓ found in README or source; ✗ not present; ? not verified.

### 3a. Book managers

| Feature | BookshelfNG | ChaptarrNG | Readarr (archived) |
|---|---|---|---|
| Ebook and audiobook in one instance | ✓ | ✓ | ? |
| Native Hardcover metadata | ✓ | ✗ (own pipeline) | ✗ (backend offline) |
| Goodreads import path | ✓ (softcover image) | ? | ? |
| Multi-edition (ebook and audio of one title) | ? | ✓ | ✗ (per Chaptarr claim) |
| M4B merge or MP3 to M4B | ✓ | ✓ | ? |
| Series-pack search | ✓ | ? | ? |
| Native direct-download indexer | ✓ (optional headless Chromium) | ✓ (API key and browser-assisted) | ✗ |
| Format-scoped requests with SeerrNG capability contract | ? (SeerrNG docs say supported) | ✓ (`/api/v1/system/capabilities`, service key) | ✗ |
| Pending-import progress and safe cancel | ? | ✓ | ✗ |
| PostgreSQL | ✓ (compose) | ✓ (optional) | ? |
| Calibre Content Server | ✓ | ? | ? |
| BookLore or Grimmory upload | ✓ | ? | ? |
| Narrator tagging | ✓ | ✓ | ? |
| Telemetry | Sentry removed; opt-in OTLP | ? | ? |

**Read:** both NG book forks cover the same dual-format ground. ChaptarrNG has the stronger SeerrNG contract (capability negotiation and service keys). BookshelfNG has the stronger Hardcover path and Calibre and Grimmory handoff. Confidence: moderate.

### 3b. Game and ROM stack

| Feature | QuestarrNG | Questarr (upstream) | ROMarrNG | Playnite | RomM |
|---|---|---|---|---|---|
| PC game acquisition | ✓ | ✓ | ✗ | ✗ | ✗ |
| ROM acquisition | ✗ | ✗ | ✓ | ✗ | ✗ |
| IGDB catalog | ✓ | ✓ | ✓ | ✗ | ✗ |
| DAT verification (No-Intro and Redump) | ✗ | ✗ | ✓ (verified, bad dump, unknown) | ✗ | ? |
| 1G1R collection acquisition | ✗ | ✗ | ✓ | ✗ | ✗ |
| Usenet clients | ✓ (SABnzbd, NZBGet) | ✓ | ✓ (26 clients incl. SABnzbd) | ✗ | ✗ |
| Routes into RomM | ✓ | ? | ✓ | ✗ | (is the target) |
| Playnite extension | ✓ | ✗ | ✗ | (is the host) | ✗ |
| Steam achievements | ✓ | ? | ✗ | ✓ (via extension) | ? |
| Malware scan on post-process | ✓ (VirusTotal or ClamAV, optional) | ? | ✗ | ✗ | ✗ |
| Blocklist and backoff ladder | ? | ? | ✓ | ✗ | ✗ |
| Native HTTPS, TOTP, ForwardAuth | ? | ? | ✓ | ✗ | ? |

**Read:** no alternative in the research performs ROM acquisition with DAT verification, so ROMarrNG has no direct substitute. QuestarrNG's distinct value is Playnite and RomM routing. Confidence: moderate.

### 3c. Live TV and DVR

| Feature | Tunerr | Threadfin | Dispatcharr | Tunarr | ErsatzTV | Channels DVR | Tvheadend |
|---|---|---|---|---|---|---|---|
| HDHomeRun-style tuner emulation | ✓ | ✓ | ? | ✓ | ? | ✓ (needs hardware) | ? |
| Guide merge, repair, publish | ✓ | ✓ (filter, rename) | ✓ (EPG management) | ✓ (guide UI) | ? | ✓ | ✓ |
| Host failover and ranking | ✓ | ? | ? | ✗ | ✗ | ✗ | ✗ |
| Catch-up libraries | ✓ | ✗ | ✗ | ✗ | ✗ | ? | ✗ |
| Owned-media virtual channels | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ |
| Recording and DVR | ✓ (rules; recorder on a local branch) | ✗ | ✗ | ✗ | ✗ | ✓ (commercial skip) | ✓ (scheduled, API) |
| Documented automation API | ✓ (SeerrNG uses it) | ? | ? | ? | ? | ? | ✓ |
| Maintenance status | Active (local commits) | Maintained | Active (`?`) | `?` | Maintenance mode | Commercial | Active |

**Read:** Tunerr is the only option in this table that combines guide repair, host failover, catch-up and recording rules. Its weak point is single-vendor dependence: SeerrNG's client is Tunerr-specific. Confidence: moderate.

### 3d. Soulseek

| Feature | slskdN | slskd | Nicotine+ | SoulseekQt |
|---|---|---|---|---|
| REST API | ✓ | ✓ | ✗ | ✗ |
| Wishlist | ✓ | ? | ? | ✗ |
| SongID | ✓ | ✗ | ✗ | ✗ |
| Lidarr config | ✓ | ? | ✗ | ✗ |
| Experimental DHT, mesh, federation, multi-source | ✓ (gated) | ✗ | ✗ | ✗ |
| Headless daemon | ✓ | ✓ | ✗ | ✗ |

**Read:** slskdN extends slskd, and its experimental networking is not ready for a request product. Confidence: moderate.

### 3e. Torrent clients

| Feature | TorrentNG | qBittorrent | Transmission | Deluge | rTorrent |
|---|---|---|---|---|---|
| Unified WebUI over several clients | ✓ | ✗ | ✗ | ✗ | ✗ |
| Own BitTorrent engine | ✓ (Rust) | ✗ | ✗ | ✗ | ✗ |
| Compatible API for qB, Tr, De and rT | ✓ | (is qB) | (is Tr) | (is De) | (is rT) |
| RSS automation | ? | ✓ | ✗ | ? | ? |
| Watch directories | ? | ? | ✓ | ? | ? |
| Maturity | Pre-1.0 | Mature | Mature | Mature | Mature |

**Read:** TorrentNG's unique value is a single front end and its own engine, which is worth keeping as an adapter but not making a default. Confidence: moderate.

---

## 4. Forks: should we fork non-forks now?

| Candidate | Recommendation | Confidence |
|---|---|---|
| Readarr | **No.** Bookshelf and Chaptarr already cover it, and we already run two forks. Consolidate instead. | moderate |
| Ombi | **No.** Maintenance mode, and SeerrNG already covers its job. | moderate |
| ErsatzTV | **No.** Maintenance mode, and Tunerr covers owned-media channels. | moderate |
| xTeVe | **No.** Stalled; Threadfin is the maintained successor. | moderate |
| Mylar3 | **Conditional.** Fork only if comics become a core product. Current activity is unclear. | low |
| NZBGet | **No.** Community fork exists. | moderate |
| Lidarr, Radarr, Sonarr, Prowlarr | **No.** Active upstreams with no gap found. | low (not re-checked) |

---

## 5. Recommendations

Effort: S, M, L. Confidence in brackets.

1. **Decide the book backend.** Readarr was archived in June 2025, yet SeerrNG still ships `servarr/readarr.ts`. BookshelfNG and ChaptarrNG both serve dual-format books. Pick one as the primary book backend and deprecate the other, or document why both stay. Hold new ChaptarrNG features until that decision is made. *Where:* SeerrNG and both forks. Effort M. [high on duplication; moderate on archive status]

2. **Audit the Goodreads list import.** Goodreads closed its public API in 2020. SeerrNG's `goodreads.com` list path needs a review: how it reads lists, and whether it will keep working. Hardcover is the maintained alternative. *Where:* SeerrNG. Effort S to audit. [high on API closure; unknown on current behavior]

3. **Add a Usenet client adapter to live download progress.** Phase 1 covers only torrent clients. SABnzbd is actively maintained; NZBGet has a community fork. Usenet users currently see nothing live. *Where:* SeerrNG, `server/api/downloadClients/`. Effort M. [moderate on value; no user data consulted]

4. **Add Metron as a comic metadata source beside ComicVine.** ComicVine is GameSpot-owned. Metron is a community database with a REST API. *Where:* SeerrNG `server/api/comics/`. Effort M. [moderate]

5. **Treat BackIssue as the preferred comic target when reading and multi-user matter.** It has the most complete feature set found (reader, Android companion, RSS watching, roles). Do not fork comics now. *Where:* SeerrNG docs and comic-service picker. Effort S. [low to moderate]

6. **Keep ROMarrNG and invest in its DAT verification.** No ROM acquirer with DAT verification turned up in research, so this is the product's clearest unique feature. Finish the RomM status feedback (Phase 4, pending). *Where:* ROMarrNG and SeerrNG. Effort M. [moderate; ROM search was thin]

7. **Keep QuestarrNG's Playnite and RomM routing.** Those integrations are unique in this set. Track upstream Questarr to keep divergence small. *Where:* QuestarrNG. Effort ongoing. [moderate]

8. **Use slskdN's stable surfaces only.** Wishlist, SongID, library health and Lidarr config are worth exposing. Keep the experimental networking (DHT, mesh, federation, multi-source) out of SeerrNG. The legal question on peer previews (Phase 3 open question 3) stays open. *Where:* slskdN and SeerrNG. Effort S. [moderate]

9. **Keep TorrentNG as an adapter, not a default.** It is pre-1.0, and its value is the unified front end and built-in engine. Add rTorrent support to SeerrNG's adapter list if demand appears; QuestarrNG already supports it. *Where:* SeerrNG. Effort S to M. [moderate]

10. **Do not build a reader.** Grimmory (BookLore successor with OPDS, Kobo and KOReader sync, audiobooks) covers reading. SeerrNG's delivery to Grimmory and BookOrbit is the right boundary. Verify BookOrbit's features before relying on them. *Where:* SeerrNG docs. Effort none. [moderate]

11. **Put Tunerr behind a generic tuner-provider interface, with Tunerr as the first implementation.** This reduces single-vendor risk. Channels DVR (commercial, about $80 per year) is the first candidate for a second provider. Do this only after Phase 2's live round-trip, which is still pending. *Where:* SeerrNG `server/lib/liveTv/`. Effort L. [moderate]

12. **Add a Navidrome availability source if music users exist.** SeerrNG checks Plex, Jellyfin, Emby and Audiobookshelf. Navidrome (Subsonic API) is the standard music-only server. *Where:* SeerrNG `server/api/`. Effort M. [moderate on gap; demand unknown]

13. **Add a watch-statistics source for Jellyfin, behind a capability check.** Tautulli covers Plex only. Jellystat covers Jellyfin. Confirm Jellystat's API before building. *Where:* SeerrNG. Effort M, after API check. [low]

14. **Add an Apprise-based notification agent only if demand appears.** It would reach 120+ services through one adapter. SeerrNG already has 10 native agents, so the marginal value is unclear. *Where:* SeerrNG `server/lib/notifications/`. Effort S to M. [moderate]

15. **Verify the Plex price claim before citing it.** The $749.99 lifetime figure comes from one source. *Where:* marketing and docs. [low]

16. **No gap found in the request layer.** Seerr, Ombi and Petio overlap SeerrNG, and Ombi's music path is covered by Lidarr in SeerrNG. No action. [moderate]

---

## 6. Open items and corrections

- The ecosystem plan calls Tunerr "the Tunerr fork". Its README states no upstream. Fork status: unknown. Check `git` history or the GitHub network page before the next plan revision.
- slskr: no information was found. Unknown.
- Fork feature facts came from a small-model summary of READMEs. Verify against source before any public claim.
- Not run: no live round-trip, no human visual review, no tests. This document records research only.

## 7. Next steps (suggested)

1. Confirm the book-backend decision (item 1); it blocks further ChaptarrNG work.
2. Run the Goodreads audit (item 2).
3. Decide the scope of the long tail (rows marked `?`) before a second pass.

## 8. Implementation status (2026-10-06)

Branch `feat/market-research-recommendations`, stacked on `03d8d34c`
(`feat/ng-phase2-tunerr`), not `origin/main`. Nothing here is merged. No live
round trip or human visual acceptance has been run.

| # | Recommendation | Status | Evidence |
|---|---|---|---|
| 1 | Consolidate book backends | Declined by maintainer; both forks kept | n/a |
| 2 | Audit Goodreads list import | Audit recorded; no code change | 8.1 |
| 3 | Usenet adapter for live progress | Done: SABnzbd adapter, generalized download keys, tests, docs | `884ae47c` |
| 4 | Metron comic metadata source | Done: search fallback, token setting, tests, docs | `7a00f591` |
| 5 | BackIssue as preferred comic target | Done (docs) | `4cecbf9f` |
| 6 | Finish ROMarrNG RomM status feedback | Blocked on a maintainer decision (see 8.4) | 8.4 |
| 7 | Keep QuestarrNG Playnite and RomM routing | No change required | 8.4 |
| 8 | Keep slskdN to stable surfaces | Verified: no experimental networking code in SeerrNG | 8.5 |
| 9 | Keep TorrentNG as adapter; add rTorrent | Done: adapter, settings, tests, docs | `048be698`, `4cecbf9f` |
| 10 | Do not build a reader; verify BookOrbit | Reader not built; BookOrbit features not externally verified | 8.6 |
| 11 | Generic tuner-provider interface | Done: `LiveTvProvider` with Tunerr as the sole implementation; Channels DVR not built | `7e944c3f` |
| 12 | Navidrome availability source | Done: scanner, settings, route, Services section, docs | `2408f86f` |
| 13 | Jellystat watch statistics | Done: client, settings, route, summary component, docs | `48e8b29d` |
| 14 | Apprise notification agent | Done: agent, settings, routes, UI, tests; UI not visually accepted | `b37321cb` |
| 15 | Verify Plex price claim | No repository reference; nothing to correct | 8.10 |
| 16 | No gap in request layer | No action | n/a |

### 8.1 Goodreads list import

SeerrNG reads the public `review/list_rss/{id}?shelf=to-read` feed through
`server/lib/externalRequestLists.ts`. Goodreads has had no public API since
2020. Recent reports describe some shelf feeds erroring, so the feed is not a
guaranteed contract. Mitigation is pending: Hardcover want-to-read is the
maintained option. Confidence: moderate.

### 8.2 Usenet live progress

Done. Download keys are now a torrent info hash or a SABnzbd queue ID
(`SABnzbd_nzo_…`, format confirmed in SABnzbd's `nzbqueue.py`). The poller sends
each client only the keys of its kind. SABnzbd reports one aggregate speed, which
is attributed to the first downloading item. Confidence: high for the mapping
and routing; unverified against a live SABnzbd.

### 8.3 Metron

Done as a search fallback only. Series without a ComicVine ID are dropped,
because requests are keyed by ComicVine IDs. Detail pages still need ComicVine.
Confidence: moderate; the series response shape comes from Metron's serializer,
not a live call.

### 8.4 ROMarrNG and QuestarrNG

Recommendation 7 needs no change. Recommendation 6 is blocked on a decision.
ROMarrNG knows where it files a finished download (`romarr/library.py`) but
does not track whether RomM has indexed it. "RomM status feedback" could mean
"placed on disk" or "RomM has indexed it". These differ in what users see, so
the maintainer must choose before a contract field is added. Nothing in the
fork or SeerrNG was changed for this item.

### 8.5 slskdN

A search of `server/` and `src/` for DHT, mesh, federation, VirtualSoulfind,
and multi-source found no matches. Wishlist, SongID, and library health are the
only slskdN surfaces. Confidence: high.

### 8.6 BookOrbit

BookOrbit is a reader-delivery target over OPDS only. Its feature set was not
verified externally. Confidence: unknown.

### 8.7 Tuner provider interface

Done as an interface only. `LiveTvProvider` covers the calls the Live TV code
uses, and `createLiveTvProvider` returns Tunerr. Behavior is unchanged. The
recommendation's gate (Phase 2 live round trip) is still open, so this does
not mean a second backend is supported.

### 8.8 Navidrome

Done. Subsonic token authentication, `getAlbumList2` paging, MusicBrainz matching
through the existing `processMusic` path. `albumList2`, `musicBrainzId`, and the
`subsonic-response` envelope were confirmed in Navidrome's `responses.go`.
Known gap: albums marked available are not cleared when Navidrome is disconnected.

### 8.9 Jellystat

Done for per-title totals. The client sends `x-api-token`, and reads
`/stats/getGlobalItemStats` with a ten-year window. `PlaybackDuration` is stored
in seconds (confirmed in Jellystat's `ActivityMonitor.js`). Shown only to
administrators, on titles with a Jellyfin ID. Jellystat's user-level and
history features are not used.

### 8.10 Plex price

No reference to the claimed lifetime price exists in the repository. The claim
came from one source and remains unverified. Nothing to correct.

## 9. Ecosystem follow-up — 2026-10-08

This follow-up rechecks the remaining media automation candidates against the
current SeerrNG provider inventory and primary project sources. Confidence is
**high** for each project's stated function and **moderate** for whether that
function merits a SeerrNG integration; the latter depends on user demand and
product policy.

### Current request and acquisition coverage

The current product already has request/catalog or acquisition paths for
movies, TV, sports, music, ebooks and audiobooks, comics, magazines, PC games,
and emulation ROMs. Sportarr is the newly implemented sports request provider
in this worktree. Its current stable integration contract documents league,
event, paging, and file semantics; new integrations are directed to native
/api routes instead of the Sonarr compatibility layer
([Sportarr Integration API](https://wiki.sportarr.net/development/integration-api/)).
Source inspection also found that Sportarr's native catalog responses use
idLeague/strLeague, while the library and event API use different shapes;
SeerrNG's branch now normalizes these at the provider boundary and resolves
catalog identities through /api/leagues/all.

### Candidates and recommendation

| Project | What it does | SeerrNG gap | Recommendation |
|---|---|---|---|
| [Whisparr](https://github.com/Whisparr/Whisparr) | Adult media acquisition. The official project describes v2 as Sonarr-based and studio-focused, and v3 as Radarr-based and scene-focused; v3 is developed separately in [Whisparr-Eros](https://github.com/Whisparr/Whisparr-Eros). The main repository's current release list includes 2.2.0-develop.404 from September 19, 2026 ([releases](https://github.com/Whisparr/Whisparr/releases)). | The only clear missing *arr-style request/acquisition category found in this pass. | Investigate first if SeerrNG is to support adult catalogs. Treat v2 and v3 as separate provider targets until their APIs and catalog identities are verified; do not assume their Radarr/Sonarr lineage means compatible routes. |
| [Bazarr](https://github.com/morpheus65535/bazarr) | Manages and downloads subtitles for series and movies already indexed by Sonarr and Radarr; its README explicitly says it does not scan disks for media. | Optional downstream subtitle state/actions; no independent catalog or acquisition request target. | Defer as an optional media-detail enhancement, not a new request provider. |
| [Bindery](https://github.com/vavallee/bindery) | Self-hosted book manager with indexers, download clients, library import, and Readarr database migration. | No clear media-category gap: SeerrNG supports acquisition through BookshelfNG and ChaptarrNG, audiobook requests through ReadMeABook, and reader delivery through Grimmory and BookOrbit. | Monitor for demand and a stable SeerrNG-relevant API. Reconsider if users need a distinct Bindery capability or its API becomes a maintained target. |
| [Huntarr2](https://github.com/refringe/huntarr2) | Periodically tells Sonarr, Radarr, Lidarr, and Whisparr to search monitored missing items and quality upgrades; it does not download items itself. | Operations automation, not request discovery, approvals, identity, or destinations. | No request-provider integration. Episode Queue remains distinct because it uses each enrolled user's media-server playback position to request a bounded future buffer. |
| [Recyclarr](https://github.com/recyclarr/recyclarr) | Synchronizes TRaSH Guide quality profiles, custom formats, quality definitions, and naming/settings to Sonarr and Radarr. | Administration of existing providers, not a catalog or acquisition service. | No request-provider integration. Continue to let users configure these settings in their acquisition apps. |
| [Readarr](https://github.com/Readarr/Readarr/releases) | Archived upstream; GitHub marks the repository read-only since June 27, 2025. | None that warrants a new integration. | Keep existing compatibility where useful; direct new book work toward maintained alternatives. |

### Result

**Whisparr is the only additional Arr-style request target found in this
follow-up**, with moderate confidence because its two active lines have
different catalog emphases and require separate API validation. Supporting it
also needs an explicit adult-catalog product decision covering discoverability,
permissions, and visibility. Bazarr, Huntarr2, and Recyclarr solve adjacent
operational or subtitle tasks rather than media request acquisition. Bindery is
a book backend to monitor, but it does not expose a gap in the current book
coverage. No additional missing general-purpose movie, TV, music, book, comic,
magazine, PC-game, or ROM acquisition category was confirmed.

### BookData, BookDate, and BookLore clarification

`BookData` appeared once in an earlier version of this report, but not in
SeerrNG's source, settings, routes, or user documentation. The identifiable
NielsenIQ BookData product is a commercial book-trade metadata, search, and
market-data service; no SeerrNG adapter or Arr-style request workflow for it was
found. Confidence: high for its absence from SeerrNG and moderate for the
product-category comparison. See [NielsenIQ BookData](https://nielseniq.com/global/en/landing-page/nielseniq-bookdata-metadata/).

`BookDate` is the name ReadMeABook uses for its AI audiobook recommendations
and swipe interface. SeerrNG's `/swipe` is a separate, broader discovery
feature for movies, series, and books; the ReadMeABook connection handles its
audiobook search and request API, not BookDate's recommendation API. See the
[ReadMeABook project](https://github.com/kikootwo/ReadMeABook) and its
[BookDate feature documentation](https://github.com/kikootwo/ReadMeABook/blob/main/documentation/features/bookdate.md).

SeerrNG does not have a direct BookLore service connector. Its configured
reader destinations are Grimmory and BookOrbit. BookshelfNG can separately send
imports to BookLore's BookDrop review queue, so a BookshelfNG acquisition can
reach BookLore without SeerrNG talking to BookLore directly. See the
[SeerrNG reader-app settings](../using-seerr/settings/services.md) and
[BookshelfNG BookLore integration](https://github.com/snapetech/bookshelfng#documentation).
