# Changelog

SeerrNG release notes describe user-visible behavior and operational changes.
The release workflow adds curated notes from `release-notes/` before the
conventional-commit history.

The audit below covers every SeerrNG tag currently in this repository. The
`v3.2.6` tag records release preparation only; no GitHub release was published,
and the following `v3.2.7` release includes the intervening changes. Commit-level
links in the generated history remain the technical source of truth for changes
that are not called out here.

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

# Changelog

## [3.57.0](https://github.com/snapetech/seerrng/compare/v3.56.0..v3.57.0) - 2026-10-08

### User-facing changes

#### Added

- **Setup Assistance:** Operators can generate a Docker Compose starter, discover apps on a selected Docker network, probe common ports on a chosen host, or create manual reports for native and remote services. Import suggestions to prefill hostnames and ports; SeerrNG tests each connection before saving, and API keys stay manual.
- **Software:** Administrators can select ROMarrNG's DAT catalog for emulation requests. SeerrNG browses matched systems alphabetically, supports title search, and keeps requests tied to a stable DAT identity while reporting unmatched DAT headers for review.
  - **Action required:** Load DAT files in ROMarrNG to enable the DAT emulation catalog.
- **Sportarr:** SeerrNG now connects to Sportarr so users can browse sports leagues, request additions, and follow monitored events and available files from league details.
  - **Action required:** Connect Sportarr in Settings > Services to browse and request leagues.
- **External Request Lists:** IMDb watchlist sync now identifies automated access challenges and explains how they differ from a private or unavailable list. Users can import the CSV export supported by IMDb when server-side sync is blocked; new titles still follow their normal request permissions and approval settings.
  - **Action required:** Import an IMDb watchlist CSV export when IMDb blocks server-side sync. Imported lists request new titles on demand and stop scheduled server-side fetching.

#### Changed

- **Request Lists:** Scheduled IMDb and Goodreads list synchronization now reads saved lists in batches of up to 100, keeping memory use bounded as more accounts connect public lists.
- **Episode Queue:** New TV requests can start with one episode and use linked Plex, Jellyfin, or Emby playback to keep a small Sonarr episode buffer requested. The request screen explains setup requirements, and turning the queue off restores normal season selection.
- **Contribution Policy:** AI-assisted contributions now follow the same quality and automated-check requirements as other work, without a separate human sign-off gate before merge or release.

#### Fixed

- **Requests:** Edit Request now opens for requests on movie, series, book, music, comic, and magazine details, including API responses that omit the request's media back-reference.
- **Games:** On narrow screens, shared game-library filters now keep their labels within the page width, so using Play Together no longer causes horizontal scrolling.
- **Games:** Re-adding an owned game to your library now keeps its existing progress and privacy choices.
- **Software:** Software catalog and bookshelf database migrations now run in a unique order when both features are enabled, avoiding collisions during upgrades.

#### Security

- **Requests:** The temporary request-management QA route has been removed from production builds; the supported Edit Request flow remains available on media detail pages.
- **Dependencies:** Next.js is updated to 16.3.8 to address upstream security advisories affecting image optimization and page caching. Handlebars is updated to 4.7.10 to address three template-injection advisories. Game Library requests are also limited per user to help contain abusive bursts.

### 🚀 Features
- *(requests)* Add per-user external list syncing - ([a5ce1ce](https://github.com/snapetech/seerrng/commit/a5ce1cebcf31b17abd68bdba05ac914c74bc1bd1))
- *(software)* Support ROMarrNG request contract v2 - ([352390e](https://github.com/snapetech/seerrng/commit/352390e0c9f5409feb5523d27ec4a3823903b3be))
- *(software)* Integrate ROMarrNG DAT catalog - ([e72f113](https://github.com/snapetech/seerrng/commit/e72f113e6354ccdb0315a947557639f4ef8293c3))
- Add ReadMeABook and per-user book integration - ([c6e3eb6](https://github.com/snapetech/seerrng/commit/c6e3eb6369d2a413d21b598bb30ade9c2eefbb2f))
- Support OpenAI and compatible servers for swipe ordering - ([deb6958](https://github.com/snapetech/seerrng/commit/deb6958ee740face27106b9343a223a8d1261a15))
- Add the Swipe page for movies, series, and books - ([097ecc5](https://github.com/snapetech/seerrng/commit/097ecc5a49abb5eed18695b37db1376e1e7b9c39))
- Add swipe discovery decks with optional Claude ranking - ([cdb32d1](https://github.com/snapetech/seerrng/commit/cdb32d1602de07b2d1064d8bf179500c6d7521d0))
- Record followed sports teams' games through Tunerr - ([141ac35](https://github.com/snapetech/seerrng/commit/141ac354455fb4e916e5205c084f77f8ccd14e38))
- Show ROMarrNG DAT verification on available ROM requests - ([7db31a0](https://github.com/snapetech/seerrng/commit/7db31a08ba5ac9832963403d701177dae432a9f7))
- Show the download client handling each download to admins - ([82a0a4d](https://github.com/snapetech/seerrng/commit/82a0a4da116d7e19774426a9c30d6e358ced67a2))
- Add Soulseek request, album health, and SongID UI - ([715960e](https://github.com/snapetech/seerrng/commit/715960eddfce986afd79cf859f2820547104dd94))
- Add Soulseek track requests, album fixes, and SongID via slskdN - ([e0583a9](https://github.com/snapetech/seerrng/commit/e0583a9ba4d8e0aab74963c8f246432fe3ca064c))
- Add Live TV airing and recording UI - ([b10d971](https://github.com/snapetech/seerrng/commit/b10d971cc5ad3a1a0916e8c5d51cf048b87de8b0))
- Add Live TV recording requests through IPTV Tunerr - ([8dd9da3](https://github.com/snapetech/seerrng/commit/8dd9da3a62e2ff21defab718c8d01cb2e7bafa5f))
- Add live torrent download progress - ([7faf42f](https://github.com/snapetech/seerrng/commit/7faf42f5d1d6d3bd2e70fda8cf686d2a0a0ca184))
- Probe native app ports - ([335abc7](https://github.com/snapetech/seerrng/commit/335abc75b9417dfa063f533df95a099ed1d5935a))
- Support native service setup assistance - ([492d5a2](https://github.com/snapetech/seerrng/commit/492d5a252e13cf17aaa03c88c6c6967c015f0e30))
- Add Docker network setup discovery - ([4df616b](https://github.com/snapetech/seerrng/commit/4df616b1f7e1a73f6af6c9362a43798757028379))
- Integrate SeerrNG workflow improvements - ([f605182](https://github.com/snapetech/seerrng/commit/f6051829c4d61b10ee103a09566b30fb255cc1a0))

### 🐛 Bug Fixes
- *(security)* Resolve locked Next.js 16.3.8 - ([22d192f](https://github.com/snapetech/seerrng/commit/22d192f1580adca8ba3bf00f9ce82bae03fe9fad))
- *(security)* Rate limit game library endpoints - ([d490b2e](https://github.com/snapetech/seerrng/commit/d490b2edf73cd6d5c2b9b268330c183a7c189ebe))
- *(software)* Remove duplicate DAT capability - ([dafc4df](https://github.com/snapetech/seerrng/commit/dafc4dfb0f991cf47094330bb6210e2668b7b670))
- *(software)* Fall back when paged game search fails - ([1c23147](https://github.com/snapetech/seerrng/commit/1c231472159c4e61180180c73dfe7365b82595c4))
- Update vulnerable Handlebars dependency - ([cdba239](https://github.com/snapetech/seerrng/commit/cdba239afe58d84d3e8f9e844186c82a99088ee1))
- Import IMDb watchlists when sync is blocked - ([ada0c5c](https://github.com/snapetech/seerrng/commit/ada0c5c0cd80255918325f8041b909d6f0ccfa0a))
- Diagnose IMDb challenges and stabilize settings tests - ([3945324](https://github.com/snapetech/seerrng/commit/3945324b796955d41a330a972b4b17ad2b279725))
- Stabilize security and season browser checks - ([99167cd](https://github.com/snapetech/seerrng/commit/99167cddb0fa55180415d251571a4651923c3583))
- Close validation races and repair software provider build - ([1cae413](https://github.com/snapetech/seerrng/commit/1cae413fa2ace77c93e6cb4f4f732bfbf83e2ca2))
- Reconcile software catalog contract and migrations - ([da97fc6](https://github.com/snapetech/seerrng/commit/da97fc6accdd44c2965b41797b2ea176c6e95104))
- Sequence phase 7 migrations after theme adoption - ([c7f2261](https://github.com/snapetech/seerrng/commit/c7f2261dbe43711ba2b37d272afde5e3da19391a))
- Deliver live download progress to regular users - ([4d98167](https://github.com/snapetech/seerrng/commit/4d98167fac8093760a5e95a745a75d8ec0fcea10))
- Make maintenance scripts portable across macOS - ([c91998b](https://github.com/snapetech/seerrng/commit/c91998beb08de2a9bd448c5fef4653130f6a517d))

### 📖 Documentation
- *(maintainers)* Record final ROMarrNG integration validation - ([4800035](https://github.com/snapetech/seerrng/commit/48000359b75b2e4f4342ee669de8afb2e67fe429))
- *(maintainers)* Record ROMarrNG DAT integration evidence - ([d7db566](https://github.com/snapetech/seerrng/commit/d7db566b3b459e098059bf0c6f212c4e728b420a))
- Use existing security release note - ([3c5d2f0](https://github.com/snapetech/seerrng/commit/3c5d2f0b8285291733e2d1b063281652812bbbcc))
- Record current integration checkpoint - ([afb5fdb](https://github.com/snapetech/seerrng/commit/afb5fdb1ee3d4351a7d01e8843b12325a4da0371))
- Remove human sign-off gate for contributions - ([bd215ed](https://github.com/snapetech/seerrng/commit/bd215ed8d7fe3718d1b376b4181b7ddd76309f9e))
- Record final phase 7 validation checkpoint - ([94ff573](https://github.com/snapetech/seerrng/commit/94ff57382ade91cff11181ef1229951879cf7e09))
- Record phase 7 integration checkpoint - ([1457808](https://github.com/snapetech/seerrng/commit/14578084e17df5eaeb5b794c2de68109fdb088ba))
- Plan remaining ReadMeABook features - ([f78f27a](https://github.com/snapetech/seerrng/commit/f78f27aab9506ee63a6bad2748c5ab67387a3361))
- Propose fastest-source routing design - ([135c5c1](https://github.com/snapetech/seerrng/commit/135c5c1c68ac71346cbd0320755afaa5a42b2421))
- Record Tunerr recording-rule fork progress - ([83c1f37](https://github.com/snapetech/seerrng/commit/83c1f377b9e047700ac5f8ae7705ebb007faa938))
- Remove human sign-off gate for contributions - ([b6639aa](https://github.com/snapetech/seerrng/commit/b6639aa2ab768ef127334066bd65a7b551775710))

### ⚡ Performance
- Trim the initial English app bundle - ([a1f0a8d](https://github.com/snapetech/seerrng/commit/a1f0a8d0417a0d86430645983d281d4307ebcca1))

### 🧪 Testing
- *(security)* Verify game library rate limits - ([cfbd060](https://github.com/snapetech/seerrng/commit/cfbd06063e2a886c7e1878f05201d1ad368f11fe))
- *(ui)* Cover manager blocklist preference - ([ead182d](https://github.com/snapetech/seerrng/commit/ead182d582df7efa235c0139ca4492b912657f06))
- Stabilize ROMarrNG Cypress fixtures - ([a1afb3f](https://github.com/snapetech/seerrng/commit/a1afb3fd9a8724fca96bf3288d885ad16d85f2bd))
- Return nullable settings service fixtures - ([c62f2e7](https://github.com/snapetech/seerrng/commit/c62f2e7b0b04548369b872e3e235e163760fbb20))
- Capture services page state in Cypress failure - ([e99ef8d](https://github.com/snapetech/seerrng/commit/e99ef8d891cc331f05881683ed6e2024fa484ac9))
- Use complete public settings response in services spec - ([7f0d976](https://github.com/snapetech/seerrng/commit/7f0d976c0aebbc42b11ba9ae2c6f42980609236f))
- Isolate override rule data in services spec - ([7a30726](https://github.com/snapetech/seerrng/commit/7a30726feb0b593aec8eb9e54de91727786e97c5))
- Use stable selectors for async settings actions - ([131fe45](https://github.com/snapetech/seerrng/commit/131fe457354482916049db78c9f88d1efe030399))
- Wait for software catalog settings to settle - ([c1322ef](https://github.com/snapetech/seerrng/commit/c1322effffa40761352f3483239619e468dd5192))
- Rate limit game library route harness - ([51fdac1](https://github.com/snapetech/seerrng/commit/51fdac14538bd50cc2349b8af88a42d9a1abcc76))
- Improve route failure diagnostics - ([68baf4a](https://github.com/snapetech/seerrng/commit/68baf4a0c1bf4b9a8ab566b7139dcd577ac16ec9))
- Isolate music fallback service settings - ([8a12560](https://github.com/snapetech/seerrng/commit/8a1256023c0d5e5b4df7a3d53697c182874783c5))
- Repair settings Cypress assertions and fixtures - ([72ea493](https://github.com/snapetech/seerrng/commit/72ea49383c455d8b38ffce4e056fb43ee417a462))

### ⚙️ Miscellaneous Tasks
- Stop publishing the YunoHost package - ([c7a93b8](https://github.com/snapetech/seerrng/commit/c7a93b85c8b57246ce1f48993fea80158c194742))
- Record accepted preview ancestry - ([15e2ce7](https://github.com/snapetech/seerrng/commit/15e2ce7f6f56b1b9c068769c0a5bb118cad41966))
- Record issue-fix branch ancestry - ([81ae0d7](https://github.com/snapetech/seerrng/commit/81ae0d789788dedb365a84e5fe65cf46f4181209))
- Record cross-platform setup ancestry - ([d13a012](https://github.com/snapetech/seerrng/commit/d13a012d9999601e67bbcabc1a03057d69537cae))
- Record romarrng branch ancestry - ([3ee9306](https://github.com/snapetech/seerrng/commit/3ee93068db1e961454d5f1e444f27e88a3962a39))
- Record reader-groupings ancestry - ([d4d580c](https://github.com/snapetech/seerrng/commit/d4d580cbc1d5f098fcb9401ac96c405b3bf21667))

## [3.56.0](https://github.com/snapetech/seerrng/compare/v3.55.1..v3.56.0) - 2026-10-08

### User-facing changes

#### Added

- **Sportarr:** SeerrNG now connects to Sportarr so users can browse sports leagues, request additions, and follow monitored events and available files from league details.
  - **Action required:** Connect Sportarr in Settings > Services to browse and request leagues.

#### Changed

- **Episode Queue:** New TV requests can start with one episode and use linked Plex, Jellyfin, or Emby playback to keep a small Sonarr episode buffer requested. The request screen explains setup requirements, and turning the queue off restores normal season selection.

### 🚀 Features
- Add Sportarr and TV Episode Queue integrations - ([d4c28aa](https://github.com/snapetech/seerrng/commit/d4c28aac7d063cbb6cec28d0b393e9af79bb5c89))

### 🐛 Bug Fixes
- *(appimage)* Load bundled WASM compiler at startup (#178) - ([42397ee](https://github.com/snapetech/seerrng/commit/42397ee61d496337134106ef341a7d8b45ff412b))
- Preserve TV episode selections in queue - ([239fc2e](https://github.com/snapetech/seerrng/commit/239fc2e4a1c98719d0139ca940b75ede5b150ca2))

### 📖 Documentation
- Record hosted Sportarr validation - ([acc51ca](https://github.com/snapetech/seerrng/commit/acc51ca11e340cb782b17e1f407cb7eb2e9824e6))

### 🧪 Testing
- Update Prowlarr sports category fixture - ([630cf23](https://github.com/snapetech/seerrng/commit/630cf235499e5dc1c903c1cf8ac22baa0091be5b))

## [3.55.1](https://github.com/snapetech/seerrng/compare/v3.55.0..v3.55.1) - 2026-10-08

### User-facing changes

#### Changed

- **Contributing:** Maintainer and contributor instructions now avoid duplicate approval gates, scope UI Fix-It to actual interface changes, route final checks through the validation engine, point contributors at SeerrNG's current repository, and keep distributed Mode 3 dormant unless explicitly authorized.
- **Development Validation:** Development validation now stages repository checks, security scans, production builds, and browser tests in one engine. It selects worker limits from available CPUs and execution context, preserves native GitHub jobs, never reuses test results, and limits reuse to a successful same-run build consumed by its dependent browser stage.
- **Development Validation:** Mode 3 distributed validation remains dormant while its controller/node code and regression tests are retained for continued development. It is not connected to application runtime, package scripts, hooks, or GitHub workflows and is not a supported validation path.

#### Fixed

- **Software Acquisition:** ROMarrNG installations using request contract v2 now pass SeerrNG's connection check and use the supported integration API. Legacy ROMarrNG installations remain supported.
- **Maintenance:** Deployment, packaging, and Plex maintenance scripts now use portable macOS and Linux commands, reducing setup and recovery failures on developer systems.
- **External Request Lists:** IMDb watchlists now accept newer `p.*` profile URLs alongside legacy `ur*` links, so profile migrations no longer block list connections.

### 🐛 Bug Fixes
- Support migrated IMDb profile watchlists (#177) - ([481dc9a](https://github.com/snapetech/seerrng/commit/481dc9a1c58bad8e79d57a13ceb0ab76d1497e7a))

## [3.55.0](https://github.com/snapetech/seerrng/compare/v3.54.0..v3.55.0) - 2026-10-08

### User-facing changes

#### Changed

- **Contributing:** Maintainer and contributor instructions now avoid duplicate approval gates, scope UI Fix-It to actual interface changes, route final checks through the validation engine, point contributors at SeerrNG's current repository, and keep distributed Mode 3 dormant unless explicitly authorized.
- **Development Validation:** Development validation now stages repository checks, security scans, production builds, and browser tests in one engine. It selects worker limits from available CPUs and execution context, preserves native GitHub jobs, never reuses test results, and limits reuse to a successful same-run build consumed by its dependent browser stage.
- **Development Validation:** Mode 3 distributed validation remains dormant while its controller/node code and regression tests are retained for continued development. It is not connected to application runtime, package scripts, hooks, or GitHub workflows and is not a supported validation path.

#### Fixed

- **Software Acquisition:** ROMarrNG installations using request contract v2 now pass SeerrNG's connection check and use the supported integration API. Legacy ROMarrNG installations remain supported.
- **Maintenance:** Deployment, packaging, and Plex maintenance scripts now use portable macOS and Linux commands, reducing setup and recovery failures on developer systems.

### 🚀 Features
- *(validation)* Add staged orchestration engine - ([3532635](https://github.com/snapetech/seerrng/commit/35326358b8c28200ef19d1f433c2848ceec1da5d))

### 🐛 Bug Fixes
- *(release)* Support Next.js 16.3.8 in AppImage - ([2d1b9cd](https://github.com/snapetech/seerrng/commit/2d1b9cd56dcffee5814a87454f3833a5590cd7a3))
- *(software)* Accept ROMarrNG request contract v2 (#176) - ([636a70c](https://github.com/snapetech/seerrng/commit/636a70c7ced1675489e6d31addbcefceedaf4881))
- Harden validation test shell fixtures - ([1a9b998](https://github.com/snapetech/seerrng/commit/1a9b998687bf5f10c21549c362ca90137c6f46e4))
- Update workflow boundary marker - ([9216992](https://github.com/snapetech/seerrng/commit/92169929aa00b1901e9dfd3b5877d107edcaa7e9))
- Make maintenance scripts portable across macOS - ([13c47c1](https://github.com/snapetech/seerrng/commit/13c47c1d9549031df4723f213d9f7003807ee746))

## [3.54.0](https://github.com/snapetech/seerrng/compare/v3.53.0..v3.54.0) - 2026-10-07

### User-facing changes

#### Added

- **Bookshelf:** SeerrNG can now search, request, and track ReadMeABook audiobooks, sync a user's Hardcover to-read shelf, and show configurable book and audiobook rows on Discover. Swipe can use favorites or rated library items, and admins can create expiring, single-use sign-in links.

#### Fixed

- **Lidarr:** Lidarr scans now retrieve albums one artist at a time, so large libraries can sync without downloading the entire album collection in one oversized response.
- **Users:** Creating a local user with a password setup link now renders and sends the email successfully, even when the new account has not yet been reloaded from the database.

#### Security

- **Integrations:** Configured audiobook, music, tuner, downloader, and AI integrations now validate request URLs and block redirects before sending credentials. Dependencies with available security fixes have also been updated; no operator action is required.

### 🚀 Features
- Add ReadMeABook and per-user book integration - ([f72d01b](https://github.com/snapetech/seerrng/commit/f72d01b87f76f962dd03da6ad2d4a530d8229edd))

### 🐛 Bug Fixes
- *(docs)* Escape MDX placeholders in maintainer docs - ([1f5f88c](https://github.com/snapetech/seerrng/commit/1f5f88cf37eb57bd70bf9cb69a1e348210108ea3))
- *(security)* Harden configured outbound integrations - ([6ce6e4c](https://github.com/snapetech/seerrng/commit/6ce6e4cd23b3765a9fc885fc64dadb9446334de7))
- Resolve user setup and large Lidarr scan failures - ([e2e85db](https://github.com/snapetech/seerrng/commit/e2e85db567d427c09897ba7190dbb48267c76979))
- Sequence phase 7 migrations after theme adoption - ([2832854](https://github.com/snapetech/seerrng/commit/2832854838e34d696b45732eeafe2ab8dbbf4542))

### 📖 Documentation
- Allow maintainer-approved AI contributions - ([4e279d3](https://github.com/snapetech/seerrng/commit/4e279d3b43baf5a2a26e49b9a32bae8273913fb8))
- Record full phase 7 validation outcome - ([c075117](https://github.com/snapetech/seerrng/commit/c075117220bf2cb04e09da602f7f82e5fdd97faa))
- Record current-main phase 7 handoff - ([ff9295f](https://github.com/snapetech/seerrng/commit/ff9295f58b2964d1897579e29a486b16fb5fee5b))
- Record final phase 7 validation checkpoint - ([bb8d853](https://github.com/snapetech/seerrng/commit/bb8d853ee163fb735d8a08ebad85f12abb646946))
- Record phase 7 integration checkpoint - ([b553669](https://github.com/snapetech/seerrng/commit/b553669523cd5cb3ab65f368719e61cb22a03cc6))

## [3.53.0](https://github.com/snapetech/seerrng/compare/v3.52.1..v3.53.0) - 2026-10-07

### User-facing changes

#### Added

- **Notifications:** Apprise is now a notification agent. An administrator can route Seerr notifications through an Apprise API server to any service Apprise supports, while the destination URLs stay on the Apprise server.
  - **Action required:** Optional. To send through Apprise, add an Apprise API server and a saved configuration key under Settings → Notifications → Apprise.
- **Recordings:** You can now follow sports teams on the Recordings page. SeerrNG requests a recording of each upcoming game that IPTV Tunerr finds in the guide, using the usual approval rules.
  - **Action required:** Optional. Needs IPTV Tunerr sports automation and a connected Tunerr.
- **Media:** Administrators can now connect Jellystat to show lifetime play counts and playback time on titles linked to a Jellyfin item. The connection is read-only.
  - **Action required:** Optional. To show Jellystat play counts, add the Jellystat server and an API key under Settings → Services → Jellystat Statistics.
- **Downloads:** Download progress can now update live. Connect the torrent clients your *arr services use, and Request Status shows current speed, seeds, and progress while you watch, instead of waiting for the next Download Sync. SeerrNG only reads the clients.
  - **Action required:** Optional. To enable it, add your qBittorrent, Transmission, Deluge, or TorrentNG client under Settings → Services → Live Download Progress.
- **Recordings:** Movie and series pages now show when a title airs on Live TV through IPTV Tunerr. People can request a recording of one airing or every airing, with the usual approval rules, and follow it under Recordings.
  - **Action required:** Optional. Connect IPTV Tunerr under Settings → Services → Live TV (IPTV Tunerr); recording needs a Tunerr version with rule-based recording.
- **Comics:** Comic search now falls back to Metron when ComicVine search is unavailable or returns an error. Results come only from series that have a ComicVine ID, so requests keep working with the same identifiers. Comic details still require ComicVine.
  - **Action required:** Optional. To use Metron, create an API token at metron.cloud and enter it under Settings → General → Metron API Token.
- **Music:** Navidrome is now an availability source for music. SeerrNG reads your Navidrome library on a daily schedule and marks albums it finds as available, matched by MusicBrainz ID. The connection is read-only.
  - **Action required:** Optional. To mark albums from Navidrome as available, add the server under Settings → Services → Navidrome Availability.
- **Software:** Available ROM requests now show a DAT Verified badge when ROMarrNG confirms the delivered files match your loaded DATs, and say how many matched when only some did.
- **Software:** ROM requests now show **In RomM Library** once ROMarrNG has placed the finished file in a library folder RomM reads. The badge means the file is in place. RomM may still need to scan before the game appears.
- **Downloads:** Live download progress now supports rTorrent. SeerrNG reads speed, progress, and peer counts from rTorrent's XML-RPC interface in one request per refresh, and it never adds, changes, or removes torrents.
  - **Action required:** Optional. To read progress from rTorrent, add it under Settings → Services → Live Download Progress and enter its XML-RPC endpoint, which is usually a ruTorrent /RPC2 path.
- **Downloads:** Live download progress now supports SABnzbd. Usenet downloads show progress, speed, and time remaining while you watch them. SeerrNG reads the queue and never changes it. SABnzbd reports one overall speed, so that speed appears on the first item that is downloading.
  - **Action required:** Optional. To read progress from SABnzbd, add it under Settings → Services → Live Download Progress with its API key.
- **Soulseek:** SeerrNG can now request single tracks from Soulseek through slskdN, including playlist tracks with no album match, let managers fix albums slskdN flags as transcoded or incomplete, and identify songs with SongID.
  - **Action required:** Optional. Connect slskdN under Settings → Services → Soulseek (slskdN) with a read-write API key.
- **Discovery:** New Swipe page: swipe right to request, left to pass, or up if you have already seen it, through movies, series, and books picked from your requests and swipes. Administrators can optionally let Claude order each deck and explain the picks.
- **Discovery:** Swipe AI ordering now also works with OpenAI and OpenAI-compatible servers such as Ollama and LM Studio, so decks can be ordered by a local model without sending anything outside your network.
  - **Action required:** Optional. Choose OpenAI or compatible under Settings → Services → Swipe Discovery.

#### Changed

- **Comics:** The comics guide now explains when BackIssue suits reading and shared household libraries, and when Mylar3 or Kapowarr suit automated downloads.
- **Downloads:** Administrators now see which download client is handling each download, such as a ChaptarrNG direct download or a torrent client, beside its queue status.
- **Themes:** New installations and upgrades adopt the SeerrNG theme once, resetting older active theme customizations. After signing in, users can choose another theme or customize it; their new account preference survives future logins and upgrades.

#### Fixed

- **Downloads:** Live torrent progress now reaches regular users through private subscription IDs, and stale figures clear when a client stops reporting a torrent.
- **Database:** PostgreSQL startup now accepts the reader delivery and private game library date columns, so these features no longer prevent the application from starting.

#### Security

- **Dependencies:** Bumped `sharp`, `source-map-js`, and `proxy-addr` to their patched releases, clearing the CVEs the published container image's vulnerability scan was flagging.

#### Deprecated

- **Distribution:** **Breaking:** SeerrNG no longer publishes or updates its YunoHost package. Existing installations remain on their last published package; operators should move to a supported deployment or maintain package updates independently.
  - **Action required:** Move existing installations to a supported deployment or arrange independent package maintenance.

### 🚀 Features
- *(comics)* Add Metron as a comic search fallback - ([7a00f59](https://github.com/snapetech/seerrng/commit/7a00f591e5695958c3dc9a9765ce04cc3be3eab1))
- *(downloads)* Add SABnzbd live download progress - ([884ae47](https://github.com/snapetech/seerrng/commit/884ae47cfef235f825cf04b8f271767533e26698))
- *(downloads)* Add rTorrent live download progress - ([048be69](https://github.com/snapetech/seerrng/commit/048be698786a1f1c2d2fc0882e5d679198c53b91))
- *(media)* Show Jellystat watch activity on Jellyfin titles - ([48e8b29](https://github.com/snapetech/seerrng/commit/48e8b29dc5e37663f42c1351f2fcca9f1296f059))
- *(music)* Add Navidrome as an availability source - ([2408f86](https://github.com/snapetech/seerrng/commit/2408f86f9213614256e7386aa4aeedcb2b1a73d9))
- *(notifications)* Add Apprise notification agent - ([b37321c](https://github.com/snapetech/seerrng/commit/b37321cbf1a24f2af24d5bbc20295b525b341dd3))
- *(software)* Show when ROM files are in a RomM library - ([6e0132e](https://github.com/snapetech/seerrng/commit/6e0132ed45c137a169eb21dd904fbc9e391c3eed))
- *(test-engine)* Make worker defaults operator-aware - ([8e7d81c](https://github.com/snapetech/seerrng/commit/8e7d81c6429830ce2143bd243977c3c8e220da81))
- *(ui)* Integrate accepted preview and one-time SeerrNG theme adoption - ([dee61ab](https://github.com/snapetech/seerrng/commit/dee61ab886be2dc37925520fd3f52c8d6ba0048a))
- Support OpenAI and compatible servers for swipe ordering - ([cb11482](https://github.com/snapetech/seerrng/commit/cb11482dd432bdf86b71a8d7aea14af19d26ffe7))
- Add the Swipe page for movies, series, and books - ([fbb5a72](https://github.com/snapetech/seerrng/commit/fbb5a727542f4fcda88fb243f691b01a8925ba78))
- Add swipe discovery decks with optional Claude ranking - ([a10aac5](https://github.com/snapetech/seerrng/commit/a10aac5b7a5e202e28b345c0c6cea78357f22423))
- Record followed sports teams' games through Tunerr - ([068221d](https://github.com/snapetech/seerrng/commit/068221da5620086a360ac0d9773602096bfb1e0e))
- Show ROMarrNG DAT verification on available ROM requests - ([d0891b6](https://github.com/snapetech/seerrng/commit/d0891b64f37b4c9bfd915ae94eaaaa1bc9f9df2c))
- Show the download client handling each download to admins - ([97b17ed](https://github.com/snapetech/seerrng/commit/97b17ed7ac47cf1ec0fcd5212db3776897323cb9))
- Add Soulseek request, album health, and SongID UI - ([0162d13](https://github.com/snapetech/seerrng/commit/0162d134128c726c02d40f3be26fe0d62045d57a))
- Add Soulseek track requests, album fixes, and SongID via slskdN - ([3d86958](https://github.com/snapetech/seerrng/commit/3d869585f33d9e814d96c885f0e342f19b6c149e))
- Add Live TV airing and recording UI - ([782ce5d](https://github.com/snapetech/seerrng/commit/782ce5d72752caaa751e4bd3a0d16a2b6de9211b))
- Add Live TV recording requests through IPTV Tunerr - ([7e5db5e](https://github.com/snapetech/seerrng/commit/7e5db5ec333178583bd1601196ff4df64dd6b0a8))
- Add live torrent download progress - ([3af6131](https://github.com/snapetech/seerrng/commit/3af6131285272973733e510989f271f46d974bd7))

### 🐛 Bug Fixes
- *(db)* Support PostgreSQL private library timestamps - ([0980bc5](https://github.com/snapetech/seerrng/commit/0980bc5d1db052f566cd97b46b98a89149a34952))
- Patch image CVEs and stabilize Prowlarr test - ([9773903](https://github.com/snapetech/seerrng/commit/9773903dfeff38df87d1232b80548c9213b64436))
- Deliver live download progress to regular users - ([d6176bd](https://github.com/snapetech/seerrng/commit/d6176bd7c310c3e4bef96a3aa4ac37f039e84b66))
- Prevent login backdrop title overflow - ([7ef38f1](https://github.com/snapetech/seerrng/commit/7ef38f1750e63917f7beae8c441ad4c4dc630538))

### 📖 Documentation
- *(downloads)* Document rTorrent and TorrentNG client choices - ([4cecbf9](https://github.com/snapetech/seerrng/commit/4cecbf9f42821d2216e0fd52ecb9a7034a03d0d3))
- *(maintainers)* Record PostgreSQL issue 164 verification - ([749b3b5](https://github.com/snapetech/seerrng/commit/749b3b541f54f5f3a5edc7f2e8ad00f6118cfe27))
- *(maintainers)* Update market research status after implementation - ([1305bde](https://github.com/snapetech/seerrng/commit/1305bdefe82a8fbc17dd2116317563f38d83a152))
- *(maintainers)* Record market research and implementation status - ([9e9f7e6](https://github.com/snapetech/seerrng/commit/9e9f7e6816cdae338ebe3eebcc34564e10aa691f))
- Record Prowlarr mock failure root cause - ([0bbba07](https://github.com/snapetech/seerrng/commit/0bbba079ed2a75e471b2b6cd033d56a78ae34ab9))
- Plan remaining ReadMeABook features - ([03d8d34](https://github.com/snapetech/seerrng/commit/03d8d34cbcea3f1d50d239fcbd407d51e0301258))
- Propose fastest-source routing design - ([c037cb7](https://github.com/snapetech/seerrng/commit/c037cb764de5a4248265344e1e97003d14a5af70))
- Record Tunerr recording-rule fork progress - ([c3e222f](https://github.com/snapetech/seerrng/commit/c3e222f295d24ab73f5551634e5cd2c38a590af6))
- Record PR 162 integration validation - ([59c2733](https://github.com/snapetech/seerrng/commit/59c2733c15155a0be7a861fe5ec17ef3ab863129))
- Remove named visual acceptance gate - ([b46ebfd](https://github.com/snapetech/seerrng/commit/b46ebfdc6c5e7d7f483f863523f179c1cb27735e))

### 🚜 Refactor
- *(livetv)* Route Live TV through a provider interface - ([7e944c3](https://github.com/snapetech/seerrng/commit/7e944c3f53d632f92485d856c0eb6fa30f8bdafe))

### 🧪 Testing
- *(cypress)* Preserve settings API response shapes - ([714db49](https://github.com/snapetech/seerrng/commit/714db4917a3ddcec17d83c94a27134d81bbe76a8))
- *(cypress)* Return explicit Prowlarr response bodies - ([cde107d](https://github.com/snapetech/seerrng/commit/cde107d07819ae46f72674e58049806e372bacd6))
- *(cypress)* Wait for Prowlarr settings load - ([cee6572](https://github.com/snapetech/seerrng/commit/cee6572ff86c9765d9ad89dfaaa5ea12626885a2))
- *(release)* Make archive fixtures platform-independent - ([e87fef1](https://github.com/snapetech/seerrng/commit/e87fef1e4374eadf0b3e15667eb57f44ccc5a6ff))
- *(theme)* Persist palette fixtures through account settings - ([8a51821](https://github.com/snapetech/seerrng/commit/8a51821ee17d21e8d2fb5edca3cca2af1b97fc7d))
- *(ui)* Remove unused provider notice helper - ([c060df0](https://github.com/snapetech/seerrng/commit/c060df0870655421dd1b40f96d3d93fb564c9658))

### ⚙️ Miscellaneous Tasks
- *(yunohost)* Align package with v3.52.1 - ([c1c66f6](https://github.com/snapetech/seerrng/commit/c1c66f6d3d0bf82b4474b042d5816f4f744d8acc))
- Stop publishing the YunoHost package - ([0fded66](https://github.com/snapetech/seerrng/commit/0fded66830104a30c97398b09300cb89424b038f))
- Merge main into theme adoption preview - ([8c341f4](https://github.com/snapetech/seerrng/commit/8c341f4c1d38988b3de1f5775954cbca18e25596))
- Preserve accepted preview integration checkpoint - ([d933813](https://github.com/snapetech/seerrng/commit/d9338138acf269a37018d2fedc7b7daa8dce2d2d))


## New Contributors ❤️
* @kpmckellar made their first contribution
* @codex made their first contribution

## [3.52.1](https://github.com/snapetech/seerrng/compare/v3.52.0..v3.52.1) - 2026-10-05

### User-facing changes

#### Changed

- **Performance:** The English interface no longer downloads the full translation catalog during startup, trimming the initial JavaScript payload while keeping English labels available through their built-in message fallbacks.

### 🐛 Bug Fixes
- *(performance)* Reduce shared app startup bundle - ([1ab58bd](https://github.com/snapetech/seerrng/commit/1ab58bd863cf1927b4f15851b121f8471d173c64))

### ⚙️ Miscellaneous Tasks
- *(yunohost)* Align package with v3.52.0 - ([6d54a07](https://github.com/snapetech/seerrng/commit/6d54a07bce12e222096a9ba5a34add8709bd39e8))

## [3.52.0](https://github.com/snapetech/seerrng/compare/v3.51.0..v3.52.0) - 2026-10-05

### User-facing changes

#### Added

- **Games:** My Games now tracks ownership, progress, and Steam playtime alongside software requests. Link Steam to import your library, then choose which owned titles to share and find games multiple household members can play.
  - **Action required:** Configure an optional Steam Web API key to enable imports.
- **Requests:** Connect a public IMDb watchlist or Goodreads to-read shelf to your account. New titles are checked daily and enter your normal request flow, honoring your permissions, quotas, and approval settings.
- **Bookshelf:** Readers can open the selected Grimmory or BookOrbit library, use its supported ebook, audiobook, comic, and PDF readers, or download available requested files to the current device. Administrators can preview and manage live author and series shelves, including public OPDS scopes and BookOrbit Kobo sync scopes.

#### Changed

- **Settings:** The About page and README now offer Ko-fi as SeerrNG's only development donation link.
- **Books:** The README and Bookshelf guides now link to ChaptarrNG's fork feature overview and summarize its format-aware request tracking, restricted service key, and supported workflows.

#### Fixed

- **Bookshelf:** Audiobookshelf library scans now reject inconsistent, duplicate, or oversized pages before orphan cleanup runs, preventing incomplete provider responses from incorrectly removing items from SeerrNG's library index.
- **Reader Apps:** Reader app settings now give each service room for its details and keep generated addresses separate from their copy actions, making setup easier to follow.
- **Requests:** Pending requests can now be edited from the management panel even when the API omits the request's media back-reference, so administrators can correct routing without reopening the request.
- **Software Search:** PC game searches now fall back to QuestarrNG’s unpaged catalog when the paged endpoint rejects a query, keeping valid game results available during provider incompatibilities.

### 🚀 Features
- Add per-user external request list sync - ([b7b01cf](https://github.com/snapetech/seerrng/commit/b7b01cf89f8fb832fa8744a4ea63562775e65702))
- Add private game libraries and robust software search - ([a393ab9](https://github.com/snapetech/seerrng/commit/a393ab927550b5069078e24b67db2ca66c44e0cc))
- Add Grimmory and BookOrbit reader delivery - ([23e84d7](https://github.com/snapetech/seerrng/commit/23e84d7aa462d6da6c5293fa8d84b2adfe11e282))

### 🐛 Bug Fixes
- Improve reader app settings layout - ([752e6b6](https://github.com/snapetech/seerrng/commit/752e6b651dc30cf57b7e00b5c6d3ae5a0ec1211a))
- Preserve edit actions for requests without linked media - ([9e46eca](https://github.com/snapetech/seerrng/commit/9e46eca5d3713ad5c40334da1e67c25f25a0c07a))
- Bound and validate Audiobookshelf library scans - ([7cfac90](https://github.com/snapetech/seerrng/commit/7cfac9071bbd30ce3ac2c947309649148117c769))

### 📖 Documentation
- Record final reader settings verification - ([532700b](https://github.com/snapetech/seerrng/commit/532700b11958e5bd3a25a5a7dbd0810f1e3317f0))
- Record integration ledger and generated API contract - ([bace25a](https://github.com/snapetech/seerrng/commit/bace25a5e2146782a57a4268f0c60f6bcae461c3))
- Document ChaptarrNG integration capabilities - ([f32232a](https://github.com/snapetech/seerrng/commit/f32232a58972e70e7d7862ef3199e3a33b662c50))

### ⚙️ Miscellaneous Tasks
- *(yunohost)* Align package with v3.51.0 - ([4665245](https://github.com/snapetech/seerrng/commit/4665245f97a90d546a94eb25fdcd4c91104bfd7b))
- Use Ko-fi as the sole support link - ([b4bb494](https://github.com/snapetech/seerrng/commit/b4bb494bada4f01a9334c7e8aa303c2fab28c521))

## [3.51.0](https://github.com/snapetech/seerrng/compare/v3.50.0..v3.51.0) - 2026-10-04

### User-facing changes

#### Changed

- **Software Requests:** PC game details show IGDB community play-time estimates, and catalog availability separates QuestarrNG files, tracked games, and verified Steam library matches. Multi-file requests offer a compressed Download all files option while preserving individual downloads.
  - **Action required:** Update QuestarrNG to request contract version 2 for play-time estimates and multi-file bundles.

#### Fixed

- **Requests:** The Requests badge now refreshes while SeerrNG stays open, so server-side request updates do not leave an outdated approval count in the sidebar.

### 🚀 Features
- *(integration)* Extend SeerrNG software acquisition - ([ccf9004](https://github.com/snapetech/seerrng/commit/ccf900453d63a09431b82bef635331ea9f505422))

### 🐛 Bug Fixes
- *(requests)* Refresh pending badge count - ([5c2bdd3](https://github.com/snapetech/seerrng/commit/5c2bdd3dd34c3b93225ae6295edd95f4c5b0ac25))

### 🎨 Styling
- Format ChaptarrNG integration smoke script - ([b0c8ffc](https://github.com/snapetech/seerrng/commit/b0c8ffcbf883b09ac16f2c2c6c2dd250a2a480fc))

### 🧪 Testing
- Align book API key helper assertion - ([06fbbce](https://github.com/snapetech/seerrng/commit/06fbbce72260a08f36139af5dcd94dcda0bd481f))

### ⚙️ Miscellaneous Tasks
- *(yunohost)* Align package with v3.50.0 - ([d6b11b6](https://github.com/snapetech/seerrng/commit/d6b11b6fe218e00fcc0efa586bea8a0b4e73712f))
- Integrate latest request count refresh from main - ([9403246](https://github.com/snapetech/seerrng/commit/9403246fdbd992a9be13b26c2b7c00849a93355b))
- Integrate latest SeerrNG main - ([98de362](https://github.com/snapetech/seerrng/commit/98de362a21c05eec96d78f47d9a3e2bf9e0c470a))
- Integrate SeerrNG main v3.50.0 - ([8551d8b](https://github.com/snapetech/seerrng/commit/8551d8b505ade9286a4bf76e754a11367a8ea079))

## [3.50.0](https://github.com/snapetech/seerrng/compare/v3.49.0..v3.50.0) - 2026-10-04

### User-facing changes

#### Added

- **Books:** Connect a read-only Audiobookshelf book library to show ISBN-matched audiobooks as available in SeerrNG. The integration scans inventory only and never changes Audiobookshelf items.

#### Changed

- **Bookshelf:** Requests waiting for ChaptarrNG author preparation now show the book format, retry count, and next scheduled retry when the server provides that information. ChaptarrNG operators can also use a dedicated SeerrNG service key.

#### Fixed

- **Bookshelf:** SeerrNG now uses BookshelfNG's ebook and audiobook file counts independently when syncing service status, while older Readarr-compatible services keep using aggregate counts.

### 🚀 Features
- Integrate ChaptarrNG and Audiobookshelf - ([e9d2e50](https://github.com/snapetech/seerrng/commit/e9d2e50f2b446a70e01f5b16af8bc8265ed99b3e))

### 🐛 Bug Fixes
- *(release)* Pin AppImage builder version - ([b439984](https://github.com/snapetech/seerrng/commit/b439984ea5035854722ee331cc2c4c81cf3b5ce1))

## [3.49.0](https://github.com/snapetech/seerrng/compare/v3.48.3..v3.49.0) - 2026-10-04

### User-facing changes

#### Fixed

- **Bookshelf:** SeerrNG now uses BookshelfNG's ebook and audiobook file counts independently when syncing service status, while older Readarr-compatible services keep using aggregate counts.

### 🚀 Features
- *(bookshelf)* Consume format-specific availability - ([4ebf46b](https://github.com/snapetech/seerrng/commit/4ebf46b932637c87c2077274af4df94d744470ae))

### ⚙️ Miscellaneous Tasks
- *(yunohost)* Align package with v3.48.3 - ([a96fafa](https://github.com/snapetech/seerrng/commit/a96fafa07c77a2d6d95badeb9f60c32a6b4a47c9))

## [3.48.3](https://github.com/snapetech/seerrng/compare/v3.48.2..v3.48.3) - 2026-10-04

### User-facing changes

#### Changed

- **Yunohost:** Until YunoHost approves SeerrNG for its app catalog, the installation instructions use the testing package branch so new installs receive the current published SeerrNG release.
  - **Action required:** Use the testing branch URL for new installations until catalog approval.

#### Security

- **Bookshelf:** BookshelfNG connections now send API keys in the `X-Api-Key` header, so servers that reject query-string keys can be tested and used successfully. API keys are no longer added to request URLs.

### 🐛 Bug Fixes
- *(bookshelf)* Send Servarr API keys in headers - ([346f167](https://github.com/snapetech/seerrng/commit/346f16700fe370ecf94e35cf067004bd199c85a0))

### 📖 Documentation
- *(yunohost)* Point pending installs to testing - ([33899cf](https://github.com/snapetech/seerrng/commit/33899cff08ad730a24f75c46af5356563d566f8b))

### 🧪 Testing
- *(e2e)* Remove Cypress server alias import - ([9c6a4bd](https://github.com/snapetech/seerrng/commit/9c6a4bd7ea89ebcdec6a67fea73e2346c0499f4d))
- *(e2e)* Pin permission state in Cypress setup - ([7b4e1b4](https://github.com/snapetech/seerrng/commit/7b4e1b48e8271f4ffd90a97d4b224319f09898d9))

### ⚙️ Miscellaneous Tasks
- *(yunohost)* Align package with v3.48.2 - ([fff85a9](https://github.com/snapetech/seerrng/commit/fff85a9e7a146500aab57f0fa4253ff33d5f2a39))

## [3.48.2](https://github.com/snapetech/seerrng/compare/v3.48.1..v3.48.2) - 2026-10-04

### User-facing changes

#### Fixed

- **Metadata:** Movie and series cards can now use TVDB or TVmaze posters when TMDB artwork is missing or unavailable. SeerrNG saves verified backup artwork in its image cache so posters keep loading through later provider outages.

### 🐛 Bug Fixes
- *(media)* Cache fallback video posters - ([68d780e](https://github.com/snapetech/seerrng/commit/68d780ebd90216863788b74c96b4147d81f85e4d))

### 🧪 Testing
- *(e2e)* Stub discovery detail responses - ([1042f14](https://github.com/snapetech/seerrng/commit/1042f1429008315b2f8abccf1c4cc4c56a7a7a94))

### ⚙️ Miscellaneous Tasks
- *(yunohost)* Align package with v3.48.1 - ([277d76f](https://github.com/snapetech/seerrng/commit/277d76f9dc1328264b7d77f5097178af65b0174f))

## [3.48.1](https://github.com/snapetech/seerrng/compare/v3.48.0..v3.48.1) - 2026-10-03

### User-facing changes

#### Changed

- **Packaging:** YunoHost packages now follow stable SeerrNG releases with matching archive checksums, so new installs use the same build and version as GitHub releases.

### 🐛 Bug Fixes
- *(ci)* Tighten YunoHost sync workflow - ([8ed171b](https://github.com/snapetech/seerrng/commit/8ed171b8bdee1ea7cff37e67970eadc274df3827))
- *(yunohost)* Sync package releases automatically - ([780c77b](https://github.com/snapetech/seerrng/commit/780c77b5269ce1c5a47580b9fa3f23215ddf2c49))

### 🧪 Testing
- *(release)* Include YunoHost sync in final release gate - ([fbca81d](https://github.com/snapetech/seerrng/commit/fbca81da7999491d332de8822f37e4df07a78c88))

## [3.48.0](https://github.com/snapetech/seerrng/compare/v3.47.0..v3.48.0) - 2026-10-03

### User-facing changes

#### Added

- **Media Server:** Series details now offer an expandable season/episode selection tree and per-user disclosure ordering. Linked users can manage the Series in Plex Watchlist, Jellyfin/Emby Favorites, and existing authorized server Collections without creating Collections or changing download requests.

#### Changed

- **Development:** Interface guidance separates focused checks from cumulative review, preserves Requests and shared visual roles alongside Series changes, and supplies an integration checklist. Unrelated backend failures require scope review. Before expensive cumulative runs, contributors verify complete repository fixtures and native tooling; an app snapshot alone is insufficient.
- **Development:** `pnpm validate:development` provides an explicit comprehensive gate for existing tests and visual regressions. Public builds retain translation and shared-visual checks, while the commit hook retains attribution and staged lint checks. Portable agent instructions route contributors through the separate UI standards, repair procedure and forward-merge guide. Existing GitHub workflows are unchanged.
- **Series:** Series Overview now expands below a pinnable, reorderable button row and defaults to the left. Metadata sources and production credits are grouped at the bottom of Details.
- **Series:** Series Details now opens the request screen from one Request button, with HD and 4K selection available inside the screen.
- **Development:** Ordinary commands retain upstream validation. Builds still check translations and approved visual contracts. The comprehensive runner remains available explicitly, instead of repeating every test during builds and commits. Commit-message checks use the pinned package manager to avoid an incompatible bundled npm launcher.

#### Fixed

- **Interface:** Browse filters, titles and loading states retain shared styling. Request pins expand and collapse correctly. Series browsing gains a yellow watchlist visibility action. Series requests reuse the season/episode tree with existing submission rules and a compact Episode Queue beside it. Missing metadata blocks submission until recovered. Streaming-service choices retain accessible native controls.
- **Media Server:** Plex Series Watchlist and Collection actions now refresh membership correctly. Compatible Collections are recognized, and removal affects only the selected item's membership. Playback menus use the shared solid-black surface and open above their card frame without clipping.
- **Interface:** Single-option Request controls now use the same shared icon sizing as multi-option Quality/Request controls, instead of a competing local utility.
- **Requests:** Requests dropdowns, pagination, filter disclosures, card surfaces and tooltips use shared native styling, preserving geometry, palette variants and keyboard focus while respecting reduced motion. Software request cards reuse shared padding and card-spacing rules.
- **Requests:** Recent Requests loading placeholders now match the compact cards at narrow and wide screen sizes, keeping the slider consistent as items load.
- **Requests:** Requesters can again fail a downloading release and start a replacement search from its request card. Discover now respects the hide-blocklisted setting for managers as well as ordinary users, without changing the approved compact controls.
- **Discovery:** Movie discovery now keeps saved Popular and Upcoming cards available during TMDB outages, and expired metadata no longer discards poster URLs that can still load from SeerrNG’s image cache.
- **Media Details:** Native saved actions recognize the signed-in user's linked media account and show specific unavailable-state help. Media Server buttons align left, overview paragraphs are justified, and Discover headings avoid duplicate spacing.
- **Requests:** Retrying a failed request now records a waiting-for-dispatch history entry instead of leaving stale download progress in its latest visible status.
- **Interface:** Series request summaries, advanced options and quality controls now reuse shared interface styling, keeping compact dropdowns, table text and card alignment consistent.

### 🚀 Features
- *(ui)* Integrate shared visuals and native series controls - ([05fe80e](https://github.com/snapetech/seerrng/commit/05fe80e9549904232a42f61cf71f2974136792fb))
- *(ui)* Preserve shared visuals and native series actions - ([6a7b058](https://github.com/snapetech/seerrng/commit/6a7b058b650445ba06bc25acaa40f7710855e8b5))
- *(ui)* Preserve shared visuals and native series actions - ([4639a76](https://github.com/snapetech/seerrng/commit/4639a761316d11036696f5bc985b995bf58a50cb))

### 🐛 Bug Fixes
- *(discover)* Keep movie shelves and posters during outages - ([a59d744](https://github.com/snapetech/seerrng/commit/a59d74479579ddc06b877ecbf5392f4fdd681189))
- *(tooling)* Preserve UI contracts and current browser fixtures - ([509b8cf](https://github.com/snapetech/seerrng/commit/509b8cf69d66efebcc180188295f52d1784dcb62))
- *(ui)* Restore request actions and reconcile browser contracts - ([088ed0c](https://github.com/snapetech/seerrng/commit/088ed0c3280f6c9bc569d5c9c0ac91dbce9ecc43))

### 🧪 Testing
- *(cypress)* Prevent cached metadata from bypassing intercepts - ([0203f79](https://github.com/snapetech/seerrng/commit/0203f798c5c84ceb984629df2353c60705924674))

## [3.47.0](https://github.com/snapetech/seerrng/compare/v3.46.1..v3.47.0) - 2026-10-03

### User-facing changes

#### Added

- **Bookshelf:** SeerrNG now detects BookshelfNG's versioned capability response and uses its ebook or audiobook API route when available, while retaining standard Readarr routes for older BookshelfNG releases.

#### Changed

- **Bookshelf:** SeerrNG now reads ChaptarrNG's explicit capabilities contract to select its provider-ID dialect, while older Chaptarr builds keep using the existing settings fallback.
- **Bookshelf:** SeerrNG's guide now documents the restricted BookshelfNG key's exact permissions for builds that support it, including allowed reads, author/book changes, one-book searches, and excluded system, key-management, command, and delete operations.

#### Fixed

- **Integration:** ROMarrNG providers using the legacy contract can now browse the catalog through the matching legacy routes. Unknown contract versions fail clearly instead of silently falling back to an incompatible API.

#### Security

- **Metadata:** External video summaries now decode encoded markup only once, and Wikidata search snippets preserve unrecognized markup as text instead of using broad tag removal.

### 🚀 Features
- *(integrations)* Negotiate provider capability contracts - ([e0dab7a](https://github.com/snapetech/seerrng/commit/e0dab7a8caf9ce64dd1f933fa704098bf175da44))

### 🐛 Bug Fixes
- *(metadata)* Avoid double-decoding external markup - ([73c6e58](https://github.com/snapetech/seerrng/commit/73c6e582d8f4a293da97951abb52d2d0cad9dcc3))

### 📖 Documentation
- *(bookshelf)* Note restricted key availability - ([2b1c7db](https://github.com/snapetech/seerrng/commit/2b1c7dba4fc59facd77bd6876fa43a5970601b25))
- *(bookshelf)* Document restricted key access - ([744ce1b](https://github.com/snapetech/seerrng/commit/744ce1b0f0ae9d45982f792269e0a0eb5400c6e2))
- *(release)* Document BookshelfNG API key scope - ([c295bfd](https://github.com/snapetech/seerrng/commit/c295bfdee3dec3cd1e43841774d1d8a7e3310ced))

## [3.46.1](https://github.com/snapetech/seerrng/compare/v3.46.0..v3.46.1) - 2026-10-02

### User-facing changes

#### Fixed

- **Bookshelf:** Book requests now start a Bookshelf search even when the requested title is already monitored, so an existing entry cannot silently skip acquisition.

### 🐛 Bug Fixes
- *(bookshelf)* Search already monitored requests - ([137480f](https://github.com/snapetech/seerrng/commit/137480f5164ed71421a3edbae11ce51ea2f1b0d8))

### 🧪 Testing
- *(bookshelf)* Verify BookSearch dispatch for monitored requests - ([7ee1c55](https://github.com/snapetech/seerrng/commit/7ee1c556b01a0592ebf25a9008ee27a5b2e6d4b6))
- *(bookshelf)* Cover search for monitored requests - ([22c80d9](https://github.com/snapetech/seerrng/commit/22c80d9c15bed507d42fda1f2d1eb4ad1d0d3acc))

## [3.46.0](https://github.com/snapetech/seerrng/compare/v3.45.3..v3.46.0) - 2026-10-02

### User-facing changes

#### Added

- **Metadata:** Movie and series details now combine missing metadata from TMDB, TheTVDB, TVmaze, and Wikidata. Source records expire within six months, refresh independently, and show unobtrusive attribution, including TVmaze's adapted CC BY-SA 4.0 data; TMDB's logo and non-endorsement notice appear in About.

#### Fixed

- **Packaging:** SeerrNG's Chocolatey package is now submitted after its GitHub release is public, so users do not receive packages that point to unavailable release files.
- **Metadata:** Movie and series cards now keep saved titles, descriptions, availability, and posters visible during metadata-provider failures, and only show “Not Found” for a confirmed missing record.
- **Metadata:** Movie and series pages now mark a title as missing only when TMDB confirms it and other sources have no match. Concurrent refreshes also keep provider snapshots in the six-month cache.
- **Metadata:** Cards for titles confirmed missing by TMDB now show the missing-title message even when the library retains request status; saved details remain available when a provider is temporarily unavailable.
- **Metadata:** Provider-sourced movie and series titles now remain visible when their TMDB detail lookup returns 404, so valid external-ID matches are not replaced with a missing-title card.
- **Metadata:** Provider-matched movie and series titles now appear as soon as a discovery result loads, while richer catalog details finish loading.

### 🚀 Features
- *(metadata)* Merge movie and series metadata sources - ([575e7f7](https://github.com/snapetech/seerrng/commit/575e7f72c8fba5c73de4029d04185fdae421f028))

### 🐛 Bug Fixes
- *(release)* Publish Chocolatey only with live assets - ([ce4d802](https://github.com/snapetech/seerrng/commit/ce4d802b8e7af62e349dda221be7f81be7d34c39))
- *(metadata)* Handle confirmed missing IDs and concurrent refreshes - ([12339f8](https://github.com/snapetech/seerrng/commit/12339f8f043fdab47f6c5c2c550c2c72cc7acf08))
- *(metadata)* Show not-found state for confirmed missing titles - ([3b54e6b](https://github.com/snapetech/seerrng/commit/3b54e6b1a21762bd7f23420ed0c4f526ca8efc17))
- *(metadata)* Preserve exact provider title fallbacks - ([950cef9](https://github.com/snapetech/seerrng/commit/950cef9dd98415a9cf4ee7cf18ea600bc577059c))
- *(metadata)* Show matched titles while details load - ([622f037](https://github.com/snapetech/seerrng/commit/622f03766bc1782c6b124fcd431e2ce9ad490e47))
- Preserve cached video metadata on provider failures - ([adfb47e](https://github.com/snapetech/seerrng/commit/adfb47e5401e0750c028eac26b8b69f73db4bcec))

## [3.45.3](https://github.com/snapetech/seerrng/compare/v3.45.2..v3.45.3) - 2026-10-02

### User-facing changes

#### Added

- **Integrations:** The new companion-services guide compares optional providers by media type and explains which Snapetech NG forks supply SeerrNG-specific book and software workflows.

#### Changed

- **Watch Ahead:** The TV episode queue guide now covers Plex, Jellyfin, and Emby playback. Each request remains Off by default, and turning it on only queues missing episodes in that request's Sonarr destination.

#### Fixed

- **Release Pipeline:** The Windows ARM64 release now uses the correct architecture name for its download and archive contents, so Windows on ARM devices can select the native build.
- **Bookshelf:** Bookshelf-only book requests now show their catalog details in Requests, and their request notifications can be delivered without an Open Library identifier.
- **Packaging:** Linux AppImage releases now build SQLite against the supported GLIBC baseline, keeping the download usable on older compatible Linux systems.
- **Release Notes:** The About page can now load published release notes instead of having its GitHub request blocked by the browser security policy.
- **Profile:** The Advanced Theme tab now opens from every self-profile settings route instead of leading to a missing page.
- **Search:** Opening Search with no query now lands directly on the ready-to-use search page instead of flashing a loading state.

### 🛡️ Security
- Resolve Playwright audit findings - ([c59226a](https://github.com/snapetech/seerrng/commit/c59226a14e645f67a0eb1672c33fa33f46eec68e))

### 🐛 Bug Fixes
- *(books)* Support Bookshelf-only request details - ([2e38ff5](https://github.com/snapetech/seerrng/commit/2e38ff5967e9f5f084134fd48ba74374e0fed3f0))
- *(release)* Verify published Launchpad binaries - ([0b2db7d](https://github.com/snapetech/seerrng/commit/0b2db7d301ab3ef7eccdd6237b2b56e13179c455))
- *(release)* Reuse successful package workflows during recovery - ([35b19f4](https://github.com/snapetech/seerrng/commit/35b19f496bc54c6dc3ae7a25c4a43630da3de302))
- *(release)* Build AppImage SQLite for the supported glibc baseline - ([28d357b](https://github.com/snapetech/seerrng/commit/28d357b474dc04b646481532f0d980950c3ad0ea))
- *(release)* Reuse verified Windows ARM64 assets on recovery - ([f29ebc3](https://github.com/snapetech/seerrng/commit/f29ebc3f09d5595eaccd9abc60c1b7a967433eb9))
- *(release)* Recover verified assets and fan out package channels - ([45b8343](https://github.com/snapetech/seerrng/commit/45b8343493809a0e68e32df1ea6a09c9c96bb6f8))
- *(release)* Resolve AppImage package metadata from filesystem - ([3770591](https://github.com/snapetech/seerrng/commit/37705916422ae43d5f210bd1fe7181d7e699f150))
- *(release)* Correctly target Windows ARM64 artifacts - ([66b7973](https://github.com/snapetech/seerrng/commit/66b7973d0e7fcc53e0589a7db24e9ba83dec697b))
- *(release)* Isolate artifacts before checksum checks - ([3a558b8](https://github.com/snapetech/seerrng/commit/3a558b85c429532e0d1d571889daea7dc7664ebd))
- *(release)* Recover failed Windows asset builds - ([ac57b31](https://github.com/snapetech/seerrng/commit/ac57b31c7331e1f4afb8854944dce40f39f2a2ca))

### 📖 Documentation
- Clarify opt-in TV episode queue - ([bf319b2](https://github.com/snapetech/seerrng/commit/bf319b29b56e169d857b644523eae60b416fb5d8))
- Document optional SeerrNG companion forks - ([e9119fd](https://github.com/snapetech/seerrng/commit/e9119fdd937a7bf810c473f506dc6c9d2061d62a))

### ⚡ Performance
- *(release)* Speed up Windows ARM archive staging - ([086cf63](https://github.com/snapetech/seerrng/commit/086cf63d46edf206908b6a83041fe30ee430f82e))
- *(release)* Remove redundant Windows chmod and expose archive progress - ([48dcadd](https://github.com/snapetech/seerrng/commit/48dcadd68f35d72b3865a74252c375b0b9d0a62d))
- *(release)* Build assets alongside image verification - ([9b9200a](https://github.com/snapetech/seerrng/commit/9b9200a8eaa3a1d8e3689f67d87e9beeea500781))

### 🧪 Testing
- Correct Advanced Theme regression selector - ([da85baa](https://github.com/snapetech/seerrng/commit/da85baa8461c183d785d4ca5df264ad0ba79f24c))

## [3.45.2](https://github.com/snapetech/seerrng/compare/v3.45.1..v3.45.2) - 2026-10-01

### User-facing changes

#### Added

- **Comics:** Administrators can connect BackIssue through Settings, the administrator API, or the CLI. Comic requests can use it as their default destination, while SeerrNG syncs its collection and shows active queue status and progress when BackIssue reports it.
- **Appearance:** Power users can save personal overrides for supported theme colors and accents from the hidden Advanced Theme Overrides page. Users without saved overrides keep their selected theme unchanged.
- **Software Requests:** After cancelling a software request, its owner or a request manager can clear the cancelled entry and its status history from Seerr without removing installed software.
- **Appearance:** Administrators can opt their own account into John’s former visual system from Profile Settings > Advanced Theme. The preset colors shared controls and page chrome while keeping the default appearance unchanged for everyone else.
- **Requests:** TV requesters can opt into the episode queue with a linked Plex or Emby account. The queue stays off unless the requester enables it and continues to support Jellyfin.
- **Requests:** Requesters can retry their own failed requests when they still have permission to request that media. Request managers can retry any failed request, and the action stays hidden for other users.
- **Distribution:** Windows operators can install SeerrNG from Chocolatey as a managed service. Package upgrades update the existing service and preserve its configuration under `%ProgramData%\SeerrNG\config`.
- **Requests:** Request managers can set a default destination folder for each configured media service in a user's profile. Requests use that folder when the selected service still offers it and otherwise keep the service's default.
- **Distribution:** Release downloads now also include native archives for macOS Intel (x64), Windows on Arm (arm64), and 32-bit Arm Linux (armv7), alongside the existing Linux, macOS Apple Silicon, and Windows x64 builds.
- **Users:** Administrators can now apply Auto-Request settings to multiple selected users from the User List. Saving general settings also preserves an unchanged display name and email when their fields are blank.
- **Magazines:** The public magazine catalog now offers suggested title searches, helping users discover magazines before they know what to enter.
- **Requests:** Request owners and request managers can remove and blocklist an active Radarr or Sonarr release, then search again from request status. The controls have a 48-pixel touch target for easier use on phones.

#### Changed

- **Interface:** Shared cards, posters, controls, ratings, and palette treatments now follow one documented visual standard for a more consistent interface.
- **Bookshelf:** New book requests let Bookshelf or Readarr manage acquisition while SeerrNG tracks library availability. SeerrNG no longer reports its own download-queue or release-search stages for these requests.
- **Comics:** Comic detail pages now load issue lists when the page opens, so issues are ready when users reach that section.
- **Magazines:** Magazine search suggestions now have larger touch targets, making them easier to select on phones and smaller displays.
- **Release Pipeline:** Launchpad publishing retries only a classified source-publication race and waits through nonterminal builds instead of creating another source upload based on elapsed time. If monitoring times out, inspect the Launchpad logs.
- **Appearance:** Cards and posters now use one consistent solid blue frame while preserving their established border widths and rounded shapes.
- **Yunohost:** YunoHost installation and package links now point to the maintained YunoHost-Apps repositories, helping people find the current catalog entry and install source.
- **Distribution:** The earlier archive note mentioned Linux armv7, but that archive is not available because SeerrNG requires Node.js 24, which does not provide an armv7 runtime. Linux x64 and arm64 archives remain supported.
- **Runtime:** **Breaking:** SeerrNG now requires Node.js 24.15.0 or newer in the 24.x line. Operators using standalone package installs must upgrade their system Node.js runtime before updating SeerrNG; containers and YunoHost manage the runtime for you.
  - **Action required:** Upgrade system Node.js to 24.15.0 or newer
- **Release Pipeline:** Manual main-image builds can publish and scan the current multi-architecture image without deploying it to the live host. Push-triggered deployments are unchanged.
- **Release Pipeline:** GitHub release publication now proceeds after required artifact and security gates even if Chocolatey or Snap Store submission fails. Check each store for its package's current version; direct release downloads remain available.
  - **Action required:** Check Chocolatey and Snap for package availability before updating through those stores.
- **Distribution:** **Breaking:** SeerrNG's repository and GHCR publisher have returned to `snapetech` after the YunoHost-Apps transfer. The current image is `ghcr.io/snapetech/seerrng`; operators who switched custom image references to the interim `ghcr.io/yunohost-apps/seerrng` path should switch back. YunoHost installs continue to use their separate package repository.
  - **Action required:** Update manually configured container images to ghcr.io/snapetech/seerrng.
- **Distribution:** **Breaking:** SeerrNG repository links now use the YunoHost-Apps organization, and its GitHub Container Registry image is published at ghcr.io/yunohost-apps/seerrng. Update any manually configured GHCR image reference to the new path.
  - **Action required:** Update manually configured GitHub Container Registry image references to ghcr.io/yunohost-apps/seerrng.

#### Fixed

- **Discovery:** Audiobook discovery now accepts the current response contract while retaining compatibility with existing clients, so Open Library and Bookshelf results load instead of failing with HTTP 400.
- **Comics:** The BackIssue collection scan now has a named task in Settings > Jobs and can be started from the API or CLI, so operators can refresh synced comic availability on demand.
- **Comics:** ComicVine volume descriptions now show paragraphs and lists as readable formatted text instead of exposing source HTML tags.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for package signing and LAUNCHPAD_PPA for its destination. It no longer requires a separate Launchpad OAuth credential; publication verification reads Launchpad's public API anonymously.
- **Settings:** Prowlarr diagnostics now use a bounded scrollable report, with larger Save and Test buttons after the report so operators can reach them on smaller screens.
- **Release Pipeline:** PPA publishing now recovers from Launchpad's source-publication race or a binary upload stalled for 45 minutes by signing a fresh package version, then waits for its Ubuntu binaries to publish. No Launchpad OAuth secret is needed.
- **Comics:** Comic detail pages now report when ComicVine rejects an issue-page request instead of showing a misleading empty issue list. Users can retry after fixing a connection problem or waiting for ComicVine to recover.
- **Bookshelf:** Book requests now start a tracked search after Bookshelf accepts the book. If the search command temporarily fails, SeerrNG retries it and keeps the request in progress until a library scan finds the book.
- **Release Pipeline:** PPA releases now wait for Launchpad to publish the matching Ubuntu source and binary packages, and retry binary uploads rejected before source publication. This requires no Launchpad OAuth credential.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY to sign packages and LAUNCHPAD_PPA to select the destination. LAUNCHPAD_CREDENTIALS is no longer used.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Distribution:** The Linux AppImage now omits a build-only Next.js binary that required newer glibc and opens SeerrNG in the default browser after its local server is ready on desktop launches.
- **Search:** When an audiobook catalog is unavailable, search now explains which catalog failed and offers a retry instead of showing a generic internal server error.
- **Bookshelf:** Audiobook-only discovery no longer inherits ebook query filters. Browsing one Bookshelf audiobook library can load catalog pages instead of waiting for the full library response.
- **Discovery Integrations:** A single busy discovery account can no longer use up the shared request budget and cause other accounts' discovery feeds to fail.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for signing and LAUNCHPAD_PPA as its destination. Do not configure LAUNCHPAD_CREDENTIALS; publishing and verification do not use it.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Music Search:** Music searches now treat punctuation in album and artist names as text instead of letting it alter or break MusicBrainz's search query.
- **Linux Packaging:** The Linux AppImage now starts from its bundled application files and shows server startup output in a terminal window, so operators can see when SeerrNG is ready.
- **Requests:** Success notifications after manually failing and searching again now appear correctly throughout their show and dismissal transitions.
- **Magazines:** Magazine cards now show “Tracked,” “Requested,” or availability in place of the request action when a title is already tracked or has an active SeerrNG request.
- **Requests:** Processing badges now open download actions on touch devices, while the media playback link remains available in the download details.
- **Settings:** Remembered page media filters now pass API validation, so selected filters can be saved and restored normally.
- **Image Cache:** Large posters, backdrops, and cover art (over 1.5 MB) now persist to the on-disk image cache instead of being re-fetched from the source on every request.
- **Requests:** Request cards retain declined and pending states when media is deleted, and keep blocked or deleted media status visible.
- **Requests:** Failed-request actions now stay fully visible in request sliders and have a larger touch target, so people can reach and retry them on phones.
- **Requests:** The Requests page now applies task status filters to software requests too. Failed software requests no longer remain in unrelated views such as “No Release Found,” and the active, completed, and attention filters show matching software requests.
- **Software Acquisition:** Software provider connection checks now reuse saved API keys when the key field is left blank, so testing ROMarrNG or QuestarrNG settings no longer fails request validation.
- **Notifications:** Notifications for deleted requests or issues are retired instead of retrying indefinitely; valid issue updates still deliver when their optional actor account is gone.
- **Interface:** Every Visual Lab reference page now redirects non-admin accounts, matching the access behavior of its main page.
- **User Management:** Bulk user permission updates now return a specific validation message when a permission value is invalid, so administrators can see what needs correcting.
- **Packaging:** The standalone AppImage now starts without requiring `pnpm` or an internet connection to load its web interface.
- **Requests:** Request confirmation dialogs now open and remain usable, so cancelled requests can be cleared without a page error.
- **Library Sync:** Radarr, Sonarr, Lidarr, and Readarr can now sync complete libraries larger than 16 MiB, with a finite 64 MiB response cap to protect server memory.
- **Bookshelf:** Book requests linked to the first configured Bookshelf service now show the correct linked format in request cards and status lists.
- **Bookshelf:** The BookshelfNG source-build guide now uses the supported .NET 10 target and installs the combined standalone package, including its web interface.
- **Release Pipeline:** Ubuntu PPA releases now retry with a fresh signed package if Launchpad accepts an upload but fails to publish its source record, preventing package jobs from waiting until their full timeout.
- **Magazines:** Magazine discovery now loads cover images from the first configured LazyLibrarian service, so its titles no longer show the SeerrNG placeholder cover.
- **Release Pipeline:** Release publishing now keeps waiting for package jobs through temporary GitHub API errors, instead of ending before their result is known.
- **Software:** Software acquisition requests now continue to refresh their status in the background, including requests that have not yet been checked, so progress stays current.

#### Security

- **Security:** The sanitization library now includes its upstream fix for a DOM XSS issue in a supported in-place sanitization mode. No configuration change is required.
- **Media Categories:** The general media list and status endpoints now respect disabled media categories, so turning off a category (such as comics) hides and protects its media everywhere, not just on that category's own pages.
- **Security:** SeerrNG now uses a patched brace expansion dependency to prevent crafted patterns from exhausting the Node.js stack and crashing the server.
- **Discovery Integrations:** Simkl catalog requests are now validated to stay on Simkl's own hosts, removing a latent path for a future code change to redirect those requests elsewhere.
- **Security:** The application and documentation toolchains now resolve patched versions for reported URL parsing, address validation, date, brace-expansion, and web framework advisories. No operator action is required.
- **Authentication:** Signing in with Jellyfin Quick Connect now starts a fresh session the same way every other sign-in method does, closing a session-fixation gap on that login path.

### 🐛 Bug Fixes
- *(release)* Use current node-gyp on Windows builds - ([a6db35e](https://github.com/snapetech/seerrng/commit/a6db35e627f7ab52d13fe856c316178a3d9e943e))
- *(release)* Align archive matrix with supported runtimes - ([de7775e](https://github.com/snapetech/seerrng/commit/de7775e4d17c25dc85d0b64c9a25fe1106c00d15))
- *(release)* Use reachable pinned Node image mirror - ([79c1be3](https://github.com/snapetech/seerrng/commit/79c1be3d322da161e1f10941b0468dcb4b3e4ee7))
- *(release)* Let BuildKit verify mirrored base digests - ([a1faeaf](https://github.com/snapetech/seerrng/commit/a1faeaf6ec34ac490ded219d6e05dc83664c60e6))
- *(release-notes)* Preserve tagged fragment integrity - ([d7bfa90](https://github.com/snapetech/seerrng/commit/d7bfa9088110dad85583e9a36aa5cd4c7d26e904))
- *(users)* Report invalid bulk permission values - ([b34f971](https://github.com/snapetech/seerrng/commit/b34f97123b26ccf00ebd50c0c8095f63595346b9))

### 🎨 Styling
- *(release)* Format release asset matrix assertions - ([39965c1](https://github.com/snapetech/seerrng/commit/39965c1cb65b297ca09ee451d5db79b24a0f0ec6))

## [3.45.1](https://github.com/snapetech/seerrng/compare/v3.45.0..v3.45.1) - 2026-10-01

### User-facing changes

#### Added

- **Comics:** Administrators can connect BackIssue through Settings, the administrator API, or the CLI. Comic requests can use it as their default destination, while SeerrNG syncs its collection and shows active queue status and progress when BackIssue reports it.
- **Appearance:** Power users can save personal overrides for supported theme colors and accents from the hidden Advanced Theme Overrides page. Users without saved overrides keep their selected theme unchanged.
- **Software Requests:** After cancelling a software request, its owner or a request manager can clear the cancelled entry and its status history from Seerr without removing installed software.
- **Appearance:** Administrators can opt their own account into John’s former visual system from Profile Settings > Advanced Theme. The preset colors shared controls and page chrome while keeping the default appearance unchanged for everyone else.
- **Requests:** TV requesters can opt into the episode queue with a linked Plex or Emby account. The queue stays off unless the requester enables it and continues to support Jellyfin.
- **Requests:** Requesters can retry their own failed requests when they still have permission to request that media. Request managers can retry any failed request, and the action stays hidden for other users.
- **Distribution:** Windows operators can install SeerrNG from Chocolatey as a managed service. Package upgrades update the existing service and preserve its configuration under `%ProgramData%\SeerrNG\config`.
- **Requests:** Request managers can set a default destination folder for each configured media service in a user's profile. Requests use that folder when the selected service still offers it and otherwise keep the service's default.
- **Distribution:** Release downloads now also include native archives for macOS Intel (x64), Windows on Arm (arm64), and 32-bit Arm Linux (armv7), alongside the existing Linux, macOS Apple Silicon, and Windows x64 builds.
- **Users:** Administrators can now apply Auto-Request settings to multiple selected users from the User List. Saving general settings also preserves an unchanged display name and email when their fields are blank.
- **Magazines:** The public magazine catalog now offers suggested title searches, helping users discover magazines before they know what to enter.
- **Requests:** Request owners and request managers can remove and blocklist an active Radarr or Sonarr release, then search again from request status. The controls have a 48-pixel touch target for easier use on phones.

#### Changed

- **Interface:** Shared cards, posters, controls, ratings, and palette treatments now follow one documented visual standard for a more consistent interface.
- **Bookshelf:** New book requests let Bookshelf or Readarr manage acquisition while SeerrNG tracks library availability. SeerrNG no longer reports its own download-queue or release-search stages for these requests.
- **Comics:** Comic detail pages now load issue lists when the page opens, so issues are ready when users reach that section.
- **Magazines:** Magazine search suggestions now have larger touch targets, making them easier to select on phones and smaller displays.
- **Release Pipeline:** Launchpad publishing retries only a classified source-publication race and waits through nonterminal builds instead of creating another source upload based on elapsed time. If monitoring times out, inspect the Launchpad logs.
- **Appearance:** Cards and posters now use one consistent solid blue frame while preserving their established border widths and rounded shapes.
- **Yunohost:** YunoHost installation and package links now point to the maintained YunoHost-Apps repositories, helping people find the current catalog entry and install source.
- **Runtime:** **Breaking:** SeerrNG now requires Node.js 24.15.0 or newer in the 24.x line. Operators using standalone package installs must upgrade their system Node.js runtime before updating SeerrNG; containers and YunoHost manage the runtime for you.
  - **Action required:** Upgrade system Node.js to 24.15.0 or newer
- **Release Pipeline:** Manual main-image builds can publish and scan the current multi-architecture image without deploying it to the live host. Push-triggered deployments are unchanged.
- **Release Pipeline:** GitHub release publication now proceeds after required artifact and security gates even if Chocolatey or Snap Store submission fails. Check each store for its package's current version; direct release downloads remain available.
  - **Action required:** Check Chocolatey and Snap for package availability before updating through those stores.
- **Distribution:** **Breaking:** SeerrNG's repository and GHCR publisher have returned to `snapetech` after the YunoHost-Apps transfer. The current image is `ghcr.io/snapetech/seerrng`; operators who switched custom image references to the interim `ghcr.io/yunohost-apps/seerrng` path should switch back. YunoHost installs continue to use their separate package repository.
  - **Action required:** Update manually configured container images to ghcr.io/snapetech/seerrng.
- **Distribution:** **Breaking:** SeerrNG repository links now use the YunoHost-Apps organization, and its GitHub Container Registry image is published at ghcr.io/yunohost-apps/seerrng. Update any manually configured GHCR image reference to the new path.
  - **Action required:** Update manually configured GitHub Container Registry image references to ghcr.io/yunohost-apps/seerrng.

#### Fixed

- **Discovery:** Audiobook discovery now accepts the current response contract while retaining compatibility with existing clients, so Open Library and Bookshelf results load instead of failing with HTTP 400.
- **Comics:** The BackIssue collection scan now has a named task in Settings > Jobs and can be started from the API or CLI, so operators can refresh synced comic availability on demand.
- **Comics:** ComicVine volume descriptions now show paragraphs and lists as readable formatted text instead of exposing source HTML tags.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for package signing and LAUNCHPAD_PPA for its destination. It no longer requires a separate Launchpad OAuth credential; publication verification reads Launchpad's public API anonymously.
- **Settings:** Prowlarr diagnostics now use a bounded scrollable report, with larger Save and Test buttons after the report so operators can reach them on smaller screens.
- **Release Pipeline:** PPA publishing now recovers from Launchpad's source-publication race or a binary upload stalled for 45 minutes by signing a fresh package version, then waits for its Ubuntu binaries to publish. No Launchpad OAuth secret is needed.
- **Comics:** Comic detail pages now report when ComicVine rejects an issue-page request instead of showing a misleading empty issue list. Users can retry after fixing a connection problem or waiting for ComicVine to recover.
- **Bookshelf:** Book requests now start a tracked search after Bookshelf accepts the book. If the search command temporarily fails, SeerrNG retries it and keeps the request in progress until a library scan finds the book.
- **Release Pipeline:** PPA releases now wait for Launchpad to publish the matching Ubuntu source and binary packages, and retry binary uploads rejected before source publication. This requires no Launchpad OAuth credential.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY to sign packages and LAUNCHPAD_PPA to select the destination. LAUNCHPAD_CREDENTIALS is no longer used.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Distribution:** The Linux AppImage now omits a build-only Next.js binary that required newer glibc and opens SeerrNG in the default browser after its local server is ready on desktop launches.
- **Search:** When an audiobook catalog is unavailable, search now explains which catalog failed and offers a retry instead of showing a generic internal server error.
- **Bookshelf:** Audiobook-only discovery no longer inherits ebook query filters. Browsing one Bookshelf audiobook library can load catalog pages instead of waiting for the full library response.
- **Discovery Integrations:** A single busy discovery account can no longer use up the shared request budget and cause other accounts' discovery feeds to fail.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for signing and LAUNCHPAD_PPA as its destination. Do not configure LAUNCHPAD_CREDENTIALS; publishing and verification do not use it.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Music Search:** Music searches now treat punctuation in album and artist names as text instead of letting it alter or break MusicBrainz's search query.
- **Linux Packaging:** The Linux AppImage now starts from its bundled application files and shows server startup output in a terminal window, so operators can see when SeerrNG is ready.
- **Requests:** Success notifications after manually failing and searching again now appear correctly throughout their show and dismissal transitions.
- **Magazines:** Magazine cards now show “Tracked,” “Requested,” or availability in place of the request action when a title is already tracked or has an active SeerrNG request.
- **Requests:** Processing badges now open download actions on touch devices, while the media playback link remains available in the download details.
- **Settings:** Remembered page media filters now pass API validation, so selected filters can be saved and restored normally.
- **Image Cache:** Large posters, backdrops, and cover art (over 1.5 MB) now persist to the on-disk image cache instead of being re-fetched from the source on every request.
- **Requests:** Request cards retain declined and pending states when media is deleted, and keep blocked or deleted media status visible.
- **Requests:** Failed-request actions now stay fully visible in request sliders and have a larger touch target, so people can reach and retry them on phones.
- **Requests:** The Requests page now applies task status filters to software requests too. Failed software requests no longer remain in unrelated views such as “No Release Found,” and the active, completed, and attention filters show matching software requests.
- **Software Acquisition:** Software provider connection checks now reuse saved API keys when the key field is left blank, so testing ROMarrNG or QuestarrNG settings no longer fails request validation.
- **Notifications:** Notifications for deleted requests or issues are retired instead of retrying indefinitely; valid issue updates still deliver when their optional actor account is gone.
- **Interface:** Every Visual Lab reference page now redirects non-admin accounts, matching the access behavior of its main page.
- **Packaging:** The standalone AppImage now starts without requiring `pnpm` or an internet connection to load its web interface.
- **Requests:** Request confirmation dialogs now open and remain usable, so cancelled requests can be cleared without a page error.
- **Library Sync:** Radarr, Sonarr, Lidarr, and Readarr can now sync complete libraries larger than 16 MiB, with a finite 64 MiB response cap to protect server memory.
- **Bookshelf:** Book requests linked to the first configured Bookshelf service now show the correct linked format in request cards and status lists.
- **Bookshelf:** The BookshelfNG source-build guide now uses the supported .NET 10 target and installs the combined standalone package, including its web interface.
- **Release Pipeline:** Ubuntu PPA releases now retry with a fresh signed package if Launchpad accepts an upload but fails to publish its source record, preventing package jobs from waiting until their full timeout.
- **Magazines:** Magazine discovery now loads cover images from the first configured LazyLibrarian service, so its titles no longer show the SeerrNG placeholder cover.
- **Release Pipeline:** Release publishing now keeps waiting for package jobs through temporary GitHub API errors, instead of ending before their result is known.
- **Software:** Software acquisition requests now continue to refresh their status in the background, including requests that have not yet been checked, so progress stays current.

#### Security

- **Security:** The sanitization library now includes its upstream fix for a DOM XSS issue in a supported in-place sanitization mode. No configuration change is required.
- **Media Categories:** The general media list and status endpoints now respect disabled media categories, so turning off a category (such as comics) hides and protects its media everywhere, not just on that category's own pages.
- **Security:** SeerrNG now uses a patched brace expansion dependency to prevent crafted patterns from exhausting the Node.js stack and crashing the server.
- **Discovery Integrations:** Simkl catalog requests are now validated to stay on Simkl's own hosts, removing a latent path for a future code change to redirect those requests elsewhere.
- **Security:** The application and documentation toolchains now resolve patched versions for reported URL parsing, address validation, date, brace-expansion, and web framework advisories. No operator action is required.
- **Authentication:** Signing in with Jellyfin Quick Connect now starts a fresh session the same way every other sign-in method does, closing a session-fixation gap on that login path.

### 🐛 Bug Fixes
- *(servarr)* Bound full-library response sizes - ([faaebc5](https://github.com/snapetech/seerrng/commit/faaebc5313f5b131fea0330279637c3b75660499))

### 🧪 Testing
- *(release)* Match optional channel warning - ([f1234ac](https://github.com/snapetech/seerrng/commit/f1234ac66d49edf73528063c99703030fd0a0487))

### ⚙️ Miscellaneous Tasks
- *(release)* Verify Docker Hub Node mirror - ([37858f5](https://github.com/snapetech/seerrng/commit/37858f54a7e3c88b33320456df29b3a360e74a38))
- *(release)* Let optional stores fail without blocking - ([e5c8297](https://github.com/snapetech/seerrng/commit/e5c8297432479fea8d18d1cee4f3c5db4d4e97e9))

## [3.45.0](https://github.com/snapetech/seerrng/compare/v3.44.1..v3.45.0) - 2026-10-01

### User-facing changes

#### Added

- **Comics:** Administrators can connect BackIssue through Settings, the administrator API, or the CLI. Comic requests can use it as their default destination, while SeerrNG syncs its collection and shows active queue status and progress when BackIssue reports it.
- **Appearance:** Power users can save personal overrides for supported theme colors and accents from the hidden Advanced Theme Overrides page. Users without saved overrides keep their selected theme unchanged.
- **Software Requests:** After cancelling a software request, its owner or a request manager can clear the cancelled entry and its status history from Seerr without removing installed software.
- **Appearance:** Administrators can opt their own account into John’s former visual system from Profile Settings > Advanced Theme. The preset colors shared controls and page chrome while keeping the default appearance unchanged for everyone else.
- **Requests:** TV requesters can opt into the episode queue with a linked Plex or Emby account. The queue stays off unless the requester enables it and continues to support Jellyfin.
- **Requests:** Requesters can retry their own failed requests when they still have permission to request that media. Request managers can retry any failed request, and the action stays hidden for other users.
- **Distribution:** Windows operators can install SeerrNG from Chocolatey as a managed service. Package upgrades update the existing service and preserve its configuration under `%ProgramData%\SeerrNG\config`.
- **Requests:** Request managers can set a default destination folder for each configured media service in a user's profile. Requests use that folder when the selected service still offers it and otherwise keep the service's default.
- **Distribution:** Release downloads now also include native archives for macOS Intel (x64), Windows on Arm (arm64), and 32-bit Arm Linux (armv7), alongside the existing Linux, macOS Apple Silicon, and Windows x64 builds.
- **Users:** Administrators can now apply Auto-Request settings to multiple selected users from the User List. Saving general settings also preserves an unchanged display name and email when their fields are blank.
- **Magazines:** The public magazine catalog now offers suggested title searches, helping users discover magazines before they know what to enter.
- **Requests:** Request owners and request managers can remove and blocklist an active Radarr or Sonarr release, then search again from request status. The controls have a 48-pixel touch target for easier use on phones.

#### Changed

- **Interface:** Shared cards, posters, controls, ratings, and palette treatments now follow one documented visual standard for a more consistent interface.
- **Bookshelf:** New book requests let Bookshelf or Readarr manage acquisition while SeerrNG tracks library availability. SeerrNG no longer reports its own download-queue or release-search stages for these requests.
- **Comics:** Comic detail pages now load issue lists when the page opens, so issues are ready when users reach that section.
- **Magazines:** Magazine search suggestions now have larger touch targets, making them easier to select on phones and smaller displays.
- **Release Pipeline:** Launchpad publishing retries only a classified source-publication race and waits through nonterminal builds instead of creating another source upload based on elapsed time. If monitoring times out, inspect the Launchpad logs.
- **Appearance:** Cards and posters now use one consistent solid blue frame while preserving their established border widths and rounded shapes.
- **Yunohost:** YunoHost installation and package links now point to the maintained YunoHost-Apps repositories, helping people find the current catalog entry and install source.
- **Runtime:** **Breaking:** SeerrNG now requires Node.js 24.15.0 or newer in the 24.x line. Operators using standalone package installs must upgrade their system Node.js runtime before updating SeerrNG; containers and YunoHost manage the runtime for you.
  - **Action required:** Upgrade system Node.js to 24.15.0 or newer
- **Release Pipeline:** Manual main-image builds can publish and scan the current multi-architecture image without deploying it to the live host. Push-triggered deployments are unchanged.
- **Distribution:** **Breaking:** SeerrNG's repository and GHCR publisher have returned to `snapetech` after the YunoHost-Apps transfer. The current image is `ghcr.io/snapetech/seerrng`; operators who switched custom image references to the interim `ghcr.io/yunohost-apps/seerrng` path should switch back. YunoHost installs continue to use their separate package repository.
  - **Action required:** Update manually configured container images to ghcr.io/snapetech/seerrng.
- **Distribution:** **Breaking:** SeerrNG repository links now use the YunoHost-Apps organization, and its GitHub Container Registry image is published at ghcr.io/yunohost-apps/seerrng. Update any manually configured GHCR image reference to the new path.
  - **Action required:** Update manually configured GitHub Container Registry image references to ghcr.io/yunohost-apps/seerrng.

#### Fixed

- **Discovery:** Audiobook discovery now accepts the current response contract while retaining compatibility with existing clients, so Open Library and Bookshelf results load instead of failing with HTTP 400.
- **Comics:** The BackIssue collection scan now has a named task in Settings > Jobs and can be started from the API or CLI, so operators can refresh synced comic availability on demand.
- **Comics:** ComicVine volume descriptions now show paragraphs and lists as readable formatted text instead of exposing source HTML tags.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for package signing and LAUNCHPAD_PPA for its destination. It no longer requires a separate Launchpad OAuth credential; publication verification reads Launchpad's public API anonymously.
- **Settings:** Prowlarr diagnostics now use a bounded scrollable report, with larger Save and Test buttons after the report so operators can reach them on smaller screens.
- **Release Pipeline:** PPA publishing now recovers from Launchpad's source-publication race or a binary upload stalled for 45 minutes by signing a fresh package version, then waits for its Ubuntu binaries to publish. No Launchpad OAuth secret is needed.
- **Comics:** Comic detail pages now report when ComicVine rejects an issue-page request instead of showing a misleading empty issue list. Users can retry after fixing a connection problem or waiting for ComicVine to recover.
- **Bookshelf:** Book requests now start a tracked search after Bookshelf accepts the book. If the search command temporarily fails, SeerrNG retries it and keeps the request in progress until a library scan finds the book.
- **Release Pipeline:** PPA releases now wait for Launchpad to publish the matching Ubuntu source and binary packages, and retry binary uploads rejected before source publication. This requires no Launchpad OAuth credential.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY to sign packages and LAUNCHPAD_PPA to select the destination. LAUNCHPAD_CREDENTIALS is no longer used.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Distribution:** The Linux AppImage now omits a build-only Next.js binary that required newer glibc and opens SeerrNG in the default browser after its local server is ready on desktop launches.
- **Search:** When an audiobook catalog is unavailable, search now explains which catalog failed and offers a retry instead of showing a generic internal server error.
- **Bookshelf:** Audiobook-only discovery no longer inherits ebook query filters. Browsing one Bookshelf audiobook library can load catalog pages instead of waiting for the full library response.
- **Discovery Integrations:** A single busy discovery account can no longer use up the shared request budget and cause other accounts' discovery feeds to fail.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for signing and LAUNCHPAD_PPA as its destination. Do not configure LAUNCHPAD_CREDENTIALS; publishing and verification do not use it.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Music Search:** Music searches now treat punctuation in album and artist names as text instead of letting it alter or break MusicBrainz's search query.
- **Linux Packaging:** The Linux AppImage now starts from its bundled application files and shows server startup output in a terminal window, so operators can see when SeerrNG is ready.
- **Requests:** Success notifications after manually failing and searching again now appear correctly throughout their show and dismissal transitions.
- **Magazines:** Magazine cards now show “Tracked,” “Requested,” or availability in place of the request action when a title is already tracked or has an active SeerrNG request.
- **Requests:** Processing badges now open download actions on touch devices, while the media playback link remains available in the download details.
- **Settings:** Remembered page media filters now pass API validation, so selected filters can be saved and restored normally.
- **Image Cache:** Large posters, backdrops, and cover art (over 1.5 MB) now persist to the on-disk image cache instead of being re-fetched from the source on every request.
- **Requests:** Request cards retain declined and pending states when media is deleted, and keep blocked or deleted media status visible.
- **Requests:** Failed-request actions now stay fully visible in request sliders and have a larger touch target, so people can reach and retry them on phones.
- **Requests:** The Requests page now applies task status filters to software requests too. Failed software requests no longer remain in unrelated views such as “No Release Found,” and the active, completed, and attention filters show matching software requests.
- **Software Acquisition:** Software provider connection checks now reuse saved API keys when the key field is left blank, so testing ROMarrNG or QuestarrNG settings no longer fails request validation.
- **Notifications:** Notifications for deleted requests or issues are retired instead of retrying indefinitely; valid issue updates still deliver when their optional actor account is gone.
- **Interface:** Every Visual Lab reference page now redirects non-admin accounts, matching the access behavior of its main page.
- **Packaging:** The standalone AppImage now starts without requiring `pnpm` or an internet connection to load its web interface.
- **Requests:** Request confirmation dialogs now open and remain usable, so cancelled requests can be cleared without a page error.
- **Bookshelf:** Book requests linked to the first configured Bookshelf service now show the correct linked format in request cards and status lists.
- **Bookshelf:** The BookshelfNG source-build guide now uses the supported .NET 10 target and installs the combined standalone package, including its web interface.
- **Release Pipeline:** Ubuntu PPA releases now retry with a fresh signed package if Launchpad accepts an upload but fails to publish its source record, preventing package jobs from waiting until their full timeout.
- **Magazines:** Magazine discovery now loads cover images from the first configured LazyLibrarian service, so its titles no longer show the SeerrNG placeholder cover.
- **Release Pipeline:** Release publishing now keeps waiting for package jobs through temporary GitHub API errors, instead of ending before their result is known.
- **Software:** Software acquisition requests now continue to refresh their status in the background, including requests that have not yet been checked, so progress stays current.

#### Security

- **Security:** The sanitization library now includes its upstream fix for a DOM XSS issue in a supported in-place sanitization mode. No configuration change is required.
- **Media Categories:** The general media list and status endpoints now respect disabled media categories, so turning off a category (such as comics) hides and protects its media everywhere, not just on that category's own pages.
- **Security:** SeerrNG now uses a patched brace expansion dependency to prevent crafted patterns from exhausting the Node.js stack and crashing the server.
- **Discovery Integrations:** Simkl catalog requests are now validated to stay on Simkl's own hosts, removing a latent path for a future code change to redirect those requests elsewhere.
- **Security:** The application and documentation toolchains now resolve patched versions for reported URL parsing, address validation, date, brace-expansion, and web framework advisories. No operator action is required.
- **Authentication:** Signing in with Jellyfin Quick Connect now starts a fresh session the same way every other sign-in method does, closing a session-fixation gap on that login path.

### 🚀 Features
- *(release)* Build native archives for macOS x64, Windows arm64, and Linux arm - ([9172429](https://github.com/snapetech/seerrng/commit/91724297ae9f65ef78047e59636363eef967ec29))

### 🐛 Bug Fixes
- *(codeql)* Model the awaited image-cache barrier - ([f0e101a](https://github.com/snapetech/seerrng/commit/f0e101acee1d1883bca9871e5e74df428bc2499b))
- *(modal)* Restore shared dialog entry transitions - ([fddea91](https://github.com/snapetech/seerrng/commit/fddea912fec1f2f71c75caaf7a2161472f98f949))
- *(users)* Support auto-request bulk edits - ([3be5615](https://github.com/snapetech/seerrng/commit/3be561536afa4eb8b9c04de832fd96d716657d78))

### 📖 Documentation
- *(distribution)* Explain the restored Docker image path - ([7a79d1d](https://github.com/snapetech/seerrng/commit/7a79d1d3b43deac46fcb25bb7d1295cdb6841dea))
- *(release-notes)* Clarify the restored GHCR path - ([02ead14](https://github.com/snapetech/seerrng/commit/02ead14140588146c8f16e14230658dca43062ce))

### 🎨 Styling
- *(unraid)* Format template tests - ([24b9d2f](https://github.com/snapetech/seerrng/commit/24b9d2f72c291356b127eaa1024b05f9f94ccc78))

### 🧪 Testing
- *(cypress)* Wait for audiobook filter settings - ([5a0842e](https://github.com/snapetech/seerrng/commit/5a0842eb695f2ed589ba2fddd188bd1e1cf09fd0))
- *(cypress)* Assert modal and search error recovery - ([c948e54](https://github.com/snapetech/seerrng/commit/c948e5491b9965bb593534f56375eeb1cd5c1c99))
- *(cypress)* Clarify request failure coverage - ([0a8b60e](https://github.com/snapetech/seerrng/commit/0a8b60e77fbe0696c4da8eae4186ec64adf6d657))
- *(cypress)* Cover request recovery and audiobook errors - ([e49003f](https://github.com/snapetech/seerrng/commit/e49003f4f6c0503d0be57615f9f8e32279a09904))
- *(search)* Cover MusicBrainz query escaping - ([832a621](https://github.com/snapetech/seerrng/commit/832a621c0bffdbcea6519082b3d733a5f8a65cb4))
- *(users)* Assert saved request folder selection - ([596794a](https://github.com/snapetech/seerrng/commit/596794ade7c56c344761915185f5b6682c5604f8))
- Cover audiobook outages and user request defaults - ([55e4c14](https://github.com/snapetech/seerrng/commit/55e4c147196c287ee2bf012837c76f2e4faa79e0))

### ⚙️ Miscellaneous Tasks
- *(release)* Support build-only main image dispatch - ([f180750](https://github.com/snapetech/seerrng/commit/f180750c836b2f303ab4837c022a4483acda68cc))
- *(runtime)* Require Node 24 across release channels - ([09bee7d](https://github.com/snapetech/seerrng/commit/09bee7da6b672cf88d476d6fb2136eca52c2da99))
- *(yunohost)* Sync package files after SeerrNG commits - ([ae455f3](https://github.com/snapetech/seerrng/commit/ae455f3e2f29d13b06a82346f8ff8b614d3d9ed6))

## [3.44.1](https://github.com/YunoHost-Apps/seerrng/compare/v3.44.0..v3.44.1) - 2026-10-01

### User-facing changes

#### Added

- **Comics:** Administrators can connect BackIssue through Settings, the administrator API, or the CLI. Comic requests can use it as their default destination, while SeerrNG syncs its collection and shows active queue status and progress when BackIssue reports it.
- **Appearance:** Power users can save personal overrides for supported theme colors and accents from the hidden Advanced Theme Overrides page. Users without saved overrides keep their selected theme unchanged.
- **Software Requests:** After cancelling a software request, its owner or a request manager can clear the cancelled entry and its status history from Seerr without removing installed software.
- **Appearance:** Administrators can opt their own account into John’s former visual system from Profile Settings > Advanced Theme. The preset colors shared controls and page chrome while keeping the default appearance unchanged for everyone else.
- **Requests:** TV requesters can opt into the episode queue with a linked Plex or Emby account. The queue stays off unless the requester enables it and continues to support Jellyfin.
- **Requests:** Requesters can retry their own failed requests when they still have permission to request that media. Request managers can retry any failed request, and the action stays hidden for other users.
- **Distribution:** Windows operators can install SeerrNG from Chocolatey as a managed service. Package upgrades update the existing service and preserve its configuration under `%ProgramData%\SeerrNG\config`.
- **Requests:** Request managers can set a default destination folder for each configured media service in a user's profile. Requests use that folder when the selected service still offers it and otherwise keep the service's default.
- **Magazines:** The public magazine catalog now offers suggested title searches, helping users discover magazines before they know what to enter.
- **Requests:** Request owners and request managers can remove and blocklist an active Radarr or Sonarr release, then search again from request status. The controls have a 48-pixel touch target for easier use on phones.

#### Changed

- **Interface:** Shared cards, posters, controls, ratings, and palette treatments now follow one documented visual standard for a more consistent interface.
- **Bookshelf:** New book requests let Bookshelf or Readarr manage acquisition while SeerrNG tracks library availability. SeerrNG no longer reports its own download-queue or release-search stages for these requests.
- **Comics:** Comic detail pages now load issue lists when the page opens, so issues are ready when users reach that section.
- **Magazines:** Magazine search suggestions now have larger touch targets, making them easier to select on phones and smaller displays.
- **Release Pipeline:** Launchpad publishing retries only a classified source-publication race and waits through nonterminal builds instead of creating another source upload based on elapsed time. If monitoring times out, inspect the Launchpad logs.
- **Appearance:** Cards and posters now use one consistent solid blue frame while preserving their established border widths and rounded shapes.
- **Yunohost:** YunoHost installation and package links now point to the maintained YunoHost-Apps repositories, helping people find the current catalog entry and install source.
- **Distribution:** **Breaking:** SeerrNG repository links now use the YunoHost-Apps organization, and its GitHub Container Registry image is published at ghcr.io/yunohost-apps/seerrng. Update any manually configured GHCR image reference to the new path.
  - **Action required:** Update manually configured GitHub Container Registry image references to ghcr.io/yunohost-apps/seerrng.

#### Fixed

- **Discovery:** Audiobook discovery now accepts the current response contract while retaining compatibility with existing clients, so Open Library and Bookshelf results load instead of failing with HTTP 400.
- **Comics:** The BackIssue collection scan now has a named task in Settings > Jobs and can be started from the API or CLI, so operators can refresh synced comic availability on demand.
- **Comics:** ComicVine volume descriptions now show paragraphs and lists as readable formatted text instead of exposing source HTML tags.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for package signing and LAUNCHPAD_PPA for its destination. It no longer requires a separate Launchpad OAuth credential; publication verification reads Launchpad's public API anonymously.
- **Settings:** Prowlarr diagnostics now use a bounded scrollable report, with larger Save and Test buttons after the report so operators can reach them on smaller screens.
- **Release Pipeline:** PPA publishing now recovers from Launchpad's source-publication race or a binary upload stalled for 45 minutes by signing a fresh package version, then waits for its Ubuntu binaries to publish. No Launchpad OAuth secret is needed.
- **Comics:** Comic detail pages now report when ComicVine rejects an issue-page request instead of showing a misleading empty issue list. Users can retry after fixing a connection problem or waiting for ComicVine to recover.
- **Bookshelf:** Book requests now start a tracked search after Bookshelf accepts the book. If the search command temporarily fails, SeerrNG retries it and keeps the request in progress until a library scan finds the book.
- **Release Pipeline:** PPA releases now wait for Launchpad to publish the matching Ubuntu source and binary packages, and retry binary uploads rejected before source publication. This requires no Launchpad OAuth credential.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY to sign packages and LAUNCHPAD_PPA to select the destination. LAUNCHPAD_CREDENTIALS is no longer used.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Distribution:** The Linux AppImage now omits a build-only Next.js binary that required newer glibc and opens SeerrNG in the default browser after its local server is ready on desktop launches.
- **Search:** When an audiobook catalog is unavailable, search now explains which catalog failed and offers a retry instead of showing a generic internal server error.
- **Bookshelf:** Audiobook-only discovery no longer inherits ebook query filters. Browsing one Bookshelf audiobook library can load catalog pages instead of waiting for the full library response.
- **Discovery Integrations:** A single busy discovery account can no longer use up the shared request budget and cause other accounts' discovery feeds to fail.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for signing and LAUNCHPAD_PPA as its destination. Do not configure LAUNCHPAD_CREDENTIALS; publishing and verification do not use it.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Music Search:** Music searches now treat punctuation in album and artist names as text instead of letting it alter or break MusicBrainz's search query.
- **Linux Packaging:** The Linux AppImage now starts from its bundled application files and shows server startup output in a terminal window, so operators can see when SeerrNG is ready.
- **Requests:** Success notifications after manually failing and searching again now appear correctly throughout their show and dismissal transitions.
- **Magazines:** Magazine cards now show “Tracked,” “Requested,” or availability in place of the request action when a title is already tracked or has an active SeerrNG request.
- **Requests:** Processing badges now open download actions on touch devices, while the media playback link remains available in the download details.
- **Settings:** Remembered page media filters now pass API validation, so selected filters can be saved and restored normally.
- **Image Cache:** Large posters, backdrops, and cover art (over 1.5 MB) now persist to the on-disk image cache instead of being re-fetched from the source on every request.
- **Requests:** Request cards retain declined and pending states when media is deleted, and keep blocked or deleted media status visible.
- **Requests:** Failed-request actions now stay fully visible in request sliders and have a larger touch target, so people can reach and retry them on phones.
- **Requests:** The Requests page now applies task status filters to software requests too. Failed software requests no longer remain in unrelated views such as “No Release Found,” and the active, completed, and attention filters show matching software requests.
- **Software Acquisition:** Software provider connection checks now reuse saved API keys when the key field is left blank, so testing ROMarrNG or QuestarrNG settings no longer fails request validation.
- **Notifications:** Notifications for deleted requests or issues are retired instead of retrying indefinitely; valid issue updates still deliver when their optional actor account is gone.
- **Interface:** Every Visual Lab reference page now redirects non-admin accounts, matching the access behavior of its main page.
- **Bookshelf:** Book requests linked to the first configured Bookshelf service now show the correct linked format in request cards and status lists.
- **Bookshelf:** The BookshelfNG source-build guide now uses the supported .NET 10 target and installs the combined standalone package, including its web interface.
- **Release Pipeline:** Ubuntu PPA releases now retry with a fresh signed package if Launchpad accepts an upload but fails to publish its source record, preventing package jobs from waiting until their full timeout.
- **Magazines:** Magazine discovery now loads cover images from the first configured LazyLibrarian service, so its titles no longer show the SeerrNG placeholder cover.
- **Release Pipeline:** Release publishing now keeps waiting for package jobs through temporary GitHub API errors, instead of ending before their result is known.
- **Software:** Software acquisition requests now continue to refresh their status in the background, including requests that have not yet been checked, so progress stays current.

#### Security

- **Security:** The sanitization library now includes its upstream fix for a DOM XSS issue in a supported in-place sanitization mode. No configuration change is required.
- **Media Categories:** The general media list and status endpoints now respect disabled media categories, so turning off a category (such as comics) hides and protects its media everywhere, not just on that category's own pages.
- **Security:** SeerrNG now uses a patched brace expansion dependency to prevent crafted patterns from exhausting the Node.js stack and crashing the server.
- **Discovery Integrations:** Simkl catalog requests are now validated to stay on Simkl's own hosts, removing a latent path for a future code change to redirect those requests elsewhere.
- **Security:** The application and documentation toolchains now resolve patched versions for reported URL parsing, address validation, date, brace-expansion, and web framework advisories. No operator action is required.
- **Authentication:** Signing in with Jellyfin Quick Connect now starts a fresh session the same way every other sign-in method does, closing a session-fixation gap on that login path.

### 🐛 Bug Fixes
- *(appimage)* Constrain glibc and open local web UI - ([7509fbd](https://github.com/YunoHost-Apps/seerrng/commit/7509fbdc863e72a1d2378edb6a312af261332882))
- *(discovery)* Cap in-flight reads per account - ([deff393](https://github.com/YunoHost-Apps/seerrng/commit/deff393dfb8897fa0ee20ecc8f8f583e58451908))
- *(distribution)* Align links and GHCR image after transfer - ([61fa4be](https://github.com/YunoHost-Apps/seerrng/commit/61fa4be2ca6b09bad8fdecbf0dd785cdaf863e0c))
- *(images)* Persist large images to disk cache - ([7413f8c](https://github.com/YunoHost-Apps/seerrng/commit/7413f8cb83d8b46f3726da224092914cb9952508))
- *(release-notes)* Detect grouped CodeQL updates - ([ed64b69](https://github.com/YunoHost-Apps/seerrng/commit/ed64b69279485b164f5398dcac95c9daf089cfd8))
- *(search)* Escape MusicBrainz query terms - ([852da78](https://github.com/YunoHost-Apps/seerrng/commit/852da7831409cffd743edbf329802012f35271ce))
- *(security)* Close login and media category bypasses - ([64126e0](https://github.com/YunoHost-Apps/seerrng/commit/64126e0625ed234e70abe8e35ec954acc3e718b3))

### 📖 Documentation
- *(yunohost)* Update package links after repo transfer - ([96e898e](https://github.com/YunoHost-Apps/seerrng/commit/96e898eb833b7698b161504fa03c2cb2e1d51218))

### 🧪 Testing
- *(requests)* Cover folder defaults and cleanup - ([f009aac](https://github.com/YunoHost-Apps/seerrng/commit/f009aac31e628c50c37f071c8dd463307bd221cc))

## [3.44.0](https://github.com/snapetech/seerrng/compare/v3.43.0..v3.44.0) - 2026-10-01

### User-facing changes

#### Added

- **Comics:** Administrators can connect BackIssue through Settings, the administrator API, or the CLI. Comic requests can use it as their default destination, while SeerrNG syncs its collection and shows active queue status and progress when BackIssue reports it.
- **Appearance:** Power users can save personal overrides for supported theme colors and accents from the hidden Advanced Theme Overrides page. Users without saved overrides keep their selected theme unchanged.
- **Software Requests:** After cancelling a software request, its owner or a request manager can clear the cancelled entry and its status history from Seerr without removing installed software.
- **Appearance:** Administrators can opt their own account into John’s former visual system from Profile Settings > Advanced Theme. The preset colors shared controls and page chrome while keeping the default appearance unchanged for everyone else.
- **Requests:** TV requesters can opt into the episode queue with a linked Plex or Emby account. The queue stays off unless the requester enables it and continues to support Jellyfin.
- **Requests:** Requesters can retry their own failed requests when they still have permission to request that media. Request managers can retry any failed request, and the action stays hidden for other users.
- **Distribution:** Windows operators can install SeerrNG from Chocolatey as a managed service. Package upgrades update the existing service and preserve its configuration under `%ProgramData%\SeerrNG\config`.
- **Requests:** Request managers can set a default destination folder for each configured media service in a user's profile. Requests use that folder when the selected service still offers it and otherwise keep the service's default.
- **Magazines:** The public magazine catalog now offers suggested title searches, helping users discover magazines before they know what to enter.
- **Requests:** Request owners and request managers can remove and blocklist an active Radarr or Sonarr release, then search again from request status. The controls have a 48-pixel touch target for easier use on phones.

#### Changed

- **Interface:** Shared cards, posters, controls, ratings, and palette treatments now follow one documented visual standard for a more consistent interface.
- **Bookshelf:** New book requests let Bookshelf or Readarr manage acquisition while SeerrNG tracks library availability. SeerrNG no longer reports its own download-queue or release-search stages for these requests.
- **Comics:** Comic detail pages now load issue lists when the page opens, so issues are ready when users reach that section.
- **Magazines:** Magazine search suggestions now have larger touch targets, making them easier to select on phones and smaller displays.
- **Release Pipeline:** Launchpad publishing retries only a classified source-publication race and waits through nonterminal builds instead of creating another source upload based on elapsed time. If monitoring times out, inspect the Launchpad logs.
- **Appearance:** Cards and posters now use one consistent solid blue frame while preserving their established border widths and rounded shapes.

#### Fixed

- **Discovery:** Audiobook discovery now accepts the current response contract while retaining compatibility with existing clients, so Open Library and Bookshelf results load instead of failing with HTTP 400.
- **Comics:** The BackIssue collection scan now has a named task in Settings > Jobs and can be started from the API or CLI, so operators can refresh synced comic availability on demand.
- **Comics:** ComicVine volume descriptions now show paragraphs and lists as readable formatted text instead of exposing source HTML tags.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for package signing and LAUNCHPAD_PPA for its destination. It no longer requires a separate Launchpad OAuth credential; publication verification reads Launchpad's public API anonymously.
- **Settings:** Prowlarr diagnostics now use a bounded scrollable report, with larger Save and Test buttons after the report so operators can reach them on smaller screens.
- **Release Pipeline:** PPA publishing now recovers from Launchpad's source-publication race or a binary upload stalled for 45 minutes by signing a fresh package version, then waits for its Ubuntu binaries to publish. No Launchpad OAuth secret is needed.
- **Comics:** Comic detail pages now report when ComicVine rejects an issue-page request instead of showing a misleading empty issue list. Users can retry after fixing a connection problem or waiting for ComicVine to recover.
- **Bookshelf:** Book requests now start a tracked search after Bookshelf accepts the book. If the search command temporarily fails, SeerrNG retries it and keeps the request in progress until a library scan finds the book.
- **Release Pipeline:** PPA releases now wait for Launchpad to publish the matching Ubuntu source and binary packages, and retry binary uploads rejected before source publication. This requires no Launchpad OAuth credential.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY to sign packages and LAUNCHPAD_PPA to select the destination. LAUNCHPAD_CREDENTIALS is no longer used.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Search:** When an audiobook catalog is unavailable, search now explains which catalog failed and offers a retry instead of showing a generic internal server error.
- **Bookshelf:** Audiobook-only discovery no longer inherits ebook query filters. Browsing one Bookshelf audiobook library can load catalog pages instead of waiting for the full library response.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for signing and LAUNCHPAD_PPA as its destination. Do not configure LAUNCHPAD_CREDENTIALS; publishing and verification do not use it.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Linux Packaging:** The Linux AppImage now starts from its bundled application files and shows server startup output in a terminal window, so operators can see when SeerrNG is ready.
- **Requests:** Success notifications after manually failing and searching again now appear correctly throughout their show and dismissal transitions.
- **Magazines:** Magazine cards now show “Tracked,” “Requested,” or availability in place of the request action when a title is already tracked or has an active SeerrNG request.
- **Requests:** Processing badges now open download actions on touch devices, while the media playback link remains available in the download details.
- **Settings:** Remembered page media filters now pass API validation, so selected filters can be saved and restored normally.
- **Requests:** Request cards retain declined and pending states when media is deleted, and keep blocked or deleted media status visible.
- **Requests:** Failed-request actions now stay fully visible in request sliders and have a larger touch target, so people can reach and retry them on phones.
- **Requests:** The Requests page now applies task status filters to software requests too. Failed software requests no longer remain in unrelated views such as “No Release Found,” and the active, completed, and attention filters show matching software requests.
- **Software Acquisition:** Software provider connection checks now reuse saved API keys when the key field is left blank, so testing ROMarrNG or QuestarrNG settings no longer fails request validation.
- **Notifications:** Notifications for deleted requests or issues are retired instead of retrying indefinitely; valid issue updates still deliver when their optional actor account is gone.
- **Interface:** Every Visual Lab reference page now redirects non-admin accounts, matching the access behavior of its main page.
- **Bookshelf:** Book requests linked to the first configured Bookshelf service now show the correct linked format in request cards and status lists.
- **Bookshelf:** The BookshelfNG source-build guide now uses the supported .NET 10 target and installs the combined standalone package, including its web interface.
- **Release Pipeline:** Ubuntu PPA releases now retry with a fresh signed package if Launchpad accepts an upload but fails to publish its source record, preventing package jobs from waiting until their full timeout.
- **Magazines:** Magazine discovery now loads cover images from the first configured LazyLibrarian service, so its titles no longer show the SeerrNG placeholder cover.
- **Release Pipeline:** Release publishing now keeps waiting for package jobs through temporary GitHub API errors, instead of ending before their result is known.
- **Software:** Software acquisition requests now continue to refresh their status in the background, including requests that have not yet been checked, so progress stays current.

#### Security

- **Security:** The sanitization library now includes its upstream fix for a DOM XSS issue in a supported in-place sanitization mode. No configuration change is required.
- **Security:** SeerrNG now uses a patched brace expansion dependency to prevent crafted patterns from exhausting the Node.js stack and crashing the server.
- **Security:** The application and documentation toolchains now resolve patched versions for reported URL parsing, address validation, date, brace-expansion, and web framework advisories. No operator action is required.

### 🚀 Features
- *(requests)* Add per-user destination folders - ([1d9c3ff](https://github.com/snapetech/seerrng/commit/1d9c3ff9e1ea1be1645bc44c6afaaa2288682985))

### 🐛 Bug Fixes
- *(release)* Allow Chocolatey to read draft assets - ([d7e74ee](https://github.com/snapetech/seerrng/commit/d7e74ee4fc01816c8260c5528572c7f8c9c5be9d))
- *(requests)* Clear cancelled software requests - ([c580848](https://github.com/snapetech/seerrng/commit/c58084829874d0530f167fde492376719b6fdbb3))
- *(search)* Expose audiobook catalog outages - ([9e041cb](https://github.com/snapetech/seerrng/commit/9e041cbdbb05a196f509d56367ae0c8a167b0fff))

### ⚙️ Miscellaneous Tasks
- *(yunohost)* Sync package manifest with 3.39.3 - ([01f4e6b](https://github.com/snapetech/seerrng/commit/01f4e6b8d258b834fa6c1df786cdcb9d0be0561c))

## [3.43.0](https://github.com/snapetech/seerrng/compare/v3.42.1..v3.43.0) - 2026-09-30

### User-facing changes

#### Added

- **Comics:** Administrators can connect BackIssue through Settings, the administrator API, or the CLI. Comic requests can use it as their default destination, while SeerrNG syncs its collection and shows active queue status and progress when BackIssue reports it.
- **Appearance:** Power users can save personal overrides for supported theme colors and accents from the hidden Advanced Theme Overrides page. Users without saved overrides keep their selected theme unchanged.
- **Appearance:** Administrators can opt their own account into John’s former visual system from Profile Settings > Advanced Theme. The preset colors shared controls and page chrome while keeping the default appearance unchanged for everyone else.
- **Requests:** TV requesters can opt into the episode queue with a linked Plex or Emby account. The queue stays off unless the requester enables it and continues to support Jellyfin.
- **Requests:** Requesters can retry their own failed requests when they still have permission to request that media. Request managers can retry any failed request, and the action stays hidden for other users.
- **Distribution:** Windows operators can install SeerrNG from Chocolatey as a managed service. Package upgrades update the existing service and preserve its configuration under `%ProgramData%\SeerrNG\config`.
- **Magazines:** The public magazine catalog now offers suggested title searches, helping users discover magazines before they know what to enter.
- **Requests:** Request owners and request managers can remove and blocklist an active Radarr or Sonarr release, then search again from request status. The controls have a 48-pixel touch target for easier use on phones.

#### Changed

- **Interface:** Shared cards, posters, controls, ratings, and palette treatments now follow one documented visual standard for a more consistent interface.
- **Bookshelf:** New book requests let Bookshelf or Readarr manage acquisition while SeerrNG tracks library availability. SeerrNG no longer reports its own download-queue or release-search stages for these requests.
- **Comics:** Comic detail pages now load issue lists when the page opens, so issues are ready when users reach that section.
- **Magazines:** Magazine search suggestions now have larger touch targets, making them easier to select on phones and smaller displays.
- **Release Pipeline:** Launchpad publishing retries only a classified source-publication race and waits through nonterminal builds instead of creating another source upload based on elapsed time. If monitoring times out, inspect the Launchpad logs.
- **Appearance:** Cards and posters now use one consistent solid blue frame while preserving their established border widths and rounded shapes.

#### Fixed

- **Discovery:** Audiobook discovery now accepts the current response contract while retaining compatibility with existing clients, so Open Library and Bookshelf results load instead of failing with HTTP 400.
- **Comics:** The BackIssue collection scan now has a named task in Settings > Jobs and can be started from the API or CLI, so operators can refresh synced comic availability on demand.
- **Comics:** ComicVine volume descriptions now show paragraphs and lists as readable formatted text instead of exposing source HTML tags.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for package signing and LAUNCHPAD_PPA for its destination. It no longer requires a separate Launchpad OAuth credential; publication verification reads Launchpad's public API anonymously.
- **Settings:** Prowlarr diagnostics now use a bounded scrollable report, with larger Save and Test buttons after the report so operators can reach them on smaller screens.
- **Release Pipeline:** PPA publishing now recovers from Launchpad's source-publication race or a binary upload stalled for 45 minutes by signing a fresh package version, then waits for its Ubuntu binaries to publish. No Launchpad OAuth secret is needed.
- **Comics:** Comic detail pages now report when ComicVine rejects an issue-page request instead of showing a misleading empty issue list. Users can retry after fixing a connection problem or waiting for ComicVine to recover.
- **Bookshelf:** Book requests now start a tracked search after Bookshelf accepts the book. If the search command temporarily fails, SeerrNG retries it and keeps the request in progress until a library scan finds the book.
- **Release Pipeline:** PPA releases now wait for Launchpad to publish the matching Ubuntu source and binary packages, and retry binary uploads rejected before source publication. This requires no Launchpad OAuth credential.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY to sign packages and LAUNCHPAD_PPA to select the destination. LAUNCHPAD_CREDENTIALS is no longer used.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Bookshelf:** Audiobook-only discovery no longer inherits ebook query filters. Browsing one Bookshelf audiobook library can load catalog pages instead of waiting for the full library response.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for signing and LAUNCHPAD_PPA as its destination. Do not configure LAUNCHPAD_CREDENTIALS; publishing and verification do not use it.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Linux Packaging:** The Linux AppImage now starts from its bundled application files and shows server startup output in a terminal window, so operators can see when SeerrNG is ready.
- **Requests:** Success notifications after manually failing and searching again now appear correctly throughout their show and dismissal transitions.
- **Magazines:** Magazine cards now show “Tracked,” “Requested,” or availability in place of the request action when a title is already tracked or has an active SeerrNG request.
- **Requests:** Processing badges now open download actions on touch devices, while the media playback link remains available in the download details.
- **Settings:** Remembered page media filters now pass API validation, so selected filters can be saved and restored normally.
- **Requests:** Request cards retain declined and pending states when media is deleted, and keep blocked or deleted media status visible.
- **Requests:** Failed-request actions now stay fully visible in request sliders and have a larger touch target, so people can reach and retry them on phones.
- **Requests:** The Requests page now applies task status filters to software requests too. Failed software requests no longer remain in unrelated views such as “No Release Found,” and the active, completed, and attention filters show matching software requests.
- **Software Acquisition:** Software provider connection checks now reuse saved API keys when the key field is left blank, so testing ROMarrNG or QuestarrNG settings no longer fails request validation.
- **Notifications:** Notifications for deleted requests or issues are retired instead of retrying indefinitely; valid issue updates still deliver when their optional actor account is gone.
- **Interface:** Every Visual Lab reference page now redirects non-admin accounts, matching the access behavior of its main page.
- **Bookshelf:** Book requests linked to the first configured Bookshelf service now show the correct linked format in request cards and status lists.
- **Bookshelf:** The BookshelfNG source-build guide now uses the supported .NET 10 target and installs the combined standalone package, including its web interface.
- **Release Pipeline:** Ubuntu PPA releases now retry with a fresh signed package if Launchpad accepts an upload but fails to publish its source record, preventing package jobs from waiting until their full timeout.
- **Magazines:** Magazine discovery now loads cover images from the first configured LazyLibrarian service, so its titles no longer show the SeerrNG placeholder cover.
- **Release Pipeline:** Release publishing now keeps waiting for package jobs through temporary GitHub API errors, instead of ending before their result is known.
- **Software:** Software acquisition requests now continue to refresh their status in the background, including requests that have not yet been checked, so progress stays current.

#### Security

- **Security:** The sanitization library now includes its upstream fix for a DOM XSS issue in a supported in-place sanitization mode. No configuration change is required.
- **Security:** SeerrNG now uses a patched brace expansion dependency to prevent crafted patterns from exhausting the Node.js stack and crashing the server.
- **Security:** The application and documentation toolchains now resolve patched versions for reported URL parsing, address validation, date, brace-expansion, and web framework advisories. No operator action is required.

### 🚀 Features
- *(ui)* Standardize visual system and request workflows - ([0bea10e](https://github.com/snapetech/seerrng/commit/0bea10e0618ad23c1d3cbbcbf4a2661aee564853))

### 🐛 Bug Fixes
- *(appimage)* Extract Node license for package - ([a8b6cf8](https://github.com/snapetech/seerrng/commit/a8b6cf869fdccc5b36e03f222dcb1fcf3f2fe962))
- *(i18n)* Remove stale request card message - ([5aa37f6](https://github.com/snapetech/seerrng/commit/5aa37f628d988c41a1e866030d2cf253c3555d4a))
- *(requests)* Apply task filters to software requests - ([654face](https://github.com/snapetech/seerrng/commit/654face716436cc9dd0df513ded0219303dba89b))
- *(requests)* Keep fail action accessible beside playback link - ([b81b493](https://github.com/snapetech/seerrng/commit/b81b49367eb6f1c7200e6a54f24c9ac8398958ea))
- *(requests)* Preserve merged download action - ([12d381a](https://github.com/snapetech/seerrng/commit/12d381a00593036c4b075ce774c3e9d8fae6507d))
- *(ui)* Restore approved detail and request layouts - ([c96eff0](https://github.com/snapetech/seerrng/commit/c96eff03d926ddecbb776b58e4a0f23cba86e11f))
- Preserve request and notification behavior - ([446fe9a](https://github.com/snapetech/seerrng/commit/446fe9ae6e78143eef5d9c2ca780f5f5efb9fd89))

### 📖 Documentation
- *(ui)* Preserve wrapped request action alignment - ([bc62a19](https://github.com/snapetech/seerrng/commit/bc62a192a48fa0215166cecd19019819c24ec6e0))
- *(ui)* Restore visual standards guidance - ([e5b1fce](https://github.com/snapetech/seerrng/commit/e5b1fce477aaadb9ea844a39ce5eecd165afe1eb))

### 🚜 Refactor
- *(visual-lab)* Use CSS-only palette treatments - ([9248cda](https://github.com/snapetech/seerrng/commit/9248cdaeca101c2fd2f8cdc1a2c73cc63e6a4b14))

### 🎨 Styling
- *(cards)* Use solid blue frames - ([4a8730f](https://github.com/snapetech/seerrng/commit/4a8730f73acccb61e8e84a26df73b030f088861b))

### 🧪 Testing
- *(ui)* Align frame validator with solid blue standard - ([8bf579b](https://github.com/snapetech/seerrng/commit/8bf579be604c04f008b57c33aa4bd4c1e22d5bf4))

### ⚙️ Miscellaneous Tasks
- Reconcile full visual system with upstream - ([85cbede](https://github.com/snapetech/seerrng/commit/85cbede06273b87fe7b061849ef4cb663aa5b589))

## [3.42.1](https://github.com/snapetech/seerrng/compare/v3.42.0..v3.42.1) - 2026-09-30

### User-facing changes

#### Added

- **Comics:** Administrators can connect BackIssue through Settings, the administrator API, or the CLI. Comic requests can use it as their default destination, while SeerrNG syncs its collection and shows active queue status and progress when BackIssue reports it.
- **Appearance:** Power users can save personal overrides for supported theme colors and accents from the hidden Advanced Theme Overrides page. Users without saved overrides keep their selected theme unchanged.
- **Appearance:** Administrators can opt their own account into John’s former visual system from Profile Settings > Advanced Theme. The preset colors shared controls and page chrome while keeping the default appearance unchanged for everyone else.
- **Requests:** TV requesters can opt into the episode queue with a linked Plex or Emby account. The queue stays off unless the requester enables it and continues to support Jellyfin.
- **Requests:** Requesters can retry their own failed requests when they still have permission to request that media. Request managers can retry any failed request, and the action stays hidden for other users.
- **Distribution:** Windows operators can install SeerrNG from Chocolatey as a managed service. Package upgrades update the existing service and preserve its configuration under `%ProgramData%\SeerrNG\config`.
- **Magazines:** The public magazine catalog now offers suggested title searches, helping users discover magazines before they know what to enter.
- **Requests:** Request owners and request managers can remove and blocklist an active Radarr or Sonarr release, then search again from request status. The controls have a 48-pixel touch target for easier use on phones.

#### Changed

- **Bookshelf:** New book requests let Bookshelf or Readarr manage acquisition while SeerrNG tracks library availability. SeerrNG no longer reports its own download-queue or release-search stages for these requests.
- **Comics:** Comic detail pages now load issue lists when the page opens, so issues are ready when users reach that section.
- **Magazines:** Magazine search suggestions now have larger touch targets, making them easier to select on phones and smaller displays.
- **Release Pipeline:** Launchpad publishing retries only a classified source-publication race and waits through nonterminal builds instead of creating another source upload based on elapsed time. If monitoring times out, inspect the Launchpad logs.

#### Fixed

- **Discovery:** Audiobook discovery now accepts the current response contract while retaining compatibility with existing clients, so Open Library and Bookshelf results load instead of failing with HTTP 400.
- **Comics:** The BackIssue collection scan now has a named task in Settings > Jobs and can be started from the API or CLI, so operators can refresh synced comic availability on demand.
- **Comics:** ComicVine volume descriptions now show paragraphs and lists as readable formatted text instead of exposing source HTML tags.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for package signing and LAUNCHPAD_PPA for its destination. It no longer requires a separate Launchpad OAuth credential; publication verification reads Launchpad's public API anonymously.
- **Settings:** Prowlarr diagnostics now use a bounded scrollable report, with larger Save and Test buttons after the report so operators can reach them on smaller screens.
- **Release Pipeline:** PPA publishing now recovers from Launchpad's source-publication race or a binary upload stalled for 45 minutes by signing a fresh package version, then waits for its Ubuntu binaries to publish. No Launchpad OAuth secret is needed.
- **Comics:** Comic detail pages now report when ComicVine rejects an issue-page request instead of showing a misleading empty issue list. Users can retry after fixing a connection problem or waiting for ComicVine to recover.
- **Bookshelf:** Book requests now start a tracked search after Bookshelf accepts the book. If the search command temporarily fails, SeerrNG retries it and keeps the request in progress until a library scan finds the book.
- **Release Pipeline:** PPA releases now wait for Launchpad to publish the matching Ubuntu source and binary packages, and retry binary uploads rejected before source publication. This requires no Launchpad OAuth credential.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY to sign packages and LAUNCHPAD_PPA to select the destination. LAUNCHPAD_CREDENTIALS is no longer used.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Bookshelf:** Audiobook-only discovery no longer inherits ebook query filters. Browsing one Bookshelf audiobook library can load catalog pages instead of waiting for the full library response.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for signing and LAUNCHPAD_PPA as its destination. Do not configure LAUNCHPAD_CREDENTIALS; publishing and verification do not use it.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Linux Packaging:** The Linux AppImage now starts from its bundled application files and shows server startup output in a terminal window, so operators can see when SeerrNG is ready.
- **Requests:** Success notifications after manually failing and searching again now appear correctly throughout their show and dismissal transitions.
- **Magazines:** Magazine cards now show “Tracked,” “Requested,” or availability in place of the request action when a title is already tracked or has an active SeerrNG request.
- **Settings:** Remembered page media filters now pass API validation, so selected filters can be saved and restored normally.
- **Requests:** Failed-request actions now stay fully visible in request sliders and have a larger touch target, so people can reach and retry them on phones.
- **Software Acquisition:** Software provider connection checks now reuse saved API keys when the key field is left blank, so testing ROMarrNG or QuestarrNG settings no longer fails request validation.
- **Bookshelf:** Book requests linked to the first configured Bookshelf service now show the correct linked format in request cards and status lists.
- **Bookshelf:** The BookshelfNG source-build guide now uses the supported .NET 10 target and installs the combined standalone package, including its web interface.
- **Release Pipeline:** Ubuntu PPA releases now retry with a fresh signed package if Launchpad accepts an upload but fails to publish its source record, preventing package jobs from waiting until their full timeout.
- **Magazines:** Magazine discovery now loads cover images from the first configured LazyLibrarian service, so its titles no longer show the SeerrNG placeholder cover.
- **Release Pipeline:** Release publishing now keeps waiting for package jobs through temporary GitHub API errors, instead of ending before their result is known.
- **Software:** Software acquisition requests now continue to refresh their status in the background, including requests that have not yet been checked, so progress stays current.

#### Security

- **Security:** The sanitization library now includes its upstream fix for a DOM XSS issue in a supported in-place sanitization mode. No configuration change is required.
- **Security:** SeerrNG now uses a patched brace expansion dependency to prevent crafted patterns from exhausting the Node.js stack and crashing the server.
- **Security:** The application and documentation toolchains now resolve patched versions for reported URL parsing, address validation, date, brace-expansion, and web framework advisories. No operator action is required.

### 🐛 Bug Fixes
- *(appimage)* Launch bundled server correctly - ([e305649](https://github.com/snapetech/seerrng/commit/e305649119a99a0d93744e7519639b9a689dbe1b))
- *(toast)* Render notifications from visibility state - ([93a5d6f](https://github.com/snapetech/seerrng/commit/93a5d6f0ae5d109330205d176bc8335a3256dee6))

### 🧪 Testing
- *(cypress)* Assert failed-download toast visibility - ([398712c](https://github.com/snapetech/seerrng/commit/398712c0412f86e3c3569147cef900626ee1efc4))

## [3.42.0](https://github.com/snapetech/seerrng/compare/v3.41.2..v3.42.0) - 2026-09-30

### User-facing changes

#### Added

- **Comics:** Administrators can connect BackIssue through Settings, the administrator API, or the CLI. Comic requests can use it as their default destination, while SeerrNG syncs its collection and shows active queue status and progress when BackIssue reports it.
- **Appearance:** Power users can save personal overrides for supported theme colors and accents from the hidden Advanced Theme Overrides page. Users without saved overrides keep their selected theme unchanged.
- **Appearance:** Administrators can opt their own account into John’s former visual system from Profile Settings > Advanced Theme. The preset colors shared controls and page chrome while keeping the default appearance unchanged for everyone else.
- **Requests:** TV requesters can opt into the episode queue with a linked Plex or Emby account. The queue stays off unless the requester enables it and continues to support Jellyfin.
- **Requests:** Requesters can retry their own failed requests when they still have permission to request that media. Request managers can retry any failed request, and the action stays hidden for other users.
- **Distribution:** Windows operators can install SeerrNG from Chocolatey as a managed service. Package upgrades update the existing service and preserve its configuration under `%ProgramData%\SeerrNG\config`.
- **Magazines:** The public magazine catalog now offers suggested title searches, helping users discover magazines before they know what to enter.
- **Requests:** Request owners and request managers can remove and blocklist an active Radarr or Sonarr release, then search again from request status. The controls have a 48-pixel touch target for easier use on phones.

#### Changed

- **Bookshelf:** New book requests let Bookshelf or Readarr manage acquisition while SeerrNG tracks library availability. SeerrNG no longer reports its own download-queue or release-search stages for these requests.
- **Comics:** Comic detail pages now load issue lists when the page opens, so issues are ready when users reach that section.
- **Magazines:** Magazine search suggestions now have larger touch targets, making them easier to select on phones and smaller displays.
- **Release Pipeline:** Launchpad publishing retries only a classified source-publication race and waits through nonterminal builds instead of creating another source upload based on elapsed time. If monitoring times out, inspect the Launchpad logs.

#### Fixed

- **Discovery:** Audiobook discovery now accepts the current response contract while retaining compatibility with existing clients, so Open Library and Bookshelf results load instead of failing with HTTP 400.
- **Comics:** The BackIssue collection scan now has a named task in Settings > Jobs and can be started from the API or CLI, so operators can refresh synced comic availability on demand.
- **Comics:** ComicVine volume descriptions now show paragraphs and lists as readable formatted text instead of exposing source HTML tags.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for package signing and LAUNCHPAD_PPA for its destination. It no longer requires a separate Launchpad OAuth credential; publication verification reads Launchpad's public API anonymously.
- **Settings:** Prowlarr diagnostics now use a bounded scrollable report, with larger Save and Test buttons after the report so operators can reach them on smaller screens.
- **Release Pipeline:** PPA publishing now recovers from Launchpad's source-publication race or a binary upload stalled for 45 minutes by signing a fresh package version, then waits for its Ubuntu binaries to publish. No Launchpad OAuth secret is needed.
- **Comics:** Comic detail pages now report when ComicVine rejects an issue-page request instead of showing a misleading empty issue list. Users can retry after fixing a connection problem or waiting for ComicVine to recover.
- **Bookshelf:** Book requests now start a tracked search after Bookshelf accepts the book. If the search command temporarily fails, SeerrNG retries it and keeps the request in progress until a library scan finds the book.
- **Release Pipeline:** PPA releases now wait for Launchpad to publish the matching Ubuntu source and binary packages, and retry binary uploads rejected before source publication. This requires no Launchpad OAuth credential.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY to sign packages and LAUNCHPAD_PPA to select the destination. LAUNCHPAD_CREDENTIALS is no longer used.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Bookshelf:** Audiobook-only discovery no longer inherits ebook query filters. Browsing one Bookshelf audiobook library can load catalog pages instead of waiting for the full library response.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for signing and LAUNCHPAD_PPA as its destination. Do not configure LAUNCHPAD_CREDENTIALS; publishing and verification do not use it.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Magazines:** Magazine cards now show “Tracked,” “Requested,” or availability in place of the request action when a title is already tracked or has an active SeerrNG request.
- **Settings:** Remembered page media filters now pass API validation, so selected filters can be saved and restored normally.
- **Requests:** Failed-request actions now stay fully visible in request sliders and have a larger touch target, so people can reach and retry them on phones.
- **Software Acquisition:** Software provider connection checks now reuse saved API keys when the key field is left blank, so testing ROMarrNG or QuestarrNG settings no longer fails request validation.
- **Bookshelf:** Book requests linked to the first configured Bookshelf service now show the correct linked format in request cards and status lists.
- **Bookshelf:** The BookshelfNG source-build guide now uses the supported .NET 10 target and installs the combined standalone package, including its web interface.
- **Release Pipeline:** Ubuntu PPA releases now retry with a fresh signed package if Launchpad accepts an upload but fails to publish its source record, preventing package jobs from waiting until their full timeout.
- **Magazines:** Magazine discovery now loads cover images from the first configured LazyLibrarian service, so its titles no longer show the SeerrNG placeholder cover.
- **Release Pipeline:** Release publishing now keeps waiting for package jobs through temporary GitHub API errors, instead of ending before their result is known.
- **Software:** Software acquisition requests now continue to refresh their status in the background, including requests that have not yet been checked, so progress stays current.

#### Security

- **Security:** The sanitization library now includes its upstream fix for a DOM XSS issue in a supported in-place sanitization mode. No configuration change is required.
- **Security:** SeerrNG now uses a patched brace expansion dependency to prevent crafted patterns from exhausting the Node.js stack and crashing the server.
- **Security:** The application and documentation toolchains now resolve patched versions for reported URL parsing, address validation, date, brace-expansion, and web framework advisories. No operator action is required.

### 🚀 Features
- *(distribution)* Add Chocolatey service package - ([156666a](https://github.com/snapetech/seerrng/commit/156666a50a0a2daa9fd50e8127eb782d17dc4d60))
- Improve magazine and download workflows - ([68a33ce](https://github.com/snapetech/seerrng/commit/68a33ce8116106bc8f159505c7f11163ad3ae885))
- Add John visual system as opt-in theme preset - ([46204a1](https://github.com/snapetech/seerrng/commit/46204a183e31d3af6893d689da554ddeedeb0fe8))
- Opt-in advanced themes and cross-server episode queue (#145) - ([f796d81](https://github.com/snapetech/seerrng/commit/f796d8185ebd239f53bbbed98a8222bf5766a0d0))

### 🐛 Bug Fixes
- *(bookshelf)* Let provider manage book searches - ([971fd8e](https://github.com/snapetech/seerrng/commit/971fd8ee07d58d3c5dc33043b7a327513f350965))
- *(bookshelf)* Let provider manage book searches - ([52f50d0](https://github.com/snapetech/seerrng/commit/52f50d06d9f7e9be23b60c220096b7ed3cb654a5))
- *(comics)* Load issue lists with comic details - ([997c0c3](https://github.com/snapetech/seerrng/commit/997c0c3d754e09c0ee4e2a07723dd0d3f7b2483d))
- *(comics)* Load issue lists with comic details - ([c9b7265](https://github.com/snapetech/seerrng/commit/c9b7265c4aa2a153a3fb84397400f6cbb467c228))
- *(discovery)* Page audiobook library results - ([5c960ad](https://github.com/snapetech/seerrng/commit/5c960ad22f6571f078403a57ca31dce2c55d28b5))
- *(discovery)* Page audiobook library results - ([80fc9d3](https://github.com/snapetech/seerrng/commit/80fc9d30131f06f21f3c5b75e38784182e706e5d))
- *(release)* Wait before retrying Launchpad uploads - ([98f68a4](https://github.com/snapetech/seerrng/commit/98f68a49eff225c9f602a85579152eabd15915eb))
- *(release)* Wait before retrying Launchpad uploads - ([9953b4e](https://github.com/snapetech/seerrng/commit/9953b4ec2e6296b5169e89f360143a8c8bc80c62))
- *(release)* Retry transient child run API errors - ([71dca8a](https://github.com/snapetech/seerrng/commit/71dca8a01bdf4b9a5d88af57820d34393d228214))
- *(release)* Retry missing Launchpad source records - ([d576715](https://github.com/snapetech/seerrng/commit/d5767157bc7840cb853f3f48df041e9d1f5332c0))
- *(release)* Retry PPA builds without binaries - ([f3214c9](https://github.com/snapetech/seerrng/commit/f3214c9216e462bae28ab14b07c05ae242990538))
- *(release)* Allow Launchpad publication retries - ([0f77f45](https://github.com/snapetech/seerrng/commit/0f77f454afd8481428afadc450225b2a7c6a8573))
- *(requests)* Keep failed actions reachable in sliders - ([54630e9](https://github.com/snapetech/seerrng/commit/54630e976b04156b58a978ca72d11a87405b279c))
- *(requests)* Let requesters retry their failed requests - ([2345cb0](https://github.com/snapetech/seerrng/commit/2345cb0b5c59ab4db8ca9de1afd00f026bb17b11))
- *(requests)* Keep failed actions reachable in sliders - ([1accb9d](https://github.com/snapetech/seerrng/commit/1accb9dbf330513f5c56d7b6f69969264cff1bf2))
- *(requests)* Let requesters retry their failed requests - ([6126b17](https://github.com/snapetech/seerrng/commit/6126b172e20e692ed85fe7ff0dd46da4d04920b1))
- *(security)* Update DOMPurify for latest advisory - ([3284b93](https://github.com/snapetech/seerrng/commit/3284b93597915baf470225ae1857cea232fb6f39))
- *(security)* Patch dependency advisories - ([65cfd19](https://github.com/snapetech/seerrng/commit/65cfd198f88b13deb96ca8ccaa3247a821725558))
- *(security)* Patch dependency advisories - ([25c28ea](https://github.com/snapetech/seerrng/commit/25c28ea52849ccd787706cbd4b0804a05a28091e))
- *(software)* Keep request reconciliation query valid - ([60cec64](https://github.com/snapetech/seerrng/commit/60cec648e527c12ab99f08dcb7be837c2213350f))
- *(ui)* Enlarge magazine and request control targets - ([677c674](https://github.com/snapetech/seerrng/commit/677c674df6bff1b55ee7e2c80995cdfbb357844b))
- *(ui)* Remove unregistered request card style - ([914e04d](https://github.com/snapetech/seerrng/commit/914e04d59d8fa2ffc3d9975356fb6ca31a26ba96))
- *(ui)* Remove unregistered request card style - ([4bf530b](https://github.com/snapetech/seerrng/commit/4bf530b8f50d8428dce22403a872fab78eada6e0))
- Show existing request state on magazine cards - ([15ef461](https://github.com/snapetech/seerrng/commit/15ef4613d646eceaa9511b9e534a922d9ba3f408))

### 📖 Documentation
- Fix BookshelfNG source UI installation (#147) - ([9f756c9](https://github.com/snapetech/seerrng/commit/9f756c9c2538156cd5da5f64af292f16ef4d8ada))

### 🧪 Testing
- *(cypress)* Use processing label for failed download action - ([b535a70](https://github.com/snapetech/seerrng/commit/b535a703f9e55efe76db9f20084d80a734ded0a1))
- *(cypress)* Initialize isolated database before seeding - ([62e6458](https://github.com/snapetech/seerrng/commit/62e64588b89ef9d8b3972c98232c22952e86c449))
- *(discovery)* Scope audiobook paging regression - ([e9f5973](https://github.com/snapetech/seerrng/commit/e9f59737d62ae038bf34f814116a6e729f77b525))
- *(discovery)* Scope audiobook paging regression - ([86edfa3](https://github.com/snapetech/seerrng/commit/86edfa31f76f7f763f0b858c18b8f646e469a353))
- *(distribution)* Format release workflow test - ([ffb5788](https://github.com/snapetech/seerrng/commit/ffb5788115365f7f68aae09f5be454305d3c2972))
- *(distribution)* Validate Chocolatey release workflow - ([8e1e10d](https://github.com/snapetech/seerrng/commit/8e1e10de966981c1eec32aa29bc1b1d0dca96752))
- *(e2e)* Exercise failed request retry action - ([56fc9b8](https://github.com/snapetech/seerrng/commit/56fc9b8581637471bbb079c8fa37525a0fc63e64))
- *(e2e)* Stabilize settings job interactions - ([5dd7991](https://github.com/snapetech/seerrng/commit/5dd7991fe51f9d378f8a213d5621af3feb7ef13a))
- *(e2e)* Exercise failed request retry action - ([be90995](https://github.com/snapetech/seerrng/commit/be909957654b4c48c657e15a236fb9749b667be4))
- *(e2e)* Stabilize settings job interactions - ([ead59c2](https://github.com/snapetech/seerrng/commit/ead59c2138c2f74da533f2aa6a2ec0cdac90b30f))

### ⚙️ Miscellaneous Tasks
- *(i18n)* Sync generated English messages - ([7728bcc](https://github.com/snapetech/seerrng/commit/7728bcc05114f841f2df2bafe95dd60c64bd0948))
- Merge upstream security release updates - ([1be1f70](https://github.com/snapetech/seerrng/commit/1be1f707ee4436e15e157fc7e597b91535c60afe))
- Merge upstream theme and episode queue updates - ([df3d78b](https://github.com/snapetech/seerrng/commit/df3d78b361dd25d30cc9abc9b0a8328344b33f40))

## [3.41.2](https://github.com/snapetech/seerrng/compare/v3.41.1..v3.41.2) - 2026-09-30

### User-facing changes

#### Added

- **Comics:** Administrators can connect BackIssue through Settings, the administrator API, or the CLI. Comic requests can use it as their default destination, while SeerrNG syncs its collection and shows active queue status and progress when BackIssue reports it.

#### Fixed

- **Discovery:** Audiobook discovery now accepts the current response contract while retaining compatibility with existing clients, so Open Library and Bookshelf results load instead of failing with HTTP 400.
- **Comics:** The BackIssue collection scan now has a named task in Settings > Jobs and can be started from the API or CLI, so operators can refresh synced comic availability on demand.
- **Comics:** ComicVine volume descriptions now show paragraphs and lists as readable formatted text instead of exposing source HTML tags.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for package signing and LAUNCHPAD_PPA for its destination. It no longer requires a separate Launchpad OAuth credential; publication verification reads Launchpad's public API anonymously.
- **Settings:** Prowlarr diagnostics now use a bounded scrollable report, with larger Save and Test buttons after the report so operators can reach them on smaller screens.
- **Release Pipeline:** PPA publishing now recovers from Launchpad's source-publication race or a binary upload stalled for 45 minutes by signing a fresh package version, then waits for its Ubuntu binaries to publish. No Launchpad OAuth secret is needed.
- **Comics:** Comic detail pages now report when ComicVine rejects an issue-page request instead of showing a misleading empty issue list. Users can retry after fixing a connection problem or waiting for ComicVine to recover.
- **Bookshelf:** Book requests now start a tracked search after Bookshelf accepts the book. If the search command temporarily fails, SeerrNG retries it and keeps the request in progress until a library scan finds the book.
- **Release Pipeline:** PPA releases now wait for Launchpad to publish the matching Ubuntu source and binary packages, and retry binary uploads rejected before source publication. This requires no Launchpad OAuth credential.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY to sign packages and LAUNCHPAD_PPA to select the destination. LAUNCHPAD_CREDENTIALS is no longer used.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.
- **Release Pipeline:** PPA publishing uses GPG_PRIVATE_KEY for signing and LAUNCHPAD_PPA as its destination. Do not configure LAUNCHPAD_CREDENTIALS; publishing and verification do not use it.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA if PPA publishing is enabled.

#### Security

- **Security:** SeerrNG now uses a patched brace expansion dependency to prevent crafted patterns from exhausting the Node.js stack and crashing the server.

### 🐛 Bug Fixes
- *(release)* Report Launchpad publication by self link - ([a262ac8](https://github.com/snapetech/seerrng/commit/a262ac801a5b4e6a225d2259e130ea19fd7da35a))
- *(security)* Patch brace expansion stack exhaustion - ([f3ce833](https://github.com/snapetech/seerrng/commit/f3ce83305d734d4e2831b6f9dd46ef0465e456cf))

### 📖 Documentation
- *(release)* Clarify current PPA setup - ([abef9b1](https://github.com/snapetech/seerrng/commit/abef9b11adb442a77f2c21b1d301927bd48482d4))
- *(release)* Correct unpublished PPA setup notes - ([bd2f471](https://github.com/snapetech/seerrng/commit/bd2f47199e8aa6e4a98604e2ff6e68f03b650a20))

## [3.41.1](https://github.com/snapetech/seerrng/compare/v3.41.0..v3.41.1) - 2026-09-30

### User-facing changes

#### Added

- **Comics:** Administrators can connect BackIssue through Settings, the administrator API, or the CLI. Comic requests can use it as their default destination, while SeerrNG syncs its collection and shows active queue status and progress when BackIssue reports it.

#### Fixed

- **Discovery:** Audiobook discovery now accepts the current response contract while retaining compatibility with existing clients, so Open Library and Bookshelf results load instead of failing with HTTP 400.
- **Comics:** The BackIssue collection scan now has a named task in Settings > Jobs and can be started from the API or CLI, so operators can refresh synced comic availability on demand.
- **Comics:** ComicVine volume descriptions now show paragraphs and lists as readable formatted text instead of exposing source HTML tags.
- **Release Pipeline:** PPA publishing uses the existing GPG signing key and PPA target; it no longer requires a separate Launchpad OAuth credential. Publication verification reads Launchpad's public API anonymously.
- **Settings:** Prowlarr diagnostics now use a bounded scrollable report, with larger Save and Test buttons after the report so operators can reach them on smaller screens.
- **Release Pipeline:** PPA publishing now recovers from Launchpad's source-publication race or a binary upload stalled for 45 minutes by signing a fresh package version, then waits for its Ubuntu binaries to publish. No Launchpad OAuth secret is needed.
- **Comics:** Comic detail pages now report when ComicVine rejects an issue-page request instead of showing a misleading empty issue list. Users can retry after fixing a connection problem or waiting for ComicVine to recover.
- **Bookshelf:** Book requests now start a tracked search after Bookshelf accepts the book. If the search command temporarily fails, SeerrNG retries it and keeps the request in progress until a library scan finds the book.
- **Release Pipeline:** PPA releases now wait for Launchpad to publish the matching Ubuntu source and binary packages, and retry binary uploads rejected before source publication.
  - **Action required:** configure LAUNCHPAD_CREDENTIALS for PPA publishing
- **Release Pipeline:** Correction to the earlier PPA setup note: publishing does not read LAUNCHPAD_CREDENTIALS. Remove that obsolete value; releases use GPG_PRIVATE_KEY to sign packages and LAUNCHPAD_PPA to select the destination.
  - **Action required:** Remove LAUNCHPAD_CREDENTIALS; configure GPG_PRIVATE_KEY and LAUNCHPAD_PPA.

### 🐛 Bug Fixes
- *(release)* Document current PPA credentials - ([0f9f549](https://github.com/snapetech/seerrng/commit/0f9f5491a7421103c96fc716a6a8e30a0fa52401))

### 📖 Documentation
- *(release)* Clarify PPA credential correction - ([a113d0a](https://github.com/snapetech/seerrng/commit/a113d0ab80ffa53f4605811085326643b810875e))

## [3.41.0](https://github.com/snapetech/seerrng/compare/v3.40.0..v3.41.0) - 2026-09-29

### User-facing changes

#### Added

- **Comics:** Administrators can connect BackIssue through Settings, the administrator API, or the CLI. Comic requests can use it as their default destination, while SeerrNG syncs its collection and shows active queue status and progress when BackIssue reports it.

#### Fixed

- **Discovery:** Audiobook discovery now accepts the current response contract while retaining compatibility with existing clients, so Open Library and Bookshelf results load instead of failing with HTTP 400.
- **Comics:** The BackIssue collection scan now has a named task in Settings > Jobs and can be started from the API or CLI, so operators can refresh synced comic availability on demand.
- **Comics:** ComicVine volume descriptions now show paragraphs and lists as readable formatted text instead of exposing source HTML tags.
- **Release Pipeline:** PPA publishing uses the existing GPG signing key and PPA target; it no longer requires a separate Launchpad OAuth credential. Publication verification reads Launchpad's public API anonymously.
- **Settings:** Prowlarr diagnostics now use a bounded scrollable report, with larger Save and Test buttons after the report so operators can reach them on smaller screens.
- **Release Pipeline:** PPA publishing now recovers from Launchpad's source-publication race or a binary upload stalled for 45 minutes by signing a fresh package version, then waits for its Ubuntu binaries to publish. No Launchpad OAuth secret is needed.
- **Comics:** Comic detail pages now report when ComicVine rejects an issue-page request instead of showing a misleading empty issue list. Users can retry after fixing a connection problem or waiting for ComicVine to recover.
- **Bookshelf:** Book requests now start a tracked search after Bookshelf accepts the book. If the search command temporarily fails, SeerrNG retries it and keeps the request in progress until a library scan finds the book.
- **Release Pipeline:** PPA releases now wait for Launchpad to publish the matching Ubuntu source and binary packages, and retry binary uploads rejected before source publication.
  - **Action required:** configure LAUNCHPAD_CREDENTIALS for PPA publishing

### 🚀 Features
- *(comics)* Expose BackIssue collection scan task - ([cd745f3](https://github.com/snapetech/seerrng/commit/cd745f3b41e44efa972e0d5a99ced72d944250eb))

### 🐛 Bug Fixes
- *(bookshelf)* Retry book search preparation - ([6a04ad8](https://github.com/snapetech/seerrng/commit/6a04ad8188107a033f735a78440e75b597021783))
- *(comics)* Render sanitized ComicVine descriptions - ([6035ad4](https://github.com/snapetech/seerrng/commit/6035ad49437b02d4ec646dff6e914eec05a46453))
- *(discovery)* Accept audiobook response version 3 - ([9fa20e1](https://github.com/snapetech/seerrng/commit/9fa20e1a2cf1189cc5836450f25323aa1913bcea))
- *(release)* Retry stalled PPA binary uploads - ([d65fbf3](https://github.com/snapetech/seerrng/commit/d65fbf33a576741a202b4082b8dc069903a7485d))
- *(release)* Inspect pending PPA build failures - ([61d4a46](https://github.com/snapetech/seerrng/commit/61d4a46cc33a01afb5a828119a1049dca47d13f6))
- *(release)* Preserve symlinks in PPA package copy - ([13c0a6b](https://github.com/snapetech/seerrng/commit/13c0a6bdd386ef5136f0358eb9a5783badee29a9))
- *(release)* Recover PPA upload race without OAuth - ([b30cf18](https://github.com/snapetech/seerrng/commit/b30cf18f44b4a6594fdcb9504e7a080a69bd9c0a))
- *(settings)* Keep Prowlarr actions reachable on mobile - ([47a7d3f](https://github.com/snapetech/seerrng/commit/47a7d3f8f0a11c3d7cc70f2a5cd246770c532247))

### 📖 Documentation
- *(release)* Clarify PPA upload credentials - ([8e8f22d](https://github.com/snapetech/seerrng/commit/8e8f22d0c30dc5aa41191eb9001feb91ce414323))

## [3.40.0](https://github.com/snapetech/seerrng/compare/v3.39.3..v3.40.0) - 2026-09-29

### User-facing changes

#### Added

- **Comics:** Administrators can connect BackIssue through Settings, the administrator API, or the CLI. Comic requests can use it as their default destination, while SeerrNG syncs its collection and shows active queue status and progress when BackIssue reports it.

#### Fixed

- **Comics:** Comic detail pages now report when ComicVine rejects an issue-page request instead of showing a misleading empty issue list. Users can retry after fixing a connection problem or waiting for ComicVine to recover.
- **Release Pipeline:** PPA releases now wait for Launchpad to publish the matching Ubuntu source and binary packages, and retry binary uploads rejected before source publication.
  - **Action required:** configure LAUNCHPAD_CREDENTIALS for PPA publishing

### 🚀 Features
- *(comics)* Add BackIssue service support - ([ea06d28](https://github.com/snapetech/seerrng/commit/ea06d28d0c95d76905f45fe24c50b9b739154618))

### 🐛 Bug Fixes
- *(comics)* Surface ComicVine issue browsing failures - ([a61dac5](https://github.com/snapetech/seerrng/commit/a61dac517f565dc296c70fb9adffb74fcbf0a8fd))
- *(release)* Verify Launchpad PPA publication - ([edef0a4](https://github.com/snapetech/seerrng/commit/edef0a4b73ebdfd19c6ad4f0089b3519a3d2a5d9))

## [3.39.3](https://github.com/snapetech/seerrng/compare/v3.39.2..v3.39.3) - 2026-09-29

### User-facing changes

#### Fixed

- **Magazines:** Tracked magazine searches now work with older SeerrNG server contracts that do not recognize the optional public catalog selector; public catalog searches still use Google Books.

### 🐛 Bug Fixes
- *(magazines)* Omit the default tracked catalog query - ([6407a59](https://github.com/snapetech/seerrng/commit/6407a594ee9a3ac211ca6cb4401f54c606070901))

## [3.39.2](https://github.com/snapetech/seerrng/compare/v3.39.1..v3.39.2) - 2026-09-29

### User-facing changes

#### Changed

- **Bookshelf:** Book requests now leave acquisition and monitoring to Bookshelf or Chaptarr, then update availability after the library scan finds the requested files.

#### Fixed

- **Bookshelf:** All-format book discovery now shows enabled audiobook catalog matches alongside ebook results, labels each format correctly, and skips disabled formats.
- **Playback:** Native Jellyfin playback now retries startup authentication when the desktop bridge temporarily cannot clear a stale session.

### 🐛 Bug Fixes
- *(bookshelf)* Track monitored requests until available - ([7a4fd1e](https://github.com/snapetech/seerrng/commit/7a4fd1edbfcf540c58bbacde7584c183121abcbd))
- *(ci)* Align book discovery contract checks - ([90663e5](https://github.com/snapetech/seerrng/commit/90663e5f9ca8f9cc403c8fb694e91dab2500f6e7))
- *(desktop)* Retry failed native session resets - ([baa1377](https://github.com/snapetech/seerrng/commit/baa1377a0da18c692047dff19f29a9a6f5cd53f1))
- *(discovery)* Include enabled audiobook catalog results - ([401dae2](https://github.com/snapetech/seerrng/commit/401dae2bf9cbe3b6b66b81326b3c3114a9657eb3))

## [3.39.1](https://github.com/snapetech/seerrng/compare/v3.39.0..v3.39.1) - 2026-09-29

### User-facing changes

#### Fixed

- **Integrations:** ROMarrNG and QuestarrNG connection settings now identify whether SeerrNG itself could complete a test request, and point operators to the API key configured by the corresponding service.
  - **Action required:** Use the API key configured in each service's General settings.

### 🐛 Bug Fixes
- Clarify software service connection failures - ([55ab199](https://github.com/snapetech/seerrng/commit/55ab199e8c6c9ad75ffb8cf544590c8a988c152d))

## [3.39.0](https://github.com/snapetech/seerrng/compare/v3.38.0..v3.39.0) - 2026-09-29

### User-facing changes

#### Added

- **Playback:** Compatible Foreseer Desktop clients can open single-item Jellyfin playback in the same window. The optional handoff requires HTTPS; regular browser playback remains available for HTTP installs and when the desktop client is unavailable.
  - **Action required:** enable HTTPS for native playback

#### Fixed

- **Playback:** SeerrNG ignores duplicate desktop recovery notices during active authentication, preserving the valid Jellyfin session. Playback help also links directly to Foreseer Desktop remote setup instructions.

### 🚀 Features
- *(desktop)* Add secure Jellyfin playback handoff - ([ddc04d0](https://github.com/snapetech/seerrng/commit/ddc04d0ba3684e83253c3bc5c50c8f8d3356be72))

### 🐛 Bug Fixes
- *(desktop)* Preserve native session on recovery events - ([54993ed](https://github.com/snapetech/seerrng/commit/54993ed834bf57dea442f078cc580ba840660290))
- *(release-notes)* Allow updates to unshipped fragments - ([430a274](https://github.com/snapetech/seerrng/commit/430a2744fb40267ea6d1081952a88ac2301cf41e))

### 📖 Documentation
- *(release-notes)* Consolidate desktop recovery notes - ([9355996](https://github.com/snapetech/seerrng/commit/9355996f4f7bea9a577bdacc900cc97f859cbe85))

### 🧪 Testing
- *(desktop)* Cover native recovery events - ([a61fffa](https://github.com/snapetech/seerrng/commit/a61fffa48243b9350c5eef8b14030d1c87148de8))
- *(desktop)* Use HTTPS for ticket redemption checks - ([eff3dee](https://github.com/snapetech/seerrng/commit/eff3dee75be6e355fb734511de7f5fd6f862c120))

## [3.38.0](https://github.com/snapetech/seerrng/compare/v3.37.0..v3.38.0) - 2026-09-29

### User-facing changes

#### Added

- **Calendar:** Game entries in the Release Calendar link to the matching software catalog title and show the requested PC operating system or emulation system.
- **Calendar:** Requested PC games and emulation titles now appear in the Release Calendar when their IGDB catalog release date is available. My Requests stays private to you, while shared results follow the calendar’s existing permissions.
- **Calendar:** The Release Calendar now shows comic and magazine issues when Mylar3, Kapowarr, or LazyLibrarian reports an exact issue date. Personal calendars stay limited to the signed-in user's requests, and issue lookups are bounded and briefly cached.

#### Changed

- **Calendar:** The Release Calendar guide now explains which game catalog supplies release dates, how PC or emulation targets appear, and which events include date-change history.

#### Fixed

- **Release Calendar:** Game releases in the calendar now use the date IGDB records for the requested PC operating system or emulation platform. Titles without a complete date for that target are left off the calendar instead of showing another platform's launch date.
  - **Action required:** Update QuestarrNG and ROMarrNG to builds that return platform-specific release dates.
- **Calendar:** Personal calendars now omit internal server identifiers from provider status details. Issue processing also stops when its event limit is reached, keeping large comic and magazine provider responses from consuming unnecessary memory.

### 🚀 Features
- *(calendar)* Add comic and magazine issue releases - ([04c5490](https://github.com/snapetech/seerrng/commit/04c5490107f84f956c9f2cd96594ebbe351a09e4))
- *(calendar)* Use exact target platform release dates - ([8588b11](https://github.com/snapetech/seerrng/commit/8588b110be4e21a7445201c9c62532af5f507fd5))
- *(calendar)* Add PC and emulation game releases - ([dbbd1cb](https://github.com/snapetech/seerrng/commit/dbbd1cb3ab994f177d6aac9f9a16bdc53a991d3c))

### 🐛 Bug Fixes
- *(calendar)* Preserve issue order under event bounds - ([c6c7a9a](https://github.com/snapetech/seerrng/commit/c6c7a9ac9b105574a92da04178469d4cd544329b))
- *(calendar)* Bound issue event collection - ([c241a03](https://github.com/snapetech/seerrng/commit/c241a034c96538cb081f3866b5aa3cfac67d7d33))
- *(release)* Read Jellyfin plugin metadata from JSON - ([a84bb71](https://github.com/snapetech/seerrng/commit/a84bb715d4a4adab125209478d85ec90d2206c6a))

### 📖 Documentation
- *(calendar)* Note game links and target labels - ([ad237ca](https://github.com/snapetech/seerrng/commit/ad237ca52655ea528b0077a525b98f76eeb3a3f8))
- *(maintainers)* Clarify library repair coverage - ([6764121](https://github.com/snapetech/seerrng/commit/67641213cdbce073c774cf6b83f9434ee2e94237))

### 🧪 Testing
- *(calendar)* Cover exact platform date edge cases - ([0555365](https://github.com/snapetech/seerrng/commit/0555365c11b9cff412b457145aea4fbeeda93583))
- *(calendar)* Cover software event cards and filters - ([b0b339f](https://github.com/snapetech/seerrng/commit/b0b339f4641268684e3047640f8b4e0c98ac7588))
- *(calendar)* Cover software release events - ([c482182](https://github.com/snapetech/seerrng/commit/c48218215f5569a4399a8b4d73c0f38a67a4b1f1))
- *(jellyfin)* Smoke test bridge in disposable server - ([0e5cbff](https://github.com/snapetech/seerrng/commit/0e5cbffb153d90e0d323a75683dc1bc66997ee45))

### ⚙️ Miscellaneous Tasks
- *(calendar)* Explain software scope filtering - ([8388f3b](https://github.com/snapetech/seerrng/commit/8388f3ba023262f495df38644c10f39780462662))

## [3.37.0](https://github.com/snapetech/seerrng/compare/v3.36.0..v3.37.0) - 2026-09-29

### User-facing changes

#### Added

- **Bookshelf:** Administrators can preview and move ebook or audiobook paths inside one BookshelfNG library from the web UI, API, or a dry-run-first CLI, with live command status updates. Older split deployments must be consolidated before moving files.
  - **Action required:** Update BookshelfNG to a build with the bulk media-move API.
- **Discovery:** Users can repair unmatched Trakt, AniList, and MDBList discovery titles by choosing a SeerrNG catalog match. Saved matches stay private to the account and unlock the normal title card without changing the provider's original ID.
- **Discovery Integrations:** Provider discovery now explains when an account needs reconnecting, MDBList setup is missing, a list cannot be found, or a quota cooldown is active, so you can take the right recovery step.
- **Downloads:** The Download Inbox can match unmatched files to an existing movie, series, album, or book in Radarr, Sonarr, Lidarr, or Readarr before import. SeerrNG rechecks the selected target and file list before submitting the import.
- **Discovery:** Discovery feeds and personal libraries can match titles using exact IMDb or TVDB IDs when TMDB returns one valid result of the right media type. Ambiguous or unavailable titles remain in the manual repair flow, and you can save a private override for an automatic match.
- **Discovery Integrations:** Movie and series details, poster rating popovers, and collection averages now include available MDBList IMDb, Rotten Tomatoes, Metacritic, and Trakt scores. Existing rating sources remain visible when MDBList is unconfigured or unavailable.
- **Discovery:** Discover now shows personal Trakt recommendations and watchlists, plus AniList and Simkl planning and in-progress shelves for each connected account.
- **Personal Library:** My Library can save a private match from a Trakt, AniList, Simkl, Plex, Jellyfin, or Emby item to a movie or series in the SeerrNG catalog. Change or reset a match at any time; provider IDs and tracking actions remain tied to the original account item.
- **Discovery:** My Library can export saved provider-to-catalog title matches to a versioned JSON pack and import them elsewhere. Packs contain no provider credentials, and restored matches remain private to the importing account.
- **Prowlarr:** Administrators can test each enabled searchable Prowlarr indexer and see feed-specific failures and cooldown history alongside category coverage. The checks contact providers but never grab or download releases.
- **Media Requests:** Administrators can connect Prowlarr and inspect indexer coverage by medium. Users with Manage Requests can search movies, TV, music, ebooks, audiobooks, comics, magazines, ROMs, and PC games; approved requests still use their configured provider.
- **Discovery:** Administrators can share curated title matches with every account on a SeerrNG instance. Users’ private matches stay in control, and pack changes require clear confirmation because they affect all accounts.
- **Software Acquisition:** Administrators can choose ROMarrNG for the emulation IGDB catalog only when its handshake advertises SeerrNG catalog support; QuestarrNG remains the default catalog and PC-game provider, and ROMarrNG continues to acquire ROMs. Software request status also reflects retry and cancel restrictions when a provider reports them, while existing v1 provider routes remain compatible.
- **Release Calendar:** Daily release-history snapshots now track date changes for books in configured Bookshelf services. Calendar entries show recent previous and current dates within the same personal or shared scope as the matching ebook or audiobook request.
- **Release Calendar:** The release calendar now includes book releases from configured Bookshelf services, links each entry to book details, and keeps ebook and audiobook requests in their matching calendar views.
  - **Action required:** Configure a Readarr-compatible Bookshelf service for ebooks or audiobooks.
- **Jellyfin:** Jellyfin administrators can open a separately hosted SeerrNG from the dashboard with an already linked account. SeerrNG validates the active Jellyfin session and revokes bridge access when disabled or unlinked. Regular users should open SeerrNG directly and use its configured Jellyfin sign-in.
  - **Action required:** Link user accounts and enable bridge sign-in in SeerrNG, then install and configure the optional Jellyfin plugin.
- **Discovery:** Browse your linked Trakt, AniList, and Simkl libraries in My Library. You can update watched status and ratings, plus AniList episode progress, after enabling write consent for that account. SeerrNG does not automatically repeat an uncertain provider update.
- **Tracking:** Trakt and Simkl episode controls now show which episodes your linked account marks as watched and switch to the matching action. Simkl anime status follows TVDB season numbering when TVDB provides your anime metadata.
- **Discovery Integrations:** My Library can scan connected Trakt, AniList, and Simkl shelves for unique IMDb or TVDB matches and save confirmed results to your private title matches. Pause or resume a scan; existing manual and shared matches stay intact.
- **Calendar:** SeerrNG now tracks release-date and episode-air-time changes from monitored Radarr and Sonarr titles. Calendar entries show recent previous and current dates, with visibility following the selected personal or shared calendar scope.
- **Unraid:** SeerrNG's guides now explain the Snapetech-maintained ChaptarrNG fork, its format-aware pending-import integration, and its Unraid template. The template is published in the fork repository, but its first stable GHCR image is still pending, so wait for the image before installing.
  - **Action required:** Wait for ChaptarrNG's first stable GHCR image before installing its template.
- **Discovery Integrations:** My Library now lets you mark individual TV episodes watched or unwatched on Trakt and Simkl. Episode updates use the configured season list and linked catalog identities, with Simkl’s anime mapping applied when SeerrNG supplies TVDB coordinates.
- **Requests:** Jellyfin-linked TV request owners can opt into keeping up to five upcoming episodes requested in Sonarr as they watch. SeerrNG checks playback every 30 seconds by default, adds quota-exempt episodes after the parent request is approved, and matches requests by TVDB identity. Turning the buffer off stops future additions; episodes already requested remain in Sonarr.
- **Release Calendar:** The Release Calendar now includes upcoming album releases from Lidarr, with a music filter and links to matching music pages.
  - **Action required:** Configure Lidarr and enable Music to show album releases.
- **Personal Library:** My Library now browses each user's enabled Plex, Jellyfin, or Emby libraries with personal watched state and paged results. Only libraries accessible to that user and enabled in SeerrNG appear.

#### Changed

- **Books:** Audiobook discovery and search now use the configured audiobook catalog, including keyword searches and narrator filters, without mixing in ebook-only results. The Books link is hidden when ebook discovery is disabled.
- **Bookshelf:** BookshelfNG deployment guidance now distinguishes the shared catalog configuration used by one instance from per-process catalog choices in the optional split setup, including its default Library of Congress and Gutendex sources.
- **Discovery Integrations:** Provider quota alerts now show a concise countdown while Retry is paused, making it clear when another request can be sent.
- **Discovery:** Title-match controls now label the movie or series selector separately from the catalog search box, making automatic matches easier to review and override.
- **Discovery:** Discover now waits to request each connected provider's personal feed until its row nears the screen, reducing unnecessary provider traffic and keeping the initial page load lighter.
- **Media Requests:** Prowlarr's default searches now reach broader audio and PC indexer categories, separate console generations from PC games, and expose more standard category filters. Administrators can tune each medium to the categories their indexers advertise.
- **Indexer Search:** Prowlarr category suggestions now recognize more retro console aliases and newer systems such as Switch 2, helping administrators map custom ROM categories to the right media search.
- **Indexer Search:** Prowlarr settings can now suggest custom indexer categories from their advertised names for each medium. Administrators can review and save clear matches while leaving ambiguous categories under manual control.
- **Prowlarr:** Prowlarr searches now use media-specific search modes where supported, and media detail pages can open a prefilled search for that title. Search results remain informational and do not send releases to download clients.
- **Software Acquisition:** ROMarrNG connection checks now verify live system access instead of relying on cached platform data. The systems list explains its saved or cached source, and administrators can assign all systems to Retro or Modern at once.
- **Unraid:** ChaptarrNG's Unraid profile and Docker template now live in a dedicated package repository. Submit `snapetech/chaptarrng-unraid` in the Community Apps portal; the application source repository is no longer the catalog package source.
  - **Action required:** Submit https://github.com/snapetech/chaptarrng-unraid to Community Apps to make it searchable.
- **Jellyfin:** SeerrNG now enables Jellyfin bridge sign-in only when Jellyfin is the active media server and media-server login is available. The Jellyfin settings page shows these prerequisites, preventing a switch that appears enabled but cannot authenticate users.
  - **Action required:** Set Jellyfin as the active media server and enable media-server sign-in before enabling bridge sign-in.
- **Unraid:** SeerrNG's guides now confirm that ChaptarrNG v0.9.936 is available from GHCR and explain its fork-owned Unraid template. The image supports amd64, arm64, and armv7; Community Apps catalog submission is still pending.
  - **Action required:** Submit snapetech/chaptarrng to the Community Apps portal to make it searchable there.
- **Release Calendar:** Daily release-history snapshots now include monitored Lidarr albums, so upcoming music releases show date changes alongside movie releases and episode air times.

#### Fixed

- **Docs:** The Unraid guide now points to the published Bookshelf migration page, so its migration link opens correctly.
- **Personal Library:** Plex, Jellyfin, and Emby watched and in-progress shelves now filter and paginate against each user's own playback state, so sparse matches no longer disappear between pages.
- **Indexers:** Prowlarr coverage summaries now expose category counts without returning configured indexer names. Connection guidance also correctly describes approved requests handled by media and software providers.
- **Indexer Search:** Prowlarr category suggestions now refresh when you edit the connection, so custom IDs from a previous instance are not carried into the new mapping.
- **Database:** SeerrNG can now start cleanly while upgrading an existing database, even when newer per-user settings columns have not been added yet.
- **Software Acquisition:** Software provider connection checks now identify API-key, route, and network failures, and older compatible QuestarrNG integrations keep working. The Retro and Modern system-group help explains how those labels organize emulation browsing and requests.
- **Discovery Integrations:** Episode watch updates now use the catalog identities and season numbering configured for the connected provider, including TVDB anime numbering when applicable. The episode tracker also shows loading and empty-season states while retrieving episode lists.
- **Discovery Integrations:** Simkl episode tracking now applies TVDB anime-season mapping only when your configured anime metadata provider uses TVDB. Other series keep the season order selected for the provider account.
- **Bookshelf:** Book and audiobook discovery now follows the matching configured service and enablement setting. Audiobook-only setups no longer show ebook search options, and audiobook keyword searches stay scoped to audiobook catalogs.
- **Playback:** Named media-server playback windows now open on explicitly enabled HTTP deployments in browsers that do not provide crypto.randomUUID outside secure contexts.
- **Release Calendar:** Lidarr album entries now stay on the release date Lidarr reports, even when its API includes a timezone offset, so all-day releases no longer shift to a neighboring day.
- **Tracking:** Simkl episode controls now show watched state only after Simkl confirms the requested show match, so an unmatched result cannot be mistaken for watched episodes.

#### Security

- **Security:** SeerrNG updates its bundled upload and WebSocket dependencies to patched versions, closing newly reported denial-of-service issues without changing setup or use.
- **Bookshelf:** **Breaking:** The Bookshelf path-move CLI now opens saved preview files without following symbolic links, preventing a substituted file from redirecting an administrator API key. Windows CLI apply is disabled because Node.js does not provide the required no-follow open flag there.
  - **Action required:** Run CLI apply on Linux or macOS; Windows users can apply saved previews through the web UI or administrator API.

### 🚀 Features
- *(calendar)* Add Bookshelf book release events - ([0b79c1c](https://github.com/snapetech/seerrng/commit/0b79c1c49297bd4adfc8107683ae8ea19c01b315))
- *(calendar)* Include Lidarr album releases - ([8461bb7](https://github.com/snapetech/seerrng/commit/8461bb7e53533b71a29d9a6f3a4e838ce69521df))
- *(calendar)* Show recent release date changes - ([8bff46e](https://github.com/snapetech/seerrng/commit/8bff46ee24d0cb5f600e3af31bb6a75fc0ba1194))
- *(discovery)* Add bounded exact-ID library repair - ([e3d5168](https://github.com/snapetech/seerrng/commit/e3d5168ca7d0d69f06f054bb84a5798c0c5125b5))
- *(discovery)* Add episode-level watch tracking - ([ec288e3](https://github.com/snapetech/seerrng/commit/ec288e3144efcb6b17fbf3f30c92921c48bed1fb))
- *(jellyfin)* Add standalone SeerrNG bridge plugin - ([d8374ea](https://github.com/snapetech/seerrng/commit/d8374ea6a4d2c93f953d2777c6a62f46bc9e85ba))
- *(jellyfin)* Add episode watch-ahead requests - ([e0c67f1](https://github.com/snapetech/seerrng/commit/e0c67f1107567b20f451a7a18244c363803ab558))
- *(tracking)* Show provider episode watch state - ([deb9076](https://github.com/snapetech/seerrng/commit/deb90761055259e120fbcd27fc9b4c861a1bef90))
- Add Bookshelf media moves and shared title packs - ([156053f](https://github.com/snapetech/seerrng/commit/156053f0b373805a1e357285c84a72f7c9604901))
- Resolve exact provider IDs in discovery - ([1ff84e3](https://github.com/snapetech/seerrng/commit/1ff84e37dec5ddf7cd5c18c077575a9ddcb9a709))
- Back up personal title matches - ([c956c65](https://github.com/snapetech/seerrng/commit/c956c658a8005881b8c205a5aa1ac93cea68bd03))
- Repair unmatched discovery titles - ([b1006e2](https://github.com/snapetech/seerrng/commit/b1006e2306d82b43a53e25858e571c69ba2275cb))

### 🐛 Bug Fixes
- *(bookshelf)* Respect configured book formats - ([6eecd0a](https://github.com/snapetech/seerrng/commit/6eecd0a920bf621777e9afb09726422852c5abc2))
- *(calendar)* Preserve Lidarr album release days - ([c65aaa9](https://github.com/snapetech/seerrng/commit/c65aaa975dfd1a3e8bd8cdc0c83e49f4ea38c3ae))
- *(discovery)* Align Simkl anime season mapping - ([b0ca2c4](https://github.com/snapetech/seerrng/commit/b0ca2c43e7cbd79d05bb72fee245ae0f9630fdfe))
- *(discovery)* Match episode tracking identities - ([a11843c](https://github.com/snapetech/seerrng/commit/a11843cc8a979a817e47f93524f73025d2122eca))
- *(docs)* Repair Bookshelf migration link - ([adad2be](https://github.com/snapetech/seerrng/commit/adad2be3f96290e8522ad8fe44c126e8ab72e719))
- *(jellyfin)* Require active Jellyfin login for bridge - ([b1292ea](https://github.com/snapetech/seerrng/commit/b1292ea768ab861e2e61235d1c364a0cc71c909a))
- *(security)* Reject unsafe Bookshelf preview files - ([5add058](https://github.com/snapetech/seerrng/commit/5add0587b82a763cfe3106b63276111abbe06e5e))
- *(security)* Update vulnerable dependency overrides - ([b0e7e81](https://github.com/snapetech/seerrng/commit/b0e7e81f184dde8a6073f72f000fd7e624460cdd))
- *(tracking)* Ignore unmatched Simkl episode state - ([bb9dff1](https://github.com/snapetech/seerrng/commit/bb9dff1e70a807a63674f747d0d1074e4b61d361))
- Distinguish discovery title match controls - ([d532853](https://github.com/snapetech/seerrng/commit/d532853a1849aca2a966199f643ad19f1afeae3b))
- Align UI contract with typed checkbox values - ([3ef5026](https://github.com/snapetech/seerrng/commit/3ef50269aef598cf9b62cc9aa15dfea44a194abf))
- Link to the Bookshelf path migration guide - ([ea9a712](https://github.com/snapetech/seerrng/commit/ea9a712a611e1637bccd2d30805242707c192663))

### 📖 Documentation
- *(calendar)* Note Lidarr date history - ([cbe6f14](https://github.com/snapetech/seerrng/commit/cbe6f140eddb3cce4250e7a577390d1f99f87fc1))
- *(release)* Note Bookshelf calendar date history - ([6b9f625](https://github.com/snapetech/seerrng/commit/6b9f6253d49b040452a3c373e699fde9a76fa63a))
- *(unraid)* Add ChaptarrNG image availability note - ([729274c](https://github.com/snapetech/seerrng/commit/729274c602fd6f1b94504ca651402f88f6e9ef6f))
- *(unraid)* Document released ChaptarrNG image - ([e87068f](https://github.com/snapetech/seerrng/commit/e87068ff806e4c272bba1ba4553657f0edc1ff9b))
- *(unraid)* Clarify pending ChaptarrNG image release - ([cbed1e1](https://github.com/snapetech/seerrng/commit/cbed1e17f9b4b594e7ab62b41559ddc8d85c1700))
- *(unraid)* Add ChaptarrNG fork and template guidance - ([29aa761](https://github.com/snapetech/seerrng/commit/29aa761a62176915c174dbe199669e0ee278d0c6))
- Use dedicated ChaptarrNG Unraid package repo - ([8f03215](https://github.com/snapetech/seerrng/commit/8f03215fb069156cf44a8e0b4d0422174fe61923))

### 🧪 Testing
- *(calendar)* Cover date-change history - ([3c4791c](https://github.com/snapetech/seerrng/commit/3c4791c534e23a9f46639e99142c3d5923bc091e))
- *(cypress)* Enable Bookshelf in discovery fixtures - ([bec9f87](https://github.com/snapetech/seerrng/commit/bec9f87453f865dbe023a3f275512b61ea6ddbf0))
- *(cypress)* Stabilize seeded discovery fixtures - ([8ae98d8](https://github.com/snapetech/seerrng/commit/8ae98d8c62d62908adab0dffd0f340ce4b7186e3))

### ⚙️ Miscellaneous Tasks
- *(i18n)* Sync Jellyfin bridge setting copy - ([151d9c0](https://github.com/snapetech/seerrng/commit/151d9c05a25d5d652b6f1f521b8be292f50afcc2))
- *(jellyfin)* Stage episode watch-ahead state - ([ee08a38](https://github.com/snapetech/seerrng/commit/ee08a384bd2c4a0f1706af0dedd195d08644b9ce))

## [3.36.0](https://github.com/snapetech/seerrng/compare/v3.35.0..v3.36.0) - 2026-09-28

### User-facing changes

#### Added

- **Discovery Integrations:** Provider discovery now explains when an account needs reconnecting, MDBList setup is missing, a list cannot be found, or a quota cooldown is active, so you can take the right recovery step.
- **Downloads:** The Download Inbox can match unmatched files to an existing movie, series, album, or book in Radarr, Sonarr, Lidarr, or Readarr before import. SeerrNG rechecks the selected target and file list before submitting the import.
- **Discovery Integrations:** Movie and series details, poster rating popovers, and collection averages now include available MDBList IMDb, Rotten Tomatoes, Metacritic, and Trakt scores. Existing rating sources remain visible when MDBList is unconfigured or unavailable.
- **Discovery:** Discover now shows personal Trakt recommendations and watchlists, plus AniList and Simkl planning and in-progress shelves for each connected account.
- **Personal Library:** My Library can save a private match from a Trakt, AniList, Simkl, Plex, Jellyfin, or Emby item to a movie or series in the SeerrNG catalog. Change or reset a match at any time; provider IDs and tracking actions remain tied to the original account item.
- **Prowlarr:** Administrators can test each enabled searchable Prowlarr indexer and see feed-specific failures and cooldown history alongside category coverage. The checks contact providers but never grab or download releases.
- **Media Requests:** Administrators can connect Prowlarr and inspect indexer coverage by medium. Users with Manage Requests can search movies, TV, music, ebooks, audiobooks, comics, magazines, ROMs, and PC games; approved requests still use their configured provider.
- **Software Acquisition:** Administrators can choose ROMarrNG for the emulation IGDB catalog only when its handshake advertises SeerrNG catalog support; QuestarrNG remains the default catalog and PC-game provider, and ROMarrNG continues to acquire ROMs. Software request status also reflects retry and cancel restrictions when a provider reports them, while existing v1 provider routes remain compatible.
- **Discovery:** Browse your linked Trakt, AniList, and Simkl libraries in My Library. You can update watched status and ratings, plus AniList episode progress, after enabling write consent for that account. SeerrNG does not automatically repeat an uncertain provider update.
- **Personal Library:** My Library now browses each user's enabled Plex, Jellyfin, or Emby libraries with personal watched state and paged results. Only libraries accessible to that user and enabled in SeerrNG appear.

#### Changed

- **Books:** Audiobook discovery and search now use the configured audiobook catalog, including keyword searches and narrator filters, without mixing in ebook-only results. The Books link is hidden when ebook discovery is disabled.
- **Bookshelf:** BookshelfNG deployment guidance now distinguishes the shared catalog configuration used by one instance from per-process catalog choices in the optional split setup, including its default Library of Congress and Gutendex sources.
- **Discovery Integrations:** Provider quota alerts now show a concise countdown while Retry is paused, making it clear when another request can be sent.
- **Discovery:** Discover now waits to request each connected provider's personal feed until its row nears the screen, reducing unnecessary provider traffic and keeping the initial page load lighter.
- **Media Requests:** Prowlarr's default searches now reach broader audio and PC indexer categories, separate console generations from PC games, and expose more standard category filters. Administrators can tune each medium to the categories their indexers advertise.
- **Indexer Search:** Prowlarr category suggestions now recognize more retro console aliases and newer systems such as Switch 2, helping administrators map custom ROM categories to the right media search.
- **Indexer Search:** Prowlarr settings can now suggest custom indexer categories from their advertised names for each medium. Administrators can review and save clear matches while leaving ambiguous categories under manual control.
- **Prowlarr:** Prowlarr searches now use media-specific search modes where supported, and media detail pages can open a prefilled search for that title. Search results remain informational and do not send releases to download clients.
- **Software Acquisition:** ROMarrNG connection checks now verify live system access instead of relying on cached platform data. The systems list explains its saved or cached source, and administrators can assign all systems to Retro or Modern at once.

#### Fixed

- **Personal Library:** Plex, Jellyfin, and Emby watched and in-progress shelves now filter and paginate against each user's own playback state, so sparse matches no longer disappear between pages.
- **Indexers:** Prowlarr coverage summaries now expose category counts without returning configured indexer names. Connection guidance also correctly describes approved requests handled by media and software providers.
- **Indexer Search:** Prowlarr category suggestions now refresh when you edit the connection, so custom IDs from a previous instance are not carried into the new mapping.
- **Database:** SeerrNG can now start cleanly while upgrading an existing database, even when newer per-user settings columns have not been added yet.
- **Playback:** Named media-server playback windows now open on explicitly enabled HTTP deployments in browsers that do not provide crypto.randomUUID outside secure contexts.

### 🚀 Features
- *(discovery)* Add personalized provider rows - ([4072b8f](https://github.com/snapetech/seerrng/commit/4072b8f19ec0793b1203a59a6b44592d58408846))
- *(discovery)* Surface provider feed recovery states - ([4065659](https://github.com/snapetech/seerrng/commit/40656591473c5ce72d15cae9fa3c8495c103fe1c))
- *(discovery)* Complete cross-media discovery workflows - ([912376f](https://github.com/snapetech/seerrng/commit/912376f51e9b4186062b1b77e470f3925cf3da13))
- *(discovery)* Browse personal media server libraries - ([3b3978d](https://github.com/snapetech/seerrng/commit/3b3978dfca49754f4412a3b30f79d8670f698876))
- *(discovery)* Add personal provider library and write controls - ([7e49b2b](https://github.com/snapetech/seerrng/commit/7e49b2b5cca6e1bbf9eb215fcc46652306117212))
- *(indexer-search)* Detect additional console aliases - ([9b727f8](https://github.com/snapetech/seerrng/commit/9b727f84528f85aafb27a4fdfe08e2443dd3013a))
- *(indexer-search)* Suggest detected category mappings - ([e1eb874](https://github.com/snapetech/seerrng/commit/e1eb8741ae85323bfc82932a4342d32cee13f89e))
- *(indexer-search)* Improve cross-media category defaults - ([7a368b6](https://github.com/snapetech/seerrng/commit/7a368b69ca90213feb1ecb1f1c05dc1b2007df61))
- *(indexer-search)* Add Prowlarr manual search - ([7305417](https://github.com/snapetech/seerrng/commit/7305417a1fcf008aa7c1c6db4b62c0b7a112d43e))
- *(ratings)* Add MDBList scores to video and collection ratings - ([b91ae31](https://github.com/snapetech/seerrng/commit/b91ae3101fccf87e25fecbef432c1f8762a1b460))
- Add personal library identity matching - ([68d0d2c](https://github.com/snapetech/seerrng/commit/68d0d2cc1d75e9862fd9631132b6476e2a38bef8))
- Close download inbox, Prowlarr and game catalog gaps - ([6e2957f](https://github.com/snapetech/seerrng/commit/6e2957ff6e19934e799893ab5ebcbd6b7dcc8f4e))

### 🐛 Bug Fixes
- *(db)* Keep settings upgrades compatible with old schemas - ([d520cf0](https://github.com/snapetech/seerrng/commit/d520cf08de53e8177e97c5accf08dd6a3d18bf81))
- *(discovery)* Clarify provider quota recovery - ([420713c](https://github.com/snapetech/seerrng/commit/420713ced7fb6feeba07243880433929a71bdb59))
- *(indexer-search)* Refresh detected categories on connection edits - ([864433b](https://github.com/snapetech/seerrng/commit/864433bc37708bfaf28bec3a97dc507ca0bb8b51))
- *(indexer-search)* Reduce Prowlarr coverage data - ([6563775](https://github.com/snapetech/seerrng/commit/6563775a1b7ea53a493227e2662ac4bac9f9d09b))
- *(playback)* Support popup IDs over HTTP - ([3d2599f](https://github.com/snapetech/seerrng/commit/3d2599fd932ae93c43a0c5737321ed7684688b8e))
- *(test)* Exclude Vitest suites from node runner - ([532da5a](https://github.com/snapetech/seerrng/commit/532da5a5ae508134803c71e0ca41c99a71a5b46b))

### 📖 Documentation
- *(release)* Note lazy personal discovery feeds - ([4b6dc0d](https://github.com/snapetech/seerrng/commit/4b6dc0d318bb95afd8e4b9e2742aeb1cbfbcd045))

### ⚡ Performance
- *(discovery)* Defer personal feeds until visible - ([5560b29](https://github.com/snapetech/seerrng/commit/5560b29839b72eea4991a2408161c0375f55671a))

### 🧪 Testing
- *(indexer-search)* Remove database-bound route test - ([b966257](https://github.com/snapetech/seerrng/commit/b9662570a7858bb3f17315278f509b0f4abdb916))
- *(security)* Rate limit Prowlarr OpenAPI harness - ([669eda5](https://github.com/snapetech/seerrng/commit/669eda5dce4bba1e279efeb2b76ec82e31b8eaf1))

### ⚙️ Miscellaneous Tasks
- *(perf)* Refresh bundle baseline for feature release - ([f2ae9da](https://github.com/snapetech/seerrng/commit/f2ae9da01a0474e2a4f2558f5e31bfb3736913ed))

## [3.35.0](https://github.com/snapetech/seerrng/compare/v3.34.0..v3.35.0) - 2026-09-28

### User-facing changes

#### Added

- **Discovery:** Connect personal Trakt, AniList, and Simkl accounts, browse Trakt recommendations and watchlists, explore AniList catalogs, and open MDBList public lists. Provider credentials remain hidden, and unmatched titles retain their original catalog information.
  - **Action required:** Configure provider applications in Discovery Integrations, then connect personal accounts under Linked Accounts.
- **Discovery:** The discovery integration guide explains application setup, personal account authorization, unmatched catalog titles, and release calendar scopes and time zones.
- **Downloads:** Review acquisition warnings in the Download Inbox, preview movie and series files for manual import, and reject or blocklist downloads with explicit client-removal options. Actions verify the current backend and download identity, retain history, and report uncertain outcomes for review.
  - **Action required:** Grant Manage Downloads to staff who need queue access.
- **Calendar:** Browse movie release dates and upcoming series episodes in the Release Calendar. Your requests are shown by default; shared calendars follow request-view permissions. Cached acquisition-service reads are bounded, and unavailable sources are identified without hiding successful results.

#### Fixed

- **Documentation:** Bookshelf setup and migration links now open SeerrNG's maintained guides. README links point to available source documents so users can reach shared-instance and migration instructions directly.
- **Discovery:** Simkl library reads now reuse a bounded cache scoped to the linked account, reducing repeated provider requests without mixing results between people.
- **Image Cache:** Visible media artwork can now be queued for background image-cache warming, helping pages reuse artwork more reliably when users return to them.
- **Magazines:** Direct links to magazine discovery now render consistently before SeerrNG checks provider availability, avoiding a client-side rendering error when the catalog is disabled.

#### Security

- **Integrations:** Discovery integrations now reject malformed MDBList links and repeated list parameters before contacting providers, reducing the risk of confusing or unintended requests. Existing valid list URLs continue to work.

### 🚀 Features
- *(calendar)* Add scoped release agenda with cached backend reads - ([353d1a6](https://github.com/snapetech/seerrng/commit/353d1a65add3c40f92aedd5963e35db35f8225b9))
- *(discovery)* Add personal provider connections and catalog browsing - ([297e5de](https://github.com/snapetech/seerrng/commit/297e5de056167069ce01361c3b52a9255503688e))
- *(downloads)* Add durable intervention inbox and verified queue actions - ([ba8024b](https://github.com/snapetech/seerrng/commit/ba8024be7f1f377bda0f1b3c452a294a55685863))

### 🐛 Bug Fixes
- *(api)* Expose image cache warming endpoint - ([fc75057](https://github.com/snapetech/seerrng/commit/fc75057554b84cc30d3c34d7e217ade2ac05a712))
- *(docs)* Repair SeerrNG guide links - ([83dfa0b](https://github.com/snapetech/seerrng/commit/83dfa0b3cca6bc69a6b0887c8e4e553d5395ed91))
- *(magazines)* Stabilize direct-link hydration - ([42d77f7](https://github.com/snapetech/seerrng/commit/42d77f74a9f8681c3bedb0103f53146d49676b66))
- *(security)* Validate discovery provider inputs - ([291dd34](https://github.com/snapetech/seerrng/commit/291dd3486f673a0cf0d4505c645c2040d6ae2ec9))
- *(simkl)* Cache account reads safely - ([bb568e3](https://github.com/snapetech/seerrng/commit/bb568e3c856ff76c472b2d4821db4f24a4a9f6df))

### 🎨 Styling
- *(routes)* Format download inbox mount - ([20f45a8](https://github.com/snapetech/seerrng/commit/20f45a83d308eaa62f4db8e31e03f6b042b78afd))

### 🧪 Testing
- *(security)* Use secure cookie in validated harness - ([0ff4edf](https://github.com/snapetech/seerrng/commit/0ff4edfa4ce8eadcd503f6b89cc100ff6c72fa0f))

## [3.34.0](https://github.com/snapetech/seerrng/compare/v3.33.0..v3.34.0) - 2026-09-28

### User-facing changes

#### Added

- **Software:** Modern catalogs can now include PS4, PS5, Vita, Xbox One and Xbox Series titles through updated ROMarrNG. Complete folder dumps preserve their assets and download as one archive. Console acquisition support does not imply emulator compatibility.
  - **Action required:** Update ROMarrNG and assign the new systems to Modern in Software Acquisition settings.
- **Software:** Complete console game archives now support resumable downloads through updated ROMarrNG. Interrupted transfers can continue from a byte range while preserving the whole game directory structure.
  - **Action required:** Update ROMarrNG to enable resumable complete-game archive downloads.

#### Fixed

- **Unraid:** The Unraid guide now focuses on installing and configuring optional services, with a direct BookshelfNG listing link and manual template links. Repository submission instructions have been removed from user setup guidance.
- **Software:** Invalid or out-of-bounds game download resume ranges now return HTTP 416 instead of a generic provider failure. ROMarrNG and QuestarrNG error bodies remain private, while clients receive the file size needed to restart the transfer.

### 🚀 Features
- *(software)* Document and verify recent-console acquisition contracts - ([2bf1fdd](https://github.com/snapetech/seerrng/commit/2bf1fdd317f68a0c03dffbf7eff75aaec61348c9))

### 🐛 Bug Fixes
- *(downloads)* Preserve resumable game transfers and range errors - ([7fbde17](https://github.com/snapetech/seerrng/commit/7fbde173cc142426a191c9fa69b4f10e244126b9))

### 📖 Documentation
- *(unraid)* Focus companion guidance on installation and setup - ([a6128d2](https://github.com/snapetech/seerrng/commit/a6128d20123ce7d49e2cec65a4886387187e4421))

## [3.33.0](https://github.com/snapetech/seerrng/compare/v3.32.0..v3.33.0) - 2026-09-27

### User-facing changes

#### Changed

- **Bookshelf:** Fresh setup now recommends one BookshelfNG instance for both formats and offers a shortcut to add its second SeerrNG connection. Existing split installs show how to combine after migrating their separate audiobook library.
- **Unraid:** The Unraid guide now distinguishes NG fork template files on GitHub from searchable Community Apps listings, so operators know that each fork needs its own catalog submission.
  - **Action required:** Submit and scan each NG fork repository before expecting its template in Community Apps search.
- **Unraid:** SeerrNG no longer offers duplicate Unraid templates for the third-party LazyLibrarian, Mylar3, and Kapowarr apps. The Unraid guide links to their existing Community Apps listings, and NG companion templates now link to SeerrNG support.
  - **Action required:** Install LazyLibrarian, Mylar3, and Kapowarr from their existing Community Apps listings; use SeerrNG templates for the NG forks.

#### Fixed

- **Unraid:** The Unraid guide now links to BookshelfNG's dedicated template repository, avoiding scan warnings caused by unrelated XML files in its application source.
  - **Action required:** Use https://github.com/snapetech/bookshelfng-unraid for the BookshelfNG Community Apps submission.
- **Unraid:** SeerrNG's Unraid repository now publishes only SeerrNG. The optional NG forks keep one standalone template each in their own repositories, avoiding duplicate catalog submissions; the Unraid guide links to those templates.
  - **Action required:** Use the BookshelfNG, ROMarrNG, and QuestarrNG templates in their own repositories when installing those optional apps.
- **Unraid:** The Unraid guide now shows the exact repository URLs to submit for BookshelfNG, ROMarrNG, and QuestarrNG, preventing the portal from rejecting an already-listed SeerrNG repository.
  - **Action required:** Submit each NG fork's repository URL, not an XML file URL or the already-listed SeerrNG repository.

### 🚀 Features
- *(bookshelf)* Guide combined setup and upgrades - ([07fd5ea](https://github.com/snapetech/seerrng/commit/07fd5ea27bfdf9c695d036ff0fcc3b62c5370bb8))

### 🐛 Bug Fixes
- *(unraid)* Submit clean BookshelfNG template repository - ([83b94dc](https://github.com/snapetech/seerrng/commit/83b94dc14c684d903d374c03667a73effac3e679))
- *(unraid)* Keep fork templates in their own repositories - ([a866206](https://github.com/snapetech/seerrng/commit/a866206fc2fbaa21c6a89545a1201961f1988bcc))
- *(unraid)* Use existing upstream Community Apps listings - ([346226f](https://github.com/snapetech/seerrng/commit/346226f09b81cfb78d6173d239dee269cad58212))

### 📖 Documentation
- *(unraid)* Show fork repository submission URLs - ([7ded089](https://github.com/snapetech/seerrng/commit/7ded089e6a279e142f781488bf704c1bf91ac193))
- *(unraid)* Distinguish template source from CA listing - ([707eb3e](https://github.com/snapetech/seerrng/commit/707eb3ecdc523a5b7a9399eae082ef3a77b27dae))

## [3.32.0](https://github.com/snapetech/seerrng/compare/v3.31.0..v3.32.0) - 2026-09-27

### User-facing changes

#### Added

- **Comics:** Comic discovery can now filter the full volume catalog by publisher, start year, and issue count. The first filtered search builds a resumable local index and shows progress; later searches use the completed index for accurate result counts and pages.
- **Unraid:** Unraid operators can now deploy SeerrNG with BookshelfNG, LazyLibrarian, Mylar3, Kapowarr, ROMarrNG, and QuestarrNG as one managed Compose project.
  - **Action required:** Install a Compose manager, select service profiles, and configure service API keys to use the stack.
- **Unraid:** Unraid now has separate optional companion templates for BookshelfNG, LazyLibrarian, Mylar3, Kapowarr, ROMarrNG, and QuestarrNG. Each app runs independently; the NG forks also support SeerrNG integration.
  - **Action required:** Install only the companion templates you need, finish each app's own setup, then enter its API key in SeerrNG.

#### Changed

- **Bookshelf:** Bookshelf setup now explains how to register one instance for both books and audiobooks. Book cards preserve the selected format and lookup title when opening requests, while catalog editions collapse into one result and recent detail lookups are reused.

#### Fixed

- **Bookshelf:** Book search now places closer title matches first, and typed search terms retry after filter navigation cancels a route change so the search is not lost.
- **Comics:** An empty comic filter result no longer incorrectly says that a ComicVine API key is missing when the key is configured.
- **Comics:** The comic catalog's Apply filters button now uses the same accessible, styled control as other actions.
- **Comics:** Comic discovery's publisher, year, issue-count, and index-progress controls now have English catalog entries, so the new filters render with their labels and guidance.
- **Comics:** The ComicVine volume index now keeps scanning when new volumes are added at the end of the catalog, avoiding a full restart during long initial scans.
- **Comics:** An interrupted ComicVine volume index now resumes automatically when SeerrNG restarts, without waiting for someone to reopen filtered discovery.
- **Release Pipeline:** Release retries now queue behind another run for the same tag instead of cancelling an active publication.
- **Software:** Software browsing now explains when genre and release-year filters need a newer QuestarrNG version instead of suggesting the service is disconnected.
  - **Action required:** Update QuestarrNG to use genre and release-year filters.
- **Software:** Software browsing now shows all 50 titles returned by older QuestarrNG versions, so titles beyond the first 24 no longer disappear from their catalog window.
- **Unraid:** SeerrNG's Unraid template and companion stack now use an init process so the service handles shutdown signals and child processes cleanly.
  - **Action required:** Reapply the Community Apps template or recreate the Compose service to enable the init process.

#### Security

- **Library Removal:** Library-removal confirmation tokens are now keyed with SeerrNG's application API key, preventing the confirmation digest from exposing service credentials to offline guessing.

### Technical history

- feat(comics): index volumes for complete metadata filtering ([15d7d2089](https://github.com/snapetech/seerrng/commit/15d7d2089))
- fix(comics): polish filters and resume index on startup ([807df436e](https://github.com/snapetech/seerrng/commit/807df436e))
- chore(i18n): extract comic filter messages ([e9dab357f](https://github.com/snapetech/seerrng/commit/e9dab357f))
- fix(i18n): add comic discovery filter labels ([6148a4ead](https://github.com/snapetech/seerrng/commit/6148a4ead))
- fix(release): resolve image digest from GHCR ([810a6b0f4](https://github.com/snapetech/seerrng/commit/810a6b0f4))
- fix(software): preserve legacy catalog window and explain filter upgrade ([51b7b6abb](https://github.com/snapetech/seerrng/commit/51b7b6abb))
- feat(unraid): provide companion service Compose project ([60c9e9b77](https://github.com/snapetech/seerrng/commit/60c9e9b77))
- fix(comics): tolerate volume additions during index scans ([6a204cd71](https://github.com/snapetech/seerrng/commit/6a204cd71))
- style: format release readiness regression tests ([b9cd5f463](https://github.com/snapetech/seerrng/commit/b9cd5f463))
- fix(security): sign library removal plan tokens ([5ba05e7e6](https://github.com/snapetech/seerrng/commit/5ba05e7e6))
- fix(codeql): clarify comics index selection check ([418296c0d](https://github.com/snapetech/seerrng/commit/418296c0d))
- test(release): cover invalid area slug ([6dc272d8f](https://github.com/snapetech/seerrng/commit/6dc272d8f))
- chore(codeql): remove ineffective inline suppression ([9fda7cb88](https://github.com/snapetech/seerrng/commit/9fda7cb88))
- fix(unraid): enable init for clean SeerrNG shutdown ([dc6866c3f](https://github.com/snapetech/seerrng/commit/dc6866c3f))
- feat(bookshelf): improve catalog search and format guidance ([6fd9671c3](https://github.com/snapetech/seerrng/commit/6fd9671c3))
- feat(unraid): package optional standalone companions individually ([c438d309f](https://github.com/snapetech/seerrng/commit/c438d309f))
- fix(release): queue same-tag publication attempts ([27d03db31](https://github.com/snapetech/seerrng/commit/27d03db31))

## [3.31.0](https://github.com/snapetech/seerrng/compare/v3.30.0..v3.31.0) - 2026-09-27

### User-facing changes

#### Added

- **Comics:** Comic detail pages now show back issues with covers and dates when available, loading more issues as you browse a volume.
- **Software:** Game details now show IGDB ratings, screenshots, developer names, and video links when available, while catalog pages remain compact.
  - **Action required:** Upgrade QuestarrNG to a build with enriched SeerrNG game details to see screenshots and videos.
- **Software:** Software titles now open a shareable detail view with their summary, genres, release date, and supported request targets.
- **Software:** Software catalog cards now show titles already tracked, downloading, or in the provider libraries, including ROM availability by system. Incomplete ROM inventories show unknown availability.
  - **Action required:** Upgrade QuestarrNG and ROMarrNG to builds with library lookup support for existing-library badges.
- **Software:** ROM and PC game catalogs now load more matching titles as you scroll, so searches are no longer limited to the first provider window after QuestarrNG is upgraded.
  - **Action required:** Upgrade QuestarrNG to a build with paged SeerrNG catalog endpoints to use additional pages
- **Software:** Main Search now includes a Software category with paged ROM and PC game results, plus a software preview in All results.
- **Software:** ROM and PC game browsing now filters by emulation system or operating system, making it easier to find titles for a specific target.
- **Software:** Software catalog searches and popular lists can now be narrowed by genre and release year across Retro, Modern, and PC Games. Filters apply before pagination so matching titles remain discoverable on later pages.
  - **Action required:** Upgrade QuestarrNG to a build with genre and release-year catalog filters.

#### Changed

- **Discovery:** Comic and game covers now use SeerrNG's optional image cache, reducing repeat downloads while browsing discovery and request status.
- **Software:** Software catalog browsing now searches a wider set of titles before filtering by PC or emulation system, and repeats fewer provider requests.
- **Comics:** Comic requests target full ComicVine volumes; Mylar3 or Kapowarr manages back-issue searching, and SeerrNG shows issue availability after sync.
- **Unraid:** The SeerrNG Community Apps listing now describes comic, magazine, ROM, and PC game requests and names BookshelfNG, ROMarrNG, QuestarrNG, Mylar3, Kapowarr, and LazyLibrarian integrations.

#### Fixed

- **Magazines:** Magazine detail lookups now stop after 20 seconds if configured LazyLibrarian services stall, so failover cannot leave a page request waiting on every service timeout.
- **Magazines:** Tracked magazine discovery now returns results from responsive services within 20 seconds instead of waiting through every stalled LazyLibrarian timeout.
- **Comics:** Returning to comic discovery now restores the loaded catalog pages and scroll position, matching movie browsing.
- **Software:** IGDB game ratings now display on SeerrNG's 10-point scale, so typical catalog scores appear in software details.
- **Comics:** Comic detail issue dates use the shared detail text styling, and loaded issues remain visible with a retry option if ComicVine fails on a later page.
- **Software:** Software catalog paging now accepts opaque provider cursors and stops cleanly when a page token cannot advance, while keeping already loaded titles visible if a later page fails.
- **Software:** Closing a software title detail now returns to the prior catalog state without leaving an extra browser history step.
- **Search:** Global search now shows magazine titles from responsive LazyLibrarian services when another service stalls, while limiting simultaneous catalog lookups.
- **Magazines:** Magazine details and issue availability now load from another configured LazyLibrarian service when the preferred service is unavailable or does not track the title.
- **Magazines:** Tracked and public magazine discovery now accepts the selected catalog, allowing SeerrNG to return LazyLibrarian titles and Google Books results as intended.
- **Magazines:** Tracked magazine discovery now shows titles from healthy LazyLibrarian services when another configured service is unavailable.
- **Software:** An invalid software release year now shows a clear validation message and pauses catalog loading instead of silently displaying unfiltered titles.

#### Security

- **Logging:** LazyLibrarian connection failures now redact API key values and control characters before SeerrNG writes error details to its logs.
- **Software:** Software provider errors now pass through credential redaction before logging, hiding API keys if an upstream failure echoes them.
- **Software:** Software catalog covers are now accepted only from IGDB's image host, so a catalog response cannot send users' browsers to arbitrary image servers.
- **Comics:** ComicVine covers now use only approved HTTPS origins, and ComicVine lookup failures no longer expose the API key in application logs.

### 🚀 Features
- *(comics)* Browse paged back issues on volume details - ([d0e7f0a](https://github.com/snapetech/seerrng/commit/d0e7f0a049101ddcc61cb159f54a1e5aa8462213))
- *(discovery)* Cache comic and software artwork and catalogs - ([fab6c93](https://github.com/snapetech/seerrng/commit/fab6c939d5b23de0f71319b6fc0d226f4cd2dba3))
- *(software)* Filter catalog by genre and release year - ([5abcffe](https://github.com/snapetech/seerrng/commit/5abcffec24389592a4f1eb2a4c25b679d2511021))
- *(software)* Show IGDB detail screenshots and videos - ([0d587e0](https://github.com/snapetech/seerrng/commit/0d587e041bef0caffcdd700d9f2d24fecc50fc6a))
- *(software)* Show catalog library availability - ([9905722](https://github.com/snapetech/seerrng/commit/99057225ffdcc999ea9c52f0664b682c47e041f8))
- *(software)* Include catalog in global search - ([c5081d2](https://github.com/snapetech/seerrng/commit/c5081d2c7b585d4540bff1bd68031717904e61c5))
- *(software)* Open shareable catalog title details - ([7e65106](https://github.com/snapetech/seerrng/commit/7e6510646e590ae8e402298c35f1566f094d5377))
- *(software)* Filter catalogs by system and PC platform - ([eb2133a](https://github.com/snapetech/seerrng/commit/eb2133abadcb66e1db8041a424f24e107a1b2063))
- *(software)* Page QuestarrNG game catalogs - ([1c8552d](https://github.com/snapetech/seerrng/commit/1c8552d1084c16190d8053535226c9f9100aa5e9))

### 🐛 Bug Fixes
- *(ci)* Restrict security-note correction to main - ([e70a2be](https://github.com/snapetech/seerrng/commit/e70a2be57df0e45da135751e284e7f25175c88bd))
- *(i18n)* Add software catalog filter labels - ([4774533](https://github.com/snapetech/seerrng/commit/4774533d09a0439e04ba20653b125efd06d9c3a4))
- *(i18n)* Extract software catalog messages - ([13fa927](https://github.com/snapetech/seerrng/commit/13fa9278400f746516cd0277dcd5d39d0240f69c))
- *(magazines)* Bound tracked catalog discovery - ([e43bb22](https://github.com/snapetech/seerrng/commit/e43bb22db982e411af0a29882fbc9ea104bb8b5c))
- *(magazines)* Fall back across detail services - ([fad3893](https://github.com/snapetech/seerrng/commit/fad38932b6f8ed4a44bcc8f1c5890555dbaa3b4e))
- *(magazines)* Bound discovery service fan-out - ([6a7d5b9](https://github.com/snapetech/seerrng/commit/6a7d5b99c4c6e4c7fdb388535f49601aec039267))
- *(magazines)* Preserve healthy catalogs during service failures - ([193aa84](https://github.com/snapetech/seerrng/commit/193aa84bb3117f323134f42ef5910c29ff5e8c84))
- *(release)* Include every note in Discord announcements - ([e3589f5](https://github.com/snapetech/seerrng/commit/e3589f589bd266534799ce111da6366647dc2c89))
- *(search)* Retain magazine matches when a service stalls - ([cae0ddf](https://github.com/snapetech/seerrng/commit/cae0ddf1df2b664cf959a518c39a66209c94bd1e))
- *(security)* Normalize software ratings and redact errors - ([8c7ada5](https://github.com/snapetech/seerrng/commit/8c7ada59f998483ecde87701235160c45399d4ab))
- *(security)* Constrain ComicVine provider data - ([f149636](https://github.com/snapetech/seerrng/commit/f149636d4e4db448ba0ad47860956c450d168114))
- *(security)* Constrain catalog artwork and bound magazine fallback - ([f243c09](https://github.com/snapetech/seerrng/commit/f243c09685dc50ec86fe524c06a6498c151a744b))
- *(software)* Explain invalid catalog release years - ([2e015c0](https://github.com/snapetech/seerrng/commit/2e015c0aae88b04af6046df2103969270aced28a))
- *(software)* Avoid duplicate history for title details - ([0ddce80](https://github.com/snapetech/seerrng/commit/0ddce80a85af819368a4bb592c12ca96f5a36eda))
- *(software)* Preserve paged catalog state on failures - ([2d9f045](https://github.com/snapetech/seerrng/commit/2d9f045c296dc07d7e2e0fc0468bf23079097a05))
- *(ui)* Finish software and comic detail polish - ([563a07e](https://github.com/snapetech/seerrng/commit/563a07ee3d25dce99a78a2f228e5c5f1a7b81297))
- Complete Unraid integrations and magazine discovery - ([e9c3989](https://github.com/snapetech/seerrng/commit/e9c3989fb388e3c88689636b8961d3cf04428e98))

## [3.30.0](https://github.com/snapetech/seerrng/compare/v3.29.0..v3.30.0) - 2026-09-27

### User-facing changes

#### Added

- **Bookshelf:** Books with series information now open a collection-style page with format filters, related titles, and a collection request flow.
- **Music:** Music collections can be filtered by release type, genre and year. Selection and playback exclude hidden items; cyan selection controls stay together on the left. Music discovery and search share expanded release types, including Live, Compilation and Remix, with filtering before pagination.
- **Music:** Music collections show their six most common album genres and a short, attributed artist biography, with a simple fallback. Album and collection ratings now include separate TheAudioDB and Discogs scores, native scales, vote counts and source links; collection averages keep providers separate.
- **Collections:** Administrators can add and remove collections on Plex, Jellyfin and Emby. Linked collections gain newly indexed movies automatically; visible pages check each minute. Removal requires confirmation, stops automatic updates and preserves media files. Buttons use the configured server logo, with full justification limited to the collection page.
- **Collections:** Official TV franchises and artist album catalogues now have collection pages with shared selection, quality-specific playback, and media-server Add/Remove controls. Linked collections gain newly available titles automatically. Removing a collection preserves its media files.
- **Interface:** The collection action row now includes Watch Trailer for the first movie in oldest-first order. It uses the standard trailer button and explains when no trailer is available, without substituting another movie.
- **Manage Media:** View Details expands each issue's description, comments, comment entry and Close/Reopen Issue actions directly beneath its summary. View Issue remains available one row above. Close All Issues is now named Close Open Issues. Shared controls preserve existing permissions and refresh issue status without leaving Manage.
- **Interface:** Manage now offers Blocklist Title beside Remove From Blocklist for movies, series, books and music. The red action explains its effect, asks for confirmation, and is disabled when the title is already blocked or you lack permission.
- **Movie Details:** Movie details now offer View Collection beside View Cast. Expand it to show the collection card directly below the controls, or pin it open across movie pages. Collection pins are saved per user without changing cast and crew preferences.
- **Media Details:** Movie, series, book and album pages have a details toggle beside their cast, artist or subject buttons. Pin the card open across titles of the same media type; preferences are saved separately for each user and media type.

#### Changed

- **Media Details:** Season, episode, and track lists now show five rows before scrolling inside the list, keeping detail and request screens more compact.
- **Requests:** The filtered Requests screen now lives directly at `/requests`, with consistent navigation, faster page preloading, and neutral loading labels while media details arrive.
- **Collections:** Collection selections now apply when creating a collection, without blocking automatic additions of newly available titles. Already-available items left out at creation and items manually removed afterward stay out. Remove and recreate a collection to apply a different selection.
- **Media Details:** Media disclosure rows place Collection, Cast, Crew or Artists, and Subject Tags before the shortened Details button, where available. Request Discography is aligned to the right without changing other button-row alignment or pin behavior.
- **Media Details:** Media detail and collection disclosure buttons use shorter Collection, Artists, Cast and Crew labels while preserving their pin and expand/collapse behavior.
- **Music:** Music collections load posters and ratings in full-list batches of 50, retaining fetched results when filters change. The Release Year row shows loading, then the selected count. Clear Filters gains an icon and Title View a distinct labeled icon. TheAudioDB and Discogs show logos, and unrated badges remain linked to their source.
- **Ui:** Compact filter and rating dropdowns show at most eight options at once, with scrolling for longer lists and a smaller height when screen space is limited.
- **Appearance:** The default SeerrNG theme now includes the approved black readability layers and black-to-dark-blue background directly. The redundant Blackout choice has been removed from the theme picker.
- **Interface:** Primary action buttons now use the compact height while retaining their existing text and styling. Delete From Library confirmations name the title and destination app and explicitly warn that the media files and library entry will be permanently deleted.
- **Associations:** Browse More now has a magnifying-glass icon in the Associations dialog for every media type, using shared button styling.
- **Associations:** Associations use the shared details-card layout, with adaptive columns and the association reason retained at the bottom right. Movie cards show the same metadata as movie details, loading extra information only when a card is visible.
- **Interface:** Blackout now uses a clean black-to-blue background without the grey upper-right glow. Matching menu and dialog backgrounds follow the same treatment; other color schemes are unchanged.
- **Interface:** Blackout detail dividers use a stronger translucent white shadow without the solid halo. Movie Details again inherits the shared global treatment, matching other detail pages while retaining the black divider line.
- **Interface:** Blackout detail dividers now have a narrow opaque white halo behind the black line, plus the existing soft outer glow, making their immediate edges consistently white over colorful artwork. Other palettes are unchanged.
- **Interface:** Buttons now offer consistent help, including why actions are disabled and what playback controls do. Close All Issues explains its effects before confirmation. Media action rows fill their available width; Manage and Report Issue have visible labels while Blocklist stays icon-only.
- **Media Details:** Bibliography and discography requests now sit with the detail disclosures. Their selection lists use collection-style cards with a three-item scrolling window, also used for association sections. Book and album details can be collapsed and pinned open.
- **Media Details:** Details cards center the middle divider, headings and values together while keeping the outer columns content-sized. Row-spanning middle dividers cover their full allotted rows, including issue cards with only two populated middle fields. Narrow layouts remain stacked.
- **Interface:** The media-page collection panel is now a single subcard. Its overview spans the details table and expands to show the full text, followed by genres and collection size. The separate overview card and unused rows are removed.
- **Interface:** The collection page now places its full overview inside the first details card, matching movie-page collection summaries. Both share poster, table and divider styling, with genres and collection size below the overview and one consistent two-pixel divider width.
- **Interface:** Collections show separate average ratings from Rotten Tomatoes critics and audiences, IMDb, and TMDB, excluding missing scores. Movie cards use the shared details layout with a ratings row. Playback defaults to HD, with a quality selector that includes only selected titles available in that quality and never substitutes another version.
- **Interface:** Collection-card ratings are evenly distributed from the first value column through the second value column, leaving the third details column clear. Fixed gaps between rating pairs are removed; icon sizes and text remain unchanged.
- **Interface:** Collection movie-card ratings now sit together in a compact, left-aligned value cell spanning the details table after an empty label cell. Icon and text sizes stay unchanged, and narrow screens wrap the ratings without overflowing.
- **Library:** **Breaking:** Availability sync now cleans up confirmed movie and series removals. Remaining qualities, blocklists and watchlists are preserved. When the last copy is gone, requests and issues are deleted and unneeded media records are removed. Failed or inconclusive service checks leave records unchanged.
  - **Action required:** Review request and issue retention before enabling availability sync after upgrading.
- **Interface:** Details cards size their first and last columns to their contents, leaving remaining space for the middle column. Movie, series, book and music cards adapt to their different labels instead of fixed percentages. Availability now displays “Not Available” in title case.
- **Interface:** Details cards use a revised 35% / 43% / 22% column balance across shared layouts, giving the first column more room while keeping the middle column wider. Collection cards and nested details follow the same proportions.
- **Interface:** Details cards reserve 25% of the table for the third column and divide the remaining space equally between the first two columns. Dates and other leading details have more room across pages and dialogs, including collection cards.
- **Interface:** Details tables now allocate 30% to the first column, 45% to the middle and 25% to the third. Shared cards, including collection members and music details, keep the same proportions while giving the middle column more room.
- **Interface:** Detail disclosure buttons such as View Collection, View Cast, View Crew, and Subject Tags now share Manage's purple styling so they stand out from nearby text links. Pin controls retain a distinct selected state, with sizing and behavior unchanged.
- **Interface:** Main and inset cards now share eight-pixel inner padding and spacing between cards. Detail subcards, request and issue lists, Manage screens, and Settings card grids use the same global spacing, without changing button spacing or text sizes.
- **Manage Media:** View All Issues expands an inline scrollable card containing all open and resolved issue details, with at most three cards visible at once. Manage keeps a single media summary at the top instead of repeating open issues there. The same layout applies to every media type.
- **Interface:** Main cards and inset cards now share compact five-pixel inner padding across media details, requests, issues, Manage, dialogs, and Settings. Card colors, transparency, text sizes, page widths, and button sizing are unchanged.
- **Interface:** Main-menu items now use consistent diagonal dark-to-light blue highlights on desktop and mobile: darker when hovered, normal when selected, and brighter when hovering over the selected item. Keyboard focus remains clearly outlined.
- **Manage Media:** Manage uses singular Service, Request and Delete Request labels. Action descriptions are shorter, name Delete Request explicitly and omit redundant service, blocklist and empty-request notes.
- **Interface:** Manage now groups actions under Services, Blocklist, Requests, and Issues, with configured service names, explanatory text, tooltips, and confirmed actions to close or delete this item's issues. Media details no longer show a red dot on Manage.
- **Manage Media:** Manage summary cards omit request and issue counts. View Issues shows the total; Close All Issues shows the open count. Delete All Issues is unchanged. Disabled buttons retain their colors at reduced opacity without shadows. English text refreshes from the current catalog during development.
- **Manage Media:** Manage actions now have consistent disclosure, blocklist and deletion icons. View All Issues and Close Open Issues show rounded, color-matched count badges. Expanded issue descriptions, comments and entry fields sit below the details without an extra bordered card.
- **Interface:** Manage screens now use the request page's confirmed Delete and Delete From Library actions instead of Clear Data, manual availability overrides, and older removal controls. Embedded details match other subcards, service links are orange, and View Issue replaces the linked issue status badge.
- **Interface:** Manage dialogs now show Services, Blocklist, Requests, and Issues without the redundant Advanced heading.
- **Movie Details:** Expanded movie collections now show a translucent summary with a linked poster and title, collection genres and size, and an inset overview instead of a backdrop banner. Blackout detail-table dividers are black with a soft white glow; other palettes retain their divider styling.
- **Interface:** Manage service links are labeled “Open title in” followed by the configured service name, distinguishing navigation from library deletion and service-check retry actions.
- **Interface:** The shared Quality and Request control labels now use the same green text as the standard green buttons instead of white, across all color schemes. Unavailable quality options remain greyed out.
- **Interface:** Quality controls now match the segmented Request controls, with unavailable playback qualities disabled. Already available request formats are greyed out, including for advanced users. Request dialogs share grey disabled buttons, while missing formats and partially available series remain requestable.
- **Interface:** Report an Issue now shares the movie-details segmented Quality control, with unavailable versions disabled and reporting-specific help. Issue Type uses the shared yellow warning palette across all color schemes.
- **Request Status:** Delete Request and Delete From Library confirmations now use a green Cancel button while keeping the destructive confirmation red.
- **Interface:** Associations, Issues, and Blocklist list entries now use one card instead of nested cards. Blocklist source badges explain manual and tag-based blocking, and the removal action sits inside the final details column.
- **Interface:** Cancel buttons now consistently use the same X icon as Report an Issue, including confirmation dialogs, settings, discovery editing and cancellation of requests, scans and jobs. Shared button styling preserves existing colors and sizes.
- **Interface:** Details cards across movie, series, book, music, collection, request, issue, blocklist and association views now share centralized three-column and title-alignment rules. Equal-third columns and the two-pixel optical title adjustment stay consistent across pages and dialogs.
- **Interface:** Standard and compact action buttons now use a 16-pixel height and one pixel less horizontal padding per side while retaining their text sizes. View Issue fits the detail-row height, and input fields and dropdowns retain their existing height.
- **Interface:** Subject tags now share one palette across movies, series, books, music and collections, adding a distinct yellow alongside purple, amber and the existing colors while retaining translucent fills.
- **Interface:** The repeating subject-tag rainbow includes orange, lime and violet for smoother color transitions. Its green matches the Next/Previous buttons, alongside the Associations button's cyan, with colored labels retained on hover.
- **Interface:** Subject tags now follow a consistent repeating rainbow in display order across all media cards, including green and the Associations button's cyan. Text keeps each tag's color rather than turning white.
- **Interface:** Subject-tag labels now match their tag's border color instead of using near-white text, making each color easier to distinguish while retaining translucent backgrounds and hover feedback.
- **Interface:** Posters and primary cards now use a two-pixel CSS-rendered brushed-steel frame, while detail posters, subcards, and inset cards use the slimmer one-pixel treatment without downloading a border image.

#### Fixed

- **Interface:** Browser Back now closes screens with Cancel before leaving their underlying page. Selection circles are clearer over artwork, music album requests show every track as included, and the request-deletion prompt has clearer wording.
- **Requests:** Root folders now gain a visible one-pixel border when selected or hovered in Advanced Options on movie, series, music, and book request screens. Root-folder selections no longer show an unnecessary popup on hover.
- **Media Details:** Media table rows can be clicked to select an item, while select-all stays on the heading circle. Availability icons now explain each item's status on hover.
- **Interface:** The SeerrNG 3.28 update now works with the refreshed interface and existing preview databases, including verified library removal for comics and magazines, complete keyword matching for books and music, and readable Blackout theme controls in light mode. New browsers now start with the branded SeerrNG black-to-dark-blue palette, while the original blue-gray appearance remains available as Seerr.
- **Discovery:** Widened the Artist search field and suggestions on Music and Search, and kept compact filter controls aligned when focused or expanded so clear and dropdown icons stay inside their controls.
- **Search:** Music and main Search share a live Artist dropdown with partial-name matching. Music filters now combine in fresh catalogue searches. Movie, series, book, and audiobook filters retain the keyword instead of narrowing only loaded cards. Sparse filtered pages no longer end a search while more provider pages remain.
- **Collections:** Genres in TV and music collection summaries and member cards now open the matching series or music discovery filters, just like movie collection genres.
- **Collections:** Music and TV collections quietly retry failed rating requests in the background with increasing delays, preserving loaded ratings without an error banner. Retries pause while the tab is hidden or offline and stop when leaving the page. Confirmed absent ratings do not keep retrying.
- **Collections:** TV collection names now use Collection instead of a trailing Franchise label. Expanded TV and music collection cards share the movie collection layout, including linked artwork and title, overview, genres, and collection size.
- **Development:** Vitest now refuses to run against a disk-backed database, preventing inherited development settings from directing test resets at a preview database.
  - **Action required:** Start Vitest with NODE_ENV=test and a separate test configuration directory.
- **Music:** Music collections now show saved MP3 and FLAC library availability even before playback links exist. Missing album covers load as cards come into view in collections and search, with bounded requests and retries for temporary artwork-provider failures.
- **Collections:** Music collection summaries and collection pages now choose verified album artwork instead of assuming the first catalogue entry has a cover. Existing cached artwork is reused and missing covers are resolved in a bounded batch.
- **Interface:** The blocklist eye icon on media posters remains readable instead of being squeezed by text-button padding. Text buttons keep their existing size.
- **Ui:** Compact filter and rating dropdowns open outside their containing cards, keeping options accessible when a collection has no matching results without increasing the card height.
- **Ui:** English labels now include shared Request Status actions and current page controls. Login and movie-request messages no longer overwrite different labels that previously shared the same translation ID.
- **Music:** On music collection pages, the Album filter now shows only plain albums. Entries with secondary release types display those types without the repeated Album label. A combined Live and Compilation entry appears under either single-choice filter.
- **Music:** Music collections use artist portraits from Lidarr's public metadata source, with TheAudioDB fallback, instead of album covers. Album details and requests retain secondary release types such as DJ-mix. Metadata Profile uses shared request styling; approval says Automatically. Modal headings no longer overflow their card padding.
- **Media Details:** Album ratings can now pass API validation instead of disappearing after a failed request. Music details also use the same compact row spacing above Genres as movie, series and book summaries.
- **Media Details:** Album Details and Book Details no longer repeat fields already shown in the main summary. Remaining metadata is reorganized into compact, consistently styled columns.
- **Bookshelf:** Bookshelf search and discovery links now resolve provider-backed books reliably instead of landing on a 404 page, including older links that do not carry a title hint.
- **Interface:** Collection inset cards now share the cast and crew cards' lighter translucent surface. The collection disclosure uses the same parent treatment, removing its extra darkening while preserving spacing and interactions.
- **Interface:** The collection page now matches the collection summary layout: Genres starts in the first row and spans the first two column groups, with Collection Size in the third group on wide screens.
- **Collections Bookshelf:** TV and music collections now open their collection request lists, and Bookshelf search results reliably open the matching book details page.
- **Interface:** Detail cards now use consistent text-row spacing without extra Description or Genres margins, while allowing taller content to expand. Card and action gaps use a shared 8px setting, separate from card padding.
- **Confirmations:** Delete confirmation buttons now include the shared trash-can icon for library copies, requests, issues, comments, users and configured services.
- **Interface:** The gap below detail-card titles is reduced by 2px, keeping the original poster dimensions and consistent text-row heights.
- **Interface:** Collection and other media summaries now place their poster and details inside consistent translucent subcards. Existing embedded issue subcards keep a single surface without duplicate padding.
- **Development:** Development startup excludes tests and helpers from settings migrations and keeps ts-node from compiling Next-generated JavaScript. Development previews can allow one explicitly configured LAN origin and use Webpack polling for Windows Docker bind mounts. Production defaults remain unchanged.
  - **Action required:** None.
- **Manage Media:** Disabled View Issues uses the standard muted button styling without text or icon shadows. Close All Issues stays yellow and Delete All Issues stays red, including their disabled states, while unavailable actions remain disabled.
- **Interface:** Details-card dividers now align with equal thirds instead of squeezing the middle column with a fixed-width first value. Movie, series, book, music, request, issue and blocklist summaries share the correction, and collection size aligns with the final third while overview and genres keep their spanning layout.
- **Manage Media:** Closing an issue returns to the previous page and reopens Manage's expanded issue list when opened there. Issue cards place creator details in the middle column, show rounded red Open or green Closed badges, and restore View Issue at the bottom right.
- **Interface:** Issue navigation links now share the standard green button colors used by View Issues and Previous/Next media controls, replacing the older emerald styling while preserving their compact size.
- **Library:** Library verification rejects a matched series or album without a service ID instead of preparing an invalid action. The development backend can load this check with strict type checking enabled.
- **Interface:** Login buttons regain their original roomy height, padding and text size. Login now has a separate shared sizing rule, leaving compact buttons elsewhere unchanged across all color schemes.
- **Interface:** Delete From Library now shares the standard red delete styling. Manage keeps unavailable issue actions visibly red or yellow while still disabled. Close All Issues and its confirmation use yellow, and the separate library-check retry button explains why it appears.
- **Interface:** Remove From Blocklist now uses the shared red button style and standard tooltip in Manage dialogs. Unavailable actions remain greyed out, with an explanatory tooltip that appears above the dialog.
- **Manage Media:** Manage updates blocklist buttons and their tooltips immediately after a successful action, rather than waiting for the parent media refresh. Failed actions leave the current state unchanged, and refreshed media data remains authoritative after it catches up.
- **Manage Media:** Manage library deletion identifies copies by media title and year rather than service item IDs. Blocklist, close-issue and delete-issue confirmations use a short action heading and a separate media title card. Issue confirmations retain the affected count.
- **Library:** Manage checks each Radarr service for the selected movie instead of downloading the entire movie inventory. Large libraries no longer hide service links or disable library removal by exceeding the response-size limit. Verification still fails safely if any service cannot be checked.
- **Interface:** Manage resolves library copies directly from configured services and shows green Open Service links. Delete From Library confirms all verified copies across qualities and services before permanent removal. Disabled Blocklist removal retains red styling. Movie playback help now describes opening one movie in your media server rather than a playlist.
- **Interface:** Shared movie-summary titles sit two pixels higher for better visual alignment with their posters, including collection inset cards. Card margins, title size, details-table position and ratings spacing remain unchanged.
- **Interface:** Quality-row icons and ratings now use a shared 14px content height inside 16px controls, retaining 12px text and image proportions. Play on Device shares playback-button sizing, and disabled playback buttons keep a visible border while dimming their text and logo.
- **Interface:** Media-detail rating logos, scores, and the quality selector now match the compact action-button height. Collection ratings use the same shared sizing, while form inputs and dropdown options retain their existing sizes.
- **Interface:** Segmented Request controls now follow the shared action-button height instead of remaining taller on media detail and collection pages. Their text, colors, and request options are unchanged.
- **Interface:** Collection, advanced-request, and media-details cards now use the same centralized title-to-details spacing as the other detail cards.
- **Blocklist:** Blocklisting a title on its details page now updates Manage's Blocklist Title and Remove From Blocklist buttons immediately. Both views share confirmed membership state across movies, series, books and music instead of retaining a stale local override.
- **Request Status:** Movie and series requests no longer say they are being added to the library merely because Radarr or Sonarr accepted them. Requests without download or import evidence show a waiting explanation instead. Real transfer progress and existing history remain intact.

#### Security

- **Library:** Only administrators can delete all verified copies across connected services from Manage, and the API enforces the same rule. Deletion stops when a comic’s backend is unknown. Downloads verify that opened files remain under their configured library, and malformed service filenames are parsed safely. Docker builds no longer send the host `.npmrc` to the builder.

#### Removed

- **Issues:** Issue details now expand inline through View Details in Manage and the Issues list. The standalone issue screen and View Issue buttons have been removed. Existing notification links redirect to an expanded issue card, and affected episode information remains available inline.

### 🚀 Features
- *(ui)* Integrate SeerrNG v3.28 and complete shared interface system - ([00e85f0](https://github.com/snapetech/seerrng/commit/00e85f097b8b1f06390a90bebbfec15616c6bcb0))

## [3.29.0](https://github.com/snapetech/seerrng/compare/v3.28.0..v3.29.0) - 2026-09-27

### User-facing changes

#### Added

- **Requests:** Available requests can now offer a secure Download copy action in Request Status. Users can save verified imported files, while operators map file-backed libraries or use Mylar's authenticated issue stream.
  - **Action required:** Configure read-only library path mappings for file-based backends in Settings > Main > Download Copies.
- **Magazines:** Magazine discovery now includes a Google Books public catalog beside LazyLibrarian tracked titles. Search public titles with an API key; LazyLibrarian remains the request and issue tracking service.
  - **Action required:** Add a Google Books API key in Settings > Main to enable public catalog searches; configure LazyLibrarian to submit requests and track issues.
- **Comics:** Comic requests dispatched to Kapowarr now show live download progress (percent, size, and status) on the Requests page and in Manage, the same as movies, TV, music, and books.
- **Comics:** Comics can now be added to your SeerrNG watchlist, with an optional per-user setting to auto-request a watchlisted comic once it becomes available.
- **Bookshelf:** Administrators now get a direct link to create a Hardcover API token and a reminder that self-hosted services use one configured token for all connected SeerrNG users. The README explains where a personal token applies and that a shared hosted metadata endpoint controls its own upstream access.
- **Media Categories:** Administrators can independently show or hide Movies, Series, Music, Books, Audiobooks, Comics, Magazines, Retro, Modern, and PC Games. Disabled categories disappear from browsing and reject new requests while existing requests and available download copies remain accessible.
- **Software Requests:** Users can browse and request emulation games and PC games, follow acquisition status, receive availability notifications, and download verified files from Request Status.
  - **Action required:** Configure QuestarrNG and, for emulation requests, ROMarrNG.
- **Media:** Software requests now support quotas, pending withdrawal, paginated status history, and request updates through notification channels. Advanced comic requests can select a Kapowarr root folder. Fresh BookshelfNG deployments can use one instance for ebooks and audiobooks.

#### Changed

- **Software Requests:** The README now indexes the software guides, which explain provider setup, target selection, request progress, safe retries, availability notifications, and Download copy for ROMs and PC games.
- **Bookshelf:** Fresh SeerrNG Bookshelf deployments now run one BookshelfNG process for ebooks and audiobooks. Use separate format-specific service entries with the same URL and API key; existing audiobook databases keep their split deployment unless migrated explicitly.
- **Comics Magazines:** Users can manage comics and magazines with SeerrNG watchlists, blocklists, issue reports, and magazine covers. Administrators can grant format-specific request and auto-request permissions, choose magazine services, and set per-user magazine request limits.
- **Media Requests:** SeerrNG now shows where indexer searches run by category and where Prowlarr can supply indexers. Book, comic, and magazine issue reports now include specific reasons that remain visible on issue cards and details.
- **Software Requests:** Software requesters can cancel active QuestarrNG work and ROMarrNG requests before download handoff. SeerrNG asks users to check for duplicate downloads after an interrupted QuestarrNG or ROMarrNG handoff, and can show available titles without a local download copy.
- **Yunohost:** The SeerrNG YunoHost package now lives in a catalog-ready repository, and installation instructions point to that source. YunoHost's updater proposes stable release archive and checksum updates for administrators to apply through the normal app upgrade flow.

#### Fixed

- **Request Status:** Available media notifications use their Request Status link only after the request is saved, preventing links with a missing request ID.
- **Software Requests:** After administrators save software provider settings, SeerrNG reloads ROMarrNG's supported systems so they can assign Retro or Modern in the same settings visit.
- **Software Requests:** Software provider settings and catalog pages now reach their documented APIs, allowing administrators to connect services and users to browse ROM and PC game titles.
- **Software Requests:** The request dialog now opens when users select a ROM or PC game, so they can choose the emulation system or PC target before submitting.
- **Software Requests:** Platform and PC target details on software request cards now use SeerrNG's shared detail text style for consistent readability.
- **Software Requests:** Request Status now explains that its empty state applies to movies, shows, music, books, comics, and magazines when software requests are listed separately above.
- **Comics:** Editing a comic request from Manage no longer opens a broken movie-shaped request form, and its "Destination Server" override now resolves against the correct Mylar/Kapowarr server instead of Sonarr.
- **Comics:** Approved comic requests now automatically move to Completed and send the "now available" notification once the comic finishes downloading, instead of staying stuck on Approved forever.
- **Comics:** Filtering the Requests page by Comics (or Magazines) now actually filters the list instead of silently showing every request, and comic requests can now be removed from the Requests list like other media types.
- **Comics:** Comic requests on the Requests page now show their issue count and publisher instead of a blank movie-style "Director"/"Studio" placeholder, and can be sorted by publisher or release year like books.
- **Comics:** Comic requests now show correct in-library/downloading status instead of getting stuck on "Approved", a blocklisted or watchlisted comic no longer gets stuck loading in Manage, and cancelling an in-progress Kapowarr comic download now actually removes it from the queue instead of failing.
- **Bookshelf:** Bookshelf-backed search and series results now open the correct book details instead of returning Book not found for numeric catalog identifiers.
- **Bookshelf:** Bookshelf backup restore now completes with automatic backend selection. Fresh deployments continue to use one combined instance for ebooks and audiobooks; choose split mode only when you need isolated instances.
- **Deployment:** Fresh production builds now resolve SeerrNG's internal server modules correctly, allowing containers and package installs to start after an upgrade.
- **Books:** Book details now read series membership from the exact linked Bookshelf library record, so populated ebook or audiobook series fields show their link even when catalog lookup omits them. The series page now includes those library books too.
- **Software Requests:** Request Status displays PC game operating system and architecture targets with human-readable labels such as Linux and ARM64.

### 🚀 Features
- *(bookshelf)* Default fresh deployments to one instance - ([260da85](https://github.com/snapetech/seerrng/commit/260da85b0cb937fc520d94526edc99177663c1f6))
- *(comics)* Add live Kapowarr download progress tracking - ([1bca6e9](https://github.com/snapetech/seerrng/commit/1bca6e9060fcc246e2dfc447fc8eab2699a57b29))
- *(comics)* Add full watchlist support - ([5b0a8fd](https://github.com/snapetech/seerrng/commit/5b0a8fd49f3e777adce1cf043ff8259a7b110ff6))
- *(comics-magazines)* Complete user workflows - ([652304d](https://github.com/snapetech/seerrng/commit/652304dbdb60480c3144eca2ee9f80357f65e4c0))
- *(magazines)* Add public catalog discovery and close release blockers - ([387ec52](https://github.com/snapetech/seerrng/commit/387ec529692849c594c783e23a6ded2b59ef2b37))
- *(media)* Close cross-media search and lifecycle gaps - ([306ee70](https://github.com/snapetech/seerrng/commit/306ee704179ce532a98ad0551b277b2547a8acd3))
- *(media)* Improve software and comic request parity - ([e2c0be2](https://github.com/snapetech/seerrng/commit/e2c0be295a683853c5f8dedf94e74d82e955c618))
- *(settings)* Guide admins through Hardcover token setup - ([62d7b10](https://github.com/snapetech/seerrng/commit/62d7b10f431dc1f3cbe399ac1f617e5c9e52cc3d))
- Add admin media category controls - ([a4ae39d](https://github.com/snapetech/seerrng/commit/a4ae39d42927f204fefdf001b40cf237fa8062de))
- Add ROM and PC game acquisition - ([5e657a8](https://github.com/snapetech/seerrng/commit/5e657a8e0d6918f63e71dbbe251f4bfab68b9393))
- Offer request downloads in status - ([757e4b0](https://github.com/snapetech/seerrng/commit/757e4b00d41376472adce515f817353fdcd7ebeb))

### 🐛 Bug Fixes
- *(books)* Read series from linked Bookshelf records - ([15d9599](https://github.com/snapetech/seerrng/commit/15d9599ad8b4ac55dad8b0cb2916e8080bead3c0))
- *(bookshelf)* Resolve numeric work IDs explicitly - ([e0a591a](https://github.com/snapetech/seerrng/commit/e0a591a4e9a9c9bc935085c3993bf0695409679a))
- *(comics)* Fix Requests page media-type filter and removability - ([6efe982](https://github.com/snapetech/seerrng/commit/6efe98278e6f0f87f81ec36856616cbe85070ada))
- *(comics)* Fix broken edit-request modal and server override in Manage - ([bd1b003](https://github.com/snapetech/seerrng/commit/bd1b003aa77f8628d8733cc505c312ecb6ac19b1))
- *(comics)* Auto-complete approved requests once the comic is available - ([fd9de41](https://github.com/snapetech/seerrng/commit/fd9de4176a5ec26faffb8c2a7cc0f8aadd2d3e5a))
- *(comics)* Show issue count/publisher and fix sort metadata on Requests page - ([3001723](https://github.com/snapetech/seerrng/commit/3001723eb3f46c2c2f9e5d5ee6c132ef5eac10ee))
- *(comics)* Correct status display, blocklist/watchlist lookups, and Kapowarr cancellation - ([d1c1eed](https://github.com/snapetech/seerrng/commit/d1c1eedd548f12387401f7951f5e6d8f88ea1d2d))
- *(notifications)* Keep available request links valid - ([99b8db1](https://github.com/snapetech/seerrng/commit/99b8db1b8da65d22d4bc84659d496ccbb6fce1ea))
- *(request-status)* Humanize software target labels - ([c78f9f4](https://github.com/snapetech/seerrng/commit/c78f9f43a25c3cfc751d19544cfdccb5b1218742))
- *(request-status)* Clarify software empty state - ([2df2804](https://github.com/snapetech/seerrng/commit/2df28044f40b8d4e17922ad22e9b7756c1de00fc))
- *(software)* Align provider and catalog API routes - ([9bf4c6e](https://github.com/snapetech/seerrng/commit/9bf4c6eaeaba6ebabf3c2bf6be007bf1a7335ab9))

### 📖 Documentation
- *(comics)* Document Kapowarr cancel support and Mylar's limitation - ([e24ab1e](https://github.com/snapetech/seerrng/commit/e24ab1e225495ae68d445b73614dc33a123b5264))
- *(software)* Document request and download workflow - ([dafdb42](https://github.com/snapetech/seerrng/commit/dafdb42d78fb437b983c6cca7e0af9d2d3b92652))
- *(yunohost)* Use dedicated catalog package repo (#136) - ([7411227](https://github.com/snapetech/seerrng/commit/7411227bddc2493451e5f5a4c7ab08b49a010fd9))
- Record QuestarrNG catalog contract - ([79ae7a0](https://github.com/snapetech/seerrng/commit/79ae7a09972c491152f8d8c38a49b9cfe7910d78))
- Plan universal request copy delivery - ([7f44af5](https://github.com/snapetech/seerrng/commit/7f44af57c90dc5a4b8387451c54f1b34e5b8eb75))
- Record acquisition implementation direction - ([e7a0ffa](https://github.com/snapetech/seerrng/commit/e7a0ffa462a29cdafbf76e07ebcede7722656477))
- Refine ROM and game acquisition plan - ([33008d7](https://github.com/snapetech/seerrng/commit/33008d72e219024e5620b5b3b2dfd3479a23026a))
- Plan universal request copy delivery - ([5812b07](https://github.com/snapetech/seerrng/commit/5812b07cf6941ace64053dfbd299686c83c3da67))
- Record acquisition implementation direction - ([b50f56f](https://github.com/snapetech/seerrng/commit/b50f56fe01e2134de2e2698f6c1025a9c443ba18))
- Refine ROM and game acquisition plan - ([9f26e37](https://github.com/snapetech/seerrng/commit/9f26e3701a37dfd0733fabc7cabaa014110a9d83))
- Research software acquisition integrations - ([3354a1d](https://github.com/snapetech/seerrng/commit/3354a1d6be60e9283375ea5ffe5b79fbc2ec4149))

### 🚜 Refactor
- *(comics)* Reuse canRemoveRequestFromService for comic canRemove - ([a981235](https://github.com/snapetech/seerrng/commit/a9812357a5936d82a63e928297c0390e832e83c2))

### 🎨 Styling
- Format software acquisition settings route - ([cc3e162](https://github.com/snapetech/seerrng/commit/cc3e16263d8e79512ef145d4cf5b5fb8ee7994c2))

### 🧪 Testing
- Cover software request acquisition flows - ([946549d](https://github.com/snapetech/seerrng/commit/946549de030387e02fa73eeb6fc76bc90e8d9058))

### ⚙️ Miscellaneous Tasks
- *(comics)* Add comic/magazine breakdown to request count response - ([de551c2](https://github.com/snapetech/seerrng/commit/de551c270fb0f67be74b72df0d1d578170a9fa82))

## [3.28.0](https://github.com/snapetech/seerrng/compare/v3.27.1..v3.28.0) - 2026-09-25

### User-facing changes

#### Added

- **Media Management:** Administrators can set per-user comic request limits and manage tracked magazines from their detail pages. Removing a magazine from LazyLibrarian clears its SeerrNG tracking while leaving files on disk; the comics and magazines guides now describe the current controls.
- **Comics:** Users with advanced request permissions can now choose which Mylar or Kapowarr server handles a comic request when more than one is configured, instead of always using the admin-set default.
- **Search:** Global Search now has dedicated Comics and Magazines categories. Comics come from ComicVine, and magazines come from the tracked catalogs in configured LazyLibrarian services.
- **Yunohost:** YunoHost operators can install SeerrNG on amd64 and arm64 from the new package branch, with persistent data, a localhost-only service, and YunoHost-managed reverse proxy, HTTPS, backups, and restores.

#### Fixed

- **Interface:** Light appearance now keeps page surfaces, controls, and text in the same color scheme, and request artwork no longer fades under a white overlay.

### 🚀 Features
- *(comics)* Add advanced server picker for comic requests - ([cf025c4](https://github.com/snapetech/seerrng/commit/cf025c467965a8ef5beaf707c76ae5ccbdfd54e7))
- *(comics)* Add manage/issue-reporting parity and blocklist support - ([d8a43b3](https://github.com/snapetech/seerrng/commit/d8a43b3e3d7f9ab6326519bd03709ade6ea85a14))
- *(magazines)* Add management and finish comic quotas - ([4654c69](https://github.com/snapetech/seerrng/commit/4654c69f8fb97fbb4e05b2e0a06c5e17bd9677a2))
- *(search)* Merge comics and magazines search - ([461dac5](https://github.com/snapetech/seerrng/commit/461dac599bdfa437b4794a894ede3bb2337d9b64))
- *(search)* Add comics and magazines categories - ([d105a96](https://github.com/snapetech/seerrng/commit/d105a96b6e8cd8140e5cd3ed0f1e47579f319ea2))
- *(yunohost)* Add YunoHost package support - ([828859c](https://github.com/snapetech/seerrng/commit/828859ccf26c527b44bb1dbbc651fc3d96a62678))

### 🐛 Bug Fixes
- *(ui)* Align light appearance and artwork overlays - ([e18cf44](https://github.com/snapetech/seerrng/commit/e18cf442d645eb7cd40afd793b0fac82700aa474))
- *(yunohost)* Preserve backup cleanup handler - ([d2615fa](https://github.com/snapetech/seerrng/commit/d2615fa5bb9374edd39c63f07bb9c18b7905d354))
- *(yunohost)* Snapshot SQLite data during backups - ([788cac7](https://github.com/snapetech/seerrng/commit/788cac7dbfb36740b7c368966875a3c1d99a9a21))
- *(yunohost)* Prepare private SQLite directory - ([8b36382](https://github.com/snapetech/seerrng/commit/8b363828fd9fd646f468d02a4711f08b3ebe5b73))

### 📖 Documentation
- *(comics)* Remove stale server picker limitation - ([49102ba](https://github.com/snapetech/seerrng/commit/49102ba1c3db961e82a43bcdf4a2e922899e9fdc))

### ⚙️ Miscellaneous Tasks
- *(yunohost)* Target v3.27.1 release assets - ([d4d2ad3](https://github.com/snapetech/seerrng/commit/d4d2ad3eee0d50f1a140dd36d849d4b5174cd016))

## [3.27.1](https://github.com/snapetech/seerrng/compare/v3.27.0..v3.27.1) - 2026-09-25

### User-facing changes

#### Fixed

- **Requests:** When only one request quality is available, the full Request button now opens it. TV details also hide the quality selector when 4K is unavailable.

### 🐛 Bug Fixes
- *(requests)* Make single-quality controls fully clickable - ([62e8e1d](https://github.com/snapetech/seerrng/commit/62e8e1ded49ad4496db5822c65d6e36c105b9859))

## [3.27.0](https://github.com/snapetech/seerrng/compare/v3.26.1..v3.27.0) - 2026-09-25

### User-facing changes

#### Added

- **Magazines:** SeerrNG adds LazyLibrarian support for magazine requests. Users can discover tracked titles or request one by name, see known issue availability, and follow request state; administrators can configure the service, permissions, and request limits.
- **Comics:** Comics now have their own Discover and details pages, reachable from the sidebar, so you can search ComicVine and request comics without leaving the browser.
  - **Action required:** Add a ComicVine API key in Settings > General to enable comic discovery.
- **Comics:** The global search bar now includes comics from ComicVine alongside movies, TV, music, and books.
- **Comics:** SeerrNG now supports comic requests through configured Mylar3 and Kapowarr servers, with approval and processing status shown alongside other media requests.
  - **Action required:** Configure a Mylar3 or Kapowarr service to enable comic request dispatch.
- **Comics:** Admins can now add and manage Mylar3 and Kapowarr servers from Settings, and comics already in those libraries sync in automatically so they show as available without a new request.

#### Changed

- **Documentation:** The SeerrNG guides now explain how to browse books and series, follow request status history, set per-user request languages, use playback controls, configure override rules, and classify Plex Music and audiobook libraries. The README and documentation home link directly to these workflows and related setup guides.
- **Comics:** Comic requests are supported across request lists, quotas, account settings, and notifications.
- **Network:** Network settings now explain when reverse-proxy trust is needed and why it must remain off when clients can connect directly. This helps operators avoid incorrect client-IP handling and rate-limit errors behind a reverse proxy.
  - **Action required:** Enable reverse-proxy trust when SeerrNG is reachable only through one trusted reverse proxy that sets X-Forwarded-For, then restart SeerrNG.
- **Magazines:** Magazine workflows are now included in this release through LazyLibrarian, including title discovery, requests, issue availability, and administrator controls.

#### Fixed

- **Comics:** Comic requests now show correct titles, links, and status everywhere requests appear, notifications label them correctly, and admins can set a default comic request quota in Settings.
- **Operations:** Production builds now place the server entry point where containers, packages, and source installs expect it, preventing startup failures after deployment.
- **Comics:** Comic and magazine request limits, account settings, and notifications now display their labels correctly in production builds.
- **Comics:** Comic discovery, detail, and server settings screens now include their required English labels and status text in release builds, so production images package the new comics workflows correctly.
- **Magazines:** The LazyLibrarian server SSL setting now uses the shared settings toggle and saves changes to the connection configuration.
- **Release Pipeline:** Release notes now include all changes since the latest published release, even when newer tags are still drafts. This keeps fixes and features from failed or delayed releases visible in the next GitHub release and Discord announcement.
- **Release Pipeline:** Standalone Linux, Windows, and macOS release packages now build with the expanded settings sections for comic integrations, so package users receive the same release as Docker users.
- **Metadata:** Provider failures behind movie and discovery errors now retain the upstream status, provider message, and error code in server logs. TMDB rejections also show the credential source without exposing the key, helping operators distinguish authentication failures from network outages.
- **Diagnostics:** When an external service fails, SeerrNG logs now include sanitized upstream host, path, HTTP status, response message, and network error code so operators can distinguish authentication failures from connectivity problems without exposing credentials.
- **Metadata:** SeerrNG now checks TMDB authentication after startup and logs whether it succeeded, which credential source was used, or the upstream HTTP/network failure code. A rejected override is visible without exposing the key; the bundled key remains the default.
  - **Action required:** If startup logs report HTTP 401, remove or correct the TMDB credential override.

### 🚀 Features
- *(comics)* Include comics in global search - ([67108db](https://github.com/snapetech/seerrng/commit/67108db776ce643dce761134ca98b127cb775a36))
- *(magazines)* Complete shared request surfaces - ([05b1346](https://github.com/snapetech/seerrng/commit/05b134633130a7e26a081865b9db4b87d00a1ac6))
- *(magazines)* Add LazyLibrarian request support - ([5fcbccc](https://github.com/snapetech/seerrng/commit/5fcbcccdf02d69268d01ef8786c4cb57646109cf))

### 🐛 Bug Fixes
- *(build)* Emit server entrypoint at runtime path - ([40c86cf](https://github.com/snapetech/seerrng/commit/40c86cf9aa1465a0d1e0999df0c678c9294772ea))
- *(comics)* Remove incomplete magazine UI paths - ([4295990](https://github.com/snapetech/seerrng/commit/4295990438691e8439c2a26bae3de2727eca8155))
- *(comics)* Thread comic support through request-list, quota, and notification surfaces - ([affb193](https://github.com/snapetech/seerrng/commit/affb1932907e9a8b65b5bc94a8ab00fef3b683a2))
- *(diagnostics)* Report upstream request failures - ([47dd20a](https://github.com/snapetech/seerrng/commit/47dd20ad4f0368e58848fcf20e45845102e451a9))
- *(i18n)* Include comic request labels - ([19e6177](https://github.com/snapetech/seerrng/commit/19e61771c19694fc994bde99739ff6b3fe6a4930))
- *(magazines)* Use shared settings controls - ([2f32080](https://github.com/snapetech/seerrng/commit/2f320806e1c798d6a94d2480329c8fab9a6190fa))
- *(release)* Validate expanded settings integrations - ([25a48dc](https://github.com/snapetech/seerrng/commit/25a48dcd62f8df3ac0797f370bdf9a7a0d9be5fa))

### 📖 Documentation
- *(release)* Remove superseded magazine scope note - ([27e8a76](https://github.com/snapetech/seerrng/commit/27e8a76c50f39027fae1f196724eb52566a121b2))
- *(release)* Clarify magazine support scope - ([936cce2](https://github.com/snapetech/seerrng/commit/936cce257d31ccc54fb82ec8deb1985af966a0af))

### 🧪 Testing
- Expect upstream diagnostic message - ([943b8eb](https://github.com/snapetech/seerrng/commit/943b8eb52c9f31b03260ad4f1e04dee1864b5fbf))

## [3.26.1](https://github.com/snapetech/seerrng/compare/v3.26.0..v3.26.1) - 2026-09-25

### User-facing changes

#### Added

- **Comics:** Comics now have their own Discover and details pages, reachable from the sidebar, so you can search ComicVine and request comics without leaving the browser.
  - **Action required:** Add a ComicVine API key in Settings > General to enable comic discovery.
- **Comics:** SeerrNG now supports comic requests through configured Mylar3 and Kapowarr servers, with approval and processing status shown alongside other media requests.
  - **Action required:** Configure a Mylar3 or Kapowarr service to enable comic request dispatch.
- **Comics:** Admins can now add and manage Mylar3 and Kapowarr servers from Settings, and comics already in those libraries sync in automatically so they show as available without a new request.

#### Changed

- **Documentation:** The SeerrNG guides now explain how to browse books and series, follow request status history, set per-user request languages, use playback controls, configure override rules, and classify Plex Music and audiobook libraries. The README and documentation home link directly to these workflows and related setup guides.
- **Network:** Network settings now explain when reverse-proxy trust is needed and why it must remain off when clients can connect directly. This helps operators avoid incorrect client-IP handling and rate-limit errors behind a reverse proxy.
  - **Action required:** Enable reverse-proxy trust when SeerrNG is reachable only through one trusted reverse proxy that sets X-Forwarded-For, then restart SeerrNG.

#### Fixed

- **Comics:** Comic discovery, detail, and server settings screens now include their required English labels and status text in release builds, so production images package the new comics workflows correctly.
- **Release Pipeline:** Release notes now include all changes since the latest published release, even when newer tags are still drafts. This keeps fixes and features from failed or delayed releases visible in the next GitHub release and Discord announcement.
- **Metadata:** Provider failures behind movie and discovery errors now retain the upstream status, provider message, and error code in server logs. TMDB rejections also show the credential source without exposing the key, helping operators distinguish authentication failures from network outages.
- **Metadata:** SeerrNG now checks TMDB authentication after startup and logs whether it succeeded, which credential source was used, or the upstream HTTP/network failure code. A rejected override is visible without exposing the key; the bundled key remains the default.
  - **Action required:** If startup logs report HTTP 401, remove or correct the TMDB credential override.

### 🐛 Bug Fixes
- *(i18n)* Include comic messages in release catalogs - ([6b20fa6](https://github.com/snapetech/seerrng/commit/6b20fa62136910b337b3e8205ec089e655ea6272))

## [3.26.0](https://github.com/snapetech/seerrng/compare/v3.25.0..v3.26.0) - 2026-09-25

### User-facing changes

#### Added

- **Comics:** Comics now have their own Discover and details pages, reachable from the sidebar, so you can search ComicVine and request comics without leaving the browser.
  - **Action required:** Add a ComicVine API key in Settings > General to enable comic discovery.
- **Comics:** SeerrNG now supports comic requests through configured Mylar3 and Kapowarr servers, with approval and processing status shown alongside other media requests.
  - **Action required:** Configure a Mylar3 or Kapowarr service to enable comic request dispatch.
- **Comics:** Admins can now add and manage Mylar3 and Kapowarr servers from Settings, and comics already in those libraries sync in automatically so they show as available without a new request.

#### Changed

- **Documentation:** The SeerrNG guides now explain how to browse books and series, follow request status history, set per-user request languages, use playback controls, configure override rules, and classify Plex Music and audiobook libraries. The README and documentation home link directly to these workflows and related setup guides.
- **Network:** Network settings now explain when reverse-proxy trust is needed and why it must remain off when clients can connect directly. This helps operators avoid incorrect client-IP handling and rate-limit errors behind a reverse proxy.
  - **Action required:** Enable reverse-proxy trust when SeerrNG is reachable only through one trusted reverse proxy that sets X-Forwarded-For, then restart SeerrNG.

#### Fixed

- **Release Pipeline:** Release notes now include all changes since the latest published release, even when newer tags are still drafts. This keeps fixes and features from failed or delayed releases visible in the next GitHub release and Discord announcement.
- **Metadata:** Provider failures behind movie and discovery errors now retain the upstream status, provider message, and error code in server logs. TMDB rejections also show the credential source without exposing the key, helping operators distinguish authentication failures from network outages.
- **Metadata:** SeerrNG now checks TMDB authentication after startup and logs whether it succeeded, which credential source was used, or the upstream HTTP/network failure code. A rejected override is visible without exposing the key; the bundled key remains the default.
  - **Action required:** If startup logs report HTTP 401, remove or correct the TMDB credential override.

### 🚀 Features
- *(comics)* Add Comics Discover and details pages - ([92586dc](https://github.com/snapetech/seerrng/commit/92586dc3cf79dbd3fa37a979bce32040331cc5aa))
- *(comics)* Sync existing libraries and add settings UI for Mylar3/Kapowarr - ([25f9a8c](https://github.com/snapetech/seerrng/commit/25f9a8cd5be4524c6b90f234c9009da61c479408))

### 🐛 Bug Fixes
- *(api)* Preserve upstream failure diagnostics - ([8640a10](https://github.com/snapetech/seerrng/commit/8640a10494184d40b9a63b4ca8bb2af3bd39e106))
- *(release)* Carry draft release notes forward - ([87e9b7f](https://github.com/snapetech/seerrng/commit/87e9b7f4bf1246d1b4f363e03760c3a591649e14))
- *(server)* Repair server type-check, dev boot, and pnpm dev startup - ([f8cf2ee](https://github.com/snapetech/seerrng/commit/f8cf2eeee4b94d59b7f47760dda4c2e0958b8513))
- *(tmdb)* Report authentication and connectivity failures - ([8e68d49](https://github.com/snapetech/seerrng/commit/8e68d49a9890e78c8167b11eeb7718ce0b126872))

### 📖 Documentation
- *(release-notes)* Document Comics Discover and details pages - ([37f4106](https://github.com/snapetech/seerrng/commit/37f4106e68a6c707f477f76f404d8778346b9429))
- *(release-notes)* Remove duplicate network note - ([094a521](https://github.com/snapetech/seerrng/commit/094a521715bd5da47b3a3f5e4bba57e96a53fbf5))
- *(release-notes)* Document comics settings UI and library sync - ([8ec368d](https://github.com/snapetech/seerrng/commit/8ec368d5022fcf505b963631ab3eca2621d4c97b))

## [3.25.0](https://github.com/snapetech/seerrng/compare/v3.24.2..v3.25.0) - 2026-09-25

### User-facing changes

#### Added

- **Comics:** SeerrNG now supports comic requests through configured Mylar3 and Kapowarr servers, with approval and processing status shown alongside other media requests.
  - **Action required:** Configure a Mylar3 or Kapowarr service to enable comic request dispatch.

#### Changed

- **Network:** Network settings now explain when reverse-proxy trust is needed and why it must remain off when clients can connect directly. This helps operators avoid incorrect client-IP handling and rate-limit errors behind a reverse proxy.
  - **Action required:** Enable reverse-proxy trust when SeerrNG is reachable only through one trusted reverse proxy that sets X-Forwarded-For, then restart SeerrNG.

### 🚀 Features
- *(comics)* Add comics request-and-dispatch backend (Mylar3 + Kapowarr) - ([777a85b](https://github.com/snapetech/seerrng/commit/777a85b18f7e85620fbeec03ad315454f11a2b5b))

### 🐛 Bug Fixes
- *(i18n)* Sync generated English messages - ([6d233ea](https://github.com/snapetech/seerrng/commit/6d233eae8d06e16c19e4017f473bb2ad8ca30157))

### 📖 Documentation
- *(release-notes)* Document comics requests - ([1e94e6a](https://github.com/snapetech/seerrng/commit/1e94e6a57e42645f2e04b9976e7adf97d2653482))

## [3.24.2](https://github.com/snapetech/seerrng/compare/v3.24.1..v3.24.2) - 2026-09-25

### User-facing changes

#### Changed

- **Documentation:** The SeerrNG guides now explain how to browse books and series, follow request status history, set per-user request languages, use playback controls, configure override rules, and classify Plex Music and audiobook libraries. The README and documentation home link directly to these workflows and related setup guides.
- **Network:** Network settings now explain when reverse-proxy trust is needed and why it must remain off when clients can connect directly. This helps operators avoid incorrect client-IP handling and rate-limit errors behind a reverse proxy.
  - **Action required:** Enable reverse-proxy trust when SeerrNG is reachable only through one trusted reverse proxy that sets X-Forwarded-For, then restart SeerrNG.

### 🐛 Bug Fixes
- *(settings)* Clarify reverse proxy trust requirements - ([62768fb](https://github.com/snapetech/seerrng/commit/62768fb0172f9328019d50fcd881f92a866391a7))

### 📖 Documentation
- Audit recent user-facing changes - ([4f4e43b](https://github.com/snapetech/seerrng/commit/4f4e43b7061adc691ed2e15571c591e6404efa96))

## [3.24.1](https://github.com/snapetech/seerrng/compare/v3.24.0..v3.24.1) - 2026-09-24

### User-facing changes

#### Fixed

- **Media Server:** Plex and Jellyfin now sync library lists and save library selections correctly, so administrators can manage enabled libraries from settings.
- **Artwork:** Servarr artwork links from other hosts are now fetched through the safe image path even when their hostnames resemble a configured service address, restoring valid remote covers.

### 🐛 Bug Fixes
- *(artwork)* Compare Servarr cover origins exactly - ([1af8560](https://github.com/snapetech/seerrng/commit/1af85606c746ba36927410e4b008524594fd29a8))
- *(settings)* Align media library API contract - ([e4f72f5](https://github.com/snapetech/seerrng/commit/e4f72f5f89735545f0f03fa11e22578d79c4a63b))

## [3.24.0](https://github.com/snapetech/seerrng/compare/v3.23.1..v3.24.0) - 2026-09-24

### User-facing changes

#### Added

- **Books:** Book search now includes authors and a Trending shelf. Series pages show each volume’s ebook and audiobook status and let you request missing titles together. Book details show audiobook runtime and narrator information when the configured catalog provides it.
- **Books:** Chaptarr book requests needing author metadata remain pending during provider preparation, then resume through normal search tracking. Cancellation removes a queued import only when no other request needs it. SeerrNG restores tracking if Chaptarr changes a book's local row ID. Book scans honor paged totals; diagnostics show pending import IDs and explain when test work stays queued.

#### Fixed

- **Bookshelf:** Book authors in series details now use the refreshed detail text color for better contrast and visual consistency.
- **Bookshelf:** Cancelling a Chaptarr request now keeps its pending import alive while another ebook or audiobook request on the same instance still depends on it.
- **Downloads:** Automatic download recovery now applies its retry limit reliably when several failed downloads belong to the same media item, preventing duplicate retries from bypassing the cap.
- **Artwork:** Sonarr can now use an advertised remote cover when its local artwork is missing, and oversized Servarr image lists are bounded so a malformed provider response cannot trigger an excessive series of cover requests.
- **Scanners:** Radarr and Sonarr library cleanup now validates and bounds identifier lookup results, preventing malformed or oversized provider responses from disrupting availability cleanup.

#### Security

- **Music:** Music cover-art metadata requests now revalidate DNS when connecting and enforce response-size limits while following the supported archive redirect chain, protecting SeerrNG from unsafe redirects and oversized provider responses.
- **Media Artwork:** Servarr artwork is now limited to supported raster images under 10 MiB, reducing exposure to active image files and oversized responses.
- **Bookshelf:** Remote artwork returned by Servarr services is now fetched with public-address validation, redirect checks, download limits, and raster-image validation to protect the server and internal networks.
- **Playback:** Plex playback now rejects alternate IPv6 and unspecified address forms that can reach local-only services, closing address-format bypasses while keeping ordinary LAN players available.
- **Playback:** Plex playback now rejects player hostnames that resolve to loopback or cloud metadata addresses, closing a DNS-based route to local services while keeping ordinary LAN players available.

### 🚀 Features
- *(books)* Expand discovery and series workflows - ([b008430](https://github.com/snapetech/seerrng/commit/b008430a78c273f0288ede12be8bf2fc0266b3bc))
- *(bookshelf)* Improve Chaptarr interoperability - ([840b99e](https://github.com/snapetech/seerrng/commit/840b99e83fb6d256d9367bd1f8c6636d24266d68))

### 🐛 Bug Fixes
- *(bookshelf)* Protect shared Chaptarr imports - ([cbdb9a4](https://github.com/snapetech/seerrng/commit/cbdb9a4bc5a6e52a58b7f6da4a44321f9b6e20a0))
- *(downloads)* Enforce per-media recovery retry limit - ([33fb36f](https://github.com/snapetech/seerrng/commit/33fb36f4ff7994e246b6939862d97883ae1480e9))
- *(release)* Document prep-only v3.2.6 tag - ([f095e8a](https://github.com/snapetech/seerrng/commit/f095e8aefa33a5ea9048131b1f35673b8af64d9a))
- *(scanners)* Bound and preserve Servarr cover images - ([3971c91](https://github.com/snapetech/seerrng/commit/3971c915e55ebb6fd44bbeca5daec3d4b711a420))
- *(scanners)* Bound Servarr identifier lookups - ([98ef535](https://github.com/snapetech/seerrng/commit/98ef535352dc7ba687d7a2c4450a975f31ae7a15))
- *(security)* Restrict local Servarr artwork to safe raster images - ([b831c7f](https://github.com/snapetech/seerrng/commit/b831c7f40d816432f10f03cd33ab626b1cb4b8ea))
- *(security)* Bound cover art metadata fetches - ([6a7b8d5](https://github.com/snapetech/seerrng/commit/6a7b8d507e6cc6ee2dac44df944e390a047e5e12))
- *(security)* Bound remote Servarr artwork fetches - ([082900a](https://github.com/snapetech/seerrng/commit/082900a2f46d071e8e4fca6f7dc0b6e14e633c0c))
- *(security)* Reject local-only Plex player addresses - ([c5fa189](https://github.com/snapetech/seerrng/commit/c5fa18991905ee417bc83aaa9534196069868ecd))
- *(security)* Block DNS loopback in Plex playback targets - ([cb8c74c](https://github.com/snapetech/seerrng/commit/cb8c74ce6819bdf1d5c1c0531b415726587498f4))
- *(ui)* Use refreshed text color for series authors - ([f16262c](https://github.com/snapetech/seerrng/commit/f16262ca324055398a53b087fe02f7a3f7f6bace))

### 🧪 Testing
- Cover shared Chaptarr pending import cleanup (release-note: none) - ([74df1f6](https://github.com/snapetech/seerrng/commit/74df1f6489295a49733ed151f8a629a57ac479b6))

## [3.23.1](https://github.com/snapetech/seerrng/compare/v3.23.0..v3.23.1) - 2026-09-24

### 🧪 Testing
- *(security)* Enforce route limits and secure cookies - ([9d59333](https://github.com/snapetech/seerrng/commit/9d593332021d641048e05e439a348739576c7a58))
- Stabilize the migration timeout case - ([ed38bd5](https://github.com/snapetech/seerrng/commit/ed38bd527c6f2b159d91c7f9da5b14ad5b40690d))

### ⚙️ Miscellaneous Tasks
- Retain the passing pnpm setup action - ([a3dbde0](https://github.com/snapetech/seerrng/commit/a3dbde066926efb2b7f5c69ae9b60c4c051519e3))
- Pin pnpm version for action setup v6.1.0 - ([8cfafda](https://github.com/snapetech/seerrng/commit/8cfafda6911080e288cc13318d8f433c56b96497))

## [3.23.0](https://github.com/snapetech/seerrng/compare/v3.22.0..v3.23.0) - 2026-09-24

### User-facing changes

#### Added

- **Requests:** Advanced movie and series requests now preview matching override rules for the selected server, profile, folder, and tags before submission.
- **Demo:** Operators can enable demo mode to explore SeerrNG with sample content and interactions without using a live media library.
- **Notifications:** Gotify notifications can now include the media poster as a large image, making it easier to recognize which title triggered an alert.
- **Discovery:** Administrators can enable Hide Requested in General settings to remove movies and series with pending or approved requests from discovery and collection results.
- **Notifications:** Notifications sent through ntfy can now include custom tags, so operators can use ntfy's tag-based filtering and notification behavior.
- **Users:** Administrators can search the user list by username or email address to find accounts without paging through the full list.
- **Books:** Book requests can carry a chosen ISBN edition through to BookshelfNG, which selects the matching edition for acquisition. The edition picker also shows language when catalog metadata provides it.
- **Books:** Book requesters can filter available editions by language. SeerrNG selects a matching ISBN edition and carries it through to BookshelfNG, while the edition selector remains available for a manual override.
- **Bookshelf:** BookshelfNG can merge identified multi-file audiobook downloads into chaptered M4B files. The managed deployment keeps this opt-in off by default and preserves the setting across installer runs.
  - **Action required:** Set BOOKSHELF_M4B_MERGE=true to enable chaptered audiobook imports.
- **User Preferences:** Users can choose one preferred language for all media, then override it for movies, series, music, or books. Requests select matching Radarr or Sonarr profiles when configured, and book requests select a matching edition when available. Music preferences are saved for future source support. Each request keeps its manual destination and edition controls.
- **Bookshelf:** SeerrNG book searches now include the no-key Gutendex catalog by default through BookshelfNG, with optional Internet Archive and NDL Search results that retain their source identity through book details. The Settings > Metadata page now points administrators to the BookshelfNG settings where catalogs and credentials are managed.
- **Unraid:** SeerrNG now includes a Community Applications template for Unraid with stable-image updates, persistent configuration storage, HTTP and optional HTTPS ports, metadata credentials, metrics, and guarded network settings.
  - **Action required:** Make the selected appdata directory writable by UID 1000 and GID 1000 before the first start.
- **Bookshelf:** BookshelfNG can merge optional Google Books, Library of Congress, and Apify Goodreads-compatible results with Hardcover. SeerrNG opens those provider-specific results and carries their identity into requests, while matching existing media by ISBN when available. Configure runtime sources in BookshelfNG; Google Books needs a key, and Apify may charge.

#### Changed

- **Bookshelf:** Bookshelf setup docs now explain how to map host users and groups to numeric container IDs, check mounted-folder access, diagnose unreachable services, and create a matching group for source installs.
- **Documentation:** Discord notification setup now explains the Thread ID option, helping operators route messages to the intended forum thread.
- **Documentation:** The Docker setup guide now includes capability dropping and security options for operators who want to run SeerrNG with a more restricted container.
- **Documentation:** Helm installation guidance now describes chart signature verification accurately, helping operators validate the chart before installation.
- **Containers:** Container images now include the current Node.js 22 patch release, incorporating runtime fixes for deployments that use the published SeerrNG images.
- **Library Scanning:** Background library scans now use a separate bounded TMDB cache for lookup data, reducing repeated metadata traffic and limiting cache growth.
- **Integrations:** Outbound API requests now identify Seerr in their user-agent header, helping external service operators recognize SeerrNG traffic in their logs.
- **Bookshelf:** New SeerrNG installs default to Hardcover; existing Goodreads/Softcover libraries stay supported and migration is optional. The managed deployment enables Library of Congress for audiobook searches, can add Google Books or Europeana with their keys, and keeps Open Library results plus provider identities through details and requests. Apify search remains opt-in and may be metered.
- **Bookshelf:** Failed or unavailable book requests now explain the likely service-side issue and point people to the connected book service's catalog, queue, or logs before retrying.

#### Fixed

- **Library Scanning:** Before cleanup declines a request as orphaned, SeerrNG now checks the configured media servers again, preventing temporary server gaps from changing request status.
- **Requests:** Editing a series request no longer adds seasons already covered by another active request, preventing duplicate season requests.
- **Database:** Startup migrations now normalize leftover Overseerr deleted statuses, keeping older database records consistent with SeerrNG status behavior.
- **Notifications:** Discord comment notifications now handle users without a Discord ID, so webhook delivery no longer fails on an empty account identifier.
- **Discovery:** Hide available and hide blocklisted settings no longer remove people from discovery results; those filters now apply only to media titles.
- **Discovery:** Series discovery now sorts titles using TV-specific fields, and invalid sort choices are ignored instead of producing inconsistent results.
- **Requests:** Editing a request now checks the applicable quota before saving, preventing request changes from exceeding the user's configured limit.
- **Requests:** Editing a series request no longer changes season selections owned by another request, preserving each request's chosen seasons.
- **Login:** The Quick Connect sign-in option is now hidden for Emby servers, where that login method is unavailable.
- **Collections:** Empty collections are no longer shown as available media, keeping collection availability indicators accurate.
- **Requests:** Requesting all seasons now skips seasons that contain no episodes, preventing empty seasons from creating unusable requests.
- **Jellyfin:** Jellyfin API requests now use the Authorization header format expected by current Jellyfin servers, restoring authentication for library operations.
- **Media Server:** Refreshing media server settings no longer resets which libraries are enabled for scanning, so existing scan selections remain in effect.
- **Media Server:** Media server setup and synchronization now report connection failures clearly instead of treating an unreachable server as a successful connection.
- **Requests:** Request status shown in the media details modal now updates immediately after a request action, without waiting for a later page refresh.
- **Notifications:** Web push subscriptions now remain independent across devices and shared browsers, so disabling notifications on one account does not remove another user's subscription.
- **Requests:** Deleting a series request now resets season statuses that no remaining request covers, allowing those seasons to be requested again.
- **Requests:** Override rules now match the selected default Radarr or Sonarr server by its ID, so rules remain attached to the intended server after settings change.
- **Requests:** Phantom special seasons with no episodes no longer prevent a series request from being created.
- **Plex:** Plex setup now suggests the hosted Plex app address when no custom web app URL is configured, so users open the intended Plex interface.
- **Networking:** Image proxy failures now return an error response instead of leaving the browser request open indefinitely.
- **Login:** Signing in with Quick Connect now refreshes the user's avatar, so the profile image reflects the newly linked media server account.
- **Media Server:** Renaming a library in Plex or Jellyfin no longer clears its SeerrNG scan settings, keeping the library enabled state with the renamed entry.
- **Requests:** Request endpoints now preserve pending and failed states during route updates, keeping request status consistent with the action users performed.
- **Requests:** Requests created at the same time for one account are now checked in order, preventing concurrent submissions from bypassing duplicate and quota checks.
- **Requests:** Request approvals and status changes now persist on the same database connection as the save, avoiding missing or stale status updates.
- **Requests:** Concurrent requests for the same title are now serialized, preventing duplicate media records when users submit at nearly the same time.
- **Requests:** Series request cards now show download activity only for the seasons included in that request, avoiding unrelated progress indicators.
- **Interface:** Closing a slide-over panel no longer causes its backdrop to flash back onto the screen during the exit animation.
- **Database:** SQLite upgrades now remove a stale push-subscription uniqueness rule that could block valid subscriptions from additional devices or shared browsers.
- **Unraid:** The Unraid repository now exposes a canonical MIT license header, allowing Community Applications to recognize the repository as an OSI-licensed source during submission review.
- **Unraid:** The Unraid repository profile now clearly identifies this repository as the SeerrNG template source and distinguishes Seerr's existing movie and TV workflow from SeerrNG's added music and book support.

#### Security

- **Security:** Avatar image requests no longer forward the media server authorization header to the image proxy target, reducing the chance of exposing server credentials.

### 🚀 Features
- *(api)* Send a Seerr user agent on outbound requests (#3395) - ([a123d20](https://github.com/snapetech/seerrng/commit/a123d20b2c5821e57fc22082707ad83e866ec78f))
- *(bookshelf)* Surface catalog sources in settings - ([aa7f862](https://github.com/snapetech/seerrng/commit/aa7f862d464cfbeab800372d4c516a7211dcaa6f))
- *(bookshelf)* Enable supplemental catalog defaults - ([6641680](https://github.com/snapetech/seerrng/commit/66416803b70ff86c8cfebb4c5fe5563e98516cc7))
- *(bookshelf)* Support provider-aware metadata - ([39509ea](https://github.com/snapetech/seerrng/commit/39509ea4131f9fdb122a1032b586599fdcf1d531))
- *(notifications)* Add support for ntfy.sh tags (#3350) - ([92bad10](https://github.com/snapetech/seerrng/commit/92bad10c53976f903a145230141d8f78a7c5eba4))
- *(notifications)* Add embed poster option for Gotify (#3332) - ([afb17aa](https://github.com/snapetech/seerrng/commit/afb17aa4f9eb030e0d39e87d6f4750bd8865a215))
- *(overriderules)* Apply override rules to advanced requests (#2164) - ([794743a](https://github.com/snapetech/seerrng/commit/794743a45f17e3d6aba06d68e1716e8b15146673))
- *(settings)* Hide already requested media (#1855) - ([6f5a177](https://github.com/snapetech/seerrng/commit/6f5a17735d383b110cca04326ecd536ad7675ed6))
- *(users)* Configure preferred request languages - ([d1848c7](https://github.com/snapetech/seerrng/commit/d1848c744c66d2c613ab8f24a427105e0a8bb106))
- *(users)* Add search box for user lookup by username or email (#2482) - ([aae8816](https://github.com/snapetech/seerrng/commit/aae8816766daddb8433e6e3b46f0a9695acb0320))
- Add a demo feature (#3017) - ([38581ca](https://github.com/snapetech/seerrng/commit/38581ca1c05f37b3f404571da34358660d1b667b))
- Filter book editions by language - ([4ed87e6](https://github.com/snapetech/seerrng/commit/4ed87e6a5a73f73ccedc9090f509e0ef2f675143))
- Preserve requested book editions - ([67f104f](https://github.com/snapetech/seerrng/commit/67f104fdba0c7e10b01a5f8106361af41c77bb0c))
- Add Unraid Community Apps template - ([4013399](https://github.com/snapetech/seerrng/commit/401339902f86cb1ecb243246061f15fb635824e5))

### 🐛 Bug Fixes
- *(api)* Stop library reads from resetting enabled flags (#3321) - ([985ddef](https://github.com/snapetech/seerrng/commit/985ddef3f01b4cb5523a7f00c0119a4c096e1509))
- *(auth)* Refresh avatar on Quick Connect login (#3504) - ([d4eeea8](https://github.com/snapetech/seerrng/commit/d4eeea85be804af593d00ebba3ec051e355eb1ee))
- *(datasource)* Break import cycle mistyping postgres timestamps (#3449) - ([d7b08bd](https://github.com/snapetech/seerrng/commit/d7b08bddc02467414b71166250f9a38e31df9488))
- *(datasource)* Register entities and subscribers explicitly (#3375) - ([0f79ee6](https://github.com/snapetech/seerrng/commit/0f79ee663c32a3e3141ec64ef9ad79ca6dda5b89))
- *(db)* Remap leftover Overseerr DELETED status after migration (#3510) - ([2bebae8](https://github.com/snapetech/seerrng/commit/2bebae836993db271d192c5db26510a469c83a55))
- *(db)* Drop stale auth unique on sqlite push subscriptions (#3391) - ([5f4cb1e](https://github.com/snapetech/seerrng/commit/5f4cb1ea45b82e46031e8af583d04555087ca0a0))
- *(discover)* Fix tv title sorting and validate sortBy per media type (#3305) - ([2759058](https://github.com/snapetech/seerrng/commit/2759058aeb01248beae841fd450f7e73ea8d95e3))
- *(jellyfin-api)* Update Authorization headers for Jellyfin (#3502) - ([de57e7a](https://github.com/snapetech/seerrng/commit/de57e7ac6c59b0fd3dcbedac6679fb394d5e6c8b))
- *(login)* Hide quick connect button for emby servers (#3369) - ([d103787](https://github.com/snapetech/seerrng/commit/d103787a8f25fa3b4dac35a0ec3a05356adae632))
- *(override-rules)* Match default *arr server by id (#3428) - ([7fae95b](https://github.com/snapetech/seerrng/commit/7fae95bbeac58c749cd5687fa000f8c87f3938c2))
- *(requests)* Serialize requests for the same title (#3380) - ([cc6f5c7](https://github.com/snapetech/seerrng/commit/cc6f5c76316c25b193f6a8887b9d0eaf3bb26eef))
- *(requests)* Stop editing a request from re-requesting covered seasons (#3379) - ([10483e2](https://github.com/snapetech/seerrng/commit/10483e2c08db5d857edc261bb18afd5b9cc5766c))
- *(requests)* Enforce the quota when editing a request (#3378) - ([8f0a977](https://github.com/snapetech/seerrng/commit/8f0a977de83620130ab6cce7f2d39f6d6725c87d))
- *(requests)* Skip seasons with no episodes when requesting all seasons (#2698) - ([1dbf19b](https://github.com/snapetech/seerrng/commit/1dbf19b80355850973367a34bd826ada6d628cd2))
- *(requests)* Scope download status to requested seasons on request cards (#3412) - ([c604bcc](https://github.com/snapetech/seerrng/commit/c604bccc003d4d2f74a66d8cb74d9e14d5ffda89))
- *(requests)* Serialize request creation per user (#3377) - ([d7dc7bd](https://github.com/snapetech/seerrng/commit/d7dc7bdd347bd5fac83c5a6089ba5226ae57ed36))
- *(requests)* Stop editing a request from stealing another's season (#3376) - ([17fc4cc](https://github.com/snapetech/seerrng/commit/17fc4cc659e121ce1bde82188a29a8b07c2dccf9))
- *(requests)* Reset orphaned season statuses when a request is deleted (#3279) - ([970bb54](https://github.com/snapetech/seerrng/commit/970bb545716505e3d3d2fa7072a7aabbc5712c05))
- *(requests)* Enforce pending and failed states on request routes (#3385) - ([9f6403e](https://github.com/snapetech/seerrng/commit/9f6403e14eea2095342407e865f1125d7a4c8896))
- *(scanner)* Confirm orphan candidates against the servers before declining (#3399) - ([34b28d0](https://github.com/snapetech/seerrng/commit/34b28d0aba6961bde8cca9b362c1066593ea0313))
- *(server)* Respond instead of hanging on proxy route errors (#3501) - ([a53f49b](https://github.com/snapetech/seerrng/commit/a53f49bdc3d9740077d84b79fbf470579fb831e7))
- *(settings)* Mutate the query-string status key for modal immediately (#3432) - ([5af32cb](https://github.com/snapetech/seerrng/commit/5af32cb27aa13bc8d1ff3cb2478ed55eb5b5552c))
- *(subscriber)* Keep request status updates on the owning save's connection (#3366) - ([059008c](https://github.com/snapetech/seerrng/commit/059008cbb2ee0ca457ac93597d379407cb61a622))
- *(tv)* Prevent phantom specials from blocking season request (#3351) - ([7997f75](https://github.com/snapetech/seerrng/commit/7997f7564b1b830c53c6902ef8f9f520f4daf55b))
- *(ui)* Stop the slideover backdrop flashing back on close (#3451) - ([df743f4](https://github.com/snapetech/seerrng/commit/df743f463836269eb1e3b15b07ce1bbd17f543ba))
- *(ui)* Stop appear leaking onto the DOM in Modal and SlideOver (#3446) - ([da4b555](https://github.com/snapetech/seerrng/commit/da4b555ca85a5aea05627fc73a4d9cbcec7f7388))
- *(ui)* Don't mark empty collections as available (#3431) - ([92f8404](https://github.com/snapetech/seerrng/commit/92f8404326cf6d8b1c3a9412dbfc6011e26f4112))
- *(webpush)* Resolve push subscription bugs for multi-device and shared browsers (#3142) - ([59d5947](https://github.com/snapetech/seerrng/commit/59d5947b4df8591882bda70ae199f3a708e2d02b))
- Finalize override and push settings integrations - ([2836066](https://github.com/snapetech/seerrng/commit/2836066a7f3b564dd4e6d22c257f11871d8a439e))
- Complete upstream merge integration - ([992ce2d](https://github.com/snapetech/seerrng/commit/992ce2d94d5e8962f6c1ab6a189d0a887d9c1995))
- Fix empty discordId in comment webhooks (#3467) - ([e73825b](https://github.com/snapetech/seerrng/commit/e73825b2f10f53664aeb30733a483b4cf18b6a2e))
- Prevent hideAvailable/hideBlocklisted from filtering person results (#3434) - ([0be53e6](https://github.com/snapetech/seerrng/commit/0be53e6ecccd334b54ecf0ac1ffde7a44d7b13ca))
- Stop masking connection failures across media server sync and login (#3324) - ([4d17e08](https://github.com/snapetech/seerrng/commit/4d17e08b91c8e1de41fd75a750c11b635d046434))
- Keep library settings when renamed on media server (#3323) - ([c9f2ac5](https://github.com/snapetech/seerrng/commit/c9f2ac58be71bd06168f027a06e396558ee1f9f1))
- Changes the suggested url from plex's "hosted" app (#3250) - ([d3c070e](https://github.com/snapetech/seerrng/commit/d3c070e13ae9ebb5de6a42ab02f18fa84d4f02a8))
- Clarify Bookshelf request recovery - ([fe7a770](https://github.com/snapetech/seerrng/commit/fe7a770acf8f34c552b18b1750f63c3a1a4014e9))
- Clarify Unraid repository profile - ([10e93b1](https://github.com/snapetech/seerrng/commit/10e93b15c1606ebf3dac01f0b4f07e7e3a4fde80))
- Make Unraid license detection pass - ([a3a9be3](https://github.com/snapetech/seerrng/commit/a3a9be3aa2dfcf66cb6c2757a6a4b09580806f6d))

### 📖 Documentation
- *(discord)* Document the Thread ID notification setting. (#3481) - ([7afbb29](https://github.com/snapetech/seerrng/commit/7afbb2914f21afa78af357425bb5a840f5e95895))
- *(docker)* Add cap-drop and security-opt to docker command (#3472) - ([a4f5eaa](https://github.com/snapetech/seerrng/commit/a4f5eaa21e30736648600e115ecc87e27a5f6666))
- Clarify ai disclosure policy further (#3358) - ([dea5960](https://github.com/snapetech/seerrng/commit/dea596056af21480464a007ef4ae0a1727fea90c))
- Clarify Bookshelf container permissions - ([ac7271e](https://github.com/snapetech/seerrng/commit/ac7271ee264979ed325d404d18d95344631449b5))

### ⚡ Performance
- Bound tmdb cache & split scan lookups into their own tier (#3367) - ([59ad5f1](https://github.com/snapetech/seerrng/commit/59ad5f191631ec9c60990c953aef7ae08a132782))

### 🚜 Refactor
- *(avatarproxy)* Remove unused auth header from avatarproxy (#3503) - ([b211652](https://github.com/snapetech/seerrng/commit/b2116523f767b9cb9d0065624f0f1dd4f2ca64da))
- *(ui)* Use the Radio component instead of RadioGroup.Option (#3454) - ([46d5915](https://github.com/snapetech/seerrng/commit/46d5915d6c449fc8deccd84bbba50ef76d832f57))
- *(ui)* Use headlessui flat named exports (#3453) - ([aa8e0de](https://github.com/snapetech/seerrng/commit/aa8e0de04ce018137a06d3e2b664c2ebda69be70))

### 🎨 Styling
- Satisfy CI formatting and lint checks - ([ffce36b](https://github.com/snapetech/seerrng/commit/ffce36b814ad18b763e11a34357ed0769da20491))

### 🧪 Testing
- *(cypress)* Stop dirty restartRequired flag cascading across specs (#3368) - ([39ff48c](https://github.com/snapetech/seerrng/commit/39ff48c650d30ced0516574c55914d0bd26c9983))
- Restore outbound guard module imports - ([bdfbfbe](https://github.com/snapetech/seerrng/commit/bdfbfbebcbee06dc8a1c7ae5f061a4e7a0cda9c5))
- Block outbound HTTP in unit tests (#3511) - ([abe2f3b](https://github.com/snapetech/seerrng/commit/abe2f3bb805429c4318afbc6f1684ce94c2d1e8e))
- Add scanner update rate override for testing (#3241) - ([7a76142](https://github.com/snapetech/seerrng/commit/7a76142ae337ce27779109b2b47bdc14883e93b9))

### ⚙️ Miscellaneous Tasks
- *(actions)* Update github actions (#3478) - ([a3dbbd9](https://github.com/snapetech/seerrng/commit/a3dbbd94a654dcf9f4273d7ba754f66c6d71d799))
- *(actions)* Update github actions (major) (#3471) - ([6bf3d04](https://github.com/snapetech/seerrng/commit/6bf3d0484ff86553c2e27ed0552c47d62ab2bd46))
- *(actions)* Update github actions (#3306) - ([5a5f059](https://github.com/snapetech/seerrng/commit/5a5f0590018d648ba3b7d1529f6613d077c4c032))
- *(i18n)* Update translations from Weblate - ([68c5bc8](https://github.com/snapetech/seerrng/commit/68c5bc8c7d8560d295387adeeee73982ea518e8f))
- *(i18n)* Update translations from Weblate - ([5f97227](https://github.com/snapetech/seerrng/commit/5f9722758c4372cf1cd72f414c079e08b1993507))
- *(i18n)* Update translations from Weblate - ([5c04640](https://github.com/snapetech/seerrng/commit/5c04640b631a3d20712006fea24200762b2e6f70))
- *(i18n)* Update translations from Weblate - ([cc592e8](https://github.com/snapetech/seerrng/commit/cc592e8df2a818828855052161f779cbc46ee951))
- Remove third party action dawidd6/action-download-artifact (#3480) - ([6fa7473](https://github.com/snapetech/seerrng/commit/6fa7473dbb3bc0a44fd47748435f53a3480cc4da))


## New Contributors ❤️
* @atilaszsz made their first contribution
* @aussierk made their first contribution
* @Xyerophyte made their first contribution
* @Knat-Dev made their first contribution
* @britsync07-prog made their first contribution
* @MannXo made their first contribution
* @bartdelange made their first contribution
* @Arul1998 made their first contribution
* @tuvokian made their first contribution
* @peruzzof made their first contribution

## [3.22.0](https://github.com/snapetech/seerrng/compare/v3.21.4..v3.22.0) - 2026-09-17

### User-facing changes

#### Added

- **Media Details:** Movie, Series, and Music details now offer an exact playback-quality selector, use the chosen quality for playlists, and show track availability from the selected Lidarr service.
- **Media Details:** Cast, Crew, View Artists, and Subject Tags can now be pinned open per user across supported detail pages and future logins. Selecting a pin opens its card, while clearing it collapses the card without preventing ordinary per-page use of the main disclosure button. Disclosure spacing and secondary-card contrast are also more consistent.

#### Changed

- **Media Details:** The media Associations dialog now uses the site background and presents recommendations as compact details cards. Movie and Series cards show HD and 4K availability; Music cards show MP3 and FLAC, followed by wrapped relationship text. Translucent red Cancel and green Browse More actions replace the top-right close icon, and Browse More reuses the same cards in the full explorer.
- **Media Details:** Book details now use the compact summary-table spacing shared by other media, while audiobook controls appear only when playable tracks exist.
- **Poster Cards:** Poster status tooltips now explain that the yellow bell means pending approval and the purple timer means approved and processing.
- **Collections:** Collection cards now provide clickable artwork, compact metadata and ratings, clearly linked text, consistent scrollbars, and aligned Series availability headings.
- **Issues:** Issue Details now uses the standard action row and colors, places Add Comment on the left and Cancel beside Close or Reopen, and keeps playback actions on media-detail pages.
- **Media Management:** Manage Media now uses a centered artwork-backed card with inset sections, shared spacing and borders, and the standard red Cancel action across Movies, Series, Music, and Books.
- **Music:** The Music playlist importer now uses the shared centered card layout, field styling, guidance panel, and standard colors for Cancel, Preview Matches, and Spotify actions.
- **Request Forms:** Request managers can now select any Seerr user, and Destination Server and Quality Profile share the translucent Requested By menu, hover, and checkmark styling. Request-form dividers are also easier to see at two pixels wide.
- **Issues:** Report an Issue now uses one artwork-backed Collection-style card with darker inset media, selection, and description sections. Cancel, Submit Issue, Continue, and equivalent modal actions use the standard 32-pixel shared button size.
- **Request Forms:** Request forms now open Advanced Options by default, scroll root-folder lists after five rows, use darker controls and dividers, and place full-size request panels on the site background while preserving artwork-backed cards.
- **Discovery:** Edit and delete request dialogs now use shared artwork-backed cards and actions, while Discover pages use consistent navigation, dropdowns, filters, headings, and TMDB artwork.
- **Settings:** Settings now use a consistent card layout, compact page navigation, shared actions, ordinary About-page values, and an unsaved-change warning that prevents accidental loss when navigating back.

#### Fixed

- **Requests:** Media request posters remain usable while background requests run, MP3 and FLAC requests track their progress independently, and music request failures show the server's explanation.
- **Navigation:** The desktop and mobile menus now show Audiobooks once and no longer include the redundant Request Status shortcut. Both pages remain available through their existing routes.
- **Discovery:** Discover and media-detail pages now use compact request cards, consistent dropdowns and actions, clearer availability and ratings, quality-aware Association cards, and the standard artwork-backed Manage Media layout.
- **Discovery:** Discover title posters are larger while preserving their 2:3 ratio, leaving room for complete badge labels and preventing the poster shelf's bottom border from being clipped.
- **Discovery:** Recent Requests no longer shows deleted requests or stale cached cards, and now uses compact cards with artwork-matched borders while keeping approval actions in request management.
- **Media Details:** Firefox no longer progressively zooms detail-card artwork when Cast, Crew, or Subject Tags are repeatedly opened and closed. Artwork still expands to cover the complete card.
- **Discovery And Filtering:** Movie HD and 4K filters now use current Radarr file state and Radarr-backed titles and posters, excluding monitored entries without files and stale blank database cards.
- **Poster Cards:** The Associations icon on poster cards now uses the same aqua border, dark surface, and interaction colors as the full Associations button, and occupies its own second row at the left edge of the poster.
- **Poster Cards:** Poster quality states now use compact rounded badges in fixed rows: HD and MP3 stay on the first row, while 4K and FLAC stay on the second. Available formats are green, pending approval uses a bell, and processing uses a timer.
- **Media Details:** Cast, Crew, and Subject Tags now use the familiar angled pushpin icon instead of a map-location pin, with outlined and solid states for unpinned and pinned.
- **Discovery And Filtering:** Compact discovery selectors retain the site's dark styling, and Clear Filters now restores each page's default sort order as well as its filter values.
- **Navigation:** The main Requests link is present in desktop and mobile navigation while the separate Request Status link and duplicate Audiobooks link remain removed.

#### Security

- **Monitoring:** The authenticated Prometheus metrics endpoint now limits requests per client, reducing the risk that repeated scrapes or unauthorized traffic can consume SeerrNG resources.

### 🚀 Features
- *(details)* Align collection cards and scroll regions - ([7e2292b](https://github.com/snapetech/seerrng/commit/7e2292bcc7485762685183c0ad674667a8b59608))
- *(requests)* Refine requester controls and detail pins - ([e7d01b0](https://github.com/snapetech/seerrng/commit/e7d01b01e8f85f543b3b017d101b1ee2cad1b4ca))
- *(ui)* Complete shared interface refresh - ([bdd2782](https://github.com/snapetech/seerrng/commit/bdd2782f0e8aad7f0f50d3826fc8a89feb0d0969))
- *(ui)* Standardize request and discover surfaces - ([d849416](https://github.com/snapetech/seerrng/commit/d849416b4ac44b551286cf0d98ff9b1d1a48db67))
- *(ui)* Refine media detail and management cards - ([3054465](https://github.com/snapetech/seerrng/commit/30544657dd364db3ef8ccdec2f5be3e7c506184a))
- Select exact detail playback quality - ([bc88673](https://github.com/snapetech/seerrng/commit/bc88673a2f8104b54219234b99c609746f61ad3d))
- Clarify poster status tooltips - ([87878c8](https://github.com/snapetech/seerrng/commit/87878c8b6f740cc2580283ee0bd49303ae10a654))
- Align poster format status badges - ([44cf919](https://github.com/snapetech/seerrng/commit/44cf91945e4e536c171c765e51d59248f82a956a))
- Persist detail pins and refine request cards - ([e17d8b9](https://github.com/snapetech/seerrng/commit/e17d8b9af8fc1a13eb5726223893559048a00d78))

### 🐛 Bug Fixes
- *(books)* Compact detail summary - ([8fd02ae](https://github.com/snapetech/seerrng/commit/8fd02ae4bdf7c9745eaf2250a0f3c28ee47a62a5))
- *(ci)* Restore current settings and discovery flows - ([862e108](https://github.com/snapetech/seerrng/commit/862e1084ace08bcf8cff527d2de6e512f499834e))
- *(ci)* Align checks with refreshed UI - ([223238b](https://github.com/snapetech/seerrng/commit/223238b540f9e4f8f6269f6e846839ee2fa98223))
- *(discover)* Clean up recent request cards - ([ff278be](https://github.com/snapetech/seerrng/commit/ff278be6e87e7fb42145a293f0d52e493c2e7d01))
- *(discovery)* Use live Radarr movie availability - ([db141bd](https://github.com/snapetech/seerrng/commit/db141bdbc6c44a6592fd4c31c81d66eb7a34544e))
- *(security)* Rate limit authenticated metrics endpoint - ([9565c12](https://github.com/snapetech/seerrng/commit/9565c123d1007a6575a7805bad97a2908fc000c6))
- *(ui)* Align issue and history actions - ([d230a2b](https://github.com/snapetech/seerrng/commit/d230a2bd01a481609b34a4dde4d58ab03dd0785f))
- *(ui)* Refine detail quality selector - ([d23bfef](https://github.com/snapetech/seerrng/commit/d23bfefaadd28e54e6df0e2dab2429d4909e4a0d))
- Expand discover poster shelves - ([05ab759](https://github.com/snapetech/seerrng/commit/05ab7591c28221eb4262a7f5ccf0d1d9697846e4))
- Keep quality requests nonblocking - ([f06474e](https://github.com/snapetech/seerrng/commit/f06474e2975e9b3b61a43b92eb5cfa1cc137134b))
- Restore filters and requests navigation - ([d436d7a](https://github.com/snapetech/seerrng/commit/d436d7a848f95e3f01600fd11f9e8a22dcae7dd4))
- Stabilize detail artwork in Firefox - ([7c883d7](https://github.com/snapetech/seerrng/commit/7c883d749f35a9e93e81ccf7770687427a5d8843))

### 📖 Documentation
- Capture pinned media-details disclosures - ([905058e](https://github.com/snapetech/seerrng/commit/905058e5b6ac53614a0121c0e50ad28fd85e8a2c))
- Capture current SeerrNG correction tasks - ([2316f89](https://github.com/snapetech/seerrng/commit/2316f89f38851145ac7958dd80ecc5572afbd7d7))
- Reduce SeerrNG ledger to outstanding work - ([eb206c3](https://github.com/snapetech/seerrng/commit/eb206c30d046a503c4f151a95147e2903f6bf946))

### 🎨 Styling
- Widen discover poster cards - ([2add97f](https://github.com/snapetech/seerrng/commit/2add97fa1c876b123df513c78d573f60c3b8557f))
- Refresh playlist import card - ([0b13cf1](https://github.com/snapetech/seerrng/commit/0b13cf18f2ae13334e72d128130114ad9712d8f9))
- Align badge transparency with buttons - ([6b7b32d](https://github.com/snapetech/seerrng/commit/6b7b32d718a728fb7cb89dd7bcd8e33207ff9a65))

### ⚙️ Miscellaneous Tasks
- Refresh English message catalog - ([d2e9613](https://github.com/snapetech/seerrng/commit/d2e9613758e390ff6dd515c09f1fd3ff99960e88))

## [3.21.4](https://github.com/snapetech/seerrng/compare/v3.21.3..v3.21.4) - 2026-09-17

### User-facing changes

#### Changed

- **Release Pipeline:** Release automation now reports a failed Discord webhook response instead of marking the announcement successful, so operators can detect incomplete release communication.

### 🐛 Bug Fixes
- *(release)* Fail closed on Discord webhook errors - ([0bd6dcd](https://github.com/snapetech/seerrng/commit/0bd6dcd6d6013e780e071789f4df8adf1a14bac2))

## [3.21.3](https://github.com/snapetech/seerrng/compare/v3.21.2..v3.21.3) - 2026-09-17

### User-facing changes

#### Added

- **Monitoring:** Seerr now exposes request, active-request, cache-hit, and external-API counters in Prometheus format when metrics are enabled; an importable Grafana dashboard is included and the endpoint requires a bearer token.
  - **Action required:** Set `METRICS_ENABLED=true` and a long random `METRICS_AUTH_TOKEN` to expose `/metrics`.

#### Fixed

- **Blocklist:** Blocklisted media now remains linked to its blocklist entry, so automatic cleanup removes placeholder media correctly and does not leave orphaned records.
- **Library Scans:** TV library scans now pass the resolved TMDB identifier to TVDB enrichment, so TVDB-only configurations retain complete series metadata.
- **Search:** Search results enrich movie and TV credits faster while handling temporary TMDB rate limits without failing the rest of the search response.

### 🐛 Bug Fixes
- Harden metadata, search, blocklist, and metrics - ([1eeae0f](https://github.com/snapetech/seerrng/commit/1eeae0f39660b41e4f2f65970468569208c5eb68))

### 🧪 Testing
- Run the complete suite through Vitest - ([15f4ec3](https://github.com/snapetech/seerrng/commit/15f4ec3f00f215645c1e6d276ed8cc237ab7c682))

### ⚙️ Miscellaneous Tasks
- Enforce bundle and release quality gates - ([2dce2d5](https://github.com/snapetech/seerrng/commit/2dce2d5927fa6a46b5b48f5a401ca3201aaf1f8f))
- Align runtime and test tooling dependencies - ([fd1fac2](https://github.com/snapetech/seerrng/commit/fd1fac2034de56c435ddb4a4d74819aebab2b59d))

## [3.21.2](https://github.com/snapetech/seerrng/compare/v3.21.1..v3.21.2) - 2026-09-14

### User-facing changes

#### Fixed

- **Requests:** Movie requests now work with older standard Radarr configurations, and failed requests show the server’s actionable reason instead of only a generic error.

### 🐛 Bug Fixes
- *(requests)* Support legacy standard Servarr tiers - ([21c09ec](https://github.com/snapetech/seerrng/commit/21c09ec8669f294a4d4db651d53460ec7b8a921a))

## [3.21.1](https://github.com/snapetech/seerrng/compare/v3.21.0..v3.21.1) - 2026-09-14

### User-facing changes

#### Changed

- **Runtime:** **Breaking:** SeerrNG refreshes its runtime and database dependencies, including the embedded SQLite driver, while keeping existing SQLite databases supported.
  - **Action required:** Upgrade Node.js to 22.22.2 or newer before upgrading.

#### Fixed

- **Release Pipeline:** Multi-architecture container builds now include the repository's pinned dependency patches, so release images can be rebuilt reliably from a clean checkout.
- **Discovery:** Book format switches now preserve active discovery filters, and the theme and account menus open, close, and remain usable after changing display settings.
- **Authentication:** Installations using the default HTTP listener can now sign in and keep browser sessions with a visible network warning, while HSTS is sent only over HTTPS. Set `SEERR_ALLOW_HTTP_AUTH=false` when direct browser access must require HTTPS.
- **Database:** Fresh SQLite installations and database restores now complete all historical migrations with the current database driver while preserving existing data and schema.

#### Security

- **Discovery:** Discovery links now handle untrusted query parameter names safely, preventing crafted URLs from changing application object state.
- **Tooling:** The duplicate-detector tooling now pins a patched archive dependency so its bundled runtime no longer resolves vulnerable adm-zip versions.

### 🐛 Bug Fixes
- *(ci)* Include pnpm patches in container builds - ([cbb6224](https://github.com/snapetech/seerrng/commit/cbb6224f38a1845706b41c8fe28d52346513e6c6))
- *(ci)* Align UI contract with formatter - ([46a9ea1](https://github.com/snapetech/seerrng/commit/46a9ea19fc8740b2167d975635d2d004fb8c14c3))
- *(ci)* Migrate Cypress tests to v16 APIs - ([2127f6b](https://github.com/snapetech/seerrng/commit/2127f6b606252b2e6f8615801ee510b32e945d66))
- *(deps)* Repair SQLite migrations and pin adm-zip - ([949700b](https://github.com/snapetech/seerrng/commit/949700bcb356f6233bc07de161e1006afac81b1d))
- *(deps)* Refresh runtime dependencies and migrate SQLite driver - ([b007292](https://github.com/snapetech/seerrng/commit/b007292890a87ee203e44127c9c4cf22e105b1aa))
- *(security)* Harden route query parsing - ([750377d](https://github.com/snapetech/seerrng/commit/750377d864d09929b100af10efc1bf4b9b46e03f))
- *(ui)* Preserve discovery filters and migrate transitions - ([db47b39](https://github.com/snapetech/seerrng/commit/db47b39197ab7c60dca029f9ebdadedc595efbe0))
- Restore default HTTP sign-in and scope HSTS - ([96199ad](https://github.com/snapetech/seerrng/commit/96199ad2c4f39f2837b592cf341fca3ac2ed075d))

### ⚙️ Miscellaneous Tasks
- *(ci)* Settle release-note validation - ([d08e07c](https://github.com/snapetech/seerrng/commit/d08e07cf17db8b7fb09e416f0058be03c50ec51e))

## [3.21.0](https://github.com/snapetech/seerrng/compare/v3.20.4..v3.21.0) - 2026-09-13

### User-facing changes

#### Added

- **Search:** Global Search now separates media-type choices under a Media Filters heading. Its regular Filters row flows from Clear Filters and title visibility into Keyword Search and the selected media type's relevant discovery controls.
- **Discovery:** Movie, Series, and Music discovery now include one compact Quality Available control for filtering results to scanned HD, 4K, MP3, or FLAC library copies. Keyword Search begins on its own filter row across Movie, Series, Music, and Books discovery.
- **Users:** Local users can now select Edit on their profile picture to upload a JPEG, PNG, or WebP image. Plex, Jellyfin, and Emby profile pictures continue to follow their linked media-server accounts. Absolute Plex avatar URLs are now accepted by the secure remote-image cache, preventing valid linked profile pictures from falling back to the generic avatar.
- **Series Requests And Issues:** Series requests and issue reports can now retain selections from multiple seasons, including exact episode subsets for each season. Exact requests are sent to Sonarr as episode-level monitoring and searches while whole-season requests keep their existing behavior.
- **Requests:** Requests, Issues, and Blocklist now group their media-type choices under a dedicated Media Filters heading, keeping workflow state and regular Time Period and Keyword Search controls in their own sections.
- **Ui:** Books Details now matches the compact artwork-backed media design, with linked author and Open Library facts, separate Ebook and Audiobook availability, an expandable linked Genres card, and consistently styled actions. Blocklist, icon-only Manage, icon-only Report an Issue, and Associations lead the compact action row, while Request Bibliography uses a distinct dark green.
- **Ui:** Movie Details now uses a compact artwork-backed layout with linked facts, a structured overview, aligned ratings, three-column cast and crew lists, subject tags, grouped production details, consistent actions, separate adjacent standard and permission-aware 4K request buttons, and request history with separate date, time, action, and description columns.
- **Ui:** Music Details now uses the shared artwork-backed layout with linked album facts and Origin, MP3 and FLAC availability badges, track cards, artist information, subject tags, and consistent actions. Request Discography is dark green, while unreliable listening totals and the unused Artist Overview are omitted.
- **Ui:** Series Details now uses the shared artwork-backed layout with linked facts, aligned ratings, three-column cast and crew lists, subject tags, a read-only two-card season and episode browser, separate adjacent standard and permission-aware 4K request buttons, and consistently styled Blocklist, Manage, Report an Issue, trailer, and Associations actions.
- **Requests:** Request Status cards now provide compact History, Retry, and Delete controls. Active retries and deletions cancel matching download work and require confirmed cleanup before Seerr changes the request record.

#### Changed

- **Ui:** The site background now uses a narrow upper-right purple spotlight over a 40-degree blue-to-black gradient, providing stronger depth and color while keeping the highlight restrained.
- **Ui:** Discover now uses consistent category spacing, including at enlarged browser scaling, one compact title-visibility control per row, standard navigation controls, and headings without circular arrow icons. Genre, Studio, and Network cards use half the former footprint without leaving oversized slider gaps.
- **Interface:** The site and narrow-window menu now use a stronger four-color diagonal gradient with a focused upper-right highlight and black lower edge. Refreshed cards are more translucent, and artwork uses a uniform readability layer without a lower-edge fade.
- **Media Workflows:** Request, issue, blocklist, and media browsing screens now share compact filters, sorting, paging, searchable metadata, and consistent badges and tooltips.
- **Interface:** Blocklist, Issues, Request Status, Requests, Users, and Logs now share one compact pagination footer with matching Previous and Next actions, results-per-page selection, page count, spacing, and alignment.

#### Fixed

- **Bookshelf:** Book requests now track the actual Bookshelf search, download, and import workflow, report when no release is found, and remove empty records created by unsuccessful requests. Active lifecycle checks bypass cached book metadata, and a confirmed import publishes availability before request tracking ends.
- **Ui:** Season, episode, music-track, and audiobook-track availability icons now share the exact centered column alignment used by their availability heading.
- **Ui:** The Books page now shows the same Open Library timeout notice and retry action as book searches when its provider is unavailable, instead of incorrectly reporting that no books matched.
- **Ci:** Production container builds now keep development-only validation inputs outside the image context while repository and GitHub builds continue to enforce the complete current-batch contract.
- **Ui:** Refreshed media details now retain the shared blue/lavender content tone and distribute every visible primary action evenly across the full action row.
- **Discovery:** Clear Filters on Movie and Series discovery now clears the visible Keyword Search text and prevents its debounced value from restoring the removed search filter.
- **Ui:** Search fields and idle controls now retain the shared blue palette, while media-server playback buttons align their full-height provider logos consistently with clearly spaced labels.
- **Issues:** Issue cards now include their saved HD or 4K target beside the media type. Report an Issue forms list only the HD and/or 4K copies currently available for Movies and Series, fresh request forms consistently expose the configured destination qualities from every entry point, and Book issue details keep separate links to configured Ebook and Audiobook services.
- **Search:** Keyword Search now requires every entered word to match meaningful title, creator, or genre metadata, preventing broad provider metadata and popularity ranking from filling Books, Music, Movie, and Series results with unrelated titles.
- **Music Requests:** Music requests now remain Importing while Lidarr or Picard work is pending, use recent Lidarr history to bridge fast queue changes, show No Release Found after an unsuccessful search, resume after a manual grab, and track each selected service, format, quality, metadata profile, root folder, and tag independently.
- **Music:** Music Details now always lists MP3 availability first and FLAC availability second, with green available values and yellow unavailable values based on the separately scanned Lidarr destinations.
- **Authentication:** Plex sign-in now returns its authentication popup to a Seerr-owned completion page so the popup can close itself, while preserving the existing bounded PIN-polling login flow.
- **Requests:** Request forms now disable only the currently available movie, series, music, or book target while allowing another configured quality, service, or format. Album details keep the Request action visible and show the quality profile for every available MP3 or FLAC copy.
- **Discovery:** Series now places Status directly after Keyword Search and reliably preloads its TV genres. Books and Audiobooks now separate their format choices under Media Filters while keeping all regular controls in one wrapping Filters row.
- **Request Status:** Request Status now combines live Arr queues with recent service history, so fast downloads and files awaiting automatic or manual import remain Importing instead of becoming Failed. Only an explicit download or import failure is terminal.
- **Search:** Keyword Search filters now activate the shared header Searching indicator and refresh Movies, Series, Music, and Books after a short typing pause. Request managers also see all users by default, so approval-required requests made for another user remain visible.
- **Bookshelf:** Books discovery now defaults to All Books, keeps Book and Audiobook request context when entering details, opens card requests on the details page, restores browsing position after Back, and reports an unusable empty provider feed as an error.
- **Requests:** The All Users request-status filter now reloads results without retaining the previous owner selection, and filter and sort controls use the compact Search-page sizing on mobile and desktop.

### 🚀 Features
- *(ui)* Complete media workflows and server playback (#117) - ([f6d91aa](https://github.com/snapetech/seerrng/commit/f6d91aaf7d7a00a659d83a3c6cb0a6abb599960f))

## [3.20.4](https://github.com/snapetech/seerrng/compare/v3.20.3..v3.20.4) - 2026-09-13

### ⚙️ Miscellaneous Tasks
- Record internal dependency refresh - ([a60b98a](https://github.com/snapetech/seerrng/commit/a60b98ac17a37934366ad7571777d10de39ca10c))

## [3.20.3](https://github.com/snapetech/seerrng/compare/v3.20.2..v3.20.3) - 2026-09-13

### User-facing changes

#### Fixed

- **Bookshelf:** Chaptarr book requests now work with large libraries, and library synchronization uses bounded pages instead of a single oversized response.

### 🐛 Bug Fixes
- *(bookshelf)* Paginate Chaptarr library requests - ([3d1f22f](https://github.com/snapetech/seerrng/commit/3d1f22fa46ce3b5782f99062b8eb8cb4dab3ac6b))
- *(i18n)* Sync extracted messages for the music/book notification labels - ([843405f](https://github.com/snapetech/seerrng/commit/843405fb21af94e123ce962fb48df0a9de971656))

## [3.20.2](https://github.com/snapetech/seerrng/compare/v3.20.1..v3.20.2) - 2026-09-12

### User-facing changes

#### Fixed

- **Requests:** The "request on behalf of" user list in the advanced request modal no longer stays filtered against the previous quality or media type after switching between Standard/4K or between movie, TV, music, and book — a missing effect dependency let the stale permission filter linger until something unrelated forced a refresh.
- **Plex:** Plex audiobook scans no longer trust Open Library's top search hit unconditionally when Plex has no direct identifier for a title — a weakly related or unrelated book is now rejected instead of being silently marked available.
- **Testing:** The book-discovery scroll-restoration E2E test now matches the book detail link's real href (which carries a `?format=` query parameter to preserve the discovery tab's format context, added alongside the Audiobooks discovery page) instead of a bare path, fixing a false failure introduced when that link shape changed.
- **Developer Experience:** `pnpm dev` no longer crashes on startup with errors like "Cannot find module '@server/entity/IssueComment'" — a race between Next.js's require-hook and the `@server/*` path-alias resolver whenever TypeORM or the settings migrator resolved files dynamically after Next's dev server was constructed. Database and settings now initialize before Next installs its hook.
- **Requests:** The request status filter dropdown no longer offers both "Incomplete" and "Adding to library" as separate options — they matched the exact same requests, since "Incomplete" was added as a friendlier alias for the same underlying stage without removing the older entry.
- **Settings:** Switching Settings > Plex or Settings > Jellyfin to point at a different physical server now clears the previous server's stored libraries instead of carrying over their enabled state and Music/Audiobook classification onto an unrelated library that happens to reuse the same library id.
- **Requests:** A book request for both ebook and audiobook formats now correctly shows as "Incomplete" once both services are dispatched but not yet processed — previously it could report "Searching" while both downloads were already underway, because the check stopped once both formats were linked instead of also checking progress.
- **Search:** Searching for music or audiobooks/books no longer gets stuck after the first ~20 results — pagination was being computed from this page's (capped) result count instead of the true number of matches reported by MusicBrainz and Open Library, so scrolling past the first page silently stopped fetching more.
- **Notifications:** Music request notifications (pending, approved, available, declined, and auto-approved/auto-requested) now include the album's cover art across every notification agent — the music branch of the notification builder never set an image, so these were the only request-lifecycle notifications sent without artwork.
- **Notifications:** Email and web push notifications now say "music" or "book" instead of mislabeling those requests as "series" — the movie/series wording predates the Music and Audiobook request types and was never updated for them.
- **Settings:** Switching a Bookshelf/Readarr server's book format (ebook/audiobook) while it was the default for its old format no longer leaves that format without a default server — another server of the old format is now automatically promoted, matching what already happens when the default server is deleted.

### 🐛 Bug Fixes
- *(dev)* Initialize database and settings before Next installs its require-hook - ([4f80cf8](https://github.com/snapetech/seerrng/commit/4f80cf8889dabafdeb8ea29deeafcf457d98d541))
- *(notifications)* Include cover art in music request notifications - ([c1f1ab2](https://github.com/snapetech/seerrng/commit/c1f1ab285adadc281d7ca396cf9052793ab03fe2))
- *(notifications)* Label music and book requests correctly in email/webpush - ([ff40f50](https://github.com/snapetech/seerrng/commit/ff40f508ed574e4b547d9446b3e4c8da56e79e74))
- *(plex)* Reject weak Open Library matches for unidentified audiobooks - ([bba410e](https://github.com/snapetech/seerrng/commit/bba410ee31fe7c38f48c3f0d8f0e463250362374))
- *(release-notes)* Correct audience and body-length schema violations - ([acb4340](https://github.com/snapetech/seerrng/commit/acb43401b21e61527d4d3a42b58ce6aa05f81fad))
- *(requests)* Show incomplete status for a fully-dispatched mixed-format book - ([806e638](https://github.com/snapetech/seerrng/commit/806e6383eb00d864ddd0394e39d90c03d7067b6e))
- *(requests)* Remove duplicate library filter option from status page - ([39f7a84](https://github.com/snapetech/seerrng/commit/39f7a84f4d8a84ba8c3e43376105057089b01dc7))
- *(requests)* Refresh proxy-user filter when quality or media type changes - ([ff0109b](https://github.com/snapetech/seerrng/commit/ff0109bc1724d7970171550764fb393ddb6d4957))
- *(search)* Use true provider match counts for music/book pagination - ([48318be](https://github.com/snapetech/seerrng/commit/48318be707eed1b08fd48417249ca88b5727dfc9))
- *(settings)* Re-promote a Bookshelf default when its format changes - ([c4ff242](https://github.com/snapetech/seerrng/commit/c4ff242905dc776f8640918e0cfe147f3850fa8f))
- *(settings)* Clear stale library state when Plex/Jellyfin points at a new server - ([cfcb72e](https://github.com/snapetech/seerrng/commit/cfcb72ede846ee0ceb6a8d79ba9433ab635dd264))
- *(tests)* Match real book detail href in scroll-restoration E2E test - ([9f43e45](https://github.com/snapetech/seerrng/commit/9f43e459a459603fe49163f53f0817000b718bd5))

## [3.20.1](https://github.com/snapetech/seerrng/compare/v3.20.0..v3.20.1) - 2026-09-11

### User-facing changes

#### Added

- **Request Status:** Request Status now highlights partially fulfilled requests as Incomplete, with a dedicated summary count, filter, and sort option so unfinished media or formats are easier to find.

#### Fixed

- **Books:** Book discovery now has separate Books and Audiobooks sections, and each section keeps the matching format selected when searching or requesting a title.
- **Jellyfin:** Jellyfin library syncs now keep each library's enabled state when its name changes on the server.
- **Settings:** Media-server library controls now recover cleanly from failed update requests and show an error instead of leaving the settings page stuck in a loading state.
- **Plex:** Plex audiobook scans now ignore malformed ISBNs from Plex and Open Library instead of storing identifiers that cannot match future book searches.
- **Plex:** Plex audiobook libraries now show the correct label and reliably support switching between Music and Audiobooks from Settings.
- **Plex:** Plex library settings can now switch artist libraries between Music and Audiobooks, keep that choice when a Plex library is renamed, and keep every newly added album in recent scans instead of dropping albums that share an artist.
- **Plex:** Plex recent music scans now resolve matched albums whose MusicBrainz identifiers are returned in Plex’s detailed GUID metadata.

### 🐛 Bug Fixes
- *(books)* Harden audiobook discovery and Plex reclassification - ([24cfaa3](https://github.com/snapetech/seerrng/commit/24cfaa31d1ad03553da4e0263f80e5fab0ec5ac6))
- *(plex)* Correct recent-music dedup, ISBN validation, and library rename handling - ([b0f1469](https://github.com/snapetech/seerrng/commit/b0f1469a9ce945b05907d16ca3d6c2682db5747f))
- *(settings)* Correct Music library badge label and simplify reclassify prop - ([881c0bd](https://github.com/snapetech/seerrng/commit/881c0bd9815d44d09b6272d6e6ef5ed8fc9e8579))

## [3.20.0](https://github.com/snapetech/seerrng/compare/v3.19.5..v3.20.0) - 2026-09-10

### 🚀 Features
- *(plex)* Add Music and Audiobook library support (#110) - ([76035d9](https://github.com/snapetech/seerrng/commit/76035d98f070f7c44af5d75a2782c0d05de0d84e))

## [3.19.5](https://github.com/snapetech/seerrng/compare/v3.19.4..v3.19.5) - 2026-09-10

### User-facing changes

#### Fixed

- **Bookshelf:** SeerrNG now follows the latest released BookshelfNG `main` build through stable image tags; development builds no longer replace those defaults. BookshelfNG source builds also accept forwarded MSBuild warning settings when NuGet audit output needs an explicit policy.
  - **Action required:** pull the latest BookshelfNG image when upgrading

### 🐛 Bug Fixes
- *(bookshelf)* Follow latest BookshelfNG main release - ([3a3f6e4](https://github.com/snapetech/seerrng/commit/3a3f6e49d420e06339003203520acf110f5f56a6))

## [3.19.4](https://github.com/snapetech/seerrng/compare/v3.19.3..v3.19.4) - 2026-09-10

### User-facing changes

#### Fixed

- **Artwork:** Opening a title reuses downloaded artwork immediately, with sharper movie and TV posters loaded only when needed. Fresh cached covers avoid redundant background requests, and matching album covers share the same image URL across discovery and details.

### 🐛 Bug Fixes
- *(images)* Reuse loaded artwork across navigation - ([bfe4d19](https://github.com/snapetech/seerrng/commit/bfe4d19fa25878861067d2da1733efe236c31038))


## New Contributors ❤️
* @EasyAsABC123 made their first contribution

## [3.19.3](https://github.com/snapetech/seerrng/compare/v3.19.2..v3.19.3) - 2026-09-09

### User-facing changes

#### Added

- **Bookshelf:** Operators can now build and run BookshelfNG directly from source without Docker, with documented toolchain, systemd, metadata, and SeerrNG connection steps.

#### Fixed

- **Discover:** Returning from details to a discovery grid now keeps the same row in place, including when earlier poster rows are offscreen.

### 🐛 Bug Fixes
- *(discover)* Keep poster rows stable on back navigation - ([ed3d299](https://github.com/snapetech/seerrng/commit/ed3d2990e54ffd53744c5cb4fb4d09f77cbf63f8))

### 📖 Documentation
- *(bookshelf)* Add source build guide - ([c57fe3a](https://github.com/snapetech/seerrng/commit/c57fe3a54eaccde68c36e2656fe4d8367fd95eda))

### 🧪 Testing
- *(e2e)* Stabilize repeated navigation and screenshot checks - ([61b228e](https://github.com/snapetech/seerrng/commit/61b228e366cb075e5b46ee663c0661f702ce5cc5))

## [3.19.2](https://github.com/snapetech/seerrng/compare/v3.19.1..v3.19.2) - 2026-09-08

### User-facing changes

#### Fixed

- **Jellyfin:** If Jellyfin setup saves the server but the browser cannot keep the new session, SeerrNG now refreshes setup state and guides you to sign in again instead of submitting the same server details twice.
- **Authentication:** The Plex login popup now closes automatically after Plex returns from a successful sign-in, while SeerrNG continues using its existing PIN polling and authentication checks.

### 🐛 Bug Fixes
- *(auth)* Close completed Plex login popups - ([f2f1722](https://github.com/snapetech/seerrng/commit/f2f1722f870618f48536d620de20722ac387372a))
- *(setup)* Recover after Jellyfin session loss - ([6f3a723](https://github.com/snapetech/seerrng/commit/6f3a723810186c77d73f2db14ad1f97d3d5e2752))

### ⚙️ Miscellaneous Tasks
- *(release)* Mark generated prep commits internal - ([04c3104](https://github.com/snapetech/seerrng/commit/04c3104202805151f8e9f0a49832186d122c7b6d))

## [3.19.1](https://github.com/snapetech/seerrng/compare/v3.19.0..v3.19.1) - 2026-09-08

### User-facing changes

#### Fixed

- **Bookshelf:** Removing an ebook, audiobook, or both formats from Bookshelf now succeeds instead of being rejected as a bad request.

### 🐛 Bug Fixes
- *(bookshelf)* Validate format-aware file removal - ([81d5c65](https://github.com/snapetech/seerrng/commit/81d5c651a82c504984935368138beeed5099888a))

## [3.19.0](https://github.com/snapetech/seerrng/compare/v3.18.0..v3.19.0) - 2026-09-08

### User-facing changes

#### Added

- **Interface:** Seerr now includes a Seerr Classic palette matching the original upstream blue-gray appearance, and browser chrome follows the selected palette. It is the default for browsers without a saved palette choice, while existing saved palette preferences remain unchanged.
- **Interface:** Seerr now includes a distinct Seerr palette with navy surfaces and blue/sky accents alongside Seerr Classic. Choose it from the browser-local theme picker without changing another user’s saved palette.

#### Fixed

- **Release Checks:** SeerrNG now compares installed and available versions using the SeerrNG release tags, so a fork build that is newer than the last public release no longer shows a false update warning. The stable status label also identifies SeerrNG in Swedish.
- **Release Pipeline:** Release asset publication now has permission to download the platform archives produced earlier in the same workflow, so a successful build matrix can complete the GitHub release instead of failing at the upload gate.
- **Release Pipeline:** Release retries now pass artifact-download permission from the top-level release workflow into the reusable asset workflow, allowing an existing draft release to recover after its platform archives finish building.
- **Interface:** The default SeerrNG palette is now labeled **Seerr** in the theme picker and documentation, with the separate branded palette retaining its own distinct name.
- **Services:** SeerrNG now retries a transient Sonarr, Radarr, or other provider read failure before showing a connection error, reducing false “unable to connect” warnings while preserving persistent failures.

### 🚀 Features
- Add branded Seerr palette - ([aa8ad8f](https://github.com/snapetech/seerrng/commit/aa8ad8fc571b0ab7c3f91f9f368461774fbead3b))
- Restore the classic Seerr palette - ([472956c](https://github.com/snapetech/seerrng/commit/472956c7ba3eef247b7112857ba99c0aa97268a3))

### 🐛 Bug Fixes
- Name the default Seerr theme - ([4506d1d](https://github.com/snapetech/seerrng/commit/4506d1d69d9bf93fc1d7b5873a17033af3381677))
- Pass release artifact permissions through - ([d6cc0ca](https://github.com/snapetech/seerrng/commit/d6cc0caa36c1e6636a53169e27d991447ca55289))
- Allow release asset downloads - ([5028be8](https://github.com/snapetech/seerrng/commit/5028be89d7efe5177e5d7e4ca6daf131fbb95c47))
- Parse public status query booleans - ([1cd5eb6](https://github.com/snapetech/seerrng/commit/1cd5eb688e67a495746131429ad152b62da4d7df))
- Retry transient external API reads - ([7834580](https://github.com/snapetech/seerrng/commit/783458007ad4e33555c21e9ffa0df2a0678d35eb))
- Report SeerrNG stable releases correctly - ([873e596](https://github.com/snapetech/seerrng/commit/873e596e84b89788dfeec93c43c88a5610bd1e7b))

### 📖 Documentation
- Clarify Seerr theme labels - ([cb924d4](https://github.com/snapetech/seerrng/commit/cb924d4ed82be1884b3b36622908e103a33d54f0))
- Clarify transient service retry note - ([7174b0c](https://github.com/snapetech/seerrng/commit/7174b0cf1d0d1fbce21b3462baf6d3dc73e02b69))

## [3.18.0](https://github.com/snapetech/seerrng/compare/v3.17.0..v3.18.0) - 2026-09-08

### User-facing changes

#### Fixed

- **Authentication:** First-run setup now waits for an active HTTPS or explicitly enabled HTTP session mode before media-server sign-in, and recovers clearly when a previous attempt saved Jellyfin details without establishing a browser session.
  - **Action required:** restart SeerrNG after changing browser transport settings
- **Metadata:** SeerrNG now bounds poster pre-caching, keeps key search and request views usable on narrow screens, shows MusicBrainz record-label metadata when available, and improves title-only book and audiobook matching.

### 🚀 Features
- Complete tester feedback media and import flows - ([2aa11a2](https://github.com/snapetech/seerrng/commit/2aa11a2ebab183304f81d37505a5fd590d13be09))

### 🐛 Bug Fixes
- *(ci)* Allow multiple release-note confirmations - ([abab5ea](https://github.com/snapetech/seerrng/commit/abab5eaedf8889e9f452c6de69a1989c108cdc46))
- *(ci)* Keep releases moving when Snap Store is unavailable - ([4bc309d](https://github.com/snapetech/seerrng/commit/4bc309ddaaf400c329c72b0d1dd6dbdd05bbe7b3))
- *(ci)* Install git in rpm package container - ([68cf515](https://github.com/snapetech/seerrng/commit/68cf515b078b9a2084d4fe0962df9bd3695cd6d5))
- *(ci)* Validate release asset sidecars - ([f93c383](https://github.com/snapetech/seerrng/commit/f93c383c0c7fee813e0992e1685f740b6fe177dd))
- *(ci)* Validate release platform digests portably - ([5b7b513](https://github.com/snapetech/seerrng/commit/5b7b5136976888e3c234b26596287c7664568bd3))
- *(release)* Align OCI manifest annotations - ([ad82d50](https://github.com/snapetech/seerrng/commit/ad82d501f532230ac2cb94430af98de068d3b1e7))
- *(release)* Label images with the tagged source commit - ([e5ce1f7](https://github.com/snapetech/seerrng/commit/e5ce1f754f11b1bc1d15e3266af2b3be0ad51c37))
- *(release)* Inspect draft assets through gh release view - ([6fba0a9](https://github.com/snapetech/seerrng/commit/6fba0a9cd110f59437e2aae1c8e47ace2e8b37f0))
- *(release)* Allow package channels to read drafts - ([625fcf7](https://github.com/snapetech/seerrng/commit/625fcf71319438ef744b0b00f1f6ce4293744092))
- *(release)* Allow AUR to read draft assets - ([07ca314](https://github.com/snapetech/seerrng/commit/07ca3142db6c1195c7a28f9f203228eba51d2540))
- *(release)* Use GitHub CLI for AUR assets - ([94eebe2](https://github.com/snapetech/seerrng/commit/94eebe2dfbddf200b10bc32a4dc4675f63bedb8f))
- *(release)* Download AUR assets from draft releases - ([70c9f28](https://github.com/snapetech/seerrng/commit/70c9f2820d564db2ff38fbb241b2c6f2ae568806))
- *(release)* Authenticate Fedora tag verification - ([78c93f1](https://github.com/snapetech/seerrng/commit/78c93f1b4696a274d580b4b5345773d579a72992))
- *(release)* Mark Fedora workspace safe - ([5208653](https://github.com/snapetech/seerrng/commit/5208653b10cc54a4c7ab659b3ac789474c1e2210))
- *(release)* Repair rpm tag verification - ([fd8998a](https://github.com/snapetech/seerrng/commit/fd8998a771b793ca22348745273e188b72389753))
- *(setup)* Recover browser sessions during media server setup - ([60c1806](https://github.com/snapetech/seerrng/commit/60c1806e6b68c90ba8d92ccf39796dc31cfd5c64))

### 🧪 Testing
- *(e2e)* Acknowledge HTTP transport in Cypress [release-note: none] - ([ab553e3](https://github.com/snapetech/seerrng/commit/ab553e3792314cadd09264c9cc394686e6b9bfa7))

## [3.17.0](https://github.com/snapetech/seerrng/compare/v3.16.0..v3.17.0) - 2026-09-07

### User-facing changes

#### Changed

- **Media Ui:** Request-management panels now identify movie, series, and album requests alongside their status, including on compact layouts.
- **Media Ui:** Media cards and request lists now show consistent badges for movies, series, albums, artists, collections, and books so each title’s media type is clear at a glance.
- **Media Ui:** Movie and series cards now distinguish standard and 4K availability, downloads, and requests, including a clear 4K request affordance when that quality is missing.

#### Fixed

- **Discover:** Returning from movie, series, or book details now preserves the discovery list order and restores your previous scroll position after the results have loaded.

### 🚀 Features
- *(ui)* Surface movie and series quality state - ([a66dc4e](https://github.com/snapetech/seerrng/commit/a66dc4ea5968f479ace2c519b059decc44711772))
- *(ui)* Identify media in request panels - ([3d63c1c](https://github.com/snapetech/seerrng/commit/3d63c1c8ee8508b00eeb4a585b441cf934f443fa))
- *(ui)* Standardize media type badges - ([86bcb32](https://github.com/snapetech/seerrng/commit/86bcb327e081c1c4d78cbe1876aad35e9d70ad69))

### 🐛 Bug Fixes
- *(discover)* Harden persisted back-navigation state - ([f01052f](https://github.com/snapetech/seerrng/commit/f01052f4ef3587f47ec0d9107c92ad8147530cf5))
- *(discover)* Restore list order and scroll on back navigation - ([d925405](https://github.com/snapetech/seerrng/commit/d92540590ae0a7a1d25841e0dd11b248ce3fe5b3))

### 🎨 Styling
- *(ci)* Format release workflow assertion - ([d0f0f0c](https://github.com/snapetech/seerrng/commit/d0f0f0ce79ab62341ac3caadf4348d2df20c223c))

### 🧪 Testing
- *(cypress)* Align book assertions with format-aware controls - ([ac80cfe](https://github.com/snapetech/seerrng/commit/ac80cfebe9a8f9168b2ee56c6b3306abd13d8019))

### ⚙️ Miscellaneous Tasks
- *(ci)* Honor internal release-note markers on pushes - ([6817587](https://github.com/snapetech/seerrng/commit/6817587157be11e7f544399f53213928ada12ee8))

## [3.16.0](https://github.com/snapetech/seerrng/compare/v3.15.0..v3.16.0) - 2026-09-07

### User-facing changes

#### Added

- **Search:** Search results can now be filtered into movies, series, books, audiobooks, and music, with type-aware sorting, title visibility controls, loading feedback, and clear empty states. Book formats route to the matching Bookshelf service.
- **Bookshelf:** Book detail pages now preserve the selected format, label request and view actions accordingly, and show whether ebook and audiobook coverage is available or already requested.
- **Bookshelf:** Book cards, search results, and request dialogs now identify ebook, audiobook, and combined format choices. Request actions use the selected format, and formats without a configured service are clearly unavailable.

#### Changed

- **Request Status:** Request Status now uses compact media cards with clearer lifecycle progress, download details, status history, user context, and optional request-date filtering.
- **Bookshelf:** Ebook, audiobook, and combined requests now keep their format context across book details, request lists, and Request Status, with clearer coverage indicators and format-aware links and actions.
- **Bookshelf:** Bulk bibliography requests now use the same explicit Ebook, Audiobook, and Ebook + Audiobook choices as individual requests, while status links, download rows, and request-management views keep the selected format visible.
- **Bookshelf:** Book request dialogs now include the selected ebook, audiobook, or combined format in their title and confirmation action, making the requested format clear while reviewing or submitting a request.
- **Bookshelf:** Request status now keeps ebook, audiobook, and combined book formats visible in filters, request cards, detail links, and activity history so users can tell which format is being processed.
- **Ci:** Main-branch image publication now reports its real multi-architecture build result independently from live deployment storage; deployment still remains blocked when the configured host is unhealthy.
- **Ci:** Main validation runs can now proceed independently while image publication and live deployment remain serialized, and each scan and deployment uses the exact image digest produced by its own run.
- **Ci:** Main-branch CI now runs the same release-note, localization, lint, build, and unit-test validation as pull requests before publication or deployment.
- **Release Pipeline:** Tagged releases now remain in draft status until every required artifact and package channel has completed and the release announcement is ready, preventing incomplete releases from being presented as final.
- **Release Pipeline:** Release publication now validates the real platform matrix, records build provenance, and waits for enabled package channels to finish, so a green release cannot hide a missing architecture or silently skipped package upload.
- **Request Status:** Request Status now opens on recent requests by default, offers 7-day, 14-day, 30-day, 6-month, and all-time windows, and points you to older requests instead of hiding them silently.

#### Fixed

- **Release Pipeline:** Provenance-enabled container indexes are now verified correctly: attestation descriptors are required and checked without being mistaken for extra runtime architectures.
- **Reliability:** Search and Request Status now explain connection failures clearly, keep useful cached results visible when possible, and provide retry or refresh actions instead of presenting outages as empty results.
- **Localization:** The English message catalog is now regenerated from the source messages, keeping recently added Request Status and other UI text synchronized for releases.
- **Release Pipeline:** Container vulnerability gates now resolve the pinned Trivy release correctly, so image scans run to completion instead of stopping during scanner installation.

#### Security

- **Authentication:** Fresh installations can choose built-in self-signed HTTPS, a provided certificate, or an explicitly acknowledged trusted-LAN HTTP fallback before first login. Administrators can change the mode in Settings > Network, verify HTTPS before enabling redirects, and recover from certificate errors with the documented environment override. Existing installs are unchanged.
  - **Action required:** review-and-choose-transport
- **Bookshelf:** SeerrNG now pins Hardcover and softcover BookshelfNG deployments to the latest validated images, including the native Hardcover null-response fix and patched dependency vulnerabilities.
- **Authentication:** SeerrNG can now generate persistent local HTTPS certificates for direct LAN deployments and provides an explicit, warning-bearing HTTP login fallback when TLS cannot be used.
  - **Action required:** configure
- **Security:** The public `main` container image is now vulnerability-scanned separately for amd64 and arm64 immediately after publication, so development images receive the same architecture-aware security coverage as tagged releases.
- **Security:** Release and scheduled container scans now cover both published Linux architectures and fail on detected fixable HIGH or CRITICAL vulnerabilities while retaining SARIF findings for review.
- **Operations:** Built-in HTTPS health checks now validate the configured local CA or certificate chain instead of disabling certificate verification, so broken trust configuration is reported as unhealthy rather than silently accepted.
- **Security:** Release and main-image vulnerability scans now use an available, explicitly pinned Trivy release instead of a retired scanner version, so the security gates execute rather than failing during tool installation.

### 🚀 Features
- *(bookshelf)* Make format choice explicit across request flows - ([c8eec36](https://github.com/snapetech/seerrng/commit/c8eec36bee1d10530dc442404f91bbdd1786747b))
- *(bookshelf)* Preserve format context across requests - ([403bc80](https://github.com/snapetech/seerrng/commit/403bc80b3f45738b016d13d4ae6140cd15e4f5d9))
- *(bookshelf)* Show formats across request status - ([30317c5](https://github.com/snapetech/seerrng/commit/30317c5a8d6ccd9259f0675d2dcf8840e78d2422))
- *(bookshelf)* Label selected request format - ([3e0b3b0](https://github.com/snapetech/seerrng/commit/3e0b3b041da990f74710d6508a555beca11acaf1))
- *(bookshelf)* Clarify book format choices - ([3eed809](https://github.com/snapetech/seerrng/commit/3eed8093116a821d264d51bb7606aefb77b5df1f))
- *(security)* Add administrator-controlled browser transport - ([e6e318a](https://github.com/snapetech/seerrng/commit/e6e318a85b4faa0a3d2acb67a68b76db5c46c753))
- *(security)* Add built-in TLS and explicit HTTP auth modes - ([9257cf9](https://github.com/snapetech/seerrng/commit/9257cf99408ad5bdd0b4800bb35c844def3f1175))
- Make request status history windows user friendly - ([106d812](https://github.com/snapetech/seerrng/commit/106d81235235e3b6752f7255bc3ee5d99cc9d10b))
- Improve search and request status tracking - ([96fd4cb](https://github.com/snapetech/seerrng/commit/96fd4cbeaeb81d9651f20ad00f6f2900690c2af4))

### 🐛 Bug Fixes
- *(security)* Validate TLS health checks - ([2c68f7d](https://github.com/snapetech/seerrng/commit/2c68f7d6ee183f7693dcca81e88fc918f832b031))
- *(security)* Update pinned BookshelfNG images - ([685e2fa](https://github.com/snapetech/seerrng/commit/685e2fa539bd9f63d0617f205d47e258c78331f5))
- Gate release image vulnerability scans - ([0ed285f](https://github.com/snapetech/seerrng/commit/0ed285f424a1741b5f55d90d8fb7830ed6b84d10))
- Document trivy tag resolution - ([66e2c36](https://github.com/snapetech/seerrng/commit/66e2c3678f516e4623350a9cbcf82077a12a94ce))
- Use the versioned trivy tag - ([f6fc6e4](https://github.com/snapetech/seerrng/commit/f6fc6e4977d9bcc1ced434a850702d0d7edcdbc9))
- Refresh trivy release pin - ([5bc57a0](https://github.com/snapetech/seerrng/commit/5bc57a0c68809193dcc6a6b2392b22515714b2d2))
- Handle provenance manifests in verifier - ([f2dba89](https://github.com/snapetech/seerrng/commit/f2dba891ddc15faed850df0bbdcdfcccc1747000))
- Synchronize extracted message catalog - ([4b71a7e](https://github.com/snapetech/seerrng/commit/4b71a7ed6e83856bac548754ce2b87872425c922))
- Harden release matrix and publication checks - ([c8deeb2](https://github.com/snapetech/seerrng/commit/c8deeb26d3ec2e47bd8bd47c0e00123f9959cb7f))
- Harden search and request status adaptations - ([1950c7c](https://github.com/snapetech/seerrng/commit/1950c7c8f0b96089c0ef5891e592db6e6e8407b8))

### 📖 Documentation
- *(bookshelf)* Document format coverage details - ([0c05388](https://github.com/snapetech/seerrng/commit/0c053884f881f8f338af3c522ebab1f2195e58d9))
- *(ops)* Document and deploy built-in TLS modes - ([83353fb](https://github.com/snapetech/seerrng/commit/83353fb7826bfc5df2298a167a98a7464dccc104))

### ⚙️ Miscellaneous Tasks
- *(ci)* Format container security test - ([bc93320](https://github.com/snapetech/seerrng/commit/bc933207f1e5f6cc8e337ffb2f172a5ab361d844))
- Serialize shared publication and scan main image - ([478f77a](https://github.com/snapetech/seerrng/commit/478f77a46f08a0aaa81e57ef95b45ebaf5d770a4))
- Gate releases on complete artifact publication - ([aa52ee2](https://github.com/snapetech/seerrng/commit/aa52ee2ba6743fbbe32a4bb99138be252883694c))
- Separate image publication from deployment health - ([405ddd0](https://github.com/snapetech/seerrng/commit/405ddd039bdd6ea1d4ea1e0e20da7d7de166e7de))
- Validate main before publication - ([9b7a16b](https://github.com/snapetech/seerrng/commit/9b7a16b8a55304460845383831403dc31f9c653e))

## [3.15.0](https://github.com/snapetech/seerrng/compare/v3.14.0..v3.15.0) - 2026-09-06

### User-facing changes

#### Added

- **Request Status:** Request Status now matches the full workflow view with per-user history, media-type and ebook/audiobook filters, and media-aware sorting across movies, series, music, and books.

### 🚀 Features
- *(requests)* Expand request status workflow view - ([53bd101](https://github.com/snapetech/seerrng/commit/53bd101c066411da6ba223439cc06cc0a8733777))

## [3.14.0](https://github.com/snapetech/seerrng/compare/v3.13.3..v3.14.0) - 2026-09-06

### User-facing changes

#### Added

- **Request Status:** A new Request Status page tracks requests from approval through download and library availability, preserves status history, and lets authorized users retry requests that need attention.
  - **Action required:** upgrade

#### Fixed

- **Request Status:** Request Status detail responses now include the associated media and request metadata, so direct links and API clients have the same context as the status list.
  - **Action required:** upgrade
- **Request Status:** Book request status now names only the selected ebook or audiobook service, while mixed-format requests continue to show both services accurately.
  - **Action required:** upgrade
- **Request Status:** Request Status now keeps filtered results, TV season progress, mixed download queues, and status history aligned with the latest trustworthy media and download state. Request owners can also retry failed or unavailable requests when their media-request permission still applies.
  - **Action required:** upgrade

### 🚀 Features
- *(requests)* Add request status timeline - ([5c83029](https://github.com/snapetech/seerrng/commit/5c8302904b7cee5f9928ef3c580a6e4adf9ec29d))

### 🐛 Bug Fixes
- *(requests)* Include media in status details - ([fee86fa](https://github.com/snapetech/seerrng/commit/fee86fa56db2dd36185f9b936d03008f8fb4a84c))
- *(requests)* Scope book status services to format - ([0788f98](https://github.com/snapetech/seerrng/commit/0788f984c61e37c7f4d57398b56c5a502a84d657))
- *(requests)* Reconcile status projections with live state - ([7d0ed62](https://github.com/snapetech/seerrng/commit/7d0ed62a0405f54195b3e8317e9c1d5bb3c9c91d))

## [3.13.3](https://github.com/snapetech/seerrng/compare/v3.13.2..v3.13.3) - 2026-09-05

### User-facing changes

#### Fixed

- **Packaging:** The binary AUR package now builds faster and ships runtime files readable by its dedicated service account, allowing the systemd service to start normally.
  - **Action required:** upgrade

### 🐛 Bug Fixes
- *(aur)* Make the binary package runnable - ([b003341](https://github.com/snapetech/seerrng/commit/b00334135ce2be5559ed258736fb3e8fc21c6095))
- *(release)* Publish Linux assets with service-readable modes - ([89cf235](https://github.com/snapetech/seerrng/commit/89cf235dd57bf0ad6909cb15a03c5badafce19c3))

### 📖 Documentation
- *(release)* Note Linux package permission fix - ([7e7d066](https://github.com/snapetech/seerrng/commit/7e7d066ad1e16e63b1dc88272c4db93fcc913cfc))

### 🧪 Testing
- *(cypress)* Reset network settings after specs - ([025bc95](https://github.com/snapetech/seerrng/commit/025bc952e1f2a2c735dd8d84ba3e1e6727c98f48))

## [3.13.2](https://github.com/snapetech/seerrng/compare/v3.13.1..v3.13.2) - 2026-09-04

### User-facing changes

#### Fixed

- **Deployment:** Main deployments now start cleanly when the target config directory is empty, allowing SeerrNG to create its initial settings before later upgrades export external configuration.
- **Release Pipeline:** The `:main` container image on GHCR is now published as a real multi-arch (amd64 + arm64) manifest, fixing "exec format error" crashes on arm64 hosts.
- **Playlist Requests:** Connecting Spotify and importing Spotify or YouTube playlists no longer fails with a "not found" error — every playlist-import endpoint was missing from the API contract and is now reachable.

#### Security

- **Authentication:** **Breaking:** Session cookies now require HTTPS, and the runtime and documentation dependencies have been updated to address current security advisories.
  - **Action required:** Serve SeerrNG through HTTPS before upgrading.

### 🐛 Bug Fixes
- *(ci)* Allow first-start deployments - ([674ffa4](https://github.com/snapetech/seerrng/commit/674ffa449dc82f72c881c1c8d6a2442219f3078f))
- *(ci)* Publish real multi-arch amd64+arm64 images for :main - ([45c0d84](https://github.com/snapetech/seerrng/commit/45c0d841032fdb23d675ad867a42817e7bcc1473))
- *(security)* Make secure session cookies explicit - ([126289f](https://github.com/snapetech/seerrng/commit/126289f187cc20b448508de0d92907766b0ed87d))
- *(security)* Require HTTPS sessions and update advisories - ([b675c55](https://github.com/snapetech/seerrng/commit/b675c559e75921b4b2a9321d602c8e39d25d1c1c))
- *(server)* Declare playlist/Spotify routes in the OpenAPI spec - ([fe889bb](https://github.com/snapetech/seerrng/commit/fe889bbc691ef87de3bf1bb423c7cc0dcfbf1659))


## New Contributors ❤️
* @TrojanHorsePower made their first contribution

## [3.13.1](https://github.com/snapetech/seerrng/compare/v3.13.0..v3.13.1) - 2026-09-03

### User-facing changes

#### Fixed

- **Authentication:** Jellyfin and Emby setup now preserve custom server ports, allowing first-run connections to non-default ports to complete.

### 🐛 Bug Fixes
- *(setup)* Serialize Jellyfin port as a number - ([91b1c56](https://github.com/snapetech/seerrng/commit/91b1c56f8fb839f84e0d90adaea23b57569c8e57))

## [3.13.0](https://github.com/snapetech/seerrng/compare/v3.12.9..v3.13.0) - 2026-09-01

### User-facing changes

#### Added

- **Metadata:** Administrators can now enable adult content in Settings → Main. When enabled, TMDB searches and movie discovery include adult results without requiring a manual source-code change.

#### Fixed

- **Bookshelf:** Ebook requests now work with older Chaptarr releases that expose book metadata only through their audiobook lookup endpoint.
- **Discovery:** Movie, series, and book discovery lists now return to the previous scroll position after viewing an item's details.
- **Authentication:** Plex sign-in and other browser sessions work again on direct HTTP/LAN deployments, while HTTPS deployments continue to receive Secure session cookies.
- **Release Pipeline:** Release retries now require dispatching from `main`, and tag-triggered releases reject non-tag refs before privileged publishing begins.

#### Security

- **Security:** The CodeQL security workflow now runs all of its actions at the same verified version, so security analysis completes instead of failing during workflow setup.
- **Security:** Security updates include patched runtime and documentation-build dependencies, while browser session cookies remain Secure on HTTPS deployments. Direct HTTP/LAN deployments continue to work but should be migrated to HTTPS to protect authenticated sessions.

### 🚀 Features
- *(settings)* Add adult content option and harden security - ([317a94b](https://github.com/snapetech/seerrng/commit/317a94b2c82ae7e4c0c9bb7fb81b2b4b5ba55430))

### 🐛 Bug Fixes
- *(auth)* Restore direct HTTP Plex sessions - ([6a8045d](https://github.com/snapetech/seerrng/commit/6a8045de32f61bef2d3c0c1ececf8794466dd584))
- *(bookshelf)* Recover Chaptarr ebook requests - ([4873365](https://github.com/snapetech/seerrng/commit/4873365c1caa681f11db89e3d1652540df59e509))
- *(ci)* Restore baseline pull request checks - ([cf05a00](https://github.com/snapetech/seerrng/commit/cf05a009874621abe0b41b5085b428e5c9061a11))
- *(ci)* Restore baseline pull request checks - ([4ddccbd](https://github.com/snapetech/seerrng/commit/4ddccbdc8f0ea4beac38771c45052e6bc1c32d6f))
- *(discover)* Restore list scroll position - ([63ebcf9](https://github.com/snapetech/seerrng/commit/63ebcf923aa5d0a508954237d956d79f8480062f))
- *(security)* Make session cookie transport explicit - ([a0ac03e](https://github.com/snapetech/seerrng/commit/a0ac03e55df6997c30370997d8591978253de4a9))
- *(security)* Align CodeQL action versions - ([efc2770](https://github.com/snapetech/seerrng/commit/efc2770ac4c796339ea19cfb3d32978e1191fd33))

### 📖 Documentation
- *(release)* Reconcile session security note - ([6b952c4](https://github.com/snapetech/seerrng/commit/6b952c4a94fe3f43d458aca9129f357470b0b5fe))
- *(release)* Note discovery scroll restoration - ([c7e2566](https://github.com/snapetech/seerrng/commit/c7e25668d71d2541bee691c78a6af789936deee1))

## [3.12.9](https://github.com/snapetech/seerrng/compare/v3.12.8..v3.12.9) - 2026-08-31

### User-facing changes

#### Changed

- **Community:** Published SeerrNG community links now point to the current Discord server.

#### Fixed

- **Bookshelf:** Chaptarr Bookshelf connections now use the configured ebook or audiobook provider path, preserve monitoring and automatic-search requests after adding books, and load download queues reliably.
- **Release Pipeline:** Tagged releases can now be retried through the release workflow, and SBOM generation has a longer analysis window for large container images.

### 🐛 Bug Fixes
- *(bookshelf)* Make Chaptarr integration compatible - ([ca0784e](https://github.com/snapetech/seerrng/commit/ca0784e1e6a9ca18605fdbffb26411b975f6fdd4))
- *(release)* Use requested tag for image metadata - ([57276ea](https://github.com/snapetech/seerrng/commit/57276ea65c9750d1e60b2059dde89e582969fb9f))
- *(release)* Extend SBOM analysis timeout - ([9a9e871](https://github.com/snapetech/seerrng/commit/9a9e8716fb19793c5d167c40eecf3339becca53e))

### 📖 Documentation
- Update Discord community links - ([650614b](https://github.com/snapetech/seerrng/commit/650614bbbb773bec2efd19d7a85b310a71884eff))

## [3.12.8](https://github.com/snapetech/seerrng/compare/v3.12.7..v3.12.8) - 2026-08-21

### User-facing changes

#### Added

- **Bookshelf:** Documented Chaptarr as a supported Readarr-compatible book backend alongside BookshelfNG and Readarr — add it in Settings > Services the same way as any Bookshelf server.

#### Fixed

- **Bookshelf:** Chaptarr requests now carry the selected ebook or audiobook format and selected-book monitoring intent, so one Chaptarr instance can safely back separate SeerrNG format services.
  - **Action required:** configure one service entry per requested format
- **Authentication:** Fixed the root cause of CSRF protection's "invalid csrf token" errors: an untrusted forwarded-protocol header could mark the CSRF cookies `Secure` on a connection the browser saw as plain HTTP, causing it to silently drop them. That header is now only trusted when "Enable Proxy Support" is on.
- **Requests:** Movie and TV requests now show their real status (e.g. Processing) right after submission instead of appearing stuck at Pending until a download starts — the request API was returning a stale status snapshot taken before auto-approval updated it.

### 🐛 Bug Fixes
- *(auth)* Stop CSRF cookies from being marked Secure without a trusted proxy - ([e3c1d37](https://github.com/snapetech/seerrng/commit/e3c1d3740dfce84eed80d9eb6e6565a2b2adb359))
- *(bookshelf)* Make Chaptarr requests format-aware - ([d50fb0f](https://github.com/snapetech/seerrng/commit/d50fb0f4c3573556843799ad4e2d7dc9931405f3))
- *(requests)* Return post-approval media status instead of a stale snapshot - ([1ff0693](https://github.com/snapetech/seerrng/commit/1ff069383ce75f8a15d0d54ac650b16982bdad4d))

### 📖 Documentation
- *(bookshelf)* Document Chaptarr as a supported Readarr-compatible backend - ([d5b2970](https://github.com/snapetech/seerrng/commit/d5b29700830c4528189dbf12da218004d0a9a6aa))

### 🧪 Testing
- *(settings)* Update Chaptarr guidance assertion - ([a5b8720](https://github.com/snapetech/seerrng/commit/a5b8720fb3730c38a4b2f71ef68167e6c45cc731))

## [3.12.7](https://github.com/snapetech/seerrng/compare/v3.12.6..v3.12.7) - 2026-08-20

### User-facing changes

#### Fixed

- **Availability:** Availability checks now recognize legacy standard Arr settings that omit the 4K flag, preventing available movies and series from being incorrectly shown as deleted.
- **Reliability:** SeerrNG no longer crash-loops on startup when it cannot `chmod` its config, log, database, or image-cache directories (common when a container runs as a non-default user against a bind mount or network volume it doesn't own) — it now logs a warning and continues with the existing permissions.
- **Documentation:** Discord notification embeds now use your configured `PORT` for the fallback application link, instead of always defaulting to 5055. Also backfilled documentation for five previously undiscoverable environment variables in the README and Network settings docs.
- **Authentication:** The Jellyfin/Emby setup wizard now accepts private/LAN hostnames by default, matching how the vast majority of self-hosted media servers are actually reachable. Set `SEERR_REQUIRE_PUBLIC_SETUP_HOSTS=true` to restore the stricter public-hostname-only check.

### 🐛 Bug Fixes
- *(availability)* Preserve media status for legacy Arr settings; deploy over host network - ([7663319](https://github.com/snapetech/seerrng/commit/7663319ebd6c6bf96c5600bf509c9fced29016d3))
- *(release-notes)* Shorten fragment body to pass release validation - ([99d6a11](https://github.com/snapetech/seerrng/commit/99d6a11f539db559631b433fa10447f6617c329e))
- *(reliability)* Stop chmod crashes and unblock LAN Jellyfin setup - ([4c41c84](https://github.com/snapetech/seerrng/commit/4c41c845ec7298db4870b52c0aa40f008c2c38d0))

### 📖 Documentation
- *(env)* Document undocumented env vars; fix Discord embed port - ([3971ddb](https://github.com/snapetech/seerrng/commit/3971ddb452806202551dfb534d48b1f18ee1c499))

## [3.12.6](https://github.com/snapetech/seerrng/compare/v3.12.5..v3.12.6) - 2026-08-19

### User-facing changes

#### Fixed

- **Authentication:** CSRF protection is disabled by default again, matching the documented default and fixing "invalid csrf token" errors during initial Jellyfin/Emby sign-in. Existing installs are migrated back to this default once on upgrade; if you had intentionally turned CSRF protection on, re-enable it in Settings > Network afterward.

### 🐛 Bug Fixes
- *(auth)* Disable CSRF protection by default to fix Jellyfin/Emby sign-in - ([58b3fa1](https://github.com/snapetech/seerrng/commit/58b3fa1cbac8adcd9369357cb7f810799f25e6ab))

## [3.12.5](https://github.com/snapetech/seerrng/compare/v3.12.4..v3.12.5) - 2026-08-18

### User-facing changes

#### Fixed

- **Discovery:** Book discovery and author bibliography pages no longer fail outright when Open Library responds slowly; the internal timeout that guards those requests now allows as long as the request itself is permitted to take.

### 🐛 Bug Fixes
- *(discover)* Stop book/author timeouts from cutting off good responses - ([ef8a558](https://github.com/snapetech/seerrng/commit/ef8a558565e86177bc94a1058c6846bdc04bda2e))

### 📖 Documentation
- *(release-notes)* Add fragment for book discovery timeout fix - ([c806bf4](https://github.com/snapetech/seerrng/commit/c806bf4f5637a78a91a2f03a64a2083923012d6b))

## [3.12.4](https://github.com/snapetech/seerrng/compare/v3.12.3..v3.12.4) - 2026-08-17

### User-facing changes

#### Fixed

- **Search Reliability:** Temporary backend or proxy errors no longer send users back to the login page, and global searches return available results without waiting for uncached artwork and artist metadata.

### 🐛 Bug Fixes
- *(auth)* Prevent false logout and bound search latency - ([2a304bb](https://github.com/snapetech/seerrng/commit/2a304bb082cc69c5e828656fb7c0407f40acb54d))

## [3.12.3](https://github.com/snapetech/seerrng/compare/v3.12.2..v3.12.3) - 2026-08-17

### User-facing changes

#### Fixed

- **Discovery:** Book and music discovery now keeps available results when an upstream provider is slow, and author bibliographies fail fast instead of waiting for a stalled Open Library request.

### 🐛 Bug Fixes
- *(discover)* Bound slow provider responses - ([2b6969c](https://github.com/snapetech/seerrng/commit/2b6969c87f9e037a27195c64c09edfe7066595a5))

### 🧪 Testing
- *(discover)* Mock author bibliography pagination - ([8388177](https://github.com/snapetech/seerrng/commit/83881778d4145b99ccee2e32b75bce7208178572))

## [3.12.2](https://github.com/snapetech/seerrng/compare/v3.12.1..v3.12.2) - 2026-08-16

### User-facing changes

#### Fixed

- **Book Discovery:** Book discovery now shows available recommendations when Open Library is slow, so the Books tab no longer waits on the entire recommendation blend before displaying results.

### 🐛 Bug Fixes
- *(discover)* Keep book recommendations responsive - ([eec93ff](https://github.com/snapetech/seerrng/commit/eec93ffe47cc3ff9caf3d589f08bf0c4f3f47e96))

## [3.12.1](https://github.com/snapetech/seerrng/compare/v3.12.0..v3.12.1) - 2026-08-15

### User-facing changes

#### Fixed

- **Release Pipeline:** Container builds now cache dependency installation separately from application source changes, reducing repeated native-module compilation for routine image builds.
- **Authentication:** Plex sign-in now starts correctly on direct HTTP/LAN deployments while CSRF cookies remain restricted to secure transport on HTTPS deployments.

### 🐛 Bug Fixes
- *(auth)* Allow Plex login over direct HTTP - ([f20b28d](https://github.com/snapetech/seerrng/commit/f20b28da346bda64823aa8127e812811ab5c74ec))

### ⚡ Performance
- *(build)* Cache dependencies independently of source - ([ee096f4](https://github.com/snapetech/seerrng/commit/ee096f4937d2677db9b14b1de576ca393eb02b11))


## New Contributors ❤️
* @JohnCronk79 made their first contribution

## [3.12.0](https://github.com/snapetech/seerrng/compare/v3.11.2..v3.12.0) - 2026-08-12

### User-facing changes

#### Added

- **Playlist Requests:** SeerrNG can now import Spotify and YouTube playlists, match tracks to MusicBrainz albums, let users review the results, and submit selected albums through the existing Lidarr request workflow.
  - **Action required:** Configure the provider credentials described in the playlist request guide before use.

#### Fixed

- **Authentication:** Plex sign-in now completes on direct HTTP/LAN deployments again, while HTTPS deployments continue to receive Secure session cookies; failed session handoffs now show an error instead of spinning indefinitely.
- **Release Pipeline:** Release tag preparation now retains historical tag metadata, so operators can create new releases without the workflow losing the previous release boundary.

### 🚀 Features
- Add music and playlist request support - ([e6c8346](https://github.com/snapetech/seerrng/commit/e6c834666007514aa43fd80f41357273186e5667))

### 🐛 Bug Fixes
- *(auth)* Preserve Plex sessions on HTTP - ([5f9c948](https://github.com/snapetech/seerrng/commit/5f9c948157fb5517106add6adcd26e62d3dd797b))
- *(release)* Preserve tag history during preparation - ([84187f7](https://github.com/snapetech/seerrng/commit/84187f74bc4dbde31c9c5a0b3c9a1507d268e818))

### 📖 Documentation
- *(release)* Improve release note capture - ([fefc9da](https://github.com/snapetech/seerrng/commit/fefc9dac3b32a0bad07a2fd9d0cc7e2561d319c2))
- *(release)* Audit historical release notes - ([fad41e4](https://github.com/snapetech/seerrng/commit/fad41e405162586dbf9eeb3cfc65d75ea503d752))
- *(release)* Enforce meaningful release notes - ([a00c9f0](https://github.com/snapetech/seerrng/commit/a00c9f0dd2a2fcef8d57921a8767501181046b0b))

## [3.11.2](https://github.com/snapetech/seerrng/compare/v3.11.1...v3.11.2) - 2026-08-05

### Fixed

- Session cookies are now enforced as secure at both configuration and response-writing paths, while browser test sessions remain compatible with HTTPS-only cookies.

### Changed

- Cypress reruns now select their intended spec list explicitly, making failed-release diagnostics reproducible.

## [3.11.1](https://github.com/snapetech/seerrng/compare/v3.11.0...v3.11.1) - 2026-08-05

### Fixed

- Bookshelf deployment defaults now preserve compatibility-first metadata behavior and validate the expected image, health checks, and session-cookie transport.

## [3.11.0](https://github.com/snapetech/seerrng/compare/v3.10.3...v3.11.0) - 2026-08-05

### Changed

- BookshelfNG Hardcover deployments now document native and compatibility metadata modes clearly, with reproducible image guidance and an explicit native-mode opt-in.

### Added

- Bookshelf deployment tracking now follows the native BookshelfNG latest image by default while keeping the compatibility-first behavior explicit for existing installations.

## [3.10.3](https://github.com/snapetech/seerrng/compare/v3.10.2...v3.10.3) - 2026-08-04

### Fixed

- Cross-platform release archive generation now avoids the slow fallback path that could stall Windows assets.

## [3.10.2](https://github.com/snapetech/seerrng/compare/v3.10.1...v3.10.2) - 2026-08-04

### Fixed

- Bookshelf metadata mode defaults and Helm chart validation now fail clearly instead of silently producing an invalid deployment.

## [3.10.1](https://github.com/snapetech/seerrng/compare/v3.10.0...v3.10.1) - 2026-08-04

### Fixed

- Cross-platform release assets and chart metadata now stay aligned with the application version.

## [3.10.0](https://github.com/snapetech/seerrng/compare/v3.9.2...v3.10.0) - 2026-08-04

### Added

- Plex scanners can use a custom metadata-provider GUID scheme.
- Jellyfin music availability now participates in library and request synchronization.

### Fixed

- Sonarr requests now route anime and non-anime series to the correct configured root folders and series types.
- Anime request notices render reliably without invalid nested markup.

### Changed

- Hardcover outage behavior and Bookshelf metadata boundaries are documented for operators.
- Release verification and dependency floors were hardened for more reliable published artifacts.

## [3.9.2](https://github.com/snapetech/seerrng/compare/v3.9.1...v3.9.2) - 2026-08-04

### Fixed

- Concurrent download-recovery attempts are coalesced so one failed download does not create duplicate retry work.

## [3.9.1](https://github.com/snapetech/seerrng/compare/v3.9.0...v3.9.1) - 2026-08-04

### Fixed

- Bookshelf and rreading-glasses deployment wiring now works consistently for ebook and audiobook services.

## [3.9.0](https://github.com/snapetech/seerrng/compare/v3.8.6...v3.9.0) - 2026-08-04

### Added

- Added the optional rreading-glasses metadata compatibility proxy for both Bookshelf modes, keeping Hardcover translation and upstream coordination outside SeerrNG.

## [3.8.6](https://github.com/snapetech/seerrng/compare/v3.8.5...v3.8.6) - 2026-08-04

### Fixed

- `SEERR_EXTERNAL_CONFIG` is now optional; deployments can fall back to `settings.json` instead of failing when external runtime configuration is not supplied.

## [3.8.5](https://github.com/snapetech/seerrng/compare/v3.8.4...v3.8.5) - 2026-08-02

### Fixed

- Cover Art Archive requests now follow the required cross-origin redirect chain, restoring music and artist artwork lookups.

## [3.8.4](https://github.com/snapetech/seerrng/compare/v3.8.3...v3.8.4) - 2026-08-02

### Fixed

- Music and artist routes now call Cover Art Archive correctly.
- Transient cover and image failures are no longer cached permanently, allowing later retries after an upstream recovery.

## [3.8.3](https://github.com/snapetech/seerrng/compare/v3.8.2...v3.8.3) - 2026-08-02

### Fixed

- SQLite media-request routing fields are restored for installations that use the fork's request routing behavior.
- Qualified status cache keys are revalidated before use, and Helm chart appVersion metadata is kept aligned.

## [3.8.2](https://github.com/snapetech/seerrng/compare/v3.8.1...v3.8.2) - 2026-08-02

### Fixed

- External API endpoints now preserve a configured base-URL path prefix instead of dropping it while joining request paths.

## [3.8.1](https://github.com/snapetech/seerrng/compare/v3.8.0...v3.8.1) - 2026-08-02

### Fixed

- SQLite migrations no longer rebuild tables out of order and drop fork-specific columns during an upgrade.

## [3.8.0](https://github.com/snapetech/seerrng/compare/v3.7.16...v3.8.0) - 2026-08-02

### Added

- Added public Seerr branding for notification emails, multiple Discord notification IDs, Discord thread IDs, admin quota bypass, Jellyfin/Emby Quick Connect authentication, Plex-import user-detail synchronization, Simkl links, failed-download queue recovery, and local service cover support.

### Fixed

- Request, watchlist, availability-sync, scanner, notification, search, and UI state handling now recover correctly across deletion, approval, orphaning, and merged-version edge cases.
- Book dispatch retries, orphaned book identifiers, and PWA pull-to-refresh behavior were repaired.

### Security

- External API target validation and SSRF/origin checks were tightened, CodeQL findings were resolved, and OIDC/session fixture handling was hardened.

## [3.7.16](https://github.com/snapetech/seerrng/compare/v3.7.15...v3.7.16) - 2026-08-01

### Security

- Authorization checks for user reads, media access, override rules, quotas, watchlists, and settings now use the correct actor-aware read paths.

### Fixed

- Advanced request selection now filters servers by the requested 4K/non-4K mode before deciding whether service selection is needed.

## [3.7.15](https://github.com/snapetech/seerrng/compare/v3.7.14...v3.7.15) - 2026-08-01

### Fixed

- BSD release packaging now uses a portable `chmod` path.

## [3.7.14](https://github.com/snapetech/seerrng/compare/v3.7.13...v3.7.14) - 2026-08-01

### Changed

- End-to-end jobs now isolate their server instances and rate-limit state, preventing parallel CI runs from interfering with one another.

## [3.7.13](https://github.com/snapetech/seerrng/compare/v3.7.12...v3.7.13) - 2026-08-01

### Fixed

- BSD release staging now resolves paths portably, and Cypress starts with the test environment and its rate-limit bypass explicitly exported.

## [3.7.12](https://github.com/snapetech/seerrng/compare/v3.7.11...v3.7.12) - 2026-08-01

### Fixed

- Release archive staging now works on BSD systems without relying on GNU-only path behavior.

## [3.7.11](https://github.com/snapetech/seerrng/compare/v3.7.10...v3.7.11) - 2026-08-01

### Notes

- No user-facing changes; this tag repaired end-to-end association-modal coverage.

## [3.7.10](https://github.com/snapetech/seerrng/compare/v3.7.9...v3.7.10) - 2026-08-01

### Fixed

- Association cards now use a non-locking popover interaction, preventing the association UI from becoming stuck open.

## [3.7.9](https://github.com/snapetech/seerrng/compare/v3.7.8...v3.7.9) - 2026-07-27

### Fixed

- Empty music-provider responses are retried, and empty cached homepage rows are revalidated instead of remaining blank indefinitely.

## [3.7.8](https://github.com/snapetech/seerrng/compare/v3.7.7...v3.7.8) - 2026-07-27

### Fixed

- Plex OAuth now stays on the supported polling flow, proxies PIN polling correctly, returns the PIN to the client, and preserves sessions on direct HTTP deployments.

## [3.7.7](https://github.com/snapetech/seerrng/compare/v3.7.6...v3.7.7) - 2026-07-26

### Fixed

- Plex OAuth identity registration and compatibility were restored.
- Issues can now be sorted by added date.

## [3.7.6](https://github.com/snapetech/seerrng/compare/v3.7.5...v3.7.6) - 2026-07-25

### Fixed

- Plex OAuth now uses the correct Plex Web OAuth context.

## [3.7.5](https://github.com/snapetech/seerrng/compare/v3.7.4...v3.7.5) - 2026-07-25

### Fixed

- Plex login now targets the current OAuth route.

## [3.7.4](https://github.com/snapetech/seerrng/compare/v3.7.3...v3.7.4) - 2026-07-25

### Fixed

- Plex OAuth connections can be established again.

## [3.7.3](https://github.com/snapetech/seerrng/compare/v3.7.2...v3.7.3) - 2026-07-24

### Fixed

- Deployments now inject external runtime configuration into the running service.

## [3.7.2](https://github.com/snapetech/seerrng/compare/v3.7.1...v3.7.2) - 2026-07-24

### Notes

- No user-facing changes; this tag contained release and deployment preparation only.

## [3.7.1](https://github.com/snapetech/seerrng/compare/v3.7.0...v3.7.1) - 2026-07-24

### Fixed

- External configuration is now exported consistently to Cypress, including legacy settings and optional service configuration.
- Cypress sessions remain usable on local HTTP test servers while production session-cookie security remains enforced.

## [3.7.0](https://github.com/snapetech/seerrng/compare/v3.6.3...v3.7.0) - 2026-07-24

### Security

- Authentication, protected API, and image-cache routes now have explicit rate limits.
- Session cookies are required to be secure in every environment.
- Notification URLs, image-proxy targets, and external API request targets are validated before outbound use.
- API-key comparisons, external image handling, and persisted request configuration were tightened to avoid authorization, SSRF, and cache-trust failures.

## [3.6.3](https://github.com/snapetech/seerrng/compare/v3.6.2...v3.6.3) - 2026-07-24

### Security

- Coordination keys are separated from password-hashing material, API requests are rate-limited, and protected files are opened through checked file handles.

## [3.6.2](https://github.com/snapetech/seerrng/compare/v3.6.1...v3.6.2) - 2026-07-24

### Security

- Vulnerable dependency overrides were updated, and credential handling plus notification formatting were hardened.

## [3.6.1](https://github.com/snapetech/seerrng/compare/v3.6.0...v3.6.1) - 2026-07-24

### Notes

- No user-facing changes; this tag contained release preparation only.

## [3.6.0](https://github.com/snapetech/seerrng/compare/v3.5.1...v3.6.0) - 2026-07-24

### Added

- Background jobs now log observed completion durations to make slow or stalled work diagnosable.

### Fixed

- Search result navigation and service-availability states are preserved during refreshes.
- Touch scrolling, book request cards, and Servarr connection tests now behave correctly.

## [3.5.1](https://github.com/snapetech/seerrng/compare/v3.5.0...v3.5.1) - 2026-07-17

### Fixed

- PostgreSQL startup is restored for fresh and upgraded deployments.

## [3.5.0](https://github.com/snapetech/seerrng/compare/v3.4.0...v3.5.0) - 2026-07-17

### Added

- Added project donation links.

### Changed

- Reliability and release infrastructure were hardened, and the vulnerable WebSocket driver was pinned to a safe override.

## [3.4.1](https://github.com/snapetech/seerrng/compare/v3.4.0...v3.4.1) - 2026-07-30

This imported upstream Seerr tag is retained in the merge history. No separate
SeerrNG release notes were recorded for it; the linked tag comparison preserves
the detailed commit history.

## [3.4.0](https://github.com/snapetech/seerrng/compare/v3.3.2...v3.4.0) - 2026-07-14

### Added

- Added OpenID Connect login with account linking and secure callback handling.

### Fixed

- Discover pagination preloads thumbnails earlier and fills cached media sliders reliably.
- Image cache limits and avatar fallbacks are more resilient, and request lists support the default added sort.
- Transient Plex and image-proxy failures are retried with clearer diagnostics.

## [3.3.2](https://github.com/snapetech/seerrng/compare/v3.3.1...v3.3.2) - 2026-07-14

### Fixed

- Live API failures were repaired and covered by a smoke audit; live search navigation was stabilized.

## [3.3.1](https://github.com/snapetech/seerrng/compare/v3.3.0...v3.3.1) - 2026-07-14

### Security

- Remaining CodeQL alerts were closed.

### Changed

- Cypress recording is skipped cleanly when no dashboard key is configured.

## [3.3.0](https://github.com/snapetech/seerrng/compare/v3.2.7...v3.3.0) - 2026-07-14

### Added

- Discover homepage rows are cached and revalidated, improving repeat visits without permanently serving stale state.

### Fixed

- The Bookshelf add-service form and repeated search-query navigation now work correctly.
- Discovery performance and transient API reliability were improved.

### Changed

- Debian, Fedora/COPR, PPA, and deployment publishing now validate credentials, package assets, host keys, and target state more explicitly.

## [3.2.7](https://github.com/snapetech/seerrng/compare/v3.2.5...v3.2.7) - 2026-06-16

### Security

- Container image scanning now authenticates to the registry before scanning.

### Fixed

- Release archives include the pnpm workspace configuration, application builds run on the build platform, and deployment avoids recursive ownership walks.

## [3.2.6](https://github.com/snapetech/seerrng/commit/d1af3260697da688964a1ba9d4be87bffea78fdf) - 2026-06-16

Release preparation only. No GitHub release was published for this tag; the
following `v3.2.7` release includes the intervening changes.

## [3.2.5](https://github.com/snapetech/seerrng/compare/v3.2.4...v3.2.5) - 2026-06-16

### Security

- Runtime OpenSSL packages were upgraded in the container image.

## [3.2.4](https://github.com/snapetech/seerrng/compare/v3.2.3...v3.2.4) - 2026-06-16

### Security

- Dependency and code-scanning alerts were resolved, and the container no longer carries a vulnerable npm runtime tree.

## [3.2.3](https://github.com/snapetech/seerrng/compare/v3.2.2...v3.2.3) - 2026-05-22

### Fixed

- Windows release assets and PPA signing now publish through the intended paths.

## [3.2.2](https://github.com/snapetech/seerrng/compare/v3.2.1...v3.2.2) - 2026-05-22

### Fixed

- Package channel publishing now selects and promotes the correct release artifacts.

## [3.2.1](https://github.com/snapetech/seerrng/releases/tag/v3.2.1) - 2026-05-22

This was the initial SeerrNG release and fork baseline.

### Added

- Added Readarr-style third-party client compatibility and BookshelfNG integration, including service diagnostics, metadata handling, book/music request flows, library matching, and request retry/recovery behavior.
- Added a first-class Hardcover migration workflow with resumable recovery, OpenLibrary fallback handling, and deployment documentation for Bookshelf backends.
- Added persistent media associations, Plex relink support, discover caching, and public SeerrNG branding/deployment packaging.

### Fixed

- Improved edition and identifier matching for Bookshelf, MusicBrainz, and related media, including softcover lookup and translated book terms.
- Hardened request dispatch, failed-request recovery, bulk-request pagination, and scanner writes when backends are unavailable or locked.

### Security

- Added broad validation and bounds for route identifiers, pagination, external URLs, image proxies, cache keys, webhook and notification requests, session handling, and outbound HTTP waits.

## [3.2.0](https://github.com/snapetech/seerrng/compare/v3.1.1...v3.2.0) - 2026-04-16

This imported upstream Seerr tag is retained in the merge history. No separate
SeerrNG release notes were recorded for it; the linked tag comparison preserves
the detailed commit history.

## [3.1.1](https://github.com/snapetech/seerrng/compare/v3.1.0...v3.1.1) - 2026-04-13

This imported upstream Seerr tag is retained in the merge history. No separate
SeerrNG release notes were recorded for it; the linked tag comparison preserves
the detailed commit history.

## [3.1.0](https://github.com/snapetech/seerrng/compare/v3.0.1...v3.1.0) - 2026-02-27

This imported upstream Seerr tag is retained in the merge history. No separate
SeerrNG release notes were recorded for it; the linked tag comparison preserves
the detailed commit history.

## [3.0.1](https://github.com/snapetech/seerrng/compare/v3.0.0...v3.0.1) - 2026-02-15

This imported upstream Seerr tag is retained in the merge history. No separate
SeerrNG release notes were recorded for it; the linked tag comparison preserves
the detailed commit history.

## [3.0.0](https://github.com/snapetech/seerrng/compare/v2.7.3...v3.0.0) - 2026-02-14

This imported upstream Seerr tag is retained in the merge history. No separate
SeerrNG release notes were recorded for it; the linked tag comparison preserves
the detailed commit history.

## Historical upstream history

The entries below are inherited Jellyseerr/Overseerr history. New SeerrNG
releases use the SeerrNG repository and release-note process above.

## [2.7.3](https://github.com/fallenbagel/jellyseerr/compare/v2.7.2...v2.7.3) (2025-08-14)


### Bug Fixes

* **api:** add missing user settings' api docs ([#1820](https://github.com/fallenbagel/jellyseerr/issues/1820)) ([e52c631](https://github.com/fallenbagel/jellyseerr/commit/e52c63164fcf0fa1d35b61e4a9dedfae92764bdd))
* **api:** make username field nullable in UserSettings API schema ([#1835](https://github.com/fallenbagel/jellyseerr/issues/1835)) ([c86ee0d](https://github.com/fallenbagel/jellyseerr/commit/c86ee0ddb1b1e24c296a2935aa964e7e2fb2b905))
* **api:** update Plex Watchlist URL ([#1847](https://github.com/fallenbagel/jellyseerr/issues/1847)) ([17d4f13](https://github.com/fallenbagel/jellyseerr/commit/17d4f13afe389a9d0edd6eaa9a0728380a80d892))
* **blacklist:** handle invalid keywords gracefully ([#1815](https://github.com/fallenbagel/jellyseerr/issues/1815)) ([ca16864](https://github.com/fallenbagel/jellyseerr/commit/ca1686425bcd34b05ebd3aa0b52ae939d2becc9d))
* **MediaRequestSubscriber:** use event manager to get fresh media state for MEDIA_AVAILABLE notifications ([#1825](https://github.com/fallenbagel/jellyseerr/issues/1825)) ([3292f11](https://github.com/fallenbagel/jellyseerr/commit/3292f113081cf83aa01d522c9d19c3b5ce0e281a))
* **media:** update delete media file logic to include is4k parameter ([#1832](https://github.com/fallenbagel/jellyseerr/issues/1832)) ([e02ee24](https://github.com/fallenbagel/jellyseerr/commit/e02ee24f70bae47731ddf445057703ce273b42ef))
* **proxy:** initialize image proxies after the proxy is set up ([#1794](https://github.com/fallenbagel/jellyseerr/issues/1794)) ([e98f31e](https://github.com/fallenbagel/jellyseerr/commit/e98f31e66cd2c9836a24169be0b3446d0923d9f9)), closes [#1787](https://github.com/fallenbagel/jellyseerr/issues/1787)

## [2.7.2](https://github.com/fallenbagel/jellyseerr/compare/v2.7.1...v2.7.2) (2025-07-21)


### Bug Fixes

* **proxy:** modify the registration of the axios interceptors ([#1791](https://github.com/fallenbagel/jellyseerr/issues/1791)) ([75a7279](https://github.com/fallenbagel/jellyseerr/commit/75a7279ea24874548fece12bb5e7c97d78d088a9)), closes [#1787](https://github.com/fallenbagel/jellyseerr/issues/1787)

## [2.7.1](https://github.com/fallenbagel/jellyseerr/compare/v2.7.0...v2.7.1) (2025-07-15)


### Bug Fixes

* allow setting IPv6 as an IP address in hostname field ([#1782](https://github.com/fallenbagel/jellyseerr/issues/1782)) ([844b1ab](https://github.com/fallenbagel/jellyseerr/commit/844b1abad9589c57ea6f56717212d9219b2aa954))
* **gotify:** notifications blocked when priority set to 0 ([#1763](https://github.com/fallenbagel/jellyseerr/issues/1763)) ([8c43db2](https://github.com/fallenbagel/jellyseerr/commit/8c43db2abf3b504dbb789369c9a9ac92bb820722))
* **proxy:** apply all proxy settings to Axios ([#1741](https://github.com/fallenbagel/jellyseerr/issues/1741)) ([b83367c](https://github.com/fallenbagel/jellyseerr/commit/b83367cbf2e0470cc1ad4eed8ec6eafaafafdbad))
* remove LunaSea ([#1759](https://github.com/fallenbagel/jellyseerr/issues/1759)) ([510108f](https://github.com/fallenbagel/jellyseerr/commit/510108f9bbec9651a5d91e11ea411e688b5043fe)), closes [#1756](https://github.com/fallenbagel/jellyseerr/issues/1756)

# [2.7.0](https://github.com/fallenbagel/jellyseerr/compare/v2.6.0...v2.7.0) (2025-06-20)


### Bug Fixes

* **blacklist:** hide items from MediaSliders when hideBlacklisted is enabled ([#1713](https://github.com/fallenbagel/jellyseerr/issues/1713)) ([d4a6cb2](https://github.com/fallenbagel/jellyseerr/commit/d4a6cb268a33d96c03f1f76c207b5597e4eae6e7))
* correct typing issue ([#1715](https://github.com/fallenbagel/jellyseerr/issues/1715)) ([bb95c70](https://github.com/fallenbagel/jellyseerr/commit/bb95c7009faaf22103c1c8e84e3403823377ce0f))
* **jellyfin:** use the same deviceId for admins ([#1710](https://github.com/fallenbagel/jellyseerr/issues/1710)) ([c7284f4](https://github.com/fallenbagel/jellyseerr/commit/c7284f473c43634b3a324f3b11a9a60990b3c0da))
* **proxy:** apply http proxy settings to axios ([#1716](https://github.com/fallenbagel/jellyseerr/issues/1716)) ([7c969f4](https://github.com/fallenbagel/jellyseerr/commit/7c969f4235aa052234084c3cb951d485c6fff9cd))
* redirect the 'Request' button to the right page ([#1711](https://github.com/fallenbagel/jellyseerr/issues/1711)) ([9cb7e14](https://github.com/fallenbagel/jellyseerr/commit/9cb7e1495ab2860cea614d10f6f7b62cf77b4def)), closes [#1588](https://github.com/fallenbagel/jellyseerr/issues/1588)
* **settings:** add a tip for youtube URL setting ([#1714](https://github.com/fallenbagel/jellyseerr/issues/1714)) ([fb8677f](https://github.com/fallenbagel/jellyseerr/commit/fb8677f29cfe2a7f0e0c465a1a742be119517886))


### Features

* add force ipv4 first setting ([#1719](https://github.com/fallenbagel/jellyseerr/issues/1719)) ([0357d17](https://github.com/fallenbagel/jellyseerr/commit/0357d172058ceda7d49a0c18c13009e0031e034d))

# [2.6.0](https://github.com/fallenbagel/jellyseerr/compare/v2.5.2...v2.6.0) (2025-06-09)


### Bug Fixes

* add missing cache for some tmdb images ([#1656](https://github.com/fallenbagel/jellyseerr/issues/1656)) ([8949ede](https://github.com/fallenbagel/jellyseerr/commit/8949edea7edcb64546f2c8b9363120102509a2a5))
* **entity:** use TIMESTAMPTZ in Postgres and sort issue comments oldest-first ([#1654](https://github.com/fallenbagel/jellyseerr/issues/1654)) ([8da1c92](https://github.com/fallenbagel/jellyseerr/commit/8da1c9292391a39b8c08ed9f7cd7a2bb10217588)), closes [#1569](https://github.com/fallenbagel/jellyseerr/issues/1569) [#1568](https://github.com/fallenbagel/jellyseerr/issues/1568)
* **filters:** display the right value when resetting the filter options ([#1695](https://github.com/fallenbagel/jellyseerr/issues/1695)) ([c0dd2e5](https://github.com/fallenbagel/jellyseerr/commit/c0dd2e5e27ad9927c52c54cd66bfb2b3cf7890d0)), closes [#1693](https://github.com/fallenbagel/jellyseerr/issues/1693)
* **imagecache:** fix avatar cache folder creation ([#1581](https://github.com/fallenbagel/jellyseerr/issues/1581)) ([355b76d](https://github.com/fallenbagel/jellyseerr/commit/355b76de5cc029a76708bb754c6c4fd72ce99e3d)), closes [#1520](https://github.com/fallenbagel/jellyseerr/issues/1520)
* **issuecomment:** fix issue display lists in IssueComment ([#1638](https://github.com/fallenbagel/jellyseerr/issues/1638)) ([515124b](https://github.com/fallenbagel/jellyseerr/commit/515124bab4b5e13759cb9497489dea828a6cef52)), closes [#1328](https://github.com/fallenbagel/jellyseerr/issues/1328) [#1328](https://github.com/fallenbagel/jellyseerr/issues/1328) [#1328](https://github.com/fallenbagel/jellyseerr/issues/1328)
* **jellyfin:** clean up Jellyfin sessions on Jellyseerr logout ([#1651](https://github.com/fallenbagel/jellyseerr/issues/1651)) ([b27dbd7](https://github.com/fallenbagel/jellyseerr/commit/b27dbd7a155bed9490afdd9dc25ef8a7ca9311eb))
* **mediarequests:** properly sort season numbers in media requests ([#1688](https://github.com/fallenbagel/jellyseerr/issues/1688)) ([6b8c0bd](https://github.com/fallenbagel/jellyseerr/commit/6b8c0bd8f3ac7a5c74bc0cb2c81edd2c22a7a618)), closes [#1336](https://github.com/fallenbagel/jellyseerr/issues/1336)
* **pushover notificatons:** the sound setting will now be stored correctly ([#1630](https://github.com/fallenbagel/jellyseerr/issues/1630)) ([5fd65eb](https://github.com/fallenbagel/jellyseerr/commit/5fd65eb1ba4e8f383e8a11cb1004acc3bace26c0)), closes [#1614](https://github.com/fallenbagel/jellyseerr/issues/1614)
* **requestlist:** remove unnecessary semicolon ([#1647](https://github.com/fallenbagel/jellyseerr/issues/1647)) ([6b9aedb](https://github.com/fallenbagel/jellyseerr/commit/6b9aedb97062e6b551cc7e023f699b8b26f730f0))
* **ui:** correct seasons badge order ([#1648](https://github.com/fallenbagel/jellyseerr/issues/1648)) ([123894b](https://github.com/fallenbagel/jellyseerr/commit/123894b475fae421b416781587432ecc4e50acc2))
* **ui:** make person media type filter consistent on mobile ([#1669](https://github.com/fallenbagel/jellyseerr/issues/1669)) ([24e1e94](https://github.com/fallenbagel/jellyseerr/commit/24e1e94747c9a070bc84a64ace47166efe52f7f1))
* **url validation:** correct URL validation for empty fields ([#1657](https://github.com/fallenbagel/jellyseerr/issues/1657)) ([d226dbb](https://github.com/fallenbagel/jellyseerr/commit/d226dbb9b4279c3d649fb0c72656d35ba065491c))
* **usediscover hook:** detect end of pagination when totalSize is a multiple of pageSize ([#1649](https://github.com/fallenbagel/jellyseerr/issues/1649)) ([45f2540](https://github.com/fallenbagel/jellyseerr/commit/45f25408c62f87e4a2b73e270644fb2f1f79a290)), closes [#1623](https://github.com/fallenbagel/jellyseerr/issues/1623)
* **usersettings:** exclude current user when checking for existing email ([#1689](https://github.com/fallenbagel/jellyseerr/issues/1689)) ([ea7e68f](https://github.com/fallenbagel/jellyseerr/commit/ea7e68fc99bbc783277891b3408f07b7a70765be))


### Features

* add caching for TVDB images ([#1655](https://github.com/fallenbagel/jellyseerr/issues/1655)) ([e69649d](https://github.com/fallenbagel/jellyseerr/commit/e69649d71d19d23cafac363792a7e89c897bcad0))
* add content certification/age-rating filter ([#1418](https://github.com/fallenbagel/jellyseerr/issues/1418)) ([149d79e](https://github.com/fallenbagel/jellyseerr/commit/149d79e5404cae48217806079b0ac0a34fbaeb35)), closes [#501](https://github.com/fallenbagel/jellyseerr/issues/501) [#501](https://github.com/fallenbagel/jellyseerr/issues/501)
* allow changing YouTube host for trailers ([#643](https://github.com/fallenbagel/jellyseerr/issues/643)) ([d01f9a0](https://github.com/fallenbagel/jellyseerr/commit/d01f9a058042657ae1ce39537cdf0029ef878c8e))
* **blacklist:** Automatically add media with blacklisted tags to the blacklist ([#1306](https://github.com/fallenbagel/jellyseerr/issues/1306)) ([4a5ac3c](https://github.com/fallenbagel/jellyseerr/commit/4a5ac3cc42fd924e8c83d64e5b01de44bed6b8ab))
* **blacklist:** hide blacklisted items from discover pages for admins ([#1601](https://github.com/fallenbagel/jellyseerr/issues/1601)) ([185167a](https://github.com/fallenbagel/jellyseerr/commit/185167a0a75eb710a8696b58f7bc0a3f5939cee8))
* **discord.ts:** adds a link to the pending approval discord notification ([#436](https://github.com/fallenbagel/jellyseerr/issues/436)) ([14ee52e](https://github.com/fallenbagel/jellyseerr/commit/14ee52e93e7e6b2c1c5ec6cf05abcac3c0d8163a))
* filter by media type on PersonDetails ([#1566](https://github.com/fallenbagel/jellyseerr/issues/1566)) ([a19dcaf](https://github.com/fallenbagel/jellyseerr/commit/a19dcaf5e5c5cc4072a7e4733bbbf149a352915b)), closes [#1513](https://github.com/fallenbagel/jellyseerr/issues/1513) [#1513](https://github.com/fallenbagel/jellyseerr/issues/1513)
* **gotify:** added priority input for gotify ([#1410](https://github.com/fallenbagel/jellyseerr/issues/1410)) ([21400ce](https://github.com/fallenbagel/jellyseerr/commit/21400cecdc1b964023087bce479bb7d141049080))
* **issuecomment:** fix translation issue ([#1635](https://github.com/fallenbagel/jellyseerr/issues/1635)) ([8a42fe1](https://github.com/fallenbagel/jellyseerr/commit/8a42fe16b5ebca80e76d98fb05006cf41f5a953a)), closes [#1604](https://github.com/fallenbagel/jellyseerr/issues/1604)
* make chart probes configurable ([#1574](https://github.com/fallenbagel/jellyseerr/issues/1574)) ([c3b8574](https://github.com/fallenbagel/jellyseerr/commit/c3b8574515de4f5a2c13f36b3a00708d0858966e))
* now uses markdown linebreaks instead of relying purely on newlines ([#1514](https://github.com/fallenbagel/jellyseerr/issues/1514)) ([7d36dc1](https://github.com/fallenbagel/jellyseerr/commit/7d36dc182b462c12a31833ee08e74255d7964c24))
* **ntfy:** add native ntfy notification support ([#1599](https://github.com/fallenbagel/jellyseerr/issues/1599)) ([fc4db7f](https://github.com/fallenbagel/jellyseerr/commit/fc4db7fa002acbb31f1fd8d20da019291d8096d8)), closes [#499](https://github.com/fallenbagel/jellyseerr/issues/499)
* **requestlist:** add requests list media type filtering ([#1511](https://github.com/fallenbagel/jellyseerr/issues/1511)) ([e8f1edc](https://github.com/fallenbagel/jellyseerr/commit/e8f1edc0621387921dca73a8c9ad1d15f6b3a847))

## [2.5.2](https://github.com/fallenbagel/jellyseerr/compare/v2.5.1...v2.5.2) (2025-04-03)


### Bug Fixes

* **auth:** Bitwarden autofill fix on local/Jellyfin login (2) ([#1487](https://github.com/fallenbagel/jellyseerr/issues/1487)) ([85bbc85](https://github.com/fallenbagel/jellyseerr/commit/85bbc857141d38bcf5244078437ed6a3318bba67))
* **avatar:** fix avatar cache busting by using avatarVersion  ([#1537](https://github.com/fallenbagel/jellyseerr/issues/1537)) ([29034b3](https://github.com/fallenbagel/jellyseerr/commit/29034b350d35ebaed52556448e46436aeb644e77))
* correct "Remove from *arr" button ([#1544](https://github.com/fallenbagel/jellyseerr/issues/1544)) ([8dc1d81](https://github.com/fallenbagel/jellyseerr/commit/8dc1d8196c67bee0e772941445c294f0ca367961)), closes [#1476](https://github.com/fallenbagel/jellyseerr/issues/1476) [#1494](https://github.com/fallenbagel/jellyseerr/issues/1494)
* **helm:** apply annotations to pvc ([#1489](https://github.com/fallenbagel/jellyseerr/issues/1489)) ([e5ab847](https://github.com/fallenbagel/jellyseerr/commit/e5ab847547564869c3aa6443b1e22208c09a7810))
* **jellyfin:** ensure deviceID is never empty ([#1538](https://github.com/fallenbagel/jellyseerr/issues/1538)) ([7438042](https://github.com/fallenbagel/jellyseerr/commit/7438042757cb0e81534cf9f766d84dd3ff57fd84))
* **job:** handle media removal for 4k on the same server ([#1543](https://github.com/fallenbagel/jellyseerr/issues/1543)) ([63dc27d](https://github.com/fallenbagel/jellyseerr/commit/63dc27d400ecc80a18442fc42dd417cc03c3f9e1))
* **job:** rename Plex Sync to Jellyfin Sync ([#1549](https://github.com/fallenbagel/jellyseerr/issues/1549)) ([2f6be95](https://github.com/fallenbagel/jellyseerr/commit/2f6be955b51e8920c8954413286577e6fea4aee2))
* **migrations:** add missing Postgres migration and fix SQLite migration ([#1532](https://github.com/fallenbagel/jellyseerr/issues/1532)) ([0b0b76e](https://github.com/fallenbagel/jellyseerr/commit/0b0b76e58c583fc7c31d7821e7825e32065f7944)), closes [#1466](https://github.com/fallenbagel/jellyseerr/issues/1466)
* **ui:** handle import-from-plex response as array ([#1510](https://github.com/fallenbagel/jellyseerr/issues/1510)) ([4cd02ba](https://github.com/fallenbagel/jellyseerr/commit/4cd02babbace98c01bcef153a50d34cb36dd1d4b))
* **ui:** resolve discover language dropdown overlap ([#1497](https://github.com/fallenbagel/jellyseerr/issues/1497)) ([f5b3a52](https://github.com/fallenbagel/jellyseerr/commit/f5b3a526cb9b12c19e5ff6a79240e3d85685ff9b)), closes [#1475](https://github.com/fallenbagel/jellyseerr/issues/1475)

## [2.5.1](https://github.com/fallenbagel/jellyseerr/compare/v2.5.0...v2.5.1) (2025-03-17)


### Bug Fixes

* **auth:** Bitwarden autofill fix on local/Jellyfin login ([#1459](https://github.com/fallenbagel/jellyseerr/issues/1459)) ([b085e12](https://github.com/fallenbagel/jellyseerr/commit/b085e12ff9df9f57d71ca1fe27fefa8319229a2a))
* **blacklist:** add back the blacklist button on TitleCard for Plex ([#1463](https://github.com/fallenbagel/jellyseerr/issues/1463)) ([4d1163c](https://github.com/fallenbagel/jellyseerr/commit/4d1163c34384efa59fe9b5401c5bd42d7f0435fc)), closes [#1398](https://github.com/fallenbagel/jellyseerr/issues/1398)
* check if the file still exists in the service before deleting ([#1476](https://github.com/fallenbagel/jellyseerr/issues/1476)) ([f773e0f](https://github.com/fallenbagel/jellyseerr/commit/f773e0fb2a62f4f316ca7f8fe3d8dabdebae2ab7))
* **job:** resolve edge case issue with season availability updates ([#1483](https://github.com/fallenbagel/jellyseerr/issues/1483)) ([77a36f9](https://github.com/fallenbagel/jellyseerr/commit/77a36f971444ee5dc0d15b2d34a8daaf4e1f28b5))
* **mediarequest:** correct download sync for Radarr ([#1484](https://github.com/fallenbagel/jellyseerr/issues/1484)) ([c2d9d00](https://github.com/fallenbagel/jellyseerr/commit/c2d9d00b415fecbb5a8d7ca28a6ed76ea3ba3c19)), closes [#1376](https://github.com/fallenbagel/jellyseerr/issues/1376)
* **proxy:** update http proxy to accept bypass list with undici v7 ([#1456](https://github.com/fallenbagel/jellyseerr/issues/1456)) ([9891a75](https://github.com/fallenbagel/jellyseerr/commit/9891a7577cc0874f41c38ff0e6e5a6b4d8315281)), closes [#1454](https://github.com/fallenbagel/jellyseerr/issues/1454)
* **requestlist:** hide the remove from *arr button when no service exists ([#1457](https://github.com/fallenbagel/jellyseerr/issues/1457)) ([33e7a15](https://github.com/fallenbagel/jellyseerr/commit/33e7a153aa64461a715595d070fba53d52b34767)), closes [#1449](https://github.com/fallenbagel/jellyseerr/issues/1449)
* **smtp-notification-test:** missing allowSelfSigned option in test function ([#1461](https://github.com/fallenbagel/jellyseerr/issues/1461)) ([b8425d6](https://github.com/fallenbagel/jellyseerr/commit/b8425d6388003322edd7b4b2473aeb24c06e4802))
* **ui:** correct seasons badge order ([#1485](https://github.com/fallenbagel/jellyseerr/issues/1485)) ([f884ac9](https://github.com/fallenbagel/jellyseerr/commit/f884ac9c660d1931c8b3815dcaefd109da249f2a))
* **ui:** move watch trailer button above the 4k request button ([#1465](https://github.com/fallenbagel/jellyseerr/issues/1465)) ([a6dd4a8](https://github.com/fallenbagel/jellyseerr/commit/a6dd4a8fedb9af9810581b1cc18cfea53b3cfd39)), closes [#1462](https://github.com/fallenbagel/jellyseerr/issues/1462)
* **ui:** resolve streaming region dropdown overlap ([#1477](https://github.com/fallenbagel/jellyseerr/issues/1477)) ([767a241](https://github.com/fallenbagel/jellyseerr/commit/767a24164d6c9d101e613c53960985f4fbe2ce93)), closes [#1475](https://github.com/fallenbagel/jellyseerr/issues/1475)


### Reverts

* **airdate:** reverts airdate offset & changes relative time to only display date (not time) ([#1467](https://github.com/fallenbagel/jellyseerr/issues/1467)) ([8394eb5](https://github.com/fallenbagel/jellyseerr/commit/8394eb5ad405a90e840952d5977712e1ab890530)), closes [#1390](https://github.com/fallenbagel/jellyseerr/issues/1390)

# [2.5.0](https://github.com/fallenbagel/jellyseerr/compare/v2.4.0...v2.5.0) (2025-03-11)


### Bug Fixes

* **ui:** correct media action icon size ([#1444](https://github.com/fallenbagel/jellyseerr/issues/1444)) ([771ecdf](https://github.com/fallenbagel/jellyseerr/commit/771ecdf7812004eec0f516cc424f9982936c8a2a)), closes [#1440](https://github.com/fallenbagel/jellyseerr/issues/1440)
* **users:** correct user list for Postgres ([#1443](https://github.com/fallenbagel/jellyseerr/issues/1443)) ([5b998be](https://github.com/fallenbagel/jellyseerr/commit/5b998bef82388dccaaa462ff2ff3a526dd03338c)), closes [#1333](https://github.com/fallenbagel/jellyseerr/issues/1333)


### Features

* **helm:** upgrade jellyseerr to 2.4.0 ([#1438](https://github.com/fallenbagel/jellyseerr/issues/1438)) ([077e355](https://github.com/fallenbagel/jellyseerr/commit/077e355c775af92ff4dd2341543555d473c1abbb))


### Reverts

* reverts csrf-csrf back to csurf ([#1442](https://github.com/fallenbagel/jellyseerr/issues/1442)) ([21ab20b](https://github.com/fallenbagel/jellyseerr/commit/21ab20bba97102fe9eb9d4af4213a604c05e0acc)), closes [#1393](https://github.com/fallenbagel/jellyseerr/issues/1393)

# [2.4.0](https://github.com/fallenbagel/jellyseerr/compare/v2.3.0...v2.4.0) (2025-03-10)


### Bug Fixes

* add email requirement for local users ([#1389](https://github.com/fallenbagel/jellyseerr/issues/1389)) ([f0a6055](https://github.com/fallenbagel/jellyseerr/commit/f0a605577469248a2a7c2170be8310e106131c59)), closes [#900](https://github.com/fallenbagel/jellyseerr/issues/900) [#1367](https://github.com/fallenbagel/jellyseerr/issues/1367)
* **api:** make item endpoints user-independent ([#1413](https://github.com/fallenbagel/jellyseerr/issues/1413)) ([9cc6930](https://github.com/fallenbagel/jellyseerr/commit/9cc6930fed31c834201fe4e8a2a2f456b878dec6))
* assign the keep-alive value explicitly ([#1368](https://github.com/fallenbagel/jellyseerr/issues/1368)) ([438ccfe](https://github.com/fallenbagel/jellyseerr/commit/438ccfe9c37f4848b84e60a2ce64687e0b4e4dc0)), closes [#1365](https://github.com/fallenbagel/jellyseerr/issues/1365)
* corrected spelling errors in function names ([#1366](https://github.com/fallenbagel/jellyseerr/issues/1366)) ([e035cd8](https://github.com/fallenbagel/jellyseerr/commit/e035cd84ae24502f43cf842d6d10621f28719682))
* disable first page revalidation in useSWRInfinite ([#1386](https://github.com/fallenbagel/jellyseerr/issues/1386)) ([d563b36](https://github.com/fallenbagel/jellyseerr/commit/d563b361869d8183041cb6aea91279e17a513070)), closes [#1380](https://github.com/fallenbagel/jellyseerr/issues/1380)
* disallow admins to edit other admins in bulk edit ([#1340](https://github.com/fallenbagel/jellyseerr/issues/1340)) ([2dbd109](https://github.com/fallenbagel/jellyseerr/commit/2dbd1096d2756a7213209419d1d4da36e7267959)), closes [#1309](https://github.com/fallenbagel/jellyseerr/issues/1309)
* **emby:** throw the right error message if no library exists ([#1415](https://github.com/fallenbagel/jellyseerr/issues/1415)) ([67bd639](https://github.com/fallenbagel/jellyseerr/commit/67bd639a432d724bb34b7d6fed76c0bb66d94147))
* fix remove from *arr in item details ([#1387](https://github.com/fallenbagel/jellyseerr/issues/1387)) ([9712f56](https://github.com/fallenbagel/jellyseerr/commit/9712f5605471a673edb3d25048dc08d1addd58db))
* **helm:** no change, fixing OCI manifest corruption ([#1310](https://github.com/fallenbagel/jellyseerr/issues/1310)) ([418f0c2](https://github.com/fallenbagel/jellyseerr/commit/418f0c2eb844e8814aca0d280292e9fb372cc118))
* **jobs:** run plex/jellyfin jobs only for the relevant media server ([#1331](https://github.com/fallenbagel/jellyseerr/issues/1331)) ([2b7974f](https://github.com/fallenbagel/jellyseerr/commit/2b7974fa06f196b40de270ad24e54b227143b081)), closes [#1329](https://github.com/fallenbagel/jellyseerr/issues/1329)
* make watchlist buttons consistent ([#1272](https://github.com/fallenbagel/jellyseerr/issues/1272)) ([f247642](https://github.com/fallenbagel/jellyseerr/commit/f247642b76ebefd9eeb8aed485573b5d6b133673)), closes [#1270](https://github.com/fallenbagel/jellyseerr/issues/1270)
* **mediarequest:** optimise more typeorm lifecycle triggers ([#1376](https://github.com/fallenbagel/jellyseerr/issues/1376)) ([80927b9](https://github.com/fallenbagel/jellyseerr/commit/80927b97058a219fca9fa580243cb3f966fb0b37)), closes [#513](https://github.com/fallenbagel/jellyseerr/issues/513)
* missing plex.tv url in images remotePatterns ([#1356](https://github.com/fallenbagel/jellyseerr/issues/1356)) ([b29959b](https://github.com/fallenbagel/jellyseerr/commit/b29959b0637fd8add9598d2a3d05f9a0972b65df))
* **overriderules:** allows every user to be added to the override rules ([#1333](https://github.com/fallenbagel/jellyseerr/issues/1333)) ([af8d6b4](https://github.com/fallenbagel/jellyseerr/commit/af8d6b475c0040f7b96f04e3783ac8b4c702b3db))
* **overriderules:** correct disabled condition for override rule creation ([#1419](https://github.com/fallenbagel/jellyseerr/issues/1419)) ([1de518d](https://github.com/fallenbagel/jellyseerr/commit/1de518d9154ea7809688c73ebefdcac66d27bdf8))
* **overriderules:** enable override rules only when a service exists ([#1417](https://github.com/fallenbagel/jellyseerr/issues/1417)) ([4e44282](https://github.com/fallenbagel/jellyseerr/commit/4e44282387e7b511daecd961cdc9da98cb4b0139))
* resolve a vulnerability with admin token ([#1345](https://github.com/fallenbagel/jellyseerr/issues/1345)) ([620135a](https://github.com/fallenbagel/jellyseerr/commit/620135aeac6d9fc284a3daddcafd1964474d2789))
* **settings:** remove dns server option ([#1416](https://github.com/fallenbagel/jellyseerr/issues/1416)) ([ada467e](https://github.com/fallenbagel/jellyseerr/commit/ada467ecf40c7c27d57ae69ad515bd245d7bb639)), closes [#1266](https://github.com/fallenbagel/jellyseerr/issues/1266)
* **setup:** resolve looping library validation error message ([#1316](https://github.com/fallenbagel/jellyseerr/issues/1316)) ([6ab4632](https://github.com/fallenbagel/jellyseerr/commit/6ab463285d566c18ef0b4034fbfd0b5863a4f7a5))
* **watchlist:** disable Jellyseerr's watchlist for Plex users ([#1398](https://github.com/fallenbagel/jellyseerr/issues/1398)) ([4eddbaa](https://github.com/fallenbagel/jellyseerr/commit/4eddbaa71b7972b6db33976102501fb8b6333206)), closes [#1344](https://github.com/fallenbagel/jellyseerr/issues/1344)


### Features

* add a robots.txt file ([#1335](https://github.com/fallenbagel/jellyseerr/issues/1335)) ([24d3f52](https://github.com/fallenbagel/jellyseerr/commit/24d3f523fc07ff4b28d041b2a74cfb5ab0a788a7)), closes [#1323](https://github.com/fallenbagel/jellyseerr/issues/1323)
* add linked accounts page ([#883](https://github.com/fallenbagel/jellyseerr/issues/883)) ([64f05bc](https://github.com/fallenbagel/jellyseerr/commit/64f05bcad6956f7e8cbe3fdf5f430af1f30ddd6d))
* **airdatebadge:** convert airDate from UTC to local timezone ([#1390](https://github.com/fallenbagel/jellyseerr/issues/1390)) ([a790b1a](https://github.com/fallenbagel/jellyseerr/commit/a790b1abccfa9c3f8272ade8cd055017905dd87f)), closes [#1373](https://github.com/fallenbagel/jellyseerr/issues/1373)
* **api:** make rottentomatoes matching more robust ([#1265](https://github.com/fallenbagel/jellyseerr/issues/1265)) ([907ba6f](https://github.com/fallenbagel/jellyseerr/commit/907ba6fdea0341e8d0f429eaf6aaa404dbc7daff))
* **helm:** Add possibility to pass volumes and volume mounts ([#1291](https://github.com/fallenbagel/jellyseerr/issues/1291)) ([62c1a70](https://github.com/fallenbagel/jellyseerr/commit/62c1a70b373ee574ad9ff98d322085976dbc7868))
* revamp login page and support disabling media server login ([#1286](https://github.com/fallenbagel/jellyseerr/issues/1286)) ([73d8efa](https://github.com/fallenbagel/jellyseerr/commit/73d8efaa54888b5282624e618c1461c23653f0b9))
* **settings:** add a disclaimer for dns servers and ipv4 first settings ([#1375](https://github.com/fallenbagel/jellyseerr/issues/1375)) ([1176171](https://github.com/fallenbagel/jellyseerr/commit/117617188ed988bd8a90e9fbe8bada08d5b14513))
* **ui:** prevent password manager interference & improve service links ([#1396](https://github.com/fallenbagel/jellyseerr/issues/1396)) ([e97a13e](https://github.com/fallenbagel/jellyseerr/commit/e97a13e1e46298be9f334c8e6c6028fb8a99c53d)), closes [#3989](https://github.com/fallenbagel/jellyseerr/issues/3989)
* update Jellyfin logo ([#1359](https://github.com/fallenbagel/jellyseerr/issues/1359)) ([c181cee](https://github.com/fallenbagel/jellyseerr/commit/c181cee328eb867f90d906757b8bddaeb74ba9f2))
* upgrade chart to 2.0.0 ([#1268](https://github.com/fallenbagel/jellyseerr/issues/1268)) ([0ee3e69](https://github.com/fallenbagel/jellyseerr/commit/0ee3e69a6101f5a8818b6d4c5654d84f6aac322b))

# [2.3.0](https://github.com/fallenbagel/jellyseerr/compare/v2.2.3...v2.3.0) (2025-01-16)


### Bug Fixes

* correct typos for the special episodes setting ([#1209](https://github.com/fallenbagel/jellyseerr/issues/1209)) ([ebe7d11](https://github.com/fallenbagel/jellyseerr/commit/ebe7d11a5393f3d444dd9613854d6054af1ec58b)), closes [#1193](https://github.com/fallenbagel/jellyseerr/issues/1193) [#1208](https://github.com/fallenbagel/jellyseerr/issues/1208)
* **externalapi:** clear cache after a request is made ([#1217](https://github.com/fallenbagel/jellyseerr/issues/1217)) ([f718cec](https://github.com/fallenbagel/jellyseerr/commit/f718cec23fccbfd16fdb792c2778cd543b751799)), closes [#1207](https://github.com/fallenbagel/jellyseerr/issues/1207)
* **jellyfinlogin:** add proper error message when no admin user exists ([#1216](https://github.com/fallenbagel/jellyseerr/issues/1216)) ([ac90802](https://github.com/fallenbagel/jellyseerr/commit/ac908026dbb7ca06c0fb520bbb360120d6b87feb))
* optimize media status update to avoid lifecycle hook triggers ([#1218](https://github.com/fallenbagel/jellyseerr/issues/1218)) ([656cd91](https://github.com/fallenbagel/jellyseerr/commit/656cd91c9c90e57914b7fedb097f29e21fb18090))
* **overriderules:** allow override rules only when the service is created ([#1259](https://github.com/fallenbagel/jellyseerr/issues/1259)) ([ce1b39f](https://github.com/fallenbagel/jellyseerr/commit/ce1b39f73b953b6fa0a00948e72d24c43476bc5f))
* prevent TypeORM subscribers from calling itself over and over ([#1215](https://github.com/fallenbagel/jellyseerr/issues/1215)) ([d67ec57](https://github.com/fallenbagel/jellyseerr/commit/d67ec571c5950f04b85f5a268b38eb026a156320))
* resolve plex user mismatch due to caching issues ([#1242](https://github.com/fallenbagel/jellyseerr/issues/1242)) ([131a5a2](https://github.com/fallenbagel/jellyseerr/commit/131a5a2b0b1a235599940affc183b93c36f12ade)), closes [#1227](https://github.com/fallenbagel/jellyseerr/issues/1227)
* **settingsmigrator:** prevent region migration from running multiple times ([#1255](https://github.com/fallenbagel/jellyseerr/issues/1255)) ([1c6f536](https://github.com/fallenbagel/jellyseerr/commit/1c6f5362d773c850a5e58b5013f0d65474467e9c)), closes [#1251](https://github.com/fallenbagel/jellyseerr/issues/1251)
* **setup:** fix continue button disabled on refresh in setup 3 ([#1211](https://github.com/fallenbagel/jellyseerr/issues/1211)) ([0b331ca](https://github.com/fallenbagel/jellyseerr/commit/0b331ca579c75e546dcdbf0f1896e0f0ec3a89f1))
* **setup:** plex library setting validation ([#1233](https://github.com/fallenbagel/jellyseerr/issues/1233)) ([b8dbfaa](https://github.com/fallenbagel/jellyseerr/commit/b8dbfaaed083734b05a28a05bf100941dc673ea7))
* specify cached image type ([#1237](https://github.com/fallenbagel/jellyseerr/issues/1237)) ([d71ee58](https://github.com/fallenbagel/jellyseerr/commit/d71ee58302fe95c9c79e27b4edf317a98faf6f5c))
* **ui:** resolve streaming region dropdown overlap ([#1210](https://github.com/fallenbagel/jellyseerr/issues/1210)) ([2f0e493](https://github.com/fallenbagel/jellyseerr/commit/2f0e4932572497322df0d7d7f4377aeb9cc35d5b)), closes [#1206](https://github.com/fallenbagel/jellyseerr/issues/1206)
* **users:** correct request count query for PostgreSQL compatibility ([#1213](https://github.com/fallenbagel/jellyseerr/issues/1213)) ([f3ebf60](https://github.com/fallenbagel/jellyseerr/commit/f3ebf6028b23f803a1c8801b1541a444e8856421))


### Features

* Add latest tag to ghcr container image ([#1224](https://github.com/fallenbagel/jellyseerr/issues/1224)) ([b9dc9bc](https://github.com/fallenbagel/jellyseerr/commit/b9dc9bceb5805889c1ea3157c3ace880865eaf9c))
* Add release charts workflow ([#1140](https://github.com/fallenbagel/jellyseerr/issues/1140)) ([3cc34b0](https://github.com/fallenbagel/jellyseerr/commit/3cc34b0db6b868a6133408a69a60b7eab69d9ea3))
* **settings:** add settings for custom DNS servers and IPv4 resolution first ([#1266](https://github.com/fallenbagel/jellyseerr/issues/1266)) ([7fcc0eb](https://github.com/fallenbagel/jellyseerr/commit/7fcc0eb66d907e74b72197d6abee511150ab5e1e))

# [2.3.0](https://github.com/fallenbagel/jellyseerr/compare/v2.2.3...v2.3.0) (2025-01-16)


### Bug Fixes

* correct typos for the special episodes setting ([#1209](https://github.com/fallenbagel/jellyseerr/issues/1209)) ([ebe7d11](https://github.com/fallenbagel/jellyseerr/commit/ebe7d11a5393f3d444dd9613854d6054af1ec58b)), closes [#1193](https://github.com/fallenbagel/jellyseerr/issues/1193) [#1208](https://github.com/fallenbagel/jellyseerr/issues/1208)
* **externalapi:** clear cache after a request is made ([#1217](https://github.com/fallenbagel/jellyseerr/issues/1217)) ([f718cec](https://github.com/fallenbagel/jellyseerr/commit/f718cec23fccbfd16fdb792c2778cd543b751799)), closes [#1207](https://github.com/fallenbagel/jellyseerr/issues/1207)
* **jellyfinlogin:** add proper error message when no admin user exists ([#1216](https://github.com/fallenbagel/jellyseerr/issues/1216)) ([ac90802](https://github.com/fallenbagel/jellyseerr/commit/ac908026dbb7ca06c0fb520bbb360120d6b87feb))
* optimize media status update to avoid lifecycle hook triggers ([#1218](https://github.com/fallenbagel/jellyseerr/issues/1218)) ([656cd91](https://github.com/fallenbagel/jellyseerr/commit/656cd91c9c90e57914b7fedb097f29e21fb18090))
* **overriderules:** allow override rules only when the service is created ([#1259](https://github.com/fallenbagel/jellyseerr/issues/1259)) ([ce1b39f](https://github.com/fallenbagel/jellyseerr/commit/ce1b39f73b953b6fa0a00948e72d24c43476bc5f))
* prevent TypeORM subscribers from calling itself over and over ([#1215](https://github.com/fallenbagel/jellyseerr/issues/1215)) ([d67ec57](https://github.com/fallenbagel/jellyseerr/commit/d67ec571c5950f04b85f5a268b38eb026a156320))
* resolve plex user mismatch due to caching issues ([#1242](https://github.com/fallenbagel/jellyseerr/issues/1242)) ([131a5a2](https://github.com/fallenbagel/jellyseerr/commit/131a5a2b0b1a235599940affc183b93c36f12ade)), closes [#1227](https://github.com/fallenbagel/jellyseerr/issues/1227)
* **settingsmigrator:** prevent region migration from running multiple times ([#1255](https://github.com/fallenbagel/jellyseerr/issues/1255)) ([1c6f536](https://github.com/fallenbagel/jellyseerr/commit/1c6f5362d773c850a5e58b5013f0d65474467e9c)), closes [#1251](https://github.com/fallenbagel/jellyseerr/issues/1251)
* **setup:** fix continue button disabled on refresh in setup 3 ([#1211](https://github.com/fallenbagel/jellyseerr/issues/1211)) ([0b331ca](https://github.com/fallenbagel/jellyseerr/commit/0b331ca579c75e546dcdbf0f1896e0f0ec3a89f1))
* **setup:** plex library setting validation ([#1233](https://github.com/fallenbagel/jellyseerr/issues/1233)) ([b8dbfaa](https://github.com/fallenbagel/jellyseerr/commit/b8dbfaaed083734b05a28a05bf100941dc673ea7))
* specify cached image type ([#1237](https://github.com/fallenbagel/jellyseerr/issues/1237)) ([d71ee58](https://github.com/fallenbagel/jellyseerr/commit/d71ee58302fe95c9c79e27b4edf317a98faf6f5c))
* **ui:** resolve streaming region dropdown overlap ([#1210](https://github.com/fallenbagel/jellyseerr/issues/1210)) ([2f0e493](https://github.com/fallenbagel/jellyseerr/commit/2f0e4932572497322df0d7d7f4377aeb9cc35d5b)), closes [#1206](https://github.com/fallenbagel/jellyseerr/issues/1206)
* **users:** correct request count query for PostgreSQL compatibility ([#1213](https://github.com/fallenbagel/jellyseerr/issues/1213)) ([f3ebf60](https://github.com/fallenbagel/jellyseerr/commit/f3ebf6028b23f803a1c8801b1541a444e8856421))


### Features

* Add latest tag to ghcr container image ([#1224](https://github.com/fallenbagel/jellyseerr/issues/1224)) ([b9dc9bc](https://github.com/fallenbagel/jellyseerr/commit/b9dc9bceb5805889c1ea3157c3ace880865eaf9c))
* Add release charts workflow ([#1140](https://github.com/fallenbagel/jellyseerr/issues/1140)) ([3cc34b0](https://github.com/fallenbagel/jellyseerr/commit/3cc34b0db6b868a6133408a69a60b7eab69d9ea3))
* **settings:** add settings for custom DNS servers and IPv4 resolution first ([#1266](https://github.com/fallenbagel/jellyseerr/issues/1266)) ([7fcc0eb](https://github.com/fallenbagel/jellyseerr/commit/7fcc0eb66d907e74b72197d6abee511150ab5e1e))

## [2.2.3](https://github.com/fallenbagel/jellyseerr/compare/v2.2.2...v2.2.3) (2024-12-30)


### Bug Fixes

* properly fetch sonarr/radarr specific override rules ([#1199](https://github.com/fallenbagel/jellyseerr/issues/1199)) ([814a735](https://github.com/fallenbagel/jellyseerr/commit/814a7357c0c7418091e8d3e911adc403811c9dfe))
* **usersettings:** fix the streaming region setting toggling itself ([#1203](https://github.com/fallenbagel/jellyseerr/issues/1203)) ([7e94ad7](https://github.com/fallenbagel/jellyseerr/commit/7e94ad721026a03d3ae640ee2deb60e321cabf10)), closes [#1200](https://github.com/fallenbagel/jellyseerr/issues/1200)

## [2.2.2](https://github.com/fallenbagel/jellyseerr/compare/v2.2.1...v2.2.2) (2024-12-30)


### Bug Fixes

* **overriderules:** apply override rules to tv shows during request ([#1198](https://github.com/fallenbagel/jellyseerr/issues/1198)) ([f8a8ebd](https://github.com/fallenbagel/jellyseerr/commit/f8a8ebdf76f939ccc28ce7b39343e3a606c90b33)), closes [#1197](https://github.com/fallenbagel/jellyseerr/issues/1197) [#1195](https://github.com/fallenbagel/jellyseerr/issues/1195)

## [2.2.1](https://github.com/fallenbagel/jellyseerr/compare/v2.2.0...v2.2.1) (2024-12-30)


### Bug Fixes

* **overriderules:** apply override rules during request only for non-admin/non-auto-approve users ([#1197](https://github.com/fallenbagel/jellyseerr/issues/1197)) ([8da4870](https://github.com/fallenbagel/jellyseerr/commit/8da48709977fa0111225c3519f9128bea41867fc)), closes [#1195](https://github.com/fallenbagel/jellyseerr/issues/1195)

# [2.2.0](https://github.com/fallenbagel/jellyseerr/compare/v2.1.0...v2.2.0) (2024-12-29)


### Bug Fixes

* **avatarproxy:** add support for Emby avatars ([#1128](https://github.com/fallenbagel/jellyseerr/issues/1128)) ([17418f8](https://github.com/fallenbagel/jellyseerr/commit/17418f82af53362338aebe9602373a3c8fa027f7)), closes [#1101](https://github.com/fallenbagel/jellyseerr/issues/1101)
* **blacklist:** remove a "undefined" appearing when the blacklist modal closes ([#1142](https://github.com/fallenbagel/jellyseerr/issues/1142)) ([b01f98f](https://github.com/fallenbagel/jellyseerr/commit/b01f98f7e280a037eba303eeaa836f6623daa440))
* **discover:** display recent requests even if there is an error with *arr ([#1141](https://github.com/fallenbagel/jellyseerr/issues/1141)) ([fa443c0](https://github.com/fallenbagel/jellyseerr/commit/fa443c05bedfca8208bfb05ab02c3b0e678e4ca0))
* **discover:** resolve a typing issue with the WatchlistItem interface ([#1156](https://github.com/fallenbagel/jellyseerr/issues/1156)) ([de6e591](https://github.com/fallenbagel/jellyseerr/commit/de6e591baedacb33704216842dddaa2b96bfae19))
* **emby:** change default value of Accept-Encoding header ([#1157](https://github.com/fallenbagel/jellyseerr/issues/1157)) ([7c734bc](https://github.com/fallenbagel/jellyseerr/commit/7c734bc8732a511e62edfcc371028ead6b6f1b12))
* fix PostgreSQL migrations and TelegramMessageThreadId migration ([#1171](https://github.com/fallenbagel/jellyseerr/issues/1171)) ([0491a04](https://github.com/fallenbagel/jellyseerr/commit/0491a04ef1816e81bb495746cc529fc621e4e147))
* handle non-existent rottentomatoes rating for movies ([#1169](https://github.com/fallenbagel/jellyseerr/issues/1169)) ([347a24a](https://github.com/fallenbagel/jellyseerr/commit/347a24a97b354725c4ccb3b5a07793b96ff60b80))
* remove non-null requirement for some fields ([#1175](https://github.com/fallenbagel/jellyseerr/issues/1175)) ([13d15d1](https://github.com/fallenbagel/jellyseerr/commit/13d15d1dcf4a80bc0b544fecbeced706f2dbd816)), closes [#628](https://github.com/fallenbagel/jellyseerr/issues/628)
* **requestlist:** use default value of sort direction only if valid ([#1174](https://github.com/fallenbagel/jellyseerr/issues/1174)) ([59c22cc](https://github.com/fallenbagel/jellyseerr/commit/59c22ccc089c960b523ccfb69efc680b2687c353)), closes [#1147](https://github.com/fallenbagel/jellyseerr/issues/1147)
* **server/settings:** write settings to a temp file then move to avoid corruption ([#1067](https://github.com/fallenbagel/jellyseerr/issues/1067)) ([01bbece](https://github.com/fallenbagel/jellyseerr/commit/01bbeced65b82f5041462cd7a6c9016274acade4))
* **ui:** allow thetvdb images for unmatched series ([#1105](https://github.com/fallenbagel/jellyseerr/issues/1105)) ([9b151fe](https://github.com/fallenbagel/jellyseerr/commit/9b151feb4f44d631b44c88c089f184c4c93161c5)), closes [#1075](https://github.com/fallenbagel/jellyseerr/issues/1075)
* **ui:** display Rotten Tomatoes for 0% ratings ([#1178](https://github.com/fallenbagel/jellyseerr/issues/1178)) ([5345207](https://github.com/fallenbagel/jellyseerr/commit/534520794071d8530d6325460e61dabfcb46fbf0)), closes [#1166](https://github.com/fallenbagel/jellyseerr/issues/1166)
* **ui:** resize streaming service logos ([#1106](https://github.com/fallenbagel/jellyseerr/issues/1106)) ([fe5d016](https://github.com/fallenbagel/jellyseerr/commit/fe5d016929d18c38aef7a3d48e4828188131e025)), closes [#1103](https://github.com/fallenbagel/jellyseerr/issues/1103)
* use less strict validation for external URLs ([#1104](https://github.com/fallenbagel/jellyseerr/issues/1104)) ([14f316a](https://github.com/fallenbagel/jellyseerr/commit/14f316a9a6d91c25c43e07ae66923785f90b1fdf)), closes [#1068](https://github.com/fallenbagel/jellyseerr/issues/1068)
* use links instead of buttons for external links in movie/tv details page ([#923](https://github.com/fallenbagel/jellyseerr/issues/923)) ([5776715](https://github.com/fallenbagel/jellyseerr/commit/57767156f79cb0bcb761f6fc0907d747f126e146))
* use tmdb first as metadata provider and fallback to tvdb ([#1138](https://github.com/fallenbagel/jellyseerr/issues/1138)) ([84fd884](https://github.com/fallenbagel/jellyseerr/commit/84fd884052ea2177c92d144367c4b4ed1dde3b73)), closes [#1137](https://github.com/fallenbagel/jellyseerr/issues/1137)
* **usediscover hook:** fixing duplicate movies ([#708](https://github.com/fallenbagel/jellyseerr/issues/708)) ([39dbb7f](https://github.com/fallenbagel/jellyseerr/commit/39dbb7f7e59cf4b1b5f029089c6b1ea6a0d7e5f5))
* **usersettings:** allow unset email and add more explicit email error message ([#1096](https://github.com/fallenbagel/jellyseerr/issues/1096)) ([39a5ccb](https://github.com/fallenbagel/jellyseerr/commit/39a5ccb7f3a6ed4e93b12e11021bb30515936ce7))


### Features

* add a setting for special episodes ([#1193](https://github.com/fallenbagel/jellyseerr/issues/1193)) ([b6e2e6c](https://github.com/fallenbagel/jellyseerr/commit/b6e2e6ce615cb94cea8d2335140fe245a0ca2d8a))
* add postgres support + migrations ([#628](https://github.com/fallenbagel/jellyseerr/issues/628)) ([44a9221](https://github.com/fallenbagel/jellyseerr/commit/44a9221a9dca501fa57c0bcbd743aed9889059ff)), closes [#186](https://github.com/fallenbagel/jellyseerr/issues/186)
* **helm:** add base helm chart ([#1116](https://github.com/fallenbagel/jellyseerr/issues/1116)) ([27e3d46](https://github.com/fallenbagel/jellyseerr/commit/27e3d465bd7eaa3f382c961220f8af1860a15c7f))
* **notifications:** added telegram thread id's ([#1145](https://github.com/fallenbagel/jellyseerr/issues/1145)) ([d76d794](https://github.com/fallenbagel/jellyseerr/commit/d76d79441142ccc6fe2357549f39a1fba3546ff9))
* **notifications:** improve discord notifications ([#1102](https://github.com/fallenbagel/jellyseerr/issues/1102)) ([5c24e79](https://github.com/fallenbagel/jellyseerr/commit/5c24e79b1dddc3c8421e57e67302fa3dc064f87f))
* override rules ([#945](https://github.com/fallenbagel/jellyseerr/issues/945)) ([9a59529](https://github.com/fallenbagel/jellyseerr/commit/9a595296dbdd00bb3477052b53412e6019667740))
* **requestlist:** sort direction ([#1147](https://github.com/fallenbagel/jellyseerr/issues/1147)) ([66a5ab4](https://github.com/fallenbagel/jellyseerr/commit/66a5ab41ab646501f72a658782e8a89f9faf939f))
* **usersettings:** add separate setting for streaming region ([#993](https://github.com/fallenbagel/jellyseerr/issues/993)) ([89831f7](https://github.com/fallenbagel/jellyseerr/commit/89831f70909df0a76dfa8a027702e4e5f9b57be8)), closes [#890](https://github.com/fallenbagel/jellyseerr/issues/890)

# [2.1.0](https://github.com/fallenbagel/jellyseerr/compare/v2.0.1...v2.1.0) (2024-11-12)


### Bug Fixes

* **blacklist:** request data only when modal is shown, remove useless ratelimit and lazy load blacklist ([#1084](https://github.com/fallenbagel/jellyseerr/issues/1084)) ([694913c](https://github.com/fallenbagel/jellyseerr/commit/694913c767c558147f413e2375b2512567541127))
* cache Jellyfin/Emby avatars from API ([#1045](https://github.com/fallenbagel/jellyseerr/issues/1045)) ([0bbcfcb](https://github.com/fallenbagel/jellyseerr/commit/0bbcfcbd5e03137aba35ceb07e42f623aefa41d7))
* **externalapi:** extract basic auth and pass it through header ([#1062](https://github.com/fallenbagel/jellyseerr/issues/1062)) ([cf59102](https://github.com/fallenbagel/jellyseerr/commit/cf59102ef91fa0e907cc6369b0fe60b503c823ca)), closes [#1027](https://github.com/fallenbagel/jellyseerr/issues/1027)
* fixes wrong avatar rendered for the modifiedBy user in request list ([#1028](https://github.com/fallenbagel/jellyseerr/issues/1028)) ([cbb1a74](https://github.com/fallenbagel/jellyseerr/commit/cbb1a74526ef5c003b7081c31146c52e7e551d60)), closes [#1017](https://github.com/fallenbagel/jellyseerr/issues/1017)
* **i18n:** update extractMessages function for better escaping of characters ([#1079](https://github.com/fallenbagel/jellyseerr/issues/1079)) ([a2d2fd3](https://github.com/fallenbagel/jellyseerr/commit/a2d2fd3c2a53fc98d6288bd049fd8e37a1914280))
* remove language profiles dropdown for Sonarr v4 ([#1000](https://github.com/fallenbagel/jellyseerr/issues/1000)) ([d331798](https://github.com/fallenbagel/jellyseerr/commit/d331798b28a7bd32a27fc0ccbad2354be2e15b02)), closes [#207](https://github.com/fallenbagel/jellyseerr/issues/207)
* resolve error when setup on second attempt ([#1061](https://github.com/fallenbagel/jellyseerr/issues/1061)) ([64f4610](https://github.com/fallenbagel/jellyseerr/commit/64f4610b9ffcad01c24ecdd81b8b3a2f3db4c98d))
* **setup:** add leading slash validation for baseUrl ([#1083](https://github.com/fallenbagel/jellyseerr/issues/1083)) ([2829c25](https://github.com/fallenbagel/jellyseerr/commit/2829c2548aa0cd03f92433d3bc3b9b2739e98486))
* update i18n translations ([#1090](https://github.com/fallenbagel/jellyseerr/issues/1090)) ([f25b32a](https://github.com/fallenbagel/jellyseerr/commit/f25b32aec8ec3c2fd40ccfc6a83f18ddc99c1a15))
* use fs/promises for settings ([#1057](https://github.com/fallenbagel/jellyseerr/issues/1057)) ([f2ed101](https://github.com/fallenbagel/jellyseerr/commit/f2ed101e522561dab8563b744d908ff036c957c5))


### Features

* add a warning if permissions are missing from config folder ([#1030](https://github.com/fallenbagel/jellyseerr/issues/1030)) ([f2b6315](https://github.com/fallenbagel/jellyseerr/commit/f2b63156d1d4aa903eb261d2c80c059c39d9091b))
* add bypass list, bypass local addresses and username/password to proxy setting ([#1059](https://github.com/fallenbagel/jellyseerr/issues/1059)) ([ca838a0](https://github.com/fallenbagel/jellyseerr/commit/ca838a00fa4acb0ccdfbac8be4cf7fde493346f7))
* add more logs to migrations and create a settings backup ([#1036](https://github.com/fallenbagel/jellyseerr/issues/1036)) ([326001c](https://github.com/fallenbagel/jellyseerr/commit/326001c3ecc92dc730f327130a71e797882a62b9))
* exit Jellyseerr when migration fails ([#1026](https://github.com/fallenbagel/jellyseerr/issues/1026)) ([a2b3408](https://github.com/fallenbagel/jellyseerr/commit/a2b3408c9aa5e22e1193f535c969325254f08193))
* proxy setting ([#1031](https://github.com/fallenbagel/jellyseerr/issues/1031)) ([4b4eeb6](https://github.com/fallenbagel/jellyseerr/commit/4b4eeb6ec707e0971fe8745910edbfb546bf25fe))

## [2.0.1](https://github.com/fallenbagel/jellyseerr/compare/v2.0.0...v2.0.1) (2024-10-17)


### Bug Fixes

* fetch override to attach XSRF token to fix csrfProtection issue ([#1014](https://github.com/fallenbagel/jellyseerr/issues/1014)) ([4945b54](https://github.com/fallenbagel/jellyseerr/commit/4945b5429848b36fc0ee41cf0277ed79f53d8286)), closes [#1011](https://github.com/fallenbagel/jellyseerr/issues/1011)
* handle non-existent rottentomatoes rating ([#1018](https://github.com/fallenbagel/jellyseerr/issues/1018)) ([a351264](https://github.com/fallenbagel/jellyseerr/commit/a351264b878b2660ae7a6415f26d38b52015c591))
* rewrite avatarproxy and CachedImage ([#1016](https://github.com/fallenbagel/jellyseerr/issues/1016)) ([4e48fdf](https://github.com/fallenbagel/jellyseerr/commit/4e48fdf2cb9f76ae5c25073b585718650abd3288)), closes [#1012](https://github.com/fallenbagel/jellyseerr/issues/1012) [#1013](https://github.com/fallenbagel/jellyseerr/issues/1013)
* use jellyfinMediaId4k for mediaUrl4k ([#1006](https://github.com/fallenbagel/jellyseerr/issues/1006)) ([a0f80fe](https://github.com/fallenbagel/jellyseerr/commit/a0f80fe7647ef4a9025ca93407cd21ddc640fed1)), closes [#520](https://github.com/fallenbagel/jellyseerr/issues/520)

# [2.0.0](https://github.com/fallenbagel/jellyseerr/compare/v1.9.2...v2.0.0) (2024-10-15)


### Bug Fixes

* abort availability sync job if auth token invalid/connection lost ([#845](https://github.com/fallenbagel/jellyseerr/issues/845)) ([bdee340](https://github.com/fallenbagel/jellyseerr/commit/bdee34053080c8975a88ba16a9e8f402e10fe7e1))
* add an error message to say when an email is already taken ([#947](https://github.com/fallenbagel/jellyseerr/issues/947)) ([89e0a83](https://github.com/fallenbagel/jellyseerr/commit/89e0a831ec85a6905f539f59b7523bb1feb90bcf))
* add missing brackets ([#888](https://github.com/fallenbagel/jellyseerr/issues/888)) ([6cea8bb](https://github.com/fallenbagel/jellyseerr/commit/6cea8bba592b8db566b4d8147630385f5c377f1b))
* add missing content-type header ([#887](https://github.com/fallenbagel/jellyseerr/issues/887)) ([2be9c7d](https://github.com/fallenbagel/jellyseerr/commit/2be9c7dcc1f418726a19e99cfdb3933257a03c6f))
* add missing header when creating an issue ([#879](https://github.com/fallenbagel/jellyseerr/issues/879)) ([084e1b2](https://github.com/fallenbagel/jellyseerr/commit/084e1b224e109f0f8279741b9a5ead138396d7f8))
* add missing parameter to delete requests from ExternalAPI ([#904](https://github.com/fallenbagel/jellyseerr/issues/904)) ([36d98a2](https://github.com/fallenbagel/jellyseerr/commit/36d98a2681921a8770027b78878688f2782e8b77)), closes [#903](https://github.com/fallenbagel/jellyseerr/issues/903)
* **api:** fix nextjs error handler ([#882](https://github.com/fallenbagel/jellyseerr/issues/882)) ([0116c13](https://github.com/fallenbagel/jellyseerr/commit/0116c13e0632d1ccec43299fbb10cd71db45bc29))
* **api:** handle non-existent ratings on IMDb ([#822](https://github.com/fallenbagel/jellyseerr/issues/822)) ([74a2d25](https://github.com/fallenbagel/jellyseerr/commit/74a2d25f153b07a0cae5b44adca5fa1fed5a3b9e))
* **api:** save new password when reset password of local account ([#886](https://github.com/fallenbagel/jellyseerr/issues/886)) ([5cc4389](https://github.com/fallenbagel/jellyseerr/commit/5cc43898256b130c2576f34a3d4e7ce6a3940d3e))
* **blacklist:** add blacklist to mobile menu ([#980](https://github.com/fallenbagel/jellyseerr/issues/980)) ([f390da4](https://github.com/fallenbagel/jellyseerr/commit/f390da486625a22951956ba96867de63f73bfc2b)), closes [#979](https://github.com/fallenbagel/jellyseerr/issues/979)
* change SeriesSearch to MissingEpisodeSearch for season requests ([#711](https://github.com/fallenbagel/jellyseerr/issues/711)) ([ee7e91c](https://github.com/fallenbagel/jellyseerr/commit/ee7e91c7c948b17b556a625919eb1252a721bb6e))
* **docker:** add postinstall script ([#839](https://github.com/fallenbagel/jellyseerr/issues/839)) ([f714132](https://github.com/fallenbagel/jellyseerr/commit/f7141329094d88eb0940b1db1f21376142cb8893))
* enhance error messages when Fetch API fails ([#893](https://github.com/fallenbagel/jellyseerr/issues/893)) ([fccfca6](https://github.com/fallenbagel/jellyseerr/commit/fccfca6ed06c8dc599e1ea4b1b3dbac48eb3a7f6))
* handle status badge for season packs ([#927](https://github.com/fallenbagel/jellyseerr/issues/927)) ([80f6301](https://github.com/fallenbagel/jellyseerr/commit/80f63017ac5e9b1720a19c761dbef4dd517f1c2c))
* length of undefined on users warnings ([#875](https://github.com/fallenbagel/jellyseerr/issues/875)) ([c600566](https://github.com/fallenbagel/jellyseerr/commit/c600566ac0045c2314f9013b063007b087ee4327))
* remove DNS caching ([#837](https://github.com/fallenbagel/jellyseerr/issues/837)) ([268c7df](https://github.com/fallenbagel/jellyseerr/commit/268c7df28eea8b911d6a53297f5ce296983067ce))
* remove email requirement for the user, and use the username if no email provided ([#900](https://github.com/fallenbagel/jellyseerr/issues/900)) ([d5f817e](https://github.com/fallenbagel/jellyseerr/commit/d5f817e734131cdacc229361d9498a095af57950))
* remove protocol-relative URLs from next/image ([#889](https://github.com/fallenbagel/jellyseerr/issues/889)) ([c80d9a8](https://github.com/fallenbagel/jellyseerr/commit/c80d9a853a2a3451293a5382ef183c18add0c040))
* resize episode preview image ([#842](https://github.com/fallenbagel/jellyseerr/issues/842)) ([96ba53f](https://github.com/fallenbagel/jellyseerr/commit/96ba53fecc7b9d269f0d974051ab62836b0102bc))
* resize header image in network and studio pages ([#902](https://github.com/fallenbagel/jellyseerr/issues/902)) ([4220855](https://github.com/fallenbagel/jellyseerr/commit/422085523e5dfc132f3c3ca19eaa87117828b7be))
* rewrite request from axios to Fetch ([#920](https://github.com/fallenbagel/jellyseerr/issues/920)) ([9aee888](https://github.com/fallenbagel/jellyseerr/commit/9aee8887d3cca6e018f4be1c8400c22e86bf8dab))
* rewrite the rate limit utility ([#896](https://github.com/fallenbagel/jellyseerr/issues/896)) ([3fc14c9](https://github.com/fallenbagel/jellyseerr/commit/3fc14c9e2262463afec666e7f54e38d0d36cff68))
* **session:** set the correct TTL for the cookie store ([#992](https://github.com/fallenbagel/jellyseerr/issues/992)) ([96e1d40](https://github.com/fallenbagel/jellyseerr/commit/96e1d40304749ce00d2ff7359efc39a1d9724358)), closes [#991](https://github.com/fallenbagel/jellyseerr/issues/991)
* set correct user type when importing from emby ([#949](https://github.com/fallenbagel/jellyseerr/issues/949)) ([e57d265](https://github.com/fallenbagel/jellyseerr/commit/e57d2654d1c634a91649722d3a2bf4d73c4a02ca)), closes [#948](https://github.com/fallenbagel/jellyseerr/issues/948)
* **setup:** page display when homepage is loading ([#940](https://github.com/fallenbagel/jellyseerr/issues/940)) ([7423bbb](https://github.com/fallenbagel/jellyseerr/commit/7423bbbffc5bee2e52e3348254f035dc8527d973))
* **tmdb:** fallback movie/show overview to English when none is available in requested locale ([#928](https://github.com/fallenbagel/jellyseerr/issues/928)) ([12f908d](https://github.com/fallenbagel/jellyseerr/commit/12f908de7f5fbd717a5f151858b6edee3be13ed9)), closes [#925](https://github.com/fallenbagel/jellyseerr/issues/925)
* update the filter removing existing users from Jellyfin import modal ([#924](https://github.com/fallenbagel/jellyseerr/issues/924)) ([61dcd8e](https://github.com/fallenbagel/jellyseerr/commit/61dcd8e487d7886773ccb12501623c17838476e5))


### Code Refactoring

* **jellyfin:** abstract jellyfin hostname, updated ui to reflect it, better validation ([#773](https://github.com/fallenbagel/jellyseerr/issues/773)) ([38ad875](https://github.com/fallenbagel/jellyseerr/commit/38ad875dd7848b4e92ac3ccdd16dbf785f6a5c4d))


### Features

* add environment variable for API key ([#831](https://github.com/fallenbagel/jellyseerr/issues/831)) ([45ef150](https://github.com/fallenbagel/jellyseerr/commit/45ef150e36944d456cc9440574b5ac75f2e4bbc1))
* adds status filter for tv shows ([#796](https://github.com/fallenbagel/jellyseerr/issues/796)) ([cfd1bc2](https://github.com/fallenbagel/jellyseerr/commit/cfd1bc253557d6e19725743b8aa9a2fa33bbe760)), closes [#605](https://github.com/fallenbagel/jellyseerr/issues/605)
* allow request managers to delete data from sonarr/radarr ([#644](https://github.com/fallenbagel/jellyseerr/issues/644)) ([a5d22ba](https://github.com/fallenbagel/jellyseerr/commit/a5d22ba5b83dd0e812b16f06476d993b5d59cb2a))
* blacklist items from Discover page ([#632](https://github.com/fallenbagel/jellyseerr/issues/632)) ([818aa60](https://github.com/fallenbagel/jellyseerr/commit/818aa60aac185da07bfb71b08e0448939b63a736)), closes [#490](https://github.com/fallenbagel/jellyseerr/issues/490)
* Jellyfin/Emby server type setup ([#685](https://github.com/fallenbagel/jellyseerr/issues/685)) ([15cb949](https://github.com/fallenbagel/jellyseerr/commit/15cb949f1f2e617853f90ae7bb8ae5d6622f610e))
* **jellyfinapi:** switch to API tokens instead of auth tokens ([#868](https://github.com/fallenbagel/jellyseerr/issues/868)) ([bd4da6d](https://github.com/fallenbagel/jellyseerr/commit/bd4da6d5fc8cb55c2bc3d9a8336787cbd30814d0))
* Option on item's page to add/remove from watchlist ([#781](https://github.com/fallenbagel/jellyseerr/issues/781)) ([2348f23](https://github.com/fallenbagel/jellyseerr/commit/2348f23f433195d64dee3e6eeede296fca5fdbc9)), closes [#730](https://github.com/fallenbagel/jellyseerr/issues/730)
* refresh monitored downloads before getting queue items ([#994](https://github.com/fallenbagel/jellyseerr/issues/994)) ([92ba262](https://github.com/fallenbagel/jellyseerr/commit/92ba26207dcb1ddd696e0f01931d2609c521ae45)), closes [#866](https://github.com/fallenbagel/jellyseerr/issues/866)
* show quality profile on request ([#847](https://github.com/fallenbagel/jellyseerr/issues/847)) ([6445332](https://github.com/fallenbagel/jellyseerr/commit/64453320d36595e75dcb710dfd43997bf2d2acd5))
* **translation:** added full Hebrew translation ([#871](https://github.com/fallenbagel/jellyseerr/issues/871)) ([c96ca67](https://github.com/fallenbagel/jellyseerr/commit/c96ca6742e0a6d5685319c52f995fe06e439a450))
* update Plex logo ([#884](https://github.com/fallenbagel/jellyseerr/issues/884)) ([3a363ae](https://github.com/fallenbagel/jellyseerr/commit/3a363ae1ffa7f384be6f7d25f8558b1e55a73fb3))


### Reverts

* fix(api): fix nextjs error handler ([#882](https://github.com/fallenbagel/jellyseerr/issues/882)) ([#892](https://github.com/fallenbagel/jellyseerr/issues/892)) ([62dbde4](https://github.com/fallenbagel/jellyseerr/commit/62dbde448c7f7d530de8534bb8538452d0f91276))


### BREAKING CHANGES

* This commit deprecates the JELLYFIN_TYPE variable to identify Emby media server and
instead rely on the mediaServerType that is set in the `settings.json`. Existing environment
variable users can log out and log back in to set the mediaServerType to `3` (Emby).

* feat(api): add severType to the api
* This adds a serverType to the `/auth/jellyfin` which requires a serverType to be
set (`jellyfin`/`emby`)

* refactor: use enums for serverType and rename selectedservice to serverType

* refactor(auth): jellyfin/emby authentication to set MediaServerType

* fix: issue page formatMessage for 4k media

* refactor: cleaner way of handling serverType change using MediaServerType instead of strings

instead of using strings now it will use MediaServerType enums for serverType

* revert: removed conditional render of the auto-request permission

reverts the conditional render toshow the auto-request permission if the mediaServerType was set to
Plex as this should be handled in a different PR and Cypress tests should be modified
accordingly(currently cypress test would fail if this conditional check is there)

* feat: add server type step to setup

* feat: migrate existing emby setups to use emby mediaServerType

* fix: scan jobs not running when media server type is emby

* fix: emby media server type migration

* refactor: change emby logo to full logo

* style: decrease emby logo size in setup screen

* refactor: use title case for servertype i18n message

* refactor(i18n): fix a typo

* refactor: use enums instead of numbers

* fix: remove old references to JELLYFIN_TYPE environment variable

* fix: go back to the last step when refresh the setup page

* fix: move "scanning in background" tip next to the scanning section

* fix: redirect the setup page when Jellyseerr is already setup
* **jellyfin:** Jellyfin settings now does not include a hostname. Instead it abstracted it to ip,
port, useSsl, and urlBase. However, migration of old settings to new settings should work
automatically.

* refactor: remove console logs and use getHostname and ApiErrorCodes

* fix: store req.body jellyfin settings temporarily and store only if valid

This should fix the issue where settings are saved even if the url
was invalid. Now the settings will only be saved if the url is
valid. Sort of like a test connection.

* refactor: clean up commented out code

* refactor(i18n): extract translation keys

* fix(auth): auth failing with jellyfin login is disabled

* fix(settings): jellyfin migrations replacing the rest of the settings

* fix(settings): jellyfin hostname should be carried out if hostname exists

* fix(settings): merging the wrong settings source

* refactor(settings): use migrator for dynamic settings migrations

* refactor(settingsmigrator): settings migration handler and the migrations

* test(cypress): fix cypress tests failing

cypress settings were lacking some of the jobs so when the startJobs() is called when the app
starts, it was failing to schedule the jobs where their cron timings were not specified in the
cypress settings. Therefore, this commit adds those jobs back. In addition, other setting options
were added to keep cypress settings consistent with a normal user.

* chore(prettierignore): ignore cypress/config/settings.cypress.json as it does not need prettier

* chore(prettier): ran formatter on cypress config to fix format check error

format check locally passes on this file. However, it fails during the github actions format check.
Therefore, json language features formatter was run instead of prettier to see if that fixes the
issue.

* test(cypress): add only missing jobs to the cypress settings

* ci: attempt at trying to get formatter to pass on cypress config json file

* refactor: revert the changes brought to try and fix formatter

added back the rest of the cypress settings and removed cypress settings from .prettierignore

* refactor(settings): better erorr logging when jellyfin connection test fails in settings page

## [1.9.2](https://github.com/fallenbagel/jellyseerr/compare/v1.9.1...v1.9.2) (2024-06-13)


### Bug Fixes

* **auth:** improve login resilience with headerless fallback authentication ([#814](https://github.com/fallenbagel/jellyseerr/issues/814)) ([a9741fa](https://github.com/fallenbagel/jellyseerr/commit/a9741fa36d06710aa00d28db3dd2c29f2b0973d3))
* **auth:** validation of ipv6/ipv4 ([#812](https://github.com/fallenbagel/jellyseerr/issues/812)) ([9aeb360](https://github.com/fallenbagel/jellyseerr/commit/9aeb3604e6498c388df1d30dd0b613ba84160fc0)), closes [#795](https://github.com/fallenbagel/jellyseerr/issues/795)
* bypass cache-able lookups when resolving localhost ([#813](https://github.com/fallenbagel/jellyseerr/issues/813)) ([b5a0699](https://github.com/fallenbagel/jellyseerr/commit/b5a069901a9545772deaa9c491f2075261da0189))

## [1.9.1](https://github.com/fallenbagel/jellyseerr/compare/v1.9.0...v1.9.1) (2024-06-12)


### Bug Fixes

* **api:** add DNS caching ([#810](https://github.com/fallenbagel/jellyseerr/issues/810)) ([46ee8a4](https://github.com/fallenbagel/jellyseerr/commit/46ee8a4ca13b026bd929b4027eb001cc74064bb8)), closes [#387](https://github.com/fallenbagel/jellyseerr/issues/387) [#657](https://github.com/fallenbagel/jellyseerr/issues/657) [#728](https://github.com/fallenbagel/jellyseerr/issues/728)
* empty email in user settings ([#807](https://github.com/fallenbagel/jellyseerr/issues/807)) ([20863d4](https://github.com/fallenbagel/jellyseerr/commit/20863d4a8dabe78fb5c52995b5bcb2da557a804e)), closes [#803](https://github.com/fallenbagel/jellyseerr/issues/803)
* **jellyfinscanner:** assign only 4k available badge for a 4k request instead of both badges ([#805](https://github.com/fallenbagel/jellyseerr/issues/805)) ([d31a2c3](https://github.com/fallenbagel/jellyseerr/commit/d31a2c37e639c1126b446277fa5d666d8102fef5))
* remove the settings button of media when useless ([#809](https://github.com/fallenbagel/jellyseerr/issues/809)) ([f52939e](https://github.com/fallenbagel/jellyseerr/commit/f52939e4cdcbee94fc35165f613f6b3e21599e3c))


### Reverts

* Revert "ci: update format check command to ignore .prettierignore files (#787)" (#788) ([4757f1c](https://github.com/fallenbagel/jellyseerr/commit/4757f1c3e599304410a737c11f97db92a2bfcefd)), closes [#787](https://github.com/fallenbagel/jellyseerr/issues/787) [#788](https://github.com/fallenbagel/jellyseerr/issues/788)

# [1.9.0](https://github.com/fallenbagel/jellyseerr/compare/v1.8.1...v1.9.0) (2024-05-29)


### Bug Fixes

* **api:** save user email on the first try ([#760](https://github.com/fallenbagel/jellyseerr/issues/760)) ([0bbcfdc](https://github.com/fallenbagel/jellyseerr/commit/0bbcfdc4f9ff9735f45232a2412ac8444f525de9)), closes [#227](https://github.com/fallenbagel/jellyseerr/issues/227) [#748](https://github.com/fallenbagel/jellyseerr/issues/748)
* **api:** small errors on overseerr-api.yaml ([#721](https://github.com/fallenbagel/jellyseerr/issues/721)) ([0eea109](https://github.com/fallenbagel/jellyseerr/commit/0eea1090dfdba4333646280c84b09b0197fefa74))
* **auth:** case-sensitive logins not updating authtokens ([#778](https://github.com/fallenbagel/jellyseerr/issues/778)) ([2bd125d](https://github.com/fallenbagel/jellyseerr/commit/2bd125d9a55d15a398ceb5f2996105a5e861b6e0))
* **jellyfinapi:** use external api class for jellyfin api requests ([#762](https://github.com/fallenbagel/jellyseerr/issues/762)) ([650c339](https://github.com/fallenbagel/jellyseerr/commit/650c339d74d4fe85ef7f76184901e86f4eeada85)), closes [#728](https://github.com/fallenbagel/jellyseerr/issues/728) [#387](https://github.com/fallenbagel/jellyseerr/issues/387)
* **logging:** handle media server connection refused error/toast ([#748](https://github.com/fallenbagel/jellyseerr/issues/748)) ([f486fb5](https://github.com/fallenbagel/jellyseerr/commit/f486fb5e75f9ea21456952b6a52cb841e30f3556))
* use UTF8 encoding for webhook JSON ([#714](https://github.com/fallenbagel/jellyseerr/issues/714)) ([c0a0b9c](https://github.com/fallenbagel/jellyseerr/commit/c0a0b9c8a8b0c2eeaf3fa9159f10742baa9f6c1f))


### Features

* add Latin American Spanish translation ([#725](https://github.com/fallenbagel/jellyseerr/issues/725)) ([783fda9](https://github.com/fallenbagel/jellyseerr/commit/783fda9621aef8ffd46e5f036136de82ed502ccc)), closes [#677](https://github.com/fallenbagel/jellyseerr/issues/677)
* add merge conflict labeler workflow ([#719](https://github.com/fallenbagel/jellyseerr/issues/719)) ([d9d07c7](https://github.com/fallenbagel/jellyseerr/commit/d9d07c705a24d5c49905066aac45a3c6a2e36a53))
* **auth:** send real information on login ([#470](https://github.com/fallenbagel/jellyseerr/issues/470)) ([d765055](https://github.com/fallenbagel/jellyseerr/commit/d765055da83ee94546399f6348aee14d8427d462))
* **settings:** stores jellyfin/emby server name in the settings ([#763](https://github.com/fallenbagel/jellyseerr/issues/763)) ([7a5e8d6](https://github.com/fallenbagel/jellyseerr/commit/7a5e8d69bf620c8e7bf5f284840b1a5fe757ae5f))

## [1.8.1](https://github.com/fallenbagel/jellyseerr/compare/v1.8.0...v1.8.1) (2024-04-17)


### Reverts

* Revert "fix: disable seasonfolder option in sonarr for jellyfin/Emby users" (#718) ([cd0fa3e](https://github.com/fallenbagel/jellyseerr/commit/cd0fa3e2232dcb522673143f113fc382fb2ff0a3)), closes [#718](https://github.com/fallenbagel/jellyseerr/issues/718)

# [1.8.0](https://github.com/fallenbagel/jellyseerr/compare/v1.7.0...v1.8.0) (2024-04-15)


### Bug Fixes

* correct width issue in datepicker of filterSliderOver ([f564cdd](https://github.com/fallenbagel/jellyseerr/commit/f564cddff4525ccebffbf304672d49c57aefe635)), closes [#415](https://github.com/fallenbagel/jellyseerr/issues/415)
* disable seasonfolder option in sonarr for jellyfin/Emby users ([8ec8f2a](https://github.com/fallenbagel/jellyseerr/commit/8ec8f2ac5730aad3b12dcd8ed95bb553b46b399c)), closes [#126](https://github.com/fallenbagel/jellyseerr/issues/126) [#575](https://github.com/fallenbagel/jellyseerr/issues/575)
* **embyauth:** remove the accidentally added mediaServerType change code from another PR ([#684](https://github.com/fallenbagel/jellyseerr/issues/684)) ([c2e8771](https://github.com/fallenbagel/jellyseerr/commit/c2e87714b4c4aa11bf68dcd82b76979f82990f3c))
* ensure watchlist updates are immediately reflected ([b85d7f3](https://github.com/fallenbagel/jellyseerr/commit/b85d7f37b931735ca2ad955dccb6599bf445fc73))
* fix german translation for "components.Discover.FilterSlideover.tmdbuservotecount" ([e032c02](https://github.com/fallenbagel/jellyseerr/commit/e032c02f5f84dc4b6b470eecb18ba2c376c55f37))
* fix the translations for watchlist permissions and userSettings page ([8c82a61](https://github.com/fallenbagel/jellyseerr/commit/8c82a61450a7525c0e2f1b64e6939da47a7c715d))
* **i18n:** fixed jellyfin jobs ([7eed236](https://github.com/fallenbagel/jellyseerr/commit/7eed23637ddfb10bdcb19698e7ae171f07299502))
* **jellyfin.ts:** process virtual seasons if they have non virtual episodes ([#639](https://github.com/fallenbagel/jellyseerr/issues/639)) ([db84f65](https://github.com/fallenbagel/jellyseerr/commit/db84f6529ab285be26c96daaab065dfabf347417))
* **jellyfinapi:** refactors jellyfin library sync to support automatic grouping and collections ([#700](https://github.com/fallenbagel/jellyseerr/issues/700)) ([3856061](https://github.com/fallenbagel/jellyseerr/commit/3856061fe1ee4d3457996586b4979ad9dd60765a)), closes [#450](https://github.com/fallenbagel/jellyseerr/issues/450) [#524](https://github.com/fallenbagel/jellyseerr/issues/524) [#256](https://github.com/fallenbagel/jellyseerr/issues/256) [#489](https://github.com/fallenbagel/jellyseerr/issues/489) [#450](https://github.com/fallenbagel/jellyseerr/issues/450) [#524](https://github.com/fallenbagel/jellyseerr/issues/524) [#515](https://github.com/fallenbagel/jellyseerr/issues/515) [#474](https://github.com/fallenbagel/jellyseerr/issues/474) [#473](https://github.com/fallenbagel/jellyseerr/issues/473)
* **jellyfinlogin:** use externalHostname if set for forgetpassword link ([405f6bb](https://github.com/fallenbagel/jellyseerr/commit/405f6bbb7ffc390327c99dcef2cbbf9b3bc75f01)), closes [#199](https://github.com/fallenbagel/jellyseerr/issues/199) [#424](https://github.com/fallenbagel/jellyseerr/issues/424) [#212](https://github.com/fallenbagel/jellyseerr/issues/212)
* **jellyfinscanner:** conditionally assign the jellyfinMediaId and jellyfinMediaId4k ([#686](https://github.com/fallenbagel/jellyseerr/issues/686)) ([530be42](https://github.com/fallenbagel/jellyseerr/commit/530be4272cce1b0d74d7f4156b8d794cda6ea03f)), closes [#681](https://github.com/fallenbagel/jellyseerr/issues/681)
* **langcode:** fixes the ukranian language code ([dc67aaa](https://github.com/fallenbagel/jellyseerr/commit/dc67aaaf53eae86ba20c6c2798c92ec40962d85f)), closes [#504](https://github.com/fallenbagel/jellyseerr/issues/504)
* nullable type for jellyfinMediaId(4k) ([#702](https://github.com/fallenbagel/jellyseerr/issues/702)) ([0900a95](https://github.com/fallenbagel/jellyseerr/commit/0900a95532501b6f4d9698de7530a771512924fc)), closes [#668](https://github.com/fallenbagel/jellyseerr/issues/668)
* request watchlist items sequentially to prevent bypassing quota ([#3667](https://github.com/fallenbagel/jellyseerr/issues/3667)) ([b40ba07](https://github.com/fallenbagel/jellyseerr/commit/b40ba07a4de5857b8392f667038eeb0b22aa5d9a))
* resolved issue with region selector and all regions value ([#3652](https://github.com/fallenbagel/jellyseerr/issues/3652)) ([28a2c50](https://github.com/fallenbagel/jellyseerr/commit/28a2c50495d0ce531da7f8c442bd488a54b1e84c))
* typos on readme ([#655](https://github.com/fallenbagel/jellyseerr/issues/655)) ([eee9a02](https://github.com/fallenbagel/jellyseerr/commit/eee9a025d246c72bcd3aca753d9e49c1f8f064ea))
* **watchlist:** added missing prop for watchlist item removal button in watchlist page ([a0ec992](https://github.com/fallenbagel/jellyseerr/commit/a0ec992028093257e9fa043622e236014f02dea3))
* **watchlist:** discover local watchlist item display and profile local watchlist slider visibility ([3cb9494](https://github.com/fallenbagel/jellyseerr/commit/3cb9494e6210151716587d8c4b22e0a21692cf88))


### Features

* add ko language ([#3619](https://github.com/fallenbagel/jellyseerr/issues/3619)) ([9250735](https://github.com/fallenbagel/jellyseerr/commit/92507359b48db08b0066047d6505660b8c8b0b12))
* add Peacock to Network Slider ([#3545](https://github.com/fallenbagel/jellyseerr/issues/3545)) ([0c39057](https://github.com/fallenbagel/jellyseerr/commit/0c39057ca58743697e9dcc3b678440ac3688c65a))
* add tooltips to tautulli avatars ([#3601](https://github.com/fallenbagel/jellyseerr/issues/3601)) ([c484810](https://github.com/fallenbagel/jellyseerr/commit/c484810f965f8d04643c25c6d283dd83f4bd4a23))
* added Letterboxd links for the external link blocks for movies ([981f5e6](https://github.com/fallenbagel/jellyseerr/commit/981f5e679c4c707e119741240a58de8bb07f9d6c))
* check if first jellyfin user is admin ([#635](https://github.com/fallenbagel/jellyseerr/issues/635)) ([010df62](https://github.com/fallenbagel/jellyseerr/commit/010df62776191fe4c195e590df338f8d8523f55b)), closes [#610](https://github.com/fallenbagel/jellyseerr/issues/610)
* jellyseerr makeover ([#715](https://github.com/fallenbagel/jellyseerr/issues/715)) ([0c27132](https://github.com/fallenbagel/jellyseerr/commit/0c2713213c56de342f76300d12ce01fd543d2ce3))
* **job:** media availability support for jellyfin/emby ([#522](https://github.com/fallenbagel/jellyseerr/issues/522)) ([3eb1bb3](https://github.com/fallenbagel/jellyseerr/commit/3eb1bb3d8ff22391acb2e629bbec7b6e4b65ca95)), closes [#406](https://github.com/fallenbagel/jellyseerr/issues/406) [#193](https://github.com/fallenbagel/jellyseerr/issues/193) [#516](https://github.com/fallenbagel/jellyseerr/issues/516) [#362](https://github.com/fallenbagel/jellyseerr/issues/362) [#84](https://github.com/fallenbagel/jellyseerr/issues/84)
* **notif:** add Pushover sound options ([#2403](https://github.com/fallenbagel/jellyseerr/issues/2403)) ([3ea5076](https://github.com/fallenbagel/jellyseerr/commit/3ea5076053359b518b1b4d537e7b61580d9275a3))
* select default seriesType for anime ([#3627](https://github.com/fallenbagel/jellyseerr/issues/3627)) ([f628635](https://github.com/fallenbagel/jellyseerr/commit/f6286359cfd2ed93fc692aa2efda37310e02c11c)), closes [#3626](https://github.com/fallenbagel/jellyseerr/issues/3626)
* standard series type selector ([#3628](https://github.com/fallenbagel/jellyseerr/issues/3628)) ([7bdd25e](https://github.com/fallenbagel/jellyseerr/commit/7bdd25e5a45843a3e530d3fa2b0887664b53eec8))
* translations update from Hosted Weblate ([#3258](https://github.com/fallenbagel/jellyseerr/issues/3258)) ([e62a078](https://github.com/fallenbagel/jellyseerr/commit/e62a078298ced7dec627fb3ff9fc8f99a39d5e1b))
* update SameSite policy of session cookie to Lax ([#3650](https://github.com/fallenbagel/jellyseerr/issues/3650)) ([c84ca43](https://github.com/fallenbagel/jellyseerr/commit/c84ca4307465af4278f3dad5cf9c2b8cbae3fada))


### Reverts

* **jellyfinapi:** reverts [#450](https://github.com/fallenbagel/jellyseerr/issues/450) as it broke library sync support for local accounts using LDAP ([b5acc09](https://github.com/fallenbagel/jellyseerr/commit/b5acc09ba98e2dd9b61e6b78721e4dd9f42a996c)), closes [#489](https://github.com/fallenbagel/jellyseerr/issues/489)

# [1.7.0](https://github.com/fallenbagel/jellyseerr/compare/v1.6.0...v1.7.0) (2023-09-14)


### Bug Fixes

* adjust the plex watchlist sync schedule to have fuzziness ([#3502](https://github.com/fallenbagel/jellyseerr/issues/3502)) ([2c3f533](https://github.com/fallenbagel/jellyseerr/commit/2c3f5330764492e1323afd2d1f25e28ad78a2f2f))
* handle issue causing incorrect media to change to unknown ([#3516](https://github.com/fallenbagel/jellyseerr/issues/3516)) ([83b008c](https://github.com/fallenbagel/jellyseerr/commit/83b008c8391459bd02dc74bcdb0d8caf27207bdf))
* improved handling of edge case that could cause availability sync to fail ([#3497](https://github.com/fallenbagel/jellyseerr/issues/3497)) ([d0836ce](https://github.com/fallenbagel/jellyseerr/commit/d0836ce0efd55fccf2546087a0c4f94f7cb2e82a))
* Include all defaults in payload ([#3538](https://github.com/fallenbagel/jellyseerr/issues/3538)) ([cb63bf2](https://github.com/fallenbagel/jellyseerr/commit/cb63bf217b9e8810a5210b4bf475b2a96583cc84))
* multiple notifications for available media ([048fa96](https://github.com/fallenbagel/jellyseerr/commit/048fa967f2e5b23831ac9917c703934c50ef75f0))
* repeat notifications for available 4k media ([30361f2](https://github.com/fallenbagel/jellyseerr/commit/30361f2ab751d9a882a9120e0f3df28dc42cc2cd))
* resolved issue with create slider causing incorrect form submission ([#3514](https://github.com/fallenbagel/jellyseerr/issues/3514)) ([a761b7d](https://github.com/fallenbagel/jellyseerr/commit/a761b7dd35a5bd61bb4eb0275b75d1e0977e6a2d))
* resolved user access check issue ([#3551](https://github.com/fallenbagel/jellyseerr/issues/3551)) ([2816c66](https://github.com/fallenbagel/jellyseerr/commit/2816c66300bf870d493c0665b0e984d60f707dfd))
* **server/api/jellyfin.ts:** use /Library/VirtualFolders Jellyfin API call to fetch Jellyfin libs ([8685f57](https://github.com/fallenbagel/jellyseerr/commit/8685f5796a99d9700146bae9892319db10508d68)), closes [#256](https://github.com/fallenbagel/jellyseerr/issues/256)
* **statusbadge:** handle missing season/episode number ([#3526](https://github.com/fallenbagel/jellyseerr/issues/3526)) ([01de972](https://github.com/fallenbagel/jellyseerr/commit/01de972a8fe2ea3c18d5b2f426d01b5b14d142d4))
* **tautulli:** only test connection if hostname is defined ([#3573](https://github.com/fallenbagel/jellyseerr/issues/3573)) ([f7b4dfc](https://github.com/fallenbagel/jellyseerr/commit/f7b4dfcac472d08c54779a14fc1ad3c90927df26))
* **ui:** corrected issues icon color ([#3498](https://github.com/fallenbagel/jellyseerr/issues/3498)) ([c1a47bd](https://github.com/fallenbagel/jellyseerr/commit/c1a47bd9de332cb4925974690f5a33448b5cc2e6))


### Features

* **rating:** added IMDB Radarr proxy ([#3496](https://github.com/fallenbagel/jellyseerr/issues/3496)) ([b4191f9](https://github.com/fallenbagel/jellyseerr/commit/b4191f9c65b7ff08764e61d18e7a75bc8d4b3325))

# [1.6.0](https://github.com/fallenbagel/jellyseerr/compare/v1.5.0...v1.6.0) (2023-08-04)


### Bug Fixes

* availability sync file detection ([#3371](https://github.com/fallenbagel/jellyseerr/issues/3371)) ([7522aa3](https://github.com/fallenbagel/jellyseerr/commit/7522aa31743b169c903ebdf9d4d698645d27514c))
* corrected initial fallback data load on details page ([#3395](https://github.com/fallenbagel/jellyseerr/issues/3395)) ([4bd8764](https://github.com/fallenbagel/jellyseerr/commit/4bd87647d0551c20e13589a62690a6f3e5ad8ff7))
* correctly load series fallback modal with sonarr v4 ([#3451](https://github.com/fallenbagel/jellyseerr/issues/3451)) ([e051b1d](https://github.com/fallenbagel/jellyseerr/commit/e051b1dfea9c9320cc9dd420c475ae74cff0d901))
* **deps:** update all non-major dependencies ([#3223](https://github.com/fallenbagel/jellyseerr/issues/3223)) ([f5191ad](https://github.com/fallenbagel/jellyseerr/commit/f5191aded680357522a65bbdcc40d162b8fbf594))
* error deleting users with over 1000 requests ([#3376](https://github.com/fallenbagel/jellyseerr/issues/3376)) ([ac77b03](https://github.com/fallenbagel/jellyseerr/commit/ac77b037d5fb0c54f5edf4b29d04adb57aef388f))
* external url regex is now consistent with internal url ([33ec443](https://github.com/fallenbagel/jellyseerr/commit/33ec4436fb82e1eb1bc97dd650088c27785e9d94))
* externalLinkBlock ([46cd4d0](https://github.com/fallenbagel/jellyseerr/commit/46cd4d01d9a3cf17d79350c5e678202820272299))
* fix regex for internal url to use a more effecient one ([e848386](https://github.com/fallenbagel/jellyseerr/commit/e848386d10f05f157e7a6dde8847ecab50c169ac))
* fixes RT ratings for tv shows ([#3492](https://github.com/fallenbagel/jellyseerr/issues/3492)) ([04fbd00](https://github.com/fallenbagel/jellyseerr/commit/04fbd00d4ac29045592588ef8b664d1916991e37)), closes [#3491](https://github.com/fallenbagel/jellyseerr/issues/3491)
* **genreselector:** fix searching in Genre filter ([#3468](https://github.com/fallenbagel/jellyseerr/issues/3468)) ([d7fa35e](https://github.com/fallenbagel/jellyseerr/commit/d7fa35e066cf371797aaa46ca464aa531ba8fb35))
* handle search results with collections ([#3393](https://github.com/fallenbagel/jellyseerr/issues/3393)) ([70b1540](https://github.com/fallenbagel/jellyseerr/commit/70b1540ae23e83e01013856a9e06ad39e600922d))
* lock body scroll when using webkit ([#3399](https://github.com/fallenbagel/jellyseerr/issues/3399)) ([c27f960](https://github.com/fallenbagel/jellyseerr/commit/c27f96096ac8cc6c387f9d1dde5b263576ac2132))
* **logs:** jellyfin auth error now has the severity warn consistent with local login ([cc041b5](https://github.com/fallenbagel/jellyseerr/commit/cc041b5e0aa2b67573edba5919772b77a5111162)), closes [#224](https://github.com/fallenbagel/jellyseerr/issues/224)
* make a (shallow) copy of radarr/sonarr tags into a request before adding user tags ([#3485](https://github.com/fallenbagel/jellyseerr/issues/3485)) ([48f7666](https://github.com/fallenbagel/jellyseerr/commit/48f76662d5c08156f1da3f47e216c5f02668f64b))
* **ui:** corrected default badge hover opacity ([#3369](https://github.com/fallenbagel/jellyseerr/issues/3369)) ([a4d07f5](https://github.com/fallenbagel/jellyseerr/commit/a4d07f5afab613317d96c9c6e9b47157a5a28986))
* **ui:** corrected mobile menu spacing in collection details ([#3432](https://github.com/fallenbagel/jellyseerr/issues/3432)) ([77a33cb](https://github.com/fallenbagel/jellyseerr/commit/77a33cb74d744bb747b791785799b632af8c7862))
* **ui:** Make play symbol white ([1fe4bb8](https://github.com/fallenbagel/jellyseerr/commit/1fe4bb8a0415a72791ced75a2fba1027287398d5))
* **ui:** Resize Emby icon and add margins ([ad69d67](https://github.com/fallenbagel/jellyseerr/commit/ad69d6715e976630092bfbbb1843886523551014))
* **watchlist:** add validation for creation request ([03316c6](https://github.com/fallenbagel/jellyseerr/commit/03316c642d1ecf89753789af08caf6e3aac80113))
* **watchlist:** fix github code scanning ([c08897b](https://github.com/fallenbagel/jellyseerr/commit/c08897bdc1cff65862c62347572bbbd01b6c36ac))


### Features

* **add watchlist:** adding midding functionality from overserr ([5f1c10d](https://github.com/fallenbagel/jellyseerr/commit/5f1c10d50aaa430bcda96218ef2cc12a0eb926f3))
* adds streaming services custom slider ([#3361](https://github.com/fallenbagel/jellyseerr/issues/3361)) ([2520d8f](https://github.com/fallenbagel/jellyseerr/commit/2520d8f739abfde608f3ef66a9fbe6b7b5c6647a))
* auto tagging requested media with username ([#3338](https://github.com/fallenbagel/jellyseerr/issues/3338)) ([24f268b](https://github.com/fallenbagel/jellyseerr/commit/24f268b6cb67d9a8d8675cd6e09dd83a7f499add))
* **discover:** support filtering by tmdb user vote count on discover page ([#3407](https://github.com/fallenbagel/jellyseerr/issues/3407)) ([aa84977](https://github.com/fallenbagel/jellyseerr/commit/aa849776809dfe891e67ff4db6861ef44df1a774))
* **settings:** add internal url to jellyfin settings form ([0a30cd3](https://github.com/fallenbagel/jellyseerr/commit/0a30cd356d217a39546c016cc8bfa6ff6ad75e3e)), closes [#194](https://github.com/fallenbagel/jellyseerr/issues/194)
* **src/components/externallinkblock/index.tsx:** support Emby icon ([672061c](https://github.com/fallenbagel/jellyseerr/commit/672061cd646c97c9954790c8e50eac88ea2666e9))
* **tooltip:** email tooltip now appears when hovered over info icon ([cd7930e](https://github.com/fallenbagel/jellyseerr/commit/cd7930eef98451a781e5c9dc5ec223600a379f42))
* translations update ([47287c3](https://github.com/fallenbagel/jellyseerr/commit/47287c368885d14bd1a56e3e8318ce22dd0f6ddf)), closes [#381](https://github.com/fallenbagel/jellyseerr/issues/381)
* **watchlist:** add translation for en ([b7e3d28](https://github.com/fallenbagel/jellyseerr/commit/b7e3d285ed35b623062eceb0d99035cafbf075a6))

# [1.5.0](https://github.com/fallenbagel/jellyseerr/compare/v1.4.1...v1.5.0) (2023-04-20)


### Bug Fixes

* add better checks on 4k detection of series ([bc9017f](https://github.com/fallenbagel/jellyseerr/commit/bc9017f54d84ec24c4d74d38e1b4e24219425d41))
* added a refresh interval if download status is in progress ([#3275](https://github.com/fallenbagel/jellyseerr/issues/3275)) ([1e2c6f4](https://github.com/fallenbagel/jellyseerr/commit/1e2c6f46ab66c836f321b5d8e34f1e8124c0b542))
* **build:** increase threshold for amount of data to be fetched when SSR'ing ([#3320](https://github.com/fallenbagel/jellyseerr/issues/3320)) ([d7b83d2](https://github.com/fallenbagel/jellyseerr/commit/d7b83d22cee3d20db564cc0564d42802b02327e3))
* disable availability sync temporarily ([2e5cf22](https://github.com/fallenbagel/jellyseerr/commit/2e5cf226265686012329248e7f729fec324c3deb))
* hide remove button when default service is not configured ([7d4455b](https://github.com/fallenbagel/jellyseerr/commit/7d4455ba6bfd12e2730f7085cbb87df246f01d22))
* **jellyfin scan:** temporary workaround fix for jellyfin scan when display specials within season ([38fb66d](https://github.com/fallenbagel/jellyseerr/commit/38fb66d31e41232c01898d0d362af8338eb7b960)), closes [#215](https://github.com/fallenbagel/jellyseerr/issues/215) [#176](https://github.com/fallenbagel/jellyseerr/issues/176) [#246](https://github.com/fallenbagel/jellyseerr/issues/246)
* lint issues ([bcd2bb7](https://github.com/fallenbagel/jellyseerr/commit/bcd2bb7c96810f5a6932f42468a628d2db1bc771))
* logger was set to info for the wrong logs ([#3354](https://github.com/fallenbagel/jellyseerr/issues/3354)) ([c36a4ba](https://github.com/fallenbagel/jellyseerr/commit/c36a4ba2b8df05873f5dfd0946a9bc3dc4ecfd1d))
* remove unnecessary parenthesis from api key generation ([#3336](https://github.com/fallenbagel/jellyseerr/issues/3336)) ([6bd3f01](https://github.com/fallenbagel/jellyseerr/commit/6bd3f015d65507efca60279007bd2b86ee860643))
* **snapcraft:** use the correct config folder for image cache ([#3302](https://github.com/fallenbagel/jellyseerr/issues/3302)) ([c93467b](https://github.com/fallenbagel/jellyseerr/commit/c93467b3acf2c256324297e7e8f21e9944005dd4))
* **ui:** hide mini status badge if non-4K media status is unknown ([#3346](https://github.com/fallenbagel/jellyseerr/issues/3346)) ([50f06da](https://github.com/fallenbagel/jellyseerr/commit/50f06dabbffc693f0843584a64d1d96e77982820))
* **ui:** hide search bar behind slideover when opened ([#3348](https://github.com/fallenbagel/jellyseerr/issues/3348)) ([b3882de](https://github.com/fallenbagel/jellyseerr/commit/b3882de8930a70adb2f93a27be6370bfa1826587))
* **ui:** prevent title cards from flickering when quickly hovering across them ([#3349](https://github.com/fallenbagel/jellyseerr/issues/3349)) ([eb5502a](https://github.com/fallenbagel/jellyseerr/commit/eb5502a16f86e37a933f6beca0678c2d228e77d5))
* **watchlist:** correctly load more than 20 watchlist items ([#3351](https://github.com/fallenbagel/jellyseerr/issues/3351)) ([af880a6](https://github.com/fallenbagel/jellyseerr/commit/af880a6c839794b34bddcd7e0fe56353aa48ba36))


### Features

* add a button in ManageSlideOver to remove the movie and the file from Radarr/Sonarr ([2e74584](https://github.com/fallenbagel/jellyseerr/commit/2e7458457e995dd3ec6dd96035fe997646cdd446))
* availability sync rework ([#3219](https://github.com/fallenbagel/jellyseerr/issues/3219)) ([ae38183](https://github.com/fallenbagel/jellyseerr/commit/ae3818304b2f75222d1bd223ece94f829a3b42d0)), closes [#377](https://github.com/fallenbagel/jellyseerr/issues/377)
* full title of download item on hover with tooltip ([#3296](https://github.com/fallenbagel/jellyseerr/issues/3296)) ([33e7691](https://github.com/fallenbagel/jellyseerr/commit/33e7691b94d7d369a0a1410e434850bc51e5572e))


### Performance Improvements

* **imageproxy:** do not set cookies to image proxy so CDNs can cache images ([#3332](https://github.com/fallenbagel/jellyseerr/issues/3332)) ([966639d](https://github.com/fallenbagel/jellyseerr/commit/966639df430d32f6bfebdb16314dc4590d21caf8))

## [1.4.1](https://github.com/fallenbagel/jellyseerr/compare/v1.4.0...v1.4.1) (2023-01-31)


### Bug Fixes

* pass in library type when scanning recently added items ([#3287](https://github.com/fallenbagel/jellyseerr/issues/3287)) ([8942eb8](https://github.com/fallenbagel/jellyseerr/commit/8942eb8b7c4fa1d16aa2e72e8ba7120a653c9aa2))
* **ui:** air date will use UTC for timezone ([#3297](https://github.com/fallenbagel/jellyseerr/issues/3297)) ([3e43586](https://github.com/fallenbagel/jellyseerr/commit/3e43586acc0804c3fff524509caa890a104e132b))
* **ui:** correct range slider styling in chrome ([#3299](https://github.com/fallenbagel/jellyseerr/issues/3299)) ([d954328](https://github.com/fallenbagel/jellyseerr/commit/d9543289111d72245564d25d300a71b0ea3954ba))
* **ui:** show 5 icons when possible on mobile menu ([#3298](https://github.com/fallenbagel/jellyseerr/issues/3298)) ([7040da1](https://github.com/fallenbagel/jellyseerr/commit/7040da1334f6d18e19a494c73caa17f7df552dfe))
* **ui:** style range thumbs correctly for firefox ([#3294](https://github.com/fallenbagel/jellyseerr/issues/3294)) ([9d10e6a](https://github.com/fallenbagel/jellyseerr/commit/9d10e6a88c0996671f1d9d20792e1930dbc82329))

# [1.4.0](https://github.com/fallenbagel/jellyseerr/compare/v1.3.0...v1.4.0) (2023-01-29)


### Bug Fixes

* add bg-opacity to in-progress status badges ([#3190](https://github.com/fallenbagel/jellyseerr/issues/3190)) ([68223f4](https://github.com/fallenbagel/jellyseerr/commit/68223f4b1e98b01825516dcba39cbb2d3df31a70))
* added download status and title to request card/item error components ([#3186](https://github.com/fallenbagel/jellyseerr/issues/3186)) ([3309f77](https://github.com/fallenbagel/jellyseerr/commit/3309f77aa4be1d70b27693531c119a8e26822518))
* arrow icons were misplaced on mobile in slider edit ([#3260](https://github.com/fallenbagel/jellyseerr/issues/3260)) ([d328485](https://github.com/fallenbagel/jellyseerr/commit/d328485161b9cae6a70ef0713b4878207bc6015e))
* **build:** update usage of publish snap action ([#3272](https://github.com/fallenbagel/jellyseerr/issues/3272)) ([51b05cd](https://github.com/fallenbagel/jellyseerr/commit/51b05cd8fbb5d332807d8c00b2ffb7b10c3d0179))
* changed overflow scroll to only if necessary ([#3184](https://github.com/fallenbagel/jellyseerr/issues/3184)) ([27feeea](https://github.com/fallenbagel/jellyseerr/commit/27feeea69121336557deda1f32b65a5daa146f82))
* convert genre/studio to string in create slider ([#3201](https://github.com/fallenbagel/jellyseerr/issues/3201)) ([93afead](https://github.com/fallenbagel/jellyseerr/commit/93afead92e497f2e5bce67a34fffdaa08d20c7f2))
* correct checkbox position (again) for slider edits ([#3227](https://github.com/fallenbagel/jellyseerr/issues/3227)) ([3ba6df1](https://github.com/fallenbagel/jellyseerr/commit/3ba6df1a41c084c4a6a90354338047623abef521))
* correct grid sizing for webkit on streaming services ([#3248](https://github.com/fallenbagel/jellyseerr/issues/3248)) ([6fd11cf](https://github.com/fallenbagel/jellyseerr/commit/6fd11cf4254e1a19310592bec78a6de52bc073a8))
* correct issue detail bottom padding on mobile displays ([#3268](https://github.com/fallenbagel/jellyseerr/issues/3268)) ([3db010b](https://github.com/fallenbagel/jellyseerr/commit/3db010b9eaec62aa08d973a61caf1801471bbf3e))
* correct link to correct keyword results for series ([#3208](https://github.com/fallenbagel/jellyseerr/issues/3208)) ([4e9be7a](https://github.com/fallenbagel/jellyseerr/commit/4e9be7a3f7304ee7be5ee6fd34b1ea8f6c0cf399))
* correct spacing between sliders ([#3225](https://github.com/fallenbagel/jellyseerr/issues/3225)) ([62e2de7](https://github.com/fallenbagel/jellyseerr/commit/62e2de70bf37b72d5f63370b662d4103a642775b))
* correctly check mobile menu permissions ([#3271](https://github.com/fallenbagel/jellyseerr/issues/3271)) ([f4a22dc](https://github.com/fallenbagel/jellyseerr/commit/f4a22dc437404558f301ccfc195cf0a300dd1ff2))
* correctly restore selected streaming service filters ([#3249](https://github.com/fallenbagel/jellyseerr/issues/3249)) ([154f3e7](https://github.com/fallenbagel/jellyseerr/commit/154f3e72efbf0b663358b3029156f54516f01a2f))
* create shared class to add bottom spacing ([#3269](https://github.com/fallenbagel/jellyseerr/issues/3269)) ([5d1c6f7](https://github.com/fallenbagel/jellyseerr/commit/5d1c6f706555613d97ed9e61d8b665543c2f239b))
* **deps:** pin dependency @headlessui/react to 1.7.7 ([#3194](https://github.com/fallenbagel/jellyseerr/issues/3194)) [skip ci] ([c4b16ab](https://github.com/fallenbagel/jellyseerr/commit/c4b16abc62647c74215155942a4230a31a238677))
* **deps:** update dependency @heroicons/react to v2 ([#2970](https://github.com/fallenbagel/jellyseerr/issues/2970)) ([dd48d59](https://github.com/fallenbagel/jellyseerr/commit/dd48d59b20e2d1800ea30912116f4a4f1bb7928f))
* **deps:** update dependency axios to v1 ([#3202](https://github.com/fallenbagel/jellyseerr/issues/3202)) ([421029e](https://github.com/fallenbagel/jellyseerr/commit/421029ebab66c9a6622ba47e56d7f6473524cce4))
* **deps:** update dependency swr to v2 ([#3212](https://github.com/fallenbagel/jellyseerr/issues/3212)) ([7b6db50](https://github.com/fallenbagel/jellyseerr/commit/7b6db50ae55b1fc60d19a5cff62dd46bb989fa51))
* **experimental:** use new RT API (sorta) ([#3179](https://github.com/fallenbagel/jellyseerr/issues/3179)) ([357cab8](https://github.com/fallenbagel/jellyseerr/commit/357cab87ac7752b8e119b51c938b343c661d83c2))
* improve small screen layout for discover editing ([#3221](https://github.com/fallenbagel/jellyseerr/issues/3221)) ([d23b213](https://github.com/fallenbagel/jellyseerr/commit/d23b2132de05f072f7f9daad83d81421d747cf99))
* include new package calendar css in build ([#3235](https://github.com/fallenbagel/jellyseerr/issues/3235)) ([c2a1a20](https://github.com/fallenbagel/jellyseerr/commit/c2a1a20a3bb20039a1936c7fe0ecb9e8311a0aea))
* issues with issues ([#3267](https://github.com/fallenbagel/jellyseerr/issues/3267)) ([fd21971](https://github.com/fallenbagel/jellyseerr/commit/fd219717c01c558814d7a80de6304272b5a7944e))
* multiple genre filtering now works ([#3282](https://github.com/fallenbagel/jellyseerr/issues/3282)) ([5076938](https://github.com/fallenbagel/jellyseerr/commit/507693881b939819413f0959df5ef6b7a357eb5c))
* prevent double encode if we are on /search endpoint ([#3238](https://github.com/fallenbagel/jellyseerr/issues/3238)) ([a343f8a](https://github.com/fallenbagel/jellyseerr/commit/a343f8ad915491a9c81512c7e541a1dac8906025))
* **request:** approve request when retrying request ([#3234](https://github.com/fallenbagel/jellyseerr/issues/3234)) ([b515701](https://github.com/fallenbagel/jellyseerr/commit/b5157010c46cd9083993d5ee0172007b83d631da))
* **request:** mark request as approved if media is already available when retrying failed request ([#3244](https://github.com/fallenbagel/jellyseerr/issues/3244)) ([cb65074](https://github.com/fallenbagel/jellyseerr/commit/cb650745f6a33e69391a633e6d272831f314e098))
* restore border to ghost button and fix discover slider visibility toggle position ([#3226](https://github.com/fallenbagel/jellyseerr/issues/3226)) ([2eebb7f](https://github.com/fallenbagel/jellyseerr/commit/2eebb7fd3941b34fe9472aaf9d28265df8cce311))
* restore status badges on titles on actors page when hide available media enabled ([#3206](https://github.com/fallenbagel/jellyseerr/issues/3206)) ([9d3446d](https://github.com/fallenbagel/jellyseerr/commit/9d3446d370499c3251159393e5c791b01225e05c))
* screen would zoom on mobile if date picker input was selected ([#3241](https://github.com/fallenbagel/jellyseerr/issues/3241)) ([3aefddd](https://github.com/fallenbagel/jellyseerr/commit/3aefddd48834d86150d5f5cceb2d08af3a78847b))
* series displayed an empty season with series list/request modal ([#3147](https://github.com/fallenbagel/jellyseerr/issues/3147)) ([2179637](https://github.com/fallenbagel/jellyseerr/commit/2179637d437999290eaa4152f6f37c71fc3d8ba3))
* tooltip shows properly if not in progress ([#3185](https://github.com/fallenbagel/jellyseerr/issues/3185)) ([6face8c](https://github.com/fallenbagel/jellyseerr/commit/6face8cc4564b978fb98af32659b326d8c5cede8))
* **ui:** series first air date sorting ([#3283](https://github.com/fallenbagel/jellyseerr/issues/3283)) ([374c78c](https://github.com/fallenbagel/jellyseerr/commit/374c78c989cc86bb144a954a91d5d183c4b591c0))
* update StatusBadgeMini to shrink on title cards (and remove ring) ([#3210](https://github.com/fallenbagel/jellyseerr/issues/3210)) ([042a1a9](https://github.com/fallenbagel/jellyseerr/commit/042a1a950fdd4d4a61edf4bc19657f9b7a526da8))


### Features

* add discover customization ([#3182](https://github.com/fallenbagel/jellyseerr/issues/3182)) ([cd35748](https://github.com/fallenbagel/jellyseerr/commit/cd3574851a12517cbfadc109e6412a7a9e44c114))
* add keywords to movie/series detail pages ([#3204](https://github.com/fallenbagel/jellyseerr/issues/3204)) ([e084649](https://github.com/fallenbagel/jellyseerr/commit/e084649878a58c296786141d12dd69a69a27ee85))
* add streaming services filter ([#3247](https://github.com/fallenbagel/jellyseerr/issues/3247)) ([1154156](https://github.com/fallenbagel/jellyseerr/commit/1154156459403494e8daf0c89a3ba356aeea1d97))
* discover inline customization ([#3220](https://github.com/fallenbagel/jellyseerr/issues/3220)) ([8bd10b5](https://github.com/fallenbagel/jellyseerr/commit/8bd10b5bf3d1b8069872b616c7c8596caeb4937e))
* discover overhaul (filters!) ([#3232](https://github.com/fallenbagel/jellyseerr/issues/3232)) ([dd00e48](https://github.com/fallenbagel/jellyseerr/commit/dd00e48f59054b44bef6b32a2c169e59f6175051))
* discover slider edit arrow buttons for reordering ([#3259](https://github.com/fallenbagel/jellyseerr/issues/3259)) ([da00d45](https://github.com/fallenbagel/jellyseerr/commit/da00d454e17e8b00d04f6e26f6dd5153ed6ced81))
* **lang:** translations update from Hosted Weblate ([#3030](https://github.com/fallenbagel/jellyseerr/issues/3030)) ([0d8b390](https://github.com/fallenbagel/jellyseerr/commit/0d8b390b678731e76bd1f0f8a0a4952c11e77f4d))
* new mobile menu ([#3251](https://github.com/fallenbagel/jellyseerr/issues/3251)) ([fcbca17](https://github.com/fallenbagel/jellyseerr/commit/fcbca1722f31f32633a57bc5048f46c9da057d87))
* translations update from Hosted Weblate ([#3218](https://github.com/fallenbagel/jellyseerr/issues/3218)) ([5940ff7](https://github.com/fallenbagel/jellyseerr/commit/5940ff7f5f62eed9ac5aa6f02803418aaa09813a))
* **ui:** add episode number to front of episode name in season details ([#3086](https://github.com/fallenbagel/jellyseerr/issues/3086)) ([a672b32](https://github.com/fallenbagel/jellyseerr/commit/a672b324ec391a20f6f3a1daed82a8d276a52c2c))
* **ui:** request card progress bar ([#3123](https://github.com/fallenbagel/jellyseerr/issues/3123)) ([03853a1](https://github.com/fallenbagel/jellyseerr/commit/03853a1b9155c8a2153c8885022a74619af1bc15))

# [1.3.0](https://github.com/fallenbagel/jellyseerr/compare/v1.2.1...v1.3.0) (2023-01-02)

### Bug Fixes

- added deep links to issues and status badges ([#3065](https://github.com/fallenbagel/jellyseerr/issues/3065)) ([bfe56c3](https://github.com/fallenbagel/jellyseerr/commit/bfe56c347073001795b1c3e917eb7a5afcc4462c))
- **api:** handle auth for accounts where the plex id may have been set to null ([#3125](https://github.com/fallenbagel/jellyseerr/issues/3125)) ([15e2469](https://github.com/fallenbagel/jellyseerr/commit/15e246929bdbc2b7b5bdab7a84bd7882b79d5cb1))
- **api:** ignore Music,Books,Photos,MusicVideo libraries ([d9ca3c6](https://github.com/fallenbagel/jellyseerr/commit/d9ca3c6e52c118698ca71021217f6ca409e71974))
- count combined episodes ([64339e5](https://github.com/fallenbagel/jellyseerr/commit/64339e5f0374f8490e685e5c086e088bb7fd737e))
- improved PTR scrolling performance ([#3095](https://github.com/fallenbagel/jellyseerr/issues/3095)) ([07ec3ef](https://github.com/fallenbagel/jellyseerr/commit/07ec3efbcaf669de7ccde4421c1112bfd23675d6))
- **locale:** fix the duplicated wording in the Clear Media Warning message ([7e20c7c](https://github.com/fallenbagel/jellyseerr/commit/7e20c7cb78a44c32ab8a5f21203e285f23f402ab))
- **ui:** adds mediaServerName to statusBadge and manageSlideOver ([d0cdce9](https://github.com/fallenbagel/jellyseerr/commit/d0cdce9e90fba642d2bf934a4266e1421424bc73)), closes [#254](https://github.com/fallenbagel/jellyseerr/issues/254)
- update API docs to allow 'all' seasons value ([#3073](https://github.com/fallenbagel/jellyseerr/issues/3073)) ([1dfa943](https://github.com/fallenbagel/jellyseerr/commit/1dfa9431a95e7e2a1843746c2473d8a06f03e184))

### Features

- **api:** adds support for Mixed Libraries ([ba82ece](https://github.com/fallenbagel/jellyseerr/commit/ba82ecec5c994e79d7c9b658372041522b58a120)), closes [#95](https://github.com/fallenbagel/jellyseerr/issues/95)
- custom image proxy ([#3056](https://github.com/fallenbagel/jellyseerr/issues/3056)) ([500cd1f](https://github.com/fallenbagel/jellyseerr/commit/500cd1f872942923d2b9c3b835e6329e335d4a3f))
- **lang:** add Croatian display language ([#3041](https://github.com/fallenbagel/jellyseerr/issues/3041)) ([64aab6d](https://github.com/fallenbagel/jellyseerr/commit/64aab6dd8240e191026512733b34cc046b6e508a))

## [1.29.1](https://github.com/sct/overseerr/compare/v1.29.0...v1.29.1) (2022-04-06)

### Bug Fixes

- **auth:** resolve local/password authentication issues ([#2677](https://github.com/sct/overseerr/issues/2677)) ([b75fc7b](https://github.com/sct/overseerr/commit/b75fc7b2384ce760432620faaa92277dcd42b8e1))

# [1.29.0](https://github.com/sct/overseerr/compare/v1.28.0...v1.29.0) (2022-04-01)

### Bug Fixes

- add Discord ID setting to general user settings page ([#2406](https://github.com/sct/overseerr/issues/2406)) ([eff665e](https://github.com/sct/overseerr/commit/eff665ef4b688aac881408790304b77bd9a31ddb))
- address unhandled promise rejections & bump node to v16.13 ([#2398](https://github.com/sct/overseerr/issues/2398)) ([8cba486](https://github.com/sct/overseerr/commit/8cba486249fed88232e93a688c8bfe0f6179c589))
- **css:** rename form-input to form-input-area ([#2613](https://github.com/sct/overseerr/issues/2613)) ([086f0b6](https://github.com/sct/overseerr/commit/086f0b6ce23f607d20c2cec3c73b2e4d1ce9b426))
- **email:** enclose PGP encryption logic in try/catch ([#2519](https://github.com/sct/overseerr/issues/2519)) ([a76b608](https://github.com/sct/overseerr/commit/a76b608ab796944c0c660e3296a7aca6615d69f3))
- **frontend:** disable autocomplete on search field ([#2592](https://github.com/sct/overseerr/issues/2592)) ([82d1617](https://github.com/sct/overseerr/commit/82d16177bf763fe8097b4aae326793e3e21e847d))
- **frontend:** theme-color meta tag ([#2420](https://github.com/sct/overseerr/issues/2420)) ([ff28c9b](https://github.com/sct/overseerr/commit/ff28c9bfebf4a930e2542ee3b3c35f8af4e1b97e))
- **frontend:** various fixes ([#2524](https://github.com/sct/overseerr/issues/2524)) ([c3dbd0d](https://github.com/sct/overseerr/commit/c3dbd0d6913946e0e1b5308edfbb5ca744740223))
- **lang:** rename 'Media' notification types for clarity ([#2400](https://github.com/sct/overseerr/issues/2400)) ([399b037](https://github.com/sct/overseerr/commit/399b0379186ed34dcc436bd95330fd1a05fef4b3))
- **lang:** translations update from Hosted Weblate ([#2625](https://github.com/sct/overseerr/issues/2625)) ([19cdedd](https://github.com/sct/overseerr/commit/19cdedd2a6656b1a852e1cc653bbdb140e978b51))
- **lang:** translations update from Hosted Weblate ([#2639](https://github.com/sct/overseerr/issues/2639)) ([418a533](https://github.com/sct/overseerr/commit/418a533588bbbdbbbb4caee1ef91d57c1ca35717))
- **logs:** handle log message nested extra properties ([#2459](https://github.com/sct/overseerr/issues/2459)) ([d777940](https://github.com/sct/overseerr/commit/d7779408d162949b2eafcacefc8eabe53fae229f))
- **notif:** duplicate notification check logic ([#2424](https://github.com/sct/overseerr/issues/2424)) ([10651ba](https://github.com/sct/overseerr/commit/10651baa675993f7109989bbac67f54661c8693f))
- **notif:** show event in pop up notification for slack ([#2413](https://github.com/sct/overseerr/issues/2413)) ([d4438c8](https://github.com/sct/overseerr/commit/d4438c82e3753c9b29b6269ad406d263b3fcef4c)), closes [#2408](https://github.com/sct/overseerr/issues/2408)
- **plex:** correctly generate uuid for safari ([#2614](https://github.com/sct/overseerr/issues/2614)) ([d06f2cd](https://github.com/sct/overseerr/commit/d06f2cdb08bfa6f05cf7cec2c408a258fa926b09))
- **plex:** find TV series in addition to movies from IMDb IDs ([#1830](https://github.com/sct/overseerr/issues/1830)) ([30644f6](https://github.com/sct/overseerr/commit/30644f65ea2e8437676422ae0b083c642a836887))
- **plex:** include 'Overseerr' in X-Plex-Device-Name header ([#2635](https://github.com/sct/overseerr/issues/2635)) ([d4f9650](https://github.com/sct/overseerr/commit/d4f9650cd07704a97f8b591b7de7351c1e85b825))
- **plex:** use unique client identifier ([#2602](https://github.com/sct/overseerr/issues/2602)) ([648b346](https://github.com/sct/overseerr/commit/648b346cbe5a941c7e1ec4ddfb276fb0e27ed502))
- **plex:** user import ([#2442](https://github.com/sct/overseerr/issues/2442)) ([86dff12](https://github.com/sct/overseerr/commit/86dff12cdeef6dca92527dd31757a3a4c7f921bf))
- **radarr:** correctly check for existing movies ([#2490](https://github.com/sct/overseerr/issues/2490)) ([5d4b06b](https://github.com/sct/overseerr/commit/5d4b06bbcc6cf6d328f6b4a86c4c0f9b0f3aff3e))
- **radarr:** remove PreDB minimum availability option ([#2386](https://github.com/sct/overseerr/issues/2386)) ([3e5eb4e](https://github.com/sct/overseerr/commit/3e5eb4e148a9f88b871abc4ee1784b870f691534))
- **requests:** check for existing media of same type when requesting ([#2445](https://github.com/sct/overseerr/issues/2445)) ([eb9ca2e](https://github.com/sct/overseerr/commit/eb9ca2e86f3be3f4ff8ee2e7c4aecdf337d8976d))
- **sonarr:** monitor existing series upon request approval ([#2553](https://github.com/sct/overseerr/issues/2553)) ([aa062d9](https://github.com/sct/overseerr/commit/aa062d921c425d4b64bfdb28a5f102b0c92f7d87))
- **sonarr:** only scan seasons that exist in TMDb ([#2523](https://github.com/sct/overseerr/issues/2523)) ([6168185](https://github.com/sct/overseerr/commit/61681857b123802aaeff02a8f61b1ba046c5d333))
- **tautulli:** fetch additional user history as necessary to return 20 unique media ([#2446](https://github.com/sct/overseerr/issues/2446)) ([7d19de6](https://github.com/sct/overseerr/commit/7d19de6a4af6297be18140ca59402b40f7bbb30b))

### Features

- **about:** show config directory ([#2600](https://github.com/sct/overseerr/issues/2600)) ([0c7373c](https://github.com/sct/overseerr/commit/0c7373c7e89a4ff717efaa7d6a5854f7ccd6a8d3))
- **api:** add additional request counts ([#2426](https://github.com/sct/overseerr/issues/2426)) ([2535edc](https://github.com/sct/overseerr/commit/2535edcc7fd6ec66fd45ad754c03929f1fe94871))
- **discord:** add 'Enable Mentions' setting ([#1779](https://github.com/sct/overseerr/issues/1779)) ([5f7538a](https://github.com/sct/overseerr/commit/5f7538ae2bf9c6e2feea385cc299bd08df071218))
- **frontend:** open media management slideover on status badge click ([#2407](https://github.com/sct/overseerr/issues/2407)) ([1f5785d](https://github.com/sct/overseerr/commit/1f5785d6c53b2ca2da67a8ccee72165c052c61a1))
- **lang:** add Albanian display language ([#2605](https://github.com/sct/overseerr/issues/2605)) ([3d32462](https://github.com/sct/overseerr/commit/3d32462f50b4ced0d9205b79003c35d6d1c948a3))
- **lang:** translations update from Hosted Weblate ([#2379](https://github.com/sct/overseerr/issues/2379)) ([bd93168](https://github.com/sct/overseerr/commit/bd93168ba1ed650baf4024569bb6a76811a99820))
- **lang:** translations update from Hosted Weblate ([#2389](https://github.com/sct/overseerr/issues/2389)) ([d2241a4](https://github.com/sct/overseerr/commit/d2241a41877d126a802fc53c925d258af31f34fd))
- **lang:** translations update from Hosted Weblate ([#2404](https://github.com/sct/overseerr/issues/2404)) ([1b29b15](https://github.com/sct/overseerr/commit/1b29b15d7c9a7ec918cb59116d60e1ae2e797dc4))
- **lang:** translations update from Hosted Weblate ([#2405](https://github.com/sct/overseerr/issues/2405)) ([879df20](https://github.com/sct/overseerr/commit/879df20022c8c5d9b32858ac5499d3e4369fc064))
- **lang:** translations update from Hosted Weblate ([#2414](https://github.com/sct/overseerr/issues/2414)) ([88536b1](https://github.com/sct/overseerr/commit/88536b1f9d6e8c1a11e1adf91b85bab4f34b751c))
- **lang:** translations update from Hosted Weblate ([#2425](https://github.com/sct/overseerr/issues/2425)) ([e9d4b63](https://github.com/sct/overseerr/commit/e9d4b6327b50a005ee6c2c3292b6f107e90fc50c))
- **lang:** translations update from Hosted Weblate ([#2428](https://github.com/sct/overseerr/issues/2428)) ([f8b1bcc](https://github.com/sct/overseerr/commit/f8b1bccda44371bb6f3f8f4ceeab900b1df3de31))
- **lang:** translations update from Hosted Weblate ([#2436](https://github.com/sct/overseerr/issues/2436)) ([99c0407](https://github.com/sct/overseerr/commit/99c04072e9f7be8191f25cbcfd5103017b8796eb))
- **lang:** translations update from Hosted Weblate ([#2452](https://github.com/sct/overseerr/issues/2452)) ([b5bd6ee](https://github.com/sct/overseerr/commit/b5bd6ee78f3d4aa14f0c440d1f2a8323dccfa399))
- **lang:** translations update from Hosted Weblate ([#2457](https://github.com/sct/overseerr/issues/2457)) ([92b2d32](https://github.com/sct/overseerr/commit/92b2d32d2e1e1d319410a9e357e1304065a77598))
- **lang:** translations update from Hosted Weblate ([#2489](https://github.com/sct/overseerr/issues/2489)) ([ec08fa6](https://github.com/sct/overseerr/commit/ec08fa67934715ff4a4d618d5b9ff97853913b78))
- **lang:** translations update from Hosted Weblate ([#2508](https://github.com/sct/overseerr/issues/2508)) ([9f4ae34](https://github.com/sct/overseerr/commit/9f4ae34da76707a40e2c89a50c722ffa1c0327c0))
- **lang:** translations update from Hosted Weblate ([#2531](https://github.com/sct/overseerr/issues/2531)) ([54b32eb](https://github.com/sct/overseerr/commit/54b32ebfd6b2eb6aeeea98c25939166eda8cc17f))
- **lang:** translations update from Hosted Weblate ([#2541](https://github.com/sct/overseerr/issues/2541)) ([4549ed3](https://github.com/sct/overseerr/commit/4549ed389e4f25c0946dc01526387e5ac000c3cf))
- **lang:** translations update from Hosted Weblate ([#2611](https://github.com/sct/overseerr/issues/2611)) ([81c75c8](https://github.com/sct/overseerr/commit/81c75c800edf6d36a1082a291ef7e308f338d005))
- **lang:** translations update from Hosted Weblate ([#2629](https://github.com/sct/overseerr/issues/2629)) ([1d0cbd2](https://github.com/sct/overseerr/commit/1d0cbd2e761072be0b4b3de461397ad9f9f681f3))
- **lang:** translations update from Hosted Weblate ([#2645](https://github.com/sct/overseerr/issues/2645)) ([341e3b8](https://github.com/sct/overseerr/commit/341e3b8f0657e09f53ad0b813b051290947343c0))
- **logs:** use separate json file to parse logs for log viewer ([#2399](https://github.com/sct/overseerr/issues/2399)) ([ce31bef](https://github.com/sct/overseerr/commit/ce31bef8a125c5492f2a1cfef0dcf3d8a4e9ee11))
- **notif:** add Gotify agent ([#2196](https://github.com/sct/overseerr/issues/2196)) ([e0b6abe](https://github.com/sct/overseerr/commit/e0b6abe4796f5a324c0ff78cff317fcaead671f1)), closes [#2183](https://github.com/sct/overseerr/issues/2183) [#2183](https://github.com/sct/overseerr/issues/2183) [#2077](https://github.com/sct/overseerr/issues/2077) [#2183](https://github.com/sct/overseerr/issues/2183) [#2183](https://github.com/sct/overseerr/issues/2183) [#2183](https://github.com/sct/overseerr/issues/2183) [#2077](https://github.com/sct/overseerr/issues/2077) [#2183](https://github.com/sct/overseerr/issues/2183) [#2183](https://github.com/sct/overseerr/issues/2183) [#2183](https://github.com/sct/overseerr/issues/2183)
- **notif:** add Pushbullet channel tag ([#2198](https://github.com/sct/overseerr/issues/2198)) ([f9200b7](https://github.com/sct/overseerr/commit/f9200b7977208f9b8267ce3a74bd8a86d6f28f7b))
- **plex:** selective user import ([#2188](https://github.com/sct/overseerr/issues/2188)) ([9cb97db](https://github.com/sct/overseerr/commit/9cb97db13ced5df2dc595cd9033470b1a0750093))
- **search:** filter search results by year ([#2460](https://github.com/sct/overseerr/issues/2460)) ([72c825d](https://github.com/sct/overseerr/commit/72c825d2a5109688bcc1991a30249284bf281500))
- **search:** search by id ([#2082](https://github.com/sct/overseerr/issues/2082)) ([b31cdbf](https://github.com/sct/overseerr/commit/b31cdbf074d5dbecbbf6da135a9b686aea9e3c0e))
- Tautulli integration ([#2230](https://github.com/sct/overseerr/issues/2230)) ([0842c23](https://github.com/sct/overseerr/commit/0842c233d0fc56d44824cad18749492cd52cbed5))
- **tautulli:** validate upon saving settings ([#2511](https://github.com/sct/overseerr/issues/2511)) ([1dc900d](https://github.com/sct/overseerr/commit/1dc900d5ce9689d179c9d2f554abc74ca50bd9cb))
- **ui:** add trakt external link ([#2367](https://github.com/sct/overseerr/issues/2367)) ([4e56bae](https://github.com/sct/overseerr/commit/4e56bae98508c1a60aeb3a08560ba1c00acce7e7))
- verify Plex server access during auth for existing users with Plex IDs ([#2458](https://github.com/sct/overseerr/issues/2458)) ([85bb30e](https://github.com/sct/overseerr/commit/85bb30e252c27047ae367491f0e5bb92a7d52605))

# [1.28.0](https://github.com/sct/overseerr/compare/v1.27.0...v1.28.0) (2022-01-01)

### Bug Fixes

- add missing route guards to issues pages ([#2235](https://github.com/sct/overseerr/issues/2235)) ([c79dc9f](https://github.com/sct/overseerr/commit/c79dc9f70f512dbec0e3460ee78dbc9feccfbbb1))
- allow basic HTTP auth in hostname validation ([#2307](https://github.com/sct/overseerr/issues/2307)) ([d48a7ba](https://github.com/sct/overseerr/commit/d48a7ba518f9c79d70e499037cb730eb3efe2c08))
- **docker:** explicitly install python3 ([#2273](https://github.com/sct/overseerr/issues/2273)) [skip ci] ([f1cd087](https://github.com/sct/overseerr/commit/f1cd0878a5c74bddc864f5f8ce9e2f041bdde5ec))
- **email:** use decrypted private key ([#2232](https://github.com/sct/overseerr/issues/2232)) ([8d29685](https://github.com/sct/overseerr/commit/8d2968572a569ed77a4d7c14ae1dc69935fa847e))
- **frontend:** more issues-related fixes ([#2234](https://github.com/sct/overseerr/issues/2234)) ([3ec4a9c](https://github.com/sct/overseerr/commit/3ec4a9c76e1f31bee5c8801b389721bf8e5884e0))
- **frontend:** setup page backdrops ([#2251](https://github.com/sct/overseerr/issues/2251)) ([78a8091](https://github.com/sct/overseerr/commit/78a8091bcd29a7cf50cc7c493c28710389817adf))
- **frontend:** use consistent formatting & strings ([#2231](https://github.com/sct/overseerr/issues/2231)) ([2164471](https://github.com/sct/overseerr/commit/216447121b686b6d01a31b95ec0c8eb005f6b103))
- handle Plex library settings migration failure gracefully ([#2254](https://github.com/sct/overseerr/issues/2254)) ([ed53810](https://github.com/sct/overseerr/commit/ed53810fb33f70722361c67d176ff4edf531ba45))
- **issues:** only allow edit of own comments & do not allow non-admin delete of issues with comments ([#2248](https://github.com/sct/overseerr/issues/2248)) ([bba09d6](https://github.com/sct/overseerr/commit/bba09d69c1bc55c2f35db5a7986e7c935cc9619c))
- **lang:** add missing string ([#2370](https://github.com/sct/overseerr/issues/2370)) ([d36c1d2](https://github.com/sct/overseerr/commit/d36c1d29295020efb76bac21a443b6f9049802f3))
- **lang:** string edits ([#2229](https://github.com/sct/overseerr/issues/2229)) ([ab20c21](https://github.com/sct/overseerr/commit/ab20c21184639e1c7725f7cae96249c6fa157351))
- **lang:** translations update from Weblate ([#2212](https://github.com/sct/overseerr/issues/2212)) ([85aec4f](https://github.com/sct/overseerr/commit/85aec4f8925746ebae9bcc99d8480b78ccfd851e))
- **logs:** handle unexpected log messages ([#2303](https://github.com/sct/overseerr/issues/2303)) ([f284e4a](https://github.com/sct/overseerr/commit/f284e4ab978e502d2cc08e76226a8ebac91bb48f))
- **logs:** lazily parse log message label ([#2359](https://github.com/sct/overseerr/issues/2359)) ([5af06bd](https://github.com/sct/overseerr/commit/5af06bd87226fbc6176b0c5e362824793165a34e))
- **notif:** correct issue notif action URLs ([#2333](https://github.com/sct/overseerr/issues/2333)) ([dc7f959](https://github.com/sct/overseerr/commit/dc7f959cb422a8d89bcebc78377f1513412e542c))
- **notif:** only send MEDIA_AVAILABLE notifications for non-declined requests ([#2343](https://github.com/sct/overseerr/issues/2343)) ([fcb0dcf](https://github.com/sct/overseerr/commit/fcb0dcf5be64bf9ca814bfe119586908922099c5))
- **requests:** do not fail request edits if acting user lacks Manage Users permission ([#2338](https://github.com/sct/overseerr/issues/2338)) ([91bfff7](https://github.com/sct/overseerr/commit/91bfff71b7c05c9b9aad2c95282533eefbb6b2e7))
- secure session cookie ([#2308](https://github.com/sct/overseerr/issues/2308)) ([7f330af](https://github.com/sct/overseerr/commit/7f330aff2e1d3546e8dd1a3e4b037b9beb1cc7f0))
- **servarr:** handle baseurl error when testing connection ([#2294](https://github.com/sct/overseerr/issues/2294)) ([93b5ea2](https://github.com/sct/overseerr/commit/93b5ea20ca590996f6dc90713a76800180d0621c))
- **servarr:** handle servaarr server being unavailable when scanning downloads ([#2358](https://github.com/sct/overseerr/issues/2358)) ([488874f](https://github.com/sct/overseerr/commit/488874fc17e4e4719e90d383b83b1e1a5217213b))
- sort collection parts by release date ([#2368](https://github.com/sct/overseerr/issues/2368)) ([1b3797c](https://github.com/sct/overseerr/commit/1b3797cf6e6ef6b3d8c81e644382f6e3f68cfaaa))
- **ui:** request badge styling in request list ([#2302](https://github.com/sct/overseerr/issues/2302)) ([f2375c9](https://github.com/sct/overseerr/commit/f2375c902b79dcb1f349500862775ae57ea7d406))

### Features

- add production countries to movie/TV detail pages ([#2170](https://github.com/sct/overseerr/issues/2170)) ([30b20df](https://github.com/sct/overseerr/commit/30b20df37a9604ba1c066f89e54a5482a09575ea))
- add quotas, advanced options, and toggles to collection request modal ([#1742](https://github.com/sct/overseerr/issues/1742)) ([af40212](https://github.com/sct/overseerr/commit/af40212a738f8d6d9a5bf26dc20c0c87780d6020))
- **frontend:** add Discovery+ to network slider ([#2345](https://github.com/sct/overseerr/issues/2345)) ([2ded8f5](https://github.com/sct/overseerr/commit/2ded8f5484168bd7b8f45124d9ebdd296a5708d5))
- issues ([#2180](https://github.com/sct/overseerr/issues/2180)) ([e402c42](https://github.com/sct/overseerr/commit/e402c42aaa7d795cd724856a2e23615bb1a3695d))
- **lang:** add Polish display language ([#2261](https://github.com/sct/overseerr/issues/2261)) ([c760cea](https://github.com/sct/overseerr/commit/c760ceaa5f36c77fa3ce320fae1b4597d2d8b976))
- **lang:** translated using Weblate (Chinese (Traditional)) ([#2272](https://github.com/sct/overseerr/issues/2272)) ([d401e33](https://github.com/sct/overseerr/commit/d401e33249cbbca6e707479e5f0207e298ef3248))
- **lang:** translations update from Hosted Weblate ([#2277](https://github.com/sct/overseerr/issues/2277)) ([92732fc](https://github.com/sct/overseerr/commit/92732fcb42c56242d16daab00e2d38740b92dea0))
- **lang:** translations update from Hosted Weblate ([#2315](https://github.com/sct/overseerr/issues/2315)) ([6245be1](https://github.com/sct/overseerr/commit/6245be1e10dda67c869b59522c1290e7c100145f))
- **lang:** translations update from Hosted Weblate ([#2320](https://github.com/sct/overseerr/issues/2320)) ([68112fa](https://github.com/sct/overseerr/commit/68112faefbd64d5c71d3eff21620767f88ccfc34))
- **lang:** translations update from Hosted Weblate ([#2325](https://github.com/sct/overseerr/issues/2325)) ([febf067](https://github.com/sct/overseerr/commit/febf0677b880d2fed2822ce510db7cbb0826a920))
- **lang:** translations update from Hosted Weblate ([#2336](https://github.com/sct/overseerr/issues/2336)) ([3f7ef7a](https://github.com/sct/overseerr/commit/3f7ef7af97a807ef38041f4f2642b565aa33d066))
- **lang:** translations update from Hosted Weblate ([#2341](https://github.com/sct/overseerr/issues/2341)) ([33fe0bd](https://github.com/sct/overseerr/commit/33fe0bdd1e00da40e85b4e4b4780134b31a105d2))
- **lang:** translations update from Hosted Weblate ([#2346](https://github.com/sct/overseerr/issues/2346)) ([50dc934](https://github.com/sct/overseerr/commit/50dc9341dd98cb2d8ef3ef6471882a5a9b060afa))
- **lang:** translations update from Hosted Weblate ([#2364](https://github.com/sct/overseerr/issues/2364)) ([d437cc2](https://github.com/sct/overseerr/commit/d437cc25392e9c0881888371ffabc82892a1b15c))
- **lang:** translations update from Hosted Weblate ([#2366](https://github.com/sct/overseerr/issues/2366)) ([cc2b2bc](https://github.com/sct/overseerr/commit/cc2b2bc7a8ecd89e1feb38a907596b16df9bf0fc))
- **lang:** translations update from Hosted Weblate ([#2374](https://github.com/sct/overseerr/issues/2374)) ([b9bedac](https://github.com/sct/overseerr/commit/b9bedac7d7ba85223ecf1d9b93b96e2a490d571a))
- **lang:** translations update from Weblate ([#2226](https://github.com/sct/overseerr/issues/2226)) ([62b3dc5](https://github.com/sct/overseerr/commit/62b3dc5471c28f4d0e4399cb3bc8bfab94cff5ea))
- **lang:** translations update from Weblate ([#2241](https://github.com/sct/overseerr/issues/2241)) ([2b0b8e0](https://github.com/sct/overseerr/commit/2b0b8e05d9c95ff9218cea858a920a2815871186))
- **lang:** translations update from Weblate ([#2244](https://github.com/sct/overseerr/issues/2244)) ([0828b00](https://github.com/sct/overseerr/commit/0828b008badc8b512316799a6787bb7c403658d5))
- **lang:** translations update from Weblate ([#2247](https://github.com/sct/overseerr/issues/2247)) ([8c49309](https://github.com/sct/overseerr/commit/8c49309c35c31f7bcd0b84b0a307febc16842f68))
- **lang:** translations update from Weblate ([#2252](https://github.com/sct/overseerr/issues/2252)) ([99d5000](https://github.com/sct/overseerr/commit/99d50004e58f6b4594df0a171f6bc668635ec50c))
- **lang:** translations update from Weblate ([#2265](https://github.com/sct/overseerr/issues/2265)) ([b1b367a](https://github.com/sct/overseerr/commit/b1b367aac625ed3eb865832c94c2352e5a5c40f5))
- **notif:** 4K media notifications ([#2324](https://github.com/sct/overseerr/issues/2324)) ([88a8c1a](https://github.com/sct/overseerr/commit/88a8c1aa596e1113d6da52e5e8cbe443abc6384f))
- **notif:** add Pushbullet and Pushover agents to user notification settings ([#1740](https://github.com/sct/overseerr/issues/1740)) ([aeb7a48](https://github.com/sct/overseerr/commit/aeb7a48d72cec3fa2b857030aad3eaa0a457a896))
- **notif:** issue notifications ([#2242](https://github.com/sct/overseerr/issues/2242)) ([c9ffac3](https://github.com/sct/overseerr/commit/c9ffac33f7c04d926f8c45295703689d42fe87af))
- **search:** close search bar when hitting return ([#2260](https://github.com/sct/overseerr/issues/2260)) ([b423dc1](https://github.com/sct/overseerr/commit/b423dc167d12f0ba49f902876bceb2e876e35f58))
- **ui:** allow admins to edit & approve request from advanced request modal ([#2067](https://github.com/sct/overseerr/issues/2067)) ([340f1a2](https://github.com/sct/overseerr/commit/340f1a211952bd2e8f40f0ea4622b52dbe934e85))

# [1.27.0](https://github.com/sct/overseerr/compare/v1.26.1...v1.27.0) (2021-10-19)

### Bug Fixes

- **api:** return queried user's requests instead of own requests ([#2174](https://github.com/sct/overseerr/issues/2174)) ([0edb1f4](https://github.com/sct/overseerr/commit/0edb1f452b6ff4a49ae2bde15f7273769788cf4f))
- **api:** use query builder for user requests endpoint ([#2119](https://github.com/sct/overseerr/issues/2119)) ([a20f395](https://github.com/sct/overseerr/commit/a20f395c94c97dd7ddbc25590f15def2c9bf13c9))
- apply request overrides iff override & selected servers match ([#2164](https://github.com/sct/overseerr/issues/2164)) ([50ce198](https://github.com/sct/overseerr/commit/50ce198471b1a3777a183d68904bbfb39ebd4523))
- **email:** do not attempt to display logo if app URL not configured ([#2125](https://github.com/sct/overseerr/issues/2125)) ([b3b421a](https://github.com/sct/overseerr/commit/b3b421a67408a4a48d23c15341fcdf7aaf19b25a))
- **frontend:** notification type validation ([#2207](https://github.com/sct/overseerr/issues/2207)) ([2f204b9](https://github.com/sct/overseerr/commit/2f204b995269a53ae36f2a8733f27ae6ab70da5a))
- **scripts:** update migration scripts ([#2208](https://github.com/sct/overseerr/issues/2208)) [skip ci] ([d0ac74e](https://github.com/sct/overseerr/commit/d0ac74ea4bbfcf3d25d30cbd422d9df1c1259a18))
- **ui:** refinements for 'About' page ([#2173](https://github.com/sct/overseerr/issues/2173)) ([084a842](https://github.com/sct/overseerr/commit/084a842a4f9b6caaed22edbe77bc9e414bc1f387))

### Features

- display release dates for theatrical, digital, and physical release types ([#1492](https://github.com/sct/overseerr/issues/1492)) ([a4dca23](https://github.com/sct/overseerr/commit/a4dca2356b7605026f7bc45b691496e765c3328c))
- dynamically fetch login screen backdrop images ([#2206](https://github.com/sct/overseerr/issues/2206)) ([3486d0b](https://github.com/sct/overseerr/commit/3486d0bf5520cbdff60bd8fd023caed76c452973))
- **frontend:** add Hulu to network slider ([#2204](https://github.com/sct/overseerr/issues/2204)) ([1e402f7](https://github.com/sct/overseerr/commit/1e402f710b53c11855aab0abdb4b12c51c30b022))
- **jobs:** allow modifying job schedules ([#1440](https://github.com/sct/overseerr/issues/1440)) ([82614ca](https://github.com/sct/overseerr/commit/82614ca4410782a12d65b4c0a6526ff064be1241))
- **lang:** add Czech and Danish display languages ([#2176](https://github.com/sct/overseerr/issues/2176)) ([8d8db6c](https://github.com/sct/overseerr/commit/8d8db6cf5d98d4e498a31db339d02f8a98057c8d))
- **lang:** translations update from Weblate ([#2101](https://github.com/sct/overseerr/issues/2101)) ([c73cf7b](https://github.com/sct/overseerr/commit/c73cf7b19cbc19e97a777c0facb9264fb0113093))
- **lang:** translations update from Weblate ([#2179](https://github.com/sct/overseerr/issues/2179)) ([e3312ce](https://github.com/sct/overseerr/commit/e3312cef33821c8cb76a4a63bd565c78d67b3e0b))
- **lang:** translations update from Weblate ([#2185](https://github.com/sct/overseerr/issues/2185)) ([dce10f7](https://github.com/sct/overseerr/commit/dce10f743f52cb04036e2cdaee280e26a81b253b))
- **lang:** translations update from Weblate ([#2202](https://github.com/sct/overseerr/issues/2202)) ([492d8e3](https://github.com/sct/overseerr/commit/492d8e3daa5fb99aa9df2a18978085d5ddd581e7))
- **lang:** translations update from Weblate ([#2210](https://github.com/sct/overseerr/issues/2210)) ([0a6ef6c](https://github.com/sct/overseerr/commit/0a6ef6cc81376f7a02f1483109be7ae4ab851c48))
- **plex-scan:** plex scanner improvements ([#2105](https://github.com/sct/overseerr/issues/2105)) ([afda9c7](https://github.com/sct/overseerr/commit/afda9c7dc222137b0e6654a6beb4737cf2c1752e))
- **servarr:** auto fill base url when testing service if missing ([#1995](https://github.com/sct/overseerr/issues/1995)) ([739f667](https://github.com/sct/overseerr/commit/739f667b54d8dec258b74d0cd8fd8b3b88dcf8d5))
- **ui:** link processing/requested status badges to service URL ([#1761](https://github.com/sct/overseerr/issues/1761)) ([032c14a](https://github.com/sct/overseerr/commit/032c14a22680f62f8106943297b081b68645ce61))

## [1.26.1](https://github.com/sct/overseerr/compare/v1.26.0...v1.26.1) (2021-09-20)

### Bug Fixes

- **rt-api:** correctly format movie urls ([4c6009b](https://github.com/sct/overseerr/commit/4c6009bc2c3ff5f657a806363e3bdf7cd83d4261))

# [1.26.0](https://github.com/sct/overseerr/compare/v1.25.0...v1.26.0) (2021-09-19)

### Bug Fixes

- **email:** omit links when application URL is not configured ([#1806](https://github.com/sct/overseerr/issues/1806)) ([1133a34](https://github.com/sct/overseerr/commit/1133a34ffdf95c4d036be0264fe7f94f64007e8f))
- **lang:** minor changes to password reset strings ([#1798](https://github.com/sct/overseerr/issues/1798)) ([a41245c](https://github.com/sct/overseerr/commit/a41245c703688743ec24f9b4a53e70f3340daa0f))
- **notif:** truncate media overviews ([#1800](https://github.com/sct/overseerr/issues/1800)) ([42e45f3](https://github.com/sct/overseerr/commit/42e45f38e5ede7df0fc4bdb20a970917b2361569))
- **plex:** do not fail to scan empty libraries ([#1771](https://github.com/sct/overseerr/issues/1771)) ([6789b87](https://github.com/sct/overseerr/commit/6789b8701cb644d9a3f1384f30b3dff707201ef7))
- **quota:** block multi-season requests that would exceed a user's quota ([#1874](https://github.com/sct/overseerr/issues/1874)) ([8a55f85](https://github.com/sct/overseerr/commit/8a55f85d3ef14ccb83b139acb35d0746431637be))
- **rt-api:** use rotten-tomatoes 2.0 search api for movies ([a11bb49](https://github.com/sct/overseerr/commit/a11bb49663ec345332c4dd70ddbb49ce230b5c3c))
- **ui:** center logo on password reset pages ([#1807](https://github.com/sct/overseerr/issues/1807)) ([b8e82b5](https://github.com/sct/overseerr/commit/b8e82b5b4d3cb49ec372e3dce3cd89dff440ffd0))
- **ui:** change sidebar breakpoint to lg ([#1972](https://github.com/sct/overseerr/issues/1972)) ([70bd9e9](https://github.com/sct/overseerr/commit/70bd9e9308b607206b60a2a36a511de6e397a3db))
- **ui:** do not allow submission of invalid form inputs ([#1799](https://github.com/sct/overseerr/issues/1799)) ([910d00c](https://github.com/sct/overseerr/commit/910d00c19522a70125bfb5e5081a7ef4000e7f54))
- **ui:** do not display negative remaining quota ([#1859](https://github.com/sct/overseerr/issues/1859)) ([3841fb0](https://github.com/sct/overseerr/commit/3841fb06ebe1e09250362cc6cb401fdca12eef7f))
- **ui:** fix notifications settings buttons overflowing ([#1911](https://github.com/sct/overseerr/issues/1911)) ([0ce18b2](https://github.com/sct/overseerr/commit/0ce18b21ca547af6c083c3f248e22b7daf92aef0))
- **ui:** sort 'Request As' user dropdown by display name ([#2099](https://github.com/sct/overseerr/issues/2099)) ([bb09f8e](https://github.com/sct/overseerr/commit/bb09f8eaf70f6d0c981f31bd5f3c8afb2fe101ab))
- **webpush:** load user in push sub query ([#1894](https://github.com/sct/overseerr/issues/1894)) ([6f2db6a](https://github.com/sct/overseerr/commit/6f2db6a6ccf299262cf86d91acf639b921f28286))
- correct logo filename ([#1805](https://github.com/sct/overseerr/issues/1805)) ([f95be83](https://github.com/sct/overseerr/commit/f95be832f95a68b114ff24a65ffa0ebbd71b4121))

### Features

- list streaming providers on movie/TV detail pages ([#1778](https://github.com/sct/overseerr/issues/1778)) ([98ece67](https://github.com/sct/overseerr/commit/98ece67655a5dffe894974e337a3603afeed0236))
- **lang:** add Simplified Chinese display language ([#2032](https://github.com/sct/overseerr/issues/2032)) ([590ea7e](https://github.com/sct/overseerr/commit/590ea7e40460e381377b212d00869f191908b41f))
- **lang:** translated using Weblate (German) ([#1791](https://github.com/sct/overseerr/issues/1791)) ([15f7941](https://github.com/sct/overseerr/commit/15f7941269075b7e12de8bbc0f98418af70df380))
- **lang:** translations update from Weblate ([#1772](https://github.com/sct/overseerr/issues/1772)) ([6a75a05](https://github.com/sct/overseerr/commit/6a75a05c2348455d5374132a2574d988879d543a))
- **lang:** translations update from Weblate ([#1796](https://github.com/sct/overseerr/issues/1796)) ([57b52fc](https://github.com/sct/overseerr/commit/57b52fc9cccd3fac93cdb68e36cf652ddbcdf86c))
- **lang:** translations update from Weblate ([#1910](https://github.com/sct/overseerr/issues/1910)) ([fe89fd5](https://github.com/sct/overseerr/commit/fe89fd5f12460cb1b3acb09fb16b62497ef50f5f))
- **lang:** translations update from Weblate ([#2058](https://github.com/sct/overseerr/issues/2058)) ([db42c46](https://github.com/sct/overseerr/commit/db42c4678145d2a9676aa71b6773607b696f7cea))
- **notif:** Restyle HTML email notifications Part 2 ([#1917](https://github.com/sct/overseerr/issues/1917)) ([376149d](https://github.com/sct/overseerr/commit/376149d6ebb4db28d949391115f475afdd4e7d48))
- **ui:** add 'show more/less...' for studios on movie details page ([#1770](https://github.com/sct/overseerr/issues/1770)) ([680ea0c](https://github.com/sct/overseerr/commit/680ea0c87a9ae143413354680c421d62bccd869d))
- new logo, who dis? ([#1802](https://github.com/sct/overseerr/issues/1802)) ([beb5637](https://github.com/sct/overseerr/commit/beb5637d9f5c01d773eaee93035b7c195c2ae5f2))

# [1.25.0](https://github.com/sct/overseerr/compare/v1.24.0...v1.25.0) (2021-06-10)

### Bug Fixes

- **frontend:** add missing route guards to settings pages ([#1700](https://github.com/sct/overseerr/issues/1700)) ([78fc1f7](https://github.com/sct/overseerr/commit/78fc1f7b7d9ef912077066a3605fed6237fb4c8a))
- **locale:** set locale based on user settings upon login ([#1584](https://github.com/sct/overseerr/issues/1584)) ([f48312e](https://github.com/sct/overseerr/commit/f48312e833ed5d48c41179d0eadbc66d45486d8a))
- **notif:** include year in Media Available notifications ([#1672](https://github.com/sct/overseerr/issues/1672)) ([11aa712](https://github.com/sct/overseerr/commit/11aa712eb0e8796874c96fbcc9b51b523108e2d4))
- **plex:** disable library sync if Plex not configured, and disable scan if no libraries ([#1764](https://github.com/sct/overseerr/issues/1764)) ([22238fe](https://github.com/sct/overseerr/commit/22238fe4f711267d001be95942b3151c536e0c18))
- **plex:** do not fail to import Plex users when Plex Home has managed users ([#1699](https://github.com/sct/overseerr/issues/1699)) ([310cdb3](https://github.com/sct/overseerr/commit/310cdb36df1601bca5e57f0bc796c44111b8435f))
- **plex:** sync libraries after saving settings ([#1592](https://github.com/sct/overseerr/issues/1592)) ([9749d72](https://github.com/sct/overseerr/commit/9749d723fc0a282b291c06ee68a6e174dcec1c5b))
- **requests:** appropriately set modifiedBy user for new requests ([#1684](https://github.com/sct/overseerr/issues/1684)) ([a3f04b3](https://github.com/sct/overseerr/commit/a3f04b3f3522d46dc65178bddd1e986426e48050))
- **requests:** do not prevent duplicate requests if other requests are declined ([de0759c](https://github.com/sct/overseerr/commit/de0759c26a9e857e2b8d7244673625fc79ee4660))
- **requests:** prevent duplicate movie requests ([126d866](https://github.com/sct/overseerr/commit/126d8665ee2808fc0bc37df4ca61f3e63be096e2))
- check that application URL and email agent are configured for password reset/generation ([#1724](https://github.com/sct/overseerr/issues/1724)) ([091d66a](https://github.com/sct/overseerr/commit/091d66a1928d3c69a11eab2a789b4639b5ba9817))
- correctly display error messages ([#1653](https://github.com/sct/overseerr/issues/1653)) ([31cb717](https://github.com/sct/overseerr/commit/31cb7176d286e706575a2dc8003df13f3e737106))
- handle null values in User email transform ([#1712](https://github.com/sct/overseerr/issues/1712)) ([4a042f1](https://github.com/sct/overseerr/commit/4a042f12be6510ee47de3a7e025497f8d132d6a1))
- **lang:** only set locale once at page load and move subsequent updates back into Layout ([14756f4](https://github.com/sct/overseerr/commit/14756f4b208c5b201a6e632b43e7a21c5bec6f9c)), closes [#1662](https://github.com/sct/overseerr/issues/1662)
- **locale:** properly restore display language upon page refresh ([#1646](https://github.com/sct/overseerr/issues/1646)) ([e85d1ce](https://github.com/sct/overseerr/commit/e85d1ce94ec45d8f5d086722cfd88e0e2c5b4bb6))
- **notifications:** default webpush notification agent to enabled for users for settings response ([7520e24](https://github.com/sct/overseerr/commit/7520e24e9287e214dd31224f1201e9b6385fd567)), closes [#1663](https://github.com/sct/overseerr/issues/1663)
- **quotas:** do not count already-requested seasons when editing TV request ([#1649](https://github.com/sct/overseerr/issues/1649)) ([808ccf1](https://github.com/sct/overseerr/commit/808ccf1c6975f853db6dc89f4d9f1f5488dbaae3))
- **requests:** remove requestedBy user param from existing movie request check ([#1569](https://github.com/sct/overseerr/issues/1569)) ([788f3dc](https://github.com/sct/overseerr/commit/788f3dc435ae224fcc4d4cb2890b1b9b494c64e8))
- **sensitiveinput:** do not capture enter key input ([#1650](https://github.com/sct/overseerr/issues/1650)) ([bb8d14b](https://github.com/sct/overseerr/commit/bb8d14b5ffd840eff0c2a00e1b5d318677a5ca5f))
- **sonarr:** do not mark media as failed if there is no season data on TVDB ([#1691](https://github.com/sct/overseerr/issues/1691)) ([0cd7fa0](https://github.com/sct/overseerr/commit/0cd7fa0f1a00d129339be13550a4f694c820a0e9))
- **tv:** don't show duplicate air date ([#1666](https://github.com/sct/overseerr/issues/1666)) ([e1f5feb](https://github.com/sct/overseerr/commit/e1f5febe7bbf27e77b6f5d057c2c3f7e22898734))
- **ui:** add clarification to user settings ([#1644](https://github.com/sct/overseerr/issues/1644)) ([2ef57e9](https://github.com/sct/overseerr/commit/2ef57e9b1a5b4d0a1499921f4e26b0b0712d7ded))
- **ui:** correct horizontal overflow behavior of settings tabs ([#1667](https://github.com/sct/overseerr/issues/1667)) ([e6d5f0a](https://github.com/sct/overseerr/commit/e6d5f0abfebdc24f25d08822b57a8eb7bc48e137))
- **ui:** hide advanced request options when there is only one choice ([#1591](https://github.com/sct/overseerr/issues/1591)) ([6b26188](https://github.com/sct/overseerr/commit/6b26188d888a1f80bd36a1968e41333bab2af794))
- **ui:** improve QuotaSelector display of unlimited and singular values ([#1704](https://github.com/sct/overseerr/issues/1704)) ([59b2ec1](https://github.com/sct/overseerr/commit/59b2ec11fa8868bf6873ffa80f4999ae10d65637))
- perform case-insensitive match for local user email addresses ([#1633](https://github.com/sct/overseerr/issues/1633)) ([928b8a7](https://github.com/sct/overseerr/commit/928b8a71cf361b7bc2b8957c621f5b66c4657b1e))
- **ui:** apply pointer cursor style for clickable status badges ([#1632](https://github.com/sct/overseerr/issues/1632)) ([6968caa](https://github.com/sct/overseerr/commit/6968caa35a70c172bdd57c984fde6cb6a04a1470))
- **ui:** remove delete button from request cards ([#1635](https://github.com/sct/overseerr/issues/1635)) ([6b37242](https://github.com/sct/overseerr/commit/6b37242a3f5a3b332d259f4814d235d751ae2491))
- switch PGP regex to span multiple lines ([#1598](https://github.com/sct/overseerr/issues/1598)) ([d0703aa](https://github.com/sct/overseerr/commit/d0703aa37772759e8e28b5da7187e97e7aadc495))
- **ui:** hide Plex alert after setup and add local login warning to local user modal ([#1600](https://github.com/sct/overseerr/issues/1600)) ([694d0ff](https://github.com/sct/overseerr/commit/694d0ffcf6b3e3fa00175400fa4217a7d6eb787f))

### Features

- **lang:** add Greek display language ([#1605](https://github.com/sct/overseerr/issues/1605)) ([2241564](https://github.com/sct/overseerr/commit/22415642e8602809e3507e5b13dc2f8de3000003))
- **lang:** translations update from Weblate ([#1585](https://github.com/sct/overseerr/issues/1585)) ([361ea77](https://github.com/sct/overseerr/commit/361ea77588db3dc04a51dd3a62c73ae1297cdce2))
- **lang:** translations update from Weblate ([#1603](https://github.com/sct/overseerr/issues/1603)) ([2efa7fa](https://github.com/sct/overseerr/commit/2efa7faf20d05a5fc423e0151c6b46fe6212d096))
- **lang:** translations update from Weblate ([#1639](https://github.com/sct/overseerr/issues/1639)) ([d22400d](https://github.com/sct/overseerr/commit/d22400dbc9320743498eeb8e6a4dcbccf1a4d52d))
- **lang:** translations update from Weblate ([#1676](https://github.com/sct/overseerr/issues/1676)) ([8a80571](https://github.com/sct/overseerr/commit/8a805716e3e34ae8d081ad47f9d4cd68f88b0116))
- **lang:** translations update from Weblate ([#1703](https://github.com/sct/overseerr/issues/1703)) ([6a3649f](https://github.com/sct/overseerr/commit/6a3649f620e518ff07a48c17ce1182aaedff398a))
- **lang:** translations update from Weblate ([#1727](https://github.com/sct/overseerr/issues/1727)) ([60c3ced](https://github.com/sct/overseerr/commit/60c3ced9e2466568eecde93c88410c87ff0b796f))
- **lang:** translations update from Weblate ([#1746](https://github.com/sct/overseerr/issues/1746)) ([37a4df6](https://github.com/sct/overseerr/commit/37a4df646cc3e3101360037f1b6f061a734eb5e2))
- **lang:** translations update from Weblate ([#1768](https://github.com/sct/overseerr/issues/1768)) ([dedf95e](https://github.com/sct/overseerr/commit/dedf95e574a15a708866c381353e58ce3b3a1a61))
- add display name to create local user modal ([#1631](https://github.com/sct/overseerr/issues/1631)) ([44c3edb](https://github.com/sct/overseerr/commit/44c3edb98568ba15eb525e665115429cfb15d28b))
- allow users to select notification types ([#1512](https://github.com/sct/overseerr/issues/1512)) ([e605989](https://github.com/sct/overseerr/commit/e60598905b2d6eef7c1872d0c9e92e6d70508ae8))
- **notif:** prevent manage-request users receiving auto-approve notif from their requests ([#1707](https://github.com/sct/overseerr/issues/1707)) ([#1709](https://github.com/sct/overseerr/issues/1709)) ([9ead8bb](https://github.com/sct/overseerr/commit/9ead8bb1f1680b522550f963502c83e2f99d1e96))
- **plex:** add support for custom Plex Web App URLs ([#1581](https://github.com/sct/overseerr/issues/1581)) ([a640a91](https://github.com/sct/overseerr/commit/a640a91390f1411637ad379a8253002fdf60480f))
- **pwa:** add notification badge icon ([#1695](https://github.com/sct/overseerr/issues/1695)) ([9b3b6a9](https://github.com/sct/overseerr/commit/9b3b6a9170b25209e54c74aa9e96659bc2d19edd))
- **ui:** request list item & request card improvements ([#1532](https://github.com/sct/overseerr/issues/1532)) ([d7b9b1a](https://github.com/sct/overseerr/commit/d7b9b1a525ec6d1d81ad6fe4e55994dd8428988f))
- **webpush:** add warning to web push settings re: HTTPS requirement ([#1599](https://github.com/sct/overseerr/issues/1599)) ([0c4fb64](https://github.com/sct/overseerr/commit/0c4fb6446be425905a120df5be9a28b052e884c0))

### Reverts

- **deps:** revert back to typeorm 0.2.32 ([4368c3a](https://github.com/sct/overseerr/commit/4368c3aa4f88425ec08f3b555419e572cfa320e3))
- **deps:** use 10.1.3 until css import issue is resolved ([2254248](https://github.com/sct/overseerr/commit/2254248abc0f2051a9dd28d9663c7ab1d0b547b6))
- **requests:** go back to old modifiedBy request values for now ([0918b25](https://github.com/sct/overseerr/commit/0918b254132b0541999486e1f0679d0c0cd65864))

# [1.24.0](https://github.com/sct/overseerr/compare/v1.23.2...v1.24.0) (2021-05-05)

### Bug Fixes

- **api:** do not try to transform empty values passed to user notificationTypes ([ef3f977](https://github.com/sct/overseerr/commit/ef3f9778aa81f8ed39dcd835d63d94f2248e0204)), closes [#1501](https://github.com/sct/overseerr/issues/1501)
- **backend:** properly set request media status ([#1541](https://github.com/sct/overseerr/issues/1541)) ([b7b55e2](https://github.com/sct/overseerr/commit/b7b55e275cb2f1f61c3057cb8ab4cb1027f6356d))
- **css:** don't target button globally ([#1510](https://github.com/sct/overseerr/issues/1510)) ([f78b9c1](https://github.com/sct/overseerr/commit/f78b9c1ca9648eb10b010e526d9b9db09648b154))
- **css:** fix cog icon size on media detail pages ([#1520](https://github.com/sct/overseerr/issues/1520)) ([26ddc03](https://github.com/sct/overseerr/commit/26ddc03b2c01b343c24f1c359b78c587310cc747))
- **email:** parse sender hostname from application URL ([#1518](https://github.com/sct/overseerr/issues/1518)) ([3baa55c](https://github.com/sct/overseerr/commit/3baa55c690dd9ba39768b8b271595cb6b09fe6da))
- **lang:** correct overwritten email toast strings ([11a5e8d](https://github.com/sct/overseerr/commit/11a5e8d95bc2a2f16adf1e48d2ef38b508a6ace5))
- **locale:** default user locale should be the server setting ([#1574](https://github.com/sct/overseerr/issues/1574)) ([549103f](https://github.com/sct/overseerr/commit/549103f6f6d5624201e425df7d7814f0f67863b9))
- **pwa:** add Discover shortcut and fix/optimize icons ([#1525](https://github.com/sct/overseerr/issues/1525)) ([e1dc62b](https://github.com/sct/overseerr/commit/e1dc62b0a5b64202701aff821837ed11dd3f12db))
- **radarr:** only process Radarr movies which are either monitored or downloaded ([#1511](https://github.com/sct/overseerr/issues/1511)) ([85899ab](https://github.com/sct/overseerr/commit/85899ab49a27542390e91443531905737224338d))
- **ui:** add missing margins on button SVGs on Plex Settings page ([#1546](https://github.com/sct/overseerr/issues/1546)) ([5e588be](https://github.com/sct/overseerr/commit/5e588be8127b50dd83477f7f3a65f18de774e8af))
- **ui:** add user profile links to RequestBlock and change 'ETA' string in DownloadBlock ([#1551](https://github.com/sct/overseerr/issues/1551)) ([e4d0029](https://github.com/sct/overseerr/commit/e4d0029f7b4245b8606e2447c54629def40c7761))
- **ui:** apply rounded-l-only to SensitiveInput textareas and increase visible text input area ([#1561](https://github.com/sct/overseerr/issues/1561)) ([1123fce](https://github.com/sct/overseerr/commit/1123fce089b86251dcafebf77743d60a6e396bee))
- **ui:** correct RegionSelector z-index ([#1567](https://github.com/sct/overseerr/issues/1567)) ([e912a00](https://github.com/sct/overseerr/commit/e912a00880f856fa9621e8587ef1cc6513a3d49c))
- **ui:** correct toasts being in the wrong position on smaller screens ([2ecd9d7](https://github.com/sct/overseerr/commit/2ecd9d7b1391b8fc83e9c12a18bab105e7148f0f))
- **ui:** default to text input type for SensitiveInputs ([#1568](https://github.com/sct/overseerr/issues/1568)) ([e2acf88](https://github.com/sct/overseerr/commit/e2acf8887cb0456c80308bd1b7f3bbe1930e8cff))
- **ui:** explicitly specify width/height of Listbox dropdown icon ([#1514](https://github.com/sct/overseerr/issues/1514)) ([802e40a](https://github.com/sct/overseerr/commit/802e40a5dfa00f897f9d5a741718a319f74ff030))
- **ui:** improve form usability ([#1563](https://github.com/sct/overseerr/issues/1563)) ([26580ea](https://github.com/sct/overseerr/commit/26580eaa218702bc5841718310e340d049c50332))
- **ui:** show warning if user has both a default non-4K server and a non-default 4K server ([#1478](https://github.com/sct/overseerr/issues/1478)) ([4faddf3](https://github.com/sct/overseerr/commit/4faddf3810e20851c7ae1251ff0187fa13d7b0f6))
- **webpush:** only prompt user to allow notifications if enabled in user settings ([#1552](https://github.com/sct/overseerr/issues/1552)) ([b05b177](https://github.com/sct/overseerr/commit/b05b177776a5d22bf3b5e93bad4358f4007b879a))
- correctly fall back to English name in LanguageSelector ([#1537](https://github.com/sct/overseerr/issues/1537)) ([189313e](https://github.com/sct/overseerr/commit/189313e94a16e694d192d157642d77f664fd709b))
- do not set locale when modifying other users ([#1499](https://github.com/sct/overseerr/issues/1499)) ([4858771](https://github.com/sct/overseerr/commit/48587719e9474139c7bbc2970b1c7d1d17b78a81))

### Features

- **email:** replace 'Enable SSL' setting with more descriptive/clear 'Encryption Method' setting ([#1549](https://github.com/sct/overseerr/issues/1549)) ([69ab7cc](https://github.com/sct/overseerr/commit/69ab7cc660bea43b70bdb646eabd3866c1b5a90f))
- **inputs:** add support for toggling security on input fields ([#1404](https://github.com/sct/overseerr/issues/1404)) ([4fd452d](https://github.com/sct/overseerr/commit/4fd452dd1880f597a0acda812d567e7cb6c16d83))
- **lang:** translated using Weblate (Spanish) ([#1553](https://github.com/sct/overseerr/issues/1553)) ([e3d5e33](https://github.com/sct/overseerr/commit/e3d5e33ec3e43d36ec832d6ca47f330fc7675088))
- **lang:** translations update from Weblate ([#1497](https://github.com/sct/overseerr/issues/1497)) ([9a95a07](https://github.com/sct/overseerr/commit/9a95a073916c9968b8ef348d0805d77400ea203a))
- **lang:** translations update from Weblate ([#1527](https://github.com/sct/overseerr/issues/1527)) ([1a6d4bd](https://github.com/sct/overseerr/commit/1a6d4bddc016f4aaad83b945e103b19be4d0da31))
- **lang:** translations update from Weblate ([#1558](https://github.com/sct/overseerr/issues/1558)) ([6c9991d](https://github.com/sct/overseerr/commit/6c9991d474a5cd95d9a0a10104bd79d8a9f3ada9))
- **lang:** translations update from Weblate ([#1566](https://github.com/sct/overseerr/issues/1566)) ([93c441e](https://github.com/sct/overseerr/commit/93c441ef6665291ca3698368e4b093c843726036))
- add server default locale setting ([#1536](https://github.com/sct/overseerr/issues/1536)) ([f256a44](https://github.com/sct/overseerr/commit/f256a444c57f2d92c1c4918d4ff6e223ef85ecd2))
- **notif:** add LunaSea agent ([#1495](https://github.com/sct/overseerr/issues/1495)) ([4e6fb00](https://github.com/sct/overseerr/commit/4e6fb00a4a59545817add1544c0b1555078809a4))
- **notif:** show success/failure toast for test notifications ([#1442](https://github.com/sct/overseerr/issues/1442)) ([079645c](https://github.com/sct/overseerr/commit/079645c2c74edfb7e4f583de2ac72bb9824f6524))
- **perms:** add separate REQUEST_MOVIE and REQUEST_TV permissions ([#1474](https://github.com/sct/overseerr/issues/1474)) ([91b9e0f](https://github.com/sct/overseerr/commit/91b9e0f67996a442b5c0117fe09e2d69c163fafb))
- **pwa:** add shortcuts to PWA ([#1509](https://github.com/sct/overseerr/issues/1509)) ([ed99e49](https://github.com/sct/overseerr/commit/ed99e4976dc2700fe84c70af4887c1a431bba92c))
- add option to only allow Plex sign-in from existing users ([#1496](https://github.com/sct/overseerr/issues/1496)) ([db49b20](https://github.com/sct/overseerr/commit/db49b2024d399d90f2d1500b262374efc42f333c))
- PWA Support ([#1488](https://github.com/sct/overseerr/issues/1488)) ([28830d4](https://github.com/sct/overseerr/commit/28830d4ef809efa92a5879a81cac11ff52ea3d1f))

## [1.23.2](https://github.com/sct/overseerr/compare/v1.23.1...v1.23.2) (2021-04-21)

### Bug Fixes

- **lang:** add missing '4K' from singular case of approve/deny 4K request strings ([#1481](https://github.com/sct/overseerr/issues/1481)) ([a822b01](https://github.com/sct/overseerr/commit/a822b019220e86e362a2570e7024289450b4ed46))
- **ui:** change 'Disable Auto-Search' checkbox to 'Enable Automatic Search' ([#1476](https://github.com/sct/overseerr/issues/1476)) ([1a311d2](https://github.com/sct/overseerr/commit/1a311d211d78731c9089e66ed5387c1b5afe33c0))
- better error message when creating a user with an existing email ([f13f1c9](https://github.com/sct/overseerr/commit/f13f1c94515b5bd51382fa18ad96a2ccfd06e50d)), closes [#1441](https://github.com/sct/overseerr/issues/1441)
- set editRequest attribute as necessary, allow users to edit their own pending requests, and show 'View Request' button on series pages ([#1446](https://github.com/sct/overseerr/issues/1446)) ([89455ad](https://github.com/sct/overseerr/commit/89455ad9b783d04d993a0009c351b1096f2b222e))
- **api:** add check for 4K request perms to request creation endpoint ([#1450](https://github.com/sct/overseerr/issues/1450)) ([4449241](https://github.com/sct/overseerr/commit/4449241a8f63fdaeaa4995aa7ec34127c322b9dd))
- **notif:** include year in notifications ([#1439](https://github.com/sct/overseerr/issues/1439)) ([4e98f56](https://github.com/sct/overseerr/commit/4e98f567534a650e26b0244990b7ca549cecbe89))
- **plex:** add support for plex.direct URLs ([#1437](https://github.com/sct/overseerr/issues/1437)) ([db07770](https://github.com/sct/overseerr/commit/db077700e42ab1d2c870213fd55bbdee74002775))
- **radarr:** search in addition to monitoring existing movies ([#1449](https://github.com/sct/overseerr/issues/1449)) ([3ae7d00](https://github.com/sct/overseerr/commit/3ae7d0098b225562499d7c8a74b8b6c3e8893ad9))
- **ui:** adjust user list buttons on mobile ([#1452](https://github.com/sct/overseerr/issues/1452)) ([5d1b741](https://github.com/sct/overseerr/commit/5d1b741f55665c528e299a09464dff6d66f72666))
- **ui:** align icons in user dropdown ([eb5d152](https://github.com/sct/overseerr/commit/eb5d1528869959cdf642e6fefc1a8f4dcf51b84e))

## [1.23.1](https://github.com/sct/overseerr/compare/v1.23.0...v1.23.1) (2021-04-16)

### Bug Fixes

- **api:** correctly check if update is available for release versions ([190cbd6](https://github.com/sct/overseerr/commit/190cbd6559c51a02ec09b267891f3033add6afc8))

# [1.23.0](https://github.com/sct/overseerr/compare/v1.22.0...v1.23.0) (2021-04-16)

### Bug Fixes

- **api:** allow server owner to delete other admin accounts ([2ac6fe7](https://github.com/sct/overseerr/commit/2ac6fe7f6d666d64228d11cde24865acc54c7ce7))
- **backend:** do not log error when user has no server access ([#1419](https://github.com/sct/overseerr/issues/1419)) ([fc14037](https://github.com/sct/overseerr/commit/fc14037ec1c0b7450d892fa9be8176f5b9ff9d73))
- **frontend:** add crossorigin attribute to webmanifest link ([#1376](https://github.com/sct/overseerr/issues/1376)) ([82ca2f5](https://github.com/sct/overseerr/commit/82ca2f59349407e3b1b5cd4f321e196f37044df0))
- **frontend:** autofill with Plex server address ([#1381](https://github.com/sct/overseerr/issues/1381)) ([d9e314b](https://github.com/sct/overseerr/commit/d9e314bad295463d26d8ffe92728f3b5eee4ad05))
- **frontend:** handle media items/requests no longer having a valid tmdb id ([b5ac2f5](https://github.com/sct/overseerr/commit/b5ac2f5a2c5dda808eca177359f125d6e03d1b0f)), closes [#517](https://github.com/sct/overseerr/issues/517)
- **lang:** remove unused strings & correct manageModalNoRequests strings ([#1413](https://github.com/sct/overseerr/issues/1413)) ([190a5c0](https://github.com/sct/overseerr/commit/190a5c0723d4aeafc4ad6103d52c2042a4eaed0e))
- **plex:** do not use SSL for local servers ([#1418](https://github.com/sct/overseerr/issues/1418)) ([9233fc0](https://github.com/sct/overseerr/commit/9233fc078579df8a193344ba45bafb0d5c2cb9af))
- **plex:** use server 'address' returned by Plex API ([#1379](https://github.com/sct/overseerr/issues/1379)) ([33542c9](https://github.com/sct/overseerr/commit/33542c9b2dc53b1e036a7d9571cf467c3d3dc8af))
- **quotas:** Time value of a quota was being ignored ([d3c6bc1](https://github.com/sct/overseerr/commit/d3c6bc1619c39b1e6225d405efaad5df99a27406))
- **ui:** allow canceling from request list & hide edit button for own requests ([#1401](https://github.com/sct/overseerr/issues/1401)) ([bed850d](https://github.com/sct/overseerr/commit/bed850dce9ad0d0b52c3c628225aea938164c38b))
- **ui:** close sidebar on mobile when clicking version status ([ad67381](https://github.com/sct/overseerr/commit/ad673813976669797202c2cefc50274aca84989d))
- **ui:** correctly set autocomplete attribute for password fields ([#1430](https://github.com/sct/overseerr/issues/1430)) ([4b5e355](https://github.com/sct/overseerr/commit/4b5e355df9e291a5cb550483c7dad6c43f03d3a7))
- **ui:** dim password field when password generation option is selected ([#1427](https://github.com/sct/overseerr/issues/1427)) ([e8bbd44](https://github.com/sct/overseerr/commit/e8bbd4497a5eab6357fa7b37c9906285b3d1f64f))
- **ui:** hide alert when email notifs are already configured ([#1335](https://github.com/sct/overseerr/issues/1335)) ([5117987](https://github.com/sct/overseerr/commit/5117987feaed21ccc19e64b04a15f2b77c22b880))
- fall back to English genre names ([#1352](https://github.com/sct/overseerr/issues/1352)) ([e43106a](https://github.com/sct/overseerr/commit/e43106a434548840acecaf1276a5cebdc30e1345))
- fix outofdate string & display version status badge in Settings > About ([#1417](https://github.com/sct/overseerr/issues/1417)) ([4eb9209](https://github.com/sct/overseerr/commit/4eb92098ba1f141bf74875ce76816a615763de5f))
- various fixes for new tags feature ([#1369](https://github.com/sct/overseerr/issues/1369)) ([b4450a3](https://github.com/sct/overseerr/commit/b4450a308c56f767fbaa769d574a1b3f8e221d59))
- **ui:** link request card status badge to Plex media URL ([#1361](https://github.com/sct/overseerr/issues/1361)) ([7a5c4a3](https://github.com/sct/overseerr/commit/7a5c4a30b5735fe6fbe821a8fcfdb4bcbeca68b3))

### Features

- **lang:** Translations update from Weblate ([#1429](https://github.com/sct/overseerr/issues/1429)) ([a54241c](https://github.com/sct/overseerr/commit/a54241c775705fadc7c044f5312307f28f9a854b))
- change alpha warning to beta warning ([03fd21b](https://github.com/sct/overseerr/commit/03fd21bebc3ffa34ce983b524d09e74b8ab2d057))
- **lang:** translated using Weblate (Catalan) ([#1351](https://github.com/sct/overseerr/issues/1351)) ([35c13a8](https://github.com/sct/overseerr/commit/35c13a87467b4deabab3cb2cd1cab1b24ab51875))
- **lang:** translations update from Weblate ([#1360](https://github.com/sct/overseerr/issues/1360)) ([8ee7693](https://github.com/sct/overseerr/commit/8ee7693a1f00a2f735b2555c7f8180c8a2c6144f))
- **lang:** translations update from Weblate ([#1416](https://github.com/sct/overseerr/issues/1416)) ([dceca4d](https://github.com/sct/overseerr/commit/dceca4dd97f78f2e3aef678edcd5755c781f5249))
- add overseerr version and update availability status to sidebar ([ecf1312](https://github.com/sct/overseerr/commit/ecf13123d21d765d67bfa7f9b6509b0f2af62cee))
- **lang:** translations update from Weblate ([#1388](https://github.com/sct/overseerr/issues/1388)) ([9b199b2](https://github.com/sct/overseerr/commit/9b199b27d806e290cf0551e2d2ede6add61770aa))
- **lang:** translations update from Weblate ([#1396](https://github.com/sct/overseerr/issues/1396)) ([3daf57e](https://github.com/sct/overseerr/commit/3daf57e9a12e4973dbc56656379ab2dbcb3c2619))
- **notif:** allow users to enable/disable specific agents ([#1172](https://github.com/sct/overseerr/issues/1172)) ([46c4ee1](https://github.com/sct/overseerr/commit/46c4ee1625cf3e74bd885ecfc254b1e46cf44f29))
- **webhook:** include requestedBy user in payload ([#1385](https://github.com/sct/overseerr/issues/1385)) ([e605687](https://github.com/sct/overseerr/commit/e60568758097d07f9d4b201ffdf34f0c32ba9cf3))
- radarr/sonarr tag support ([#1366](https://github.com/sct/overseerr/issues/1366)) ([a306ebc](https://github.com/sct/overseerr/commit/a306ebc2d18317d8dbe4ccd3f24c22f55ffcd6a6))

# [1.22.0](https://github.com/sct/overseerr/compare/v1.21.1...v1.22.0) (2021-04-01)

### Bug Fixes

- **android:** adaptive icons for Android devices ([#1274](https://github.com/sct/overseerr/issues/1274)) ([a65e3d5](https://github.com/sct/overseerr/commit/a65e3d5bb6924cbde30b26ff8acf535e5274efee))
- **backend:** fix getShowByTvdbId() error message ([#1314](https://github.com/sct/overseerr/issues/1314)) [skip ci] ([fe8d346](https://github.com/sct/overseerr/commit/fe8d34607b07095dce51b29ef7aaae0485573f14))
- **db:** enable WAL journal mode ([aa205ff](https://github.com/sct/overseerr/commit/aa205ffa975d02ef0be30626e7c946a42679a847))
- **frontend:** 'Recent Requests' slider should link to request list w/ same filter ([#1235](https://github.com/sct/overseerr/issues/1235)) ([49782c0](https://github.com/sct/overseerr/commit/49782c0b730cce9f0bad14e9c83842b5b0bfe11e))
- **frontend:** call mutate after changing public settings ([#1302](https://github.com/sct/overseerr/issues/1302)) ([c8f67cf](https://github.com/sct/overseerr/commit/c8f67cf866ada791e4129a0bbae16b9eac41f32e))
- **frontend:** include language parameter in TMDb links ([#1344](https://github.com/sct/overseerr/issues/1344)) ([1d88be9](https://github.com/sct/overseerr/commit/1d88be9341a8ff9e1f39b02556b489cdbd06392b))
- **frontend:** redirect from /setup if already initialized ([#1238](https://github.com/sct/overseerr/issues/1238)) ([8016503](https://github.com/sct/overseerr/commit/80165038fd214897e3520a420f971341e7b94865))
- **frontend:** use correct path to user profile in request modal quota dropdown ([#1307](https://github.com/sct/overseerr/issues/1307)) ([f990585](https://github.com/sct/overseerr/commit/f9905859148088afec53549b81611b07bf19d3b9))
- **frontend:** use HTTPS to fetch TMDb assets for network/studio sliders ([#1343](https://github.com/sct/overseerr/issues/1343)) ([c886ea6](https://github.com/sct/overseerr/commit/c886ea6c0578cb7532d6c09266a76bfad8598b9d))
- **frontend:** use next/image to serve login page images ([cbf4519](https://github.com/sct/overseerr/commit/cbf45196b023f60c8e4cf7602c0295f886fe610c)), closes [#1207](https://github.com/sct/overseerr/issues/1207)
- **lang:** allow proper localization of comma-delimited lists ([#1264](https://github.com/sct/overseerr/issues/1264)) ([173408a](https://github.com/sct/overseerr/commit/173408a1f269f09c724843ba087ef3f85b2832ad))
- **lang:** change 'Extra Data' string to 'Additional Data' ([#1226](https://github.com/sct/overseerr/issues/1226)) ([665e164](https://github.com/sct/overseerr/commit/665e16475f3fa2ea6118340d9ea2d30b98abb238))
- **lang:** correct mismatched language strings ([#1246](https://github.com/sct/overseerr/issues/1246)) ([8ebc829](https://github.com/sct/overseerr/commit/8ebc8292504cdc57a148ab69bcb4e1514ef018c6))
- **lang:** correct strings for library sync button & user import toast ([#1252](https://github.com/sct/overseerr/issues/1252)) ([cb5ca7a](https://github.com/sct/overseerr/commit/cb5ca7acf38dcc2e27ec31d88434a11757cdb469))
- **lang:** edit setting label strings for verb tense consistency ([#1214](https://github.com/sct/overseerr/issues/1214)) ([6d7671d](https://github.com/sct/overseerr/commit/6d7671dd80fea632e5cef29fc0b4968bffe231b0))
- **lang:** fix overwritten/shared string ([#1212](https://github.com/sct/overseerr/issues/1212)) ([dfd4ff9](https://github.com/sct/overseerr/commit/dfd4ff9229822b0ce79ba322376194cbb6fd233d))
- **lang:** remove 'requires and' ([#1215](https://github.com/sct/overseerr/issues/1215)) ([cb852fd](https://github.com/sct/overseerr/commit/cb852fded18f53806c23ec6f215385072b2a867b))
- **lang:** remove unused strings ([#1330](https://github.com/sct/overseerr/issues/1330)) ([13e1595](https://github.com/sct/overseerr/commit/13e1595c6ebff32ca905d9bd3dd781e241545e83))
- **lang:** UI string edits, round 2 ([#1202](https://github.com/sct/overseerr/issues/1202)) ([ea1863a](https://github.com/sct/overseerr/commit/ea1863ac3a5d3051e07815d07df0d3f2abd9166f))
- **log:** fix typo in base scanner logging ([#1329](https://github.com/sct/overseerr/issues/1329)) [skip ci] ([b0b04ca](https://github.com/sct/overseerr/commit/b0b04ca1c7218ad5b67d9ec8b3fac5af78a4c132))
- **logs:** add i18n strings for new log page changes ([8c51c28](https://github.com/sct/overseerr/commit/8c51c28f546b9c2d38ff7f20d59bb08a599e8146))
- **notifications:** correctly send notifications for users that do not have any user settings yet ([d3a25b9](https://github.com/sct/overseerr/commit/d3a25b935aae35dd97ef0f168ac7e2898126a9a5)), closes [#1324](https://github.com/sct/overseerr/issues/1324)
- **overseerr-api.yml:** fixed pushbullet & webhook API definition refs and descriptions ([#1288](https://github.com/sct/overseerr/issues/1288)) [skip ci] ([3b003b7](https://github.com/sct/overseerr/commit/3b003b770120f7d150c64ff098b626015c030794))
- **plex:** always send Overseerr for the device name to the plex.tv api ([f7146e4](https://github.com/sct/overseerr/commit/f7146e41899a59f75b963e1cc9dac9eddf24aebe)), closes [#1244](https://github.com/sct/overseerr/issues/1244)
- **ui:** add validation to hostname/IP fields ([#1206](https://github.com/sct/overseerr/issues/1206)) ([f49a024](https://github.com/sct/overseerr/commit/f49a02449c4928aef56cecbf908cf585ea0d4fca))
- **ui:** better regex matching when parsing logs ([#1225](https://github.com/sct/overseerr/issues/1225)) ([2d737f2](https://github.com/sct/overseerr/commit/2d737f276095a8ca9abea360ef29134e9f639a39))
- **ui:** button w/ dropdown z-indices ([#1230](https://github.com/sct/overseerr/issues/1230)) ([015671f](https://github.com/sct/overseerr/commit/015671f5be7a9f0f5c38db5a11a4b3c788dfaade))
- **ui:** center role under title cards on person detail pages ([#1205](https://github.com/sct/overseerr/issues/1205)) ([4a61518](https://github.com/sct/overseerr/commit/4a6151873a3a3c5e45f9817131774a2c52957138))
- **ui:** correctly enable the request button when partial requests are disabled with no quota ([16a611b](https://github.com/sct/overseerr/commit/16a611b9dfc3c66483640f4f5364646f41d37159))
- **ui:** correctly paginate request list ([67fbb40](https://github.com/sct/overseerr/commit/67fbb401ac6ba05e58b8dfefd5954b28316254f2))
- **ui:** correctly show quota display on tv request modal when only series quota is set ([3f1f85a](https://github.com/sct/overseerr/commit/3f1f85a80edfd2a4e9627162ff29ca6bcf2d8583))
- **ui:** display asterisk indicator on required field labels ([#1236](https://github.com/sct/overseerr/issues/1236)) ([380d361](https://github.com/sct/overseerr/commit/380d36119f19a20ad67f79b3fb5db4036a093cac))
- **ui:** do not check isValid on Sonarr/Radarr modals for the test button ([0974a4c](https://github.com/sct/overseerr/commit/0974a4c971358b7a64668f9a63fc356234a656c9))
- **ui:** do not require numeric value in FormattedRelativeTime ([#1234](https://github.com/sct/overseerr/issues/1234)) ([3642b1e](https://github.com/sct/overseerr/commit/3642b1e84a20fef72428b3e240c86d35be8be8a2))
- **ui:** filter out server options that do not match request type (non-4K or 4K) ([#1183](https://github.com/sct/overseerr/issues/1183)) ([28a6a70](https://github.com/sct/overseerr/commit/28a6a70e1ecc125f4cf4900e599ad0d4d7b55e3b))
- **ui:** fix label formatting in general user settings ([#1275](https://github.com/sct/overseerr/issues/1275)) ([8546b0e](https://github.com/sct/overseerr/commit/8546b0ef53d232256b62cf08466e692a6971c16b))
- **ui:** fix regex matching when parsing label from logs ([#1231](https://github.com/sct/overseerr/issues/1231)) ([4a00617](https://github.com/sct/overseerr/commit/4a00617fe47064ea50f95a02f29832a419ab13a3))
- **ui:** gracefully handle lengthy titles & long words in overviews ([#1338](https://github.com/sct/overseerr/issues/1338)) ([d8bcb99](https://github.com/sct/overseerr/commit/d8bcb99b2fd3b24a5119ba5ff213a640425ff553))
- **ui:** hide 'show details' button if there are no additional details ([#1254](https://github.com/sct/overseerr/issues/1254)) ([6210f12](https://github.com/sct/overseerr/commit/6210f12e8e9f593d629d22278d78310482ca0cfa))
- **ui:** increase page size dropdown width when necessary ([#1216](https://github.com/sct/overseerr/issues/1216)) ([75c72b9](https://github.com/sct/overseerr/commit/75c72b987eb52b907ffd8af33f15ecc58213fc12))
- **ui:** restore saved states of quota override checkboxes ([#1282](https://github.com/sct/overseerr/issues/1282)) ([2059fc1](https://github.com/sct/overseerr/commit/2059fc1cd4d48c7d80e761b7d41b7ec122d82769))
- **ui:** sort regions & languages by their localized names rather than their TMDb English names ([#1157](https://github.com/sct/overseerr/issues/1157)) ([d76bf32](https://github.com/sct/overseerr/commit/d76bf32c9dcc83ebd0bae979726b1456a9028d8b))
- **ui:** tweak request list design ([#1201](https://github.com/sct/overseerr/issues/1201)) ([d226fc7](https://github.com/sct/overseerr/commit/d226fc79b8d5f1263d4b80a7a1772074020ec94f))
- **ui:** use appropriate cursor type for disabled UI elements ([#1184](https://github.com/sct/overseerr/issues/1184)) ([b767a58](https://github.com/sct/overseerr/commit/b767a58b011cc317a889cb8c2889b3210bec5fae))
- **ui:** use appropriate cursor type for readonly input fields ([#1208](https://github.com/sct/overseerr/issues/1208)) ([9ec2c46](https://github.com/sct/overseerr/commit/9ec2c468cbbcbd41b94bbf9f3cfeb43eed09f36e))
- **ui:** use correct colspan for 'No results.' message in Settings > Logs ([#1325](https://github.com/sct/overseerr/issues/1325)) ([5c135c9](https://github.com/sct/overseerr/commit/5c135c9974ebfcbdb434dafd459d1035624df6ed))
- fetch localized person details from TMDb ([#1243](https://github.com/sct/overseerr/issues/1243)) ([1d7a938](https://github.com/sct/overseerr/commit/1d7a938ef8b0b8c20fda5024121de2a217ef4127))

### Features

- **frontend:** add apple splash for pwa ([232def9](https://github.com/sct/overseerr/commit/232def972b9156afcbd83592708dbf8b5866ee24))
- **frontend:** add apple tv+ to network slider ([3dc27ff](https://github.com/sct/overseerr/commit/3dc27ffd9bb054e6cda58872939dbc352877d184)), closes [#1219](https://github.com/sct/overseerr/issues/1219)
- **frontend:** allow selecting multiple original languages ([a908c07](https://github.com/sct/overseerr/commit/a908c07670532b0ca7f766065bb4653ce2376e6f))
- **lang:** add Catalan to language picker ([#1309](https://github.com/sct/overseerr/issues/1309)) ([77911c0](https://github.com/sct/overseerr/commit/77911c03e98aa3c2c6c062a01c22b030704309c2))
- **lang:** translations update from Weblate ([#1178](https://github.com/sct/overseerr/issues/1178)) ([3c89010](https://github.com/sct/overseerr/commit/3c89010629bc16f225f1d3936abe9f4e47a0d7c7))
- **lang:** translations update from Weblate ([#1224](https://github.com/sct/overseerr/issues/1224)) ([c1975b3](https://github.com/sct/overseerr/commit/c1975b33f1115a95068be000b7f479a401f0f0ae))
- **lang:** translations update from Weblate ([#1237](https://github.com/sct/overseerr/issues/1237)) ([dabd32a](https://github.com/sct/overseerr/commit/dabd32a18b42980059c7a7a7450514ca827a5d3b))
- **lang:** translations update from Weblate ([#1256](https://github.com/sct/overseerr/issues/1256)) ([e9b1a9e](https://github.com/sct/overseerr/commit/e9b1a9e80e6b8285fa451a8551c5832a850c1746))
- **lang:** translations update from Weblate ([#1281](https://github.com/sct/overseerr/issues/1281)) ([bec1d3d](https://github.com/sct/overseerr/commit/bec1d3dde834b9a50e24c5894c362e5982ff3bd5))
- **lang:** translations update from Weblate ([#1305](https://github.com/sct/overseerr/issues/1305)) ([1b129c0](https://github.com/sct/overseerr/commit/1b129c0b3863ea3c5ad34c66b3ace5d09cd4e391))
- **lang:** translations update from Weblate ([#1313](https://github.com/sct/overseerr/issues/1313)) ([18ce349](https://github.com/sct/overseerr/commit/18ce349faac6ee560b9c92374039954f2365a8d1))
- **logs:** add copy to clipboard button to logs page ([e2b8745](https://github.com/sct/overseerr/commit/e2b8745fdc192f3d49872625652184005a760885))
- **notif:** include requested season numbers in notifications ([#1211](https://github.com/sct/overseerr/issues/1211)) ([4ee78ab](https://github.com/sct/overseerr/commit/4ee78ab2fe0359df6baa58f0986687f05a8392a2))
- **requests:** add request quotas ([#1277](https://github.com/sct/overseerr/issues/1277)) ([6c75c88](https://github.com/sct/overseerr/commit/6c75c8822842514ffd31864992e8d3ce686fea1b))
- **settings:** logs viewer ([#997](https://github.com/sct/overseerr/issues/997)) ([54429bb](https://github.com/sct/overseerr/commit/54429bbc1d765d0e50486a42749f9bbd4e5b3386))
- **ui:** add movie/series genre list pages ([#1194](https://github.com/sct/overseerr/issues/1194)) ([6f1a31d](https://github.com/sct/overseerr/commit/6f1a31de473d1a25bc77e0961a52b07050b64c51))
- **ui:** add option to only allow complete series requests ([#1164](https://github.com/sct/overseerr/issues/1164)) ([36c00fd](https://github.com/sct/overseerr/commit/36c00fde273799a56ec42ce6177ff44fed0904c3))
- **ui:** Add user requests page ([#936](https://github.com/sct/overseerr/issues/936)) ([a9461f7](https://github.com/sct/overseerr/commit/a9461f760d8112f2ae16183e796f706d3392f8ec))
- **ui:** allow any value 1-100 for quota limit/days ([#1337](https://github.com/sct/overseerr/issues/1337)) ([f4bed9a](https://github.com/sct/overseerr/commit/f4bed9a63b6b856ebedca9eb7662cd00038d7f7c))
- **ui:** display movie/series original title ([#1240](https://github.com/sct/overseerr/issues/1240)) ([7230915](https://github.com/sct/overseerr/commit/723091509414465e98d870b3dc943f41b9ac590d))
- **ui:** experimental status bar style change for ios pwa app ([958cdf9](https://github.com/sct/overseerr/commit/958cdf98fd1cb7c1bdb33aebb6c061750e9ab331))
- **ui:** store sort order and page size of userlist in localstorage ([#1262](https://github.com/sct/overseerr/issues/1262)) ([f5f8269](https://github.com/sct/overseerr/commit/f5f8269cd28ee792120060f4f38ef09d571fb8d5))
- add option to cache images locally ([#1213](https://github.com/sct/overseerr/issues/1213)) ([0ca3d43](https://github.com/sct/overseerr/commit/0ca3d4374942b54b59a19d017ab4ae14ba7019c1))
- genre sliders (experiment) ([#1182](https://github.com/sct/overseerr/issues/1182)) ([1c4515a](https://github.com/sct/overseerr/commit/1c4515a1ae6097f3948aaa0d0ed210831581fd98))

### Reverts

- **ui:** remove local image cache option from settings page ([911faef](https://github.com/sct/overseerr/commit/911faeff562b737a2d18a395fcd90bf354af0cc4))
- remove experimental tailwind jit compiler until title card hover is fixed ([1df67ba](https://github.com/sct/overseerr/commit/1df67baf9e7cdabc4045a0c115735797e8081bca))
- **deps:** revert react-intl to 5.13.5 ([e16277c](https://github.com/sct/overseerr/commit/e16277c07d58ddbb749f4a60bc05924f4a5af146))

## [1.21.1](https://github.com/sct/overseerr/compare/v1.21.0...v1.21.1) (2021-03-15)

### Bug Fixes

- **lang:** translations update from Weblate ([#1155](https://github.com/sct/overseerr/issues/1155)) ([ebc285c](https://github.com/sct/overseerr/commit/ebc285c758f69846e4a5cb74bb42ca5924d166d4))

# [1.21.0](https://github.com/sct/overseerr/compare/v1.20.1...v1.21.0) (2021-03-15)

### Bug Fixes

- do not allow editing of user settings under certain conditions ([#1168](https://github.com/sct/overseerr/issues/1168)) ([001dcd3](https://github.com/sct/overseerr/commit/001dcd328c8d3b1c417fd7c7ee2aa20183b08eef))
- **frontend:** check for ID instead of email after initial setup Plex login ([#1097](https://github.com/sct/overseerr/issues/1097)) ([778dda6](https://github.com/sct/overseerr/commit/778dda67d54df87347dd79577ef1bdc88d3c1d3f))
- **frontend:** check if swr is validating to determine if we should fetch new data ([e5f5bdb](https://github.com/sct/overseerr/commit/e5f5bdb95c62eba31a3321a7457d354f0226bf85)), closes [#719](https://github.com/sct/overseerr/issues/719)
- **frontend:** never hide available content in search results ([d48edeb](https://github.com/sct/overseerr/commit/d48edeb5a9bd8e2edce8bca0fea50e300bb7a1ae))
- **lang:** add missing i18n strings ([6072e8a](https://github.com/sct/overseerr/commit/6072e8aa9a0f84e50c44a92af303aad15b5f3021))
- **lang:** edit new Telegram-related strings to conform to style guide ([#1093](https://github.com/sct/overseerr/issues/1093)) ([bdf67e7](https://github.com/sct/overseerr/commit/bdf67e732b6c77cbae768a25edfc9a663ef0108b))
- **notif:** loosen input validation on Pushover settings ([#1166](https://github.com/sct/overseerr/issues/1166)) ([3148d31](https://github.com/sct/overseerr/commit/3148d312141248653c5d1e42cd2882a67a339163))
- **notif:** set URL for Discord embeds rather than adding a field for the link ([#1167](https://github.com/sct/overseerr/issues/1167)) ([0bd0912](https://github.com/sct/overseerr/commit/0bd0912613f0db24bd0da4ec956b5119133e35d4))
- correctly send auto-approval notifictions for series ([8634081](https://github.com/sct/overseerr/commit/8634081c869a2078793ecf06b1b7e249bba0a2f8))
- **lang:** fix singular form of season count ([#1080](https://github.com/sct/overseerr/issues/1080)) ([b57645d](https://github.com/sct/overseerr/commit/b57645d382361c856281e7a74295afe16c5390f2))
- **requests:** add plex url to request item ([#1088](https://github.com/sct/overseerr/issues/1088)) ([420038d](https://github.com/sct/overseerr/commit/420038d5ffdd4070df03e5c5cb6ef8d6208fddb5))
- **sonarr:** correctly search when updating existing sonarr series ([ed0a7fb](https://github.com/sct/overseerr/commit/ed0a7fbdf5122a26fa936e83b76a97c55781782d)), closes [#588](https://github.com/sct/overseerr/issues/588)
- **ui:** add alt prop to studio/network logos & fix blinking text cursor ([#1095](https://github.com/sct/overseerr/issues/1095)) ([0c4637f](https://github.com/sct/overseerr/commit/0c4637f779d8904037b9cbd5fe9166cf05a891c5))
- **ui:** add link to poster image on request items ([7289872](https://github.com/sct/overseerr/commit/7289872937d5bb94d027424760ee1ceb94095604))
- **ui:** correct language usage re: "sync" vs. "scan" ([#1079](https://github.com/sct/overseerr/issues/1079)) ([e98f2b9](https://github.com/sct/overseerr/commit/e98f2b96058fb9c5af77be2e8a1bd07fb8fcca06))
- **ui:** display "Season" vs. "Seasons" as appropriate, and fix request block "Seasons" formatting ([#1127](https://github.com/sct/overseerr/issues/1127)) ([45886cc](https://github.com/sct/overseerr/commit/45886ccef1bee57dc555060a491834567e45b59c))
- **ui:** request list button sizes ([#1152](https://github.com/sct/overseerr/issues/1152)) ([fc73592](https://github.com/sct/overseerr/commit/fc73592b69c38191f91a68a020868b8e5ec2e2e2))
- fix language filter link on movie detail pages ([#1142](https://github.com/sct/overseerr/issues/1142)) ([60d453b](https://github.com/sct/overseerr/commit/60d453b0bbba5e2060f72f40d1dde85ec6b05af4))
- remove language/region filtering on studio/network results ([#1129](https://github.com/sct/overseerr/issues/1129)) ([109aca8](https://github.com/sct/overseerr/commit/109aca8229dc7b81cac314d84591f1c04c12ac2e))
- **api:** check correct permissions for auto approve when requests are created ([3c1a72b](https://github.com/sct/overseerr/commit/3c1a72b038fd178b4be4dc082cd1496474148d7e))
- **frontend:** status, requested by, and modified alignment fix ([#1109](https://github.com/sct/overseerr/issues/1109)) ([1a7dc1a](https://github.com/sct/overseerr/commit/1a7dc1acf57888d3d0285b58c1c97a824a232216))
- **ui:** don't show "Password" user settings tab if current user lacks perms to modify the password ([#1063](https://github.com/sct/overseerr/issues/1063)) ([b146d11](https://github.com/sct/overseerr/commit/b146d11e2ffecedae76472b0491a4662ca4a4a4e))
- **ui:** fix Radarr logo alignment ([#1068](https://github.com/sct/overseerr/issues/1068)) ([0fa005a](https://github.com/sct/overseerr/commit/0fa005a99cd868b5a235ae9ce65b4c64b05d0f47))
- **ui:** fix request list UI behavior when season list is too long ([#1106](https://github.com/sct/overseerr/issues/1106)) ([8507691](https://github.com/sct/overseerr/commit/85076919c6ccbf052699b7d5f4ba8b6e5e5af74d))
- **ui:** improve responsive design on new request list UI ([#1105](https://github.com/sct/overseerr/issues/1105)) ([1f8b03f](https://github.com/sct/overseerr/commit/1f8b03ff6f67ce76051667de05166da54ed3dc89))
- **ui:** list all movie studios instead of just the first result ([#1110](https://github.com/sct/overseerr/issues/1110)) ([239202d](https://github.com/sct/overseerr/commit/239202d9c11f27410b0fa084bcc4c824b7136081))
- add correct permission checks to modifying user password/permissions ([ddfc5e6](https://github.com/sct/overseerr/commit/ddfc5e6aa8fc636931f495d6f23d56367466e3b5))

### Features

- add tagline, episode runtime, genres list to media details & clean/refactor CSS into globals ([#1160](https://github.com/sct/overseerr/issues/1160)) ([2f2e002](https://github.com/sct/overseerr/commit/2f2e00237d43bdab85bfadc3c4f2fbcdde4c2e90))
- **docker:** add tini to docker image ([#1017](https://github.com/sct/overseerr/issues/1017)) ([1629d02](https://github.com/sct/overseerr/commit/1629d02f3d8368bfd5f6fed05382974ae6fce51f))
- **email:** add pgp support ([#1138](https://github.com/sct/overseerr/issues/1138)) ([9e5adeb](https://github.com/sct/overseerr/commit/9e5adeb610bdc4800ff536412d0ae8a11fb4338d))
- **frontend:** add loading bar indicator ([#1170](https://github.com/sct/overseerr/issues/1170)) ([3d6b343](https://github.com/sct/overseerr/commit/3d6b3434138fec49c58f2bf74f781d5e2fc2911f))
- **lang:** localize job names ([#1043](https://github.com/sct/overseerr/issues/1043)) ([594aad9](https://github.com/sct/overseerr/commit/594aad9d3ae9b323677f3af8c434d7664526593d))
- **lang:** translations update from Weblate ([#1051](https://github.com/sct/overseerr/issues/1051)) ([69bf817](https://github.com/sct/overseerr/commit/69bf817f598babed99964f073259f827b60bd014))
- **lang:** Translations update from Weblate ([#1131](https://github.com/sct/overseerr/issues/1131)) ([e4686d6](https://github.com/sct/overseerr/commit/e4686d664b52448e32488ff1c4236f72e01e9a29))
- **notif:** add "Media Automatically Approved" notification type ([#1137](https://github.com/sct/overseerr/issues/1137)) ([f7d2723](https://github.com/sct/overseerr/commit/f7d2723fab2c30564fd23945709cd39b178a6eef))
- **notif:** add settings for Discord bot username & avatar URL ([#1113](https://github.com/sct/overseerr/issues/1113)) ([3384eb1](https://github.com/sct/overseerr/commit/3384eb1c479114c0246cb22f9a933aa79fb95fcf))
- **notif:** include poster image in Telegram notifications ([#1112](https://github.com/sct/overseerr/issues/1112)) ([48387e5](https://github.com/sct/overseerr/commit/48387e5b2f26c0c33acd436c6e1cf902d6c32101))
- **scan:** add support for new plex tv agent ([#1144](https://github.com/sct/overseerr/issues/1144)) ([a51d2a2](https://github.com/sct/overseerr/commit/a51d2a24d51d092a0c6da608e3322f19a37c2d28))
- **ui:** add user ID to profile header ([6e95c8b](https://github.com/sct/overseerr/commit/6e95c8b7a10e3467bfd2c3df84ccf886fe01ca5c))
- add genre/studio/network view to Discover results ([#1067](https://github.com/sct/overseerr/issues/1067)) ([f28112f](https://github.com/sct/overseerr/commit/f28112f057df2589f31ae0d0b14e8b50e479fdb7))
- add language-filtered Discover pages ([#1111](https://github.com/sct/overseerr/issues/1111)) ([7501161](https://github.com/sct/overseerr/commit/75011610e57f03098c8be9375d0c9ba1e3647e9b))
- add studio/network sliders to discover ([1c6914f](https://github.com/sct/overseerr/commit/1c6914f5ce5c0d171c4609813915b50233a8e3ad))
- **telegram:** add support for individual chat notifications ([#1027](https://github.com/sct/overseerr/issues/1027)) ([f6d00d8](https://github.com/sct/overseerr/commit/f6d00d8d1559879189f83739193c6e2acafde51d))
- **ui:** display "Owner" role instead of "Admin" for user ID 1 ([#1050](https://github.com/sct/overseerr/issues/1050)) ([1b55d2d](https://github.com/sct/overseerr/commit/1b55d2dfbc06d900e7370a4ddfd81789a25bf00c))
- **ui:** display season count on TV details page ([#1078](https://github.com/sct/overseerr/issues/1078)) ([4365231](https://github.com/sct/overseerr/commit/436523139e8f1594c352b17032734b4498d3994f))
- **ui:** in Settings > Services, make Radarr/Sonarr server names and logos clickable links ([#1008](https://github.com/sct/overseerr/issues/1008)) ([6a1e389](https://github.com/sct/overseerr/commit/6a1e3891aa5f84b6adb1e475a6658a8cd4e34c22))
- **ui:** request list redesign ([#1099](https://github.com/sct/overseerr/issues/1099)) ([cd21865](https://github.com/sct/overseerr/commit/cd21865c4d5be00c13c372e0b7a058f61ec855a2))

## [1.20.1](https://github.com/sct/overseerr/compare/v1.20.0...v1.20.1) (2021-02-28)

### Bug Fixes

- **notif:** escape application title in Telegram notifications ([#1012](https://github.com/sct/overseerr/issues/1012)) ([5560abf](https://github.com/sct/overseerr/commit/5560abf459b0350ff30b5e71d4208418fc8f3b3e))
- **notif:** fixed typo in pushover hint ([#1029](https://github.com/sct/overseerr/issues/1029)) ([e9f2fe9](https://github.com/sct/overseerr/commit/e9f2fe910d72fa41bc27673ed43291211c3cac65))
- **notifications:** correctly send tv auto approval notifications ([537850f](https://github.com/sct/overseerr/commit/537850f414a88df24c78794a2fd68e1e24ff73d1)), closes [#1041](https://github.com/sct/overseerr/issues/1041)
- **plex-sync:** no longer incorrectly sets 4k availability when there isnt any ([3f9a116](https://github.com/sct/overseerr/commit/3f9a116b17d78eeb04f0f125a4f3af6f907c83dd)), closes [#990](https://github.com/sct/overseerr/issues/990)
- **ui:** for server default options, display "All" region/language option instead of empty string ([#1042](https://github.com/sct/overseerr/issues/1042)) ([3fed26c](https://github.com/sct/overseerr/commit/3fed26cfbe74cb662ca531fd37b69f159a051ac1))
- **ui:** show translated string on sonarr sucesss/failure toast messages ([#1035](https://github.com/sct/overseerr/issues/1035)) ([eefcbcd](https://github.com/sct/overseerr/commit/eefcbcd3ddfa5258ee24dbbbd79de5bf50310f27))
- **ui:** use country-flag-icons instead of country-flag-emoji for RegionSelector ([#1011](https://github.com/sct/overseerr/issues/1011)) ([abcd7c9](https://github.com/sct/overseerr/commit/abcd7c997584c1310bd8b313ac38f30e335af8d7))
- add missing default value for settings context ([084917f](https://github.com/sct/overseerr/commit/084917f02d399e2d29bb9927e033c2e6533f586c))
- added missing language default for ssr context defaults ([9ce88ab](https://github.com/sct/overseerr/commit/9ce88abcc85d744d77172cd2357fdb4ff60dc5e4))
- allow users to override language/region settings ([69294a7](https://github.com/sct/overseerr/commit/69294a7c4c5bbe55c5cd276786cdfd48ddbff889)), closes [#1013](https://github.com/sct/overseerr/issues/1013)

# [1.20.0](https://github.com/sct/overseerr/compare/v1.19.1...v1.20.0) (2021-02-23)

### Bug Fixes

- **api:** add isAuthenticated middleware to base user route ([8a27c70](https://github.com/sct/overseerr/commit/8a27c7062599ea23dca115e6e6e95a594e1b219a))
- **api:** sort users requests by most recent ([1798383](https://github.com/sct/overseerr/commit/17983837fc10661a59d29fc1531530fca0d77825))
- **api:** Use POST instead of GET for API endpoints that mutate state ([#877](https://github.com/sct/overseerr/issues/877)) ([ff0b5ed](https://github.com/sct/overseerr/commit/ff0b5ed44132cc5a0cd178035796d042ba735a8d))
- **auth:** handle sign-in attempts from emails with no password ([#933](https://github.com/sct/overseerr/issues/933)) ([5e37a96](https://github.com/sct/overseerr/commit/5e37a96bc017471f8dc4cbdd57f2e8c3568bd97f))
- **frontend:** changed plex, request, and cog buttons to align properly on smaller mobile UIs ([#928](https://github.com/sct/overseerr/issues/928)) ([f1c3358](https://github.com/sct/overseerr/commit/f1c335815f2f17465cdd36ceb223e78a58149b3b))
- **frontend:** check for id instead of email after logging in ([c4af4c4](https://github.com/sct/overseerr/commit/c4af4c42ab00f1a63a2f5326c9cd8b26c19f4f14))
- **frontend:** Do not allow user w/ ID 1 to disable 'Admin' permission ([#965](https://github.com/sct/overseerr/issues/965)) ([77b2d9e](https://github.com/sct/overseerr/commit/77b2d9ea22a2f70cff58ac9421f3f6231bc93059))
- **frontend:** handle empty array of media attributes ([#922](https://github.com/sct/overseerr/issues/922)) ([04fa9f7](https://github.com/sct/overseerr/commit/04fa9f79e2ec90082b3fa15590dd170f7d68ad52))
- **frontend:** request and cog button would be misaligned without play on plex/watch trailer button ([#956](https://github.com/sct/overseerr/issues/956)) ([e28dfad](https://github.com/sct/overseerr/commit/e28dfadaf57d47887013c31dc5006332473156e3))
- **frontend:** Update AdvancedRequester to reflect new /user API response ([#970](https://github.com/sct/overseerr/issues/970)) ([b4bac6a](https://github.com/sct/overseerr/commit/b4bac6a9157119a4f234933245944e133c127bd0))
- **frontend:** use region settings instead of hardcoded 'US' value for movie/TV ratings ([#1006](https://github.com/sct/overseerr/issues/1006)) ([6ecd202](https://github.com/sct/overseerr/commit/6ecd202607cb48d559440da810ecc585e740542b))
- **lang:** formatMessage should not use an object spread ([8a7fa00](https://github.com/sct/overseerr/commit/8a7fa00164fd5c5501da525baa29be97bac7e7c4))
- **lang:** Remove unused strings and correct spelling of 'canceling'/'canceled' ([#981](https://github.com/sct/overseerr/issues/981)) ([5b64655](https://github.com/sct/overseerr/commit/5b646557765d1ad75e44e1c0e60e0291313c7746))
- **login:** fix the gap when 'use your overseer account' was selected ([#870](https://github.com/sct/overseerr/issues/870)) ([d163e29](https://github.com/sct/overseerr/commit/d163e294599c4bd9bdc0a148db15c8e8541410d8))
- **notif:** Do not HTML-escape email subjects ([#931](https://github.com/sct/overseerr/issues/931)) ([019622a](https://github.com/sct/overseerr/commit/019622aab1b94cc4d71cacbf0dc5cf64b62c8623))
- **notif:** Remove extra newlines from Telegram notifications ([#973](https://github.com/sct/overseerr/issues/973)) ([bbea522](https://github.com/sct/overseerr/commit/bbea52249950eb98a8d3886f2bd7648a7d669bf4))
- **plex:** Check Plex server access on user import ([#955](https://github.com/sct/overseerr/issues/955)) ([bdb3cb2](https://github.com/sct/overseerr/commit/bdb3cb202550e34d8951ac2b5015f97f6a5c1ebf))
- **plex-sync:** get correct Plex metadata for Hama movie items ([#901](https://github.com/sct/overseerr/issues/901)) ([03cecb3](https://github.com/sct/overseerr/commit/03cecb33559e27199c5a174fc86de0c4550fe666)), closes [#898](https://github.com/sct/overseerr/issues/898)
- **requests:** correctly filter requests out for users without view requests permission ([e118501](https://github.com/sct/overseerr/commit/e118501bf1dfa8dada2c57090e62631de620f3dd))
- **requests:** correctly handle when tvdbid is missing ([#891](https://github.com/sct/overseerr/issues/891)) ([e037ba4](https://github.com/sct/overseerr/commit/e037ba48f173c06b0c9c8b03085edf832d770c06))
- **search:** Handle search errors and escape \* ([#893](https://github.com/sct/overseerr/issues/893)) ([034968e](https://github.com/sct/overseerr/commit/034968e4370eaea726c94730274349c083856813))
- **services:** update all radarr/sonarr endpoints to use v3 ([da5ca02](https://github.com/sct/overseerr/commit/da5ca02f81fe91070afbda3e1ebc8d869fe39a8f))
- **sonarr:** use qualityProfileId instad of profileId when adding series ([552a7e3](https://github.com/sct/overseerr/commit/552a7e30da5fc2cc0bd43b5aef79a0225c75d233))
- **sync:** fix sonarr/plex sync fighting over availability ([9b73423](https://github.com/sct/overseerr/commit/9b73423d49e1e799cd82764a9ade8c75d92a28a2)), closes [#872](https://github.com/sct/overseerr/issues/872)
- **ui:** add fallback for region display name ([f9c83e1](https://github.com/sct/overseerr/commit/f9c83e14e52a57d6865307b3324a61c04a77a541))
- **ui:** add missing string for default Discover Language & edit string for default Discover Region ([#1004](https://github.com/sct/overseerr/issues/1004)) ([0acad8e](https://github.com/sct/overseerr/commit/0acad8e9fa65a9de6cecac9b6a4a5b2313ba8f06))
- **ui:** Add tip & validation for Discord ID input ([#966](https://github.com/sct/overseerr/issues/966)) ([e70a4ec](https://github.com/sct/overseerr/commit/e70a4ecae613e045977e262fd7f9643f30985ab7))
- **ui:** also allow 17 digit discord ids ([57c00c1](https://github.com/sct/overseerr/commit/57c00c1ea71c1229d5a59e1b8dadd84a646772b9)), closes [#971](https://github.com/sct/overseerr/issues/971)
- **ui:** Automatically disable and uncheck user permissions with unmet requirements ([#941](https://github.com/sct/overseerr/issues/941)) ([c9a150b](https://github.com/sct/overseerr/commit/c9a150b1db2adbb305cf1a448489d7a8c14cf1cb))
- **ui:** change font size in request list/user list dropdowns to prevent zoom on mobile ([fb9c878](https://github.com/sct/overseerr/commit/fb9c878db49c01d13773e8d2f94c93f840be0b82))
- **ui:** Display 4K download status on 4K status badge ([#988](https://github.com/sct/overseerr/issues/988)) ([40b07c3](https://github.com/sct/overseerr/commit/40b07c35d40c03039e4bfa5ed1e73af7e8aa6a7d))
- **ui:** Fix card sizes on person detail pages ([#881](https://github.com/sct/overseerr/issues/881)) ([a3042f8](https://github.com/sct/overseerr/commit/a3042f8e1b05a91d98f48a4aecb08e831a48fc56))
- **ui:** Fix settings navigation horizontal scroll issues ([#987](https://github.com/sct/overseerr/issues/987)) ([8701fb2](https://github.com/sct/overseerr/commit/8701fb20d07773f4cc32e857b68575a813cf7e21))
- **ui:** fix webhook URL validation regex ([baad19a](https://github.com/sct/overseerr/commit/baad19a2c94728313ee996fe1a0ffc64fbd9aaa3))
- **ui:** fixed anime language profile typo ([#879](https://github.com/sct/overseerr/issues/879)) ([ee50761](https://github.com/sct/overseerr/commit/ee5076146ef3c5e8baba197a5b397d3c3f575262))
- **ui:** Handle missing movie/series data ([#862](https://github.com/sct/overseerr/issues/862)) ([7c0ddad](https://github.com/sct/overseerr/commit/7c0ddad653393327226a877692f046d8693ddc66))
- **ui:** Notification-related string/UI edits and field validation ([#985](https://github.com/sct/overseerr/issues/985)) ([c88fcb2](https://github.com/sct/overseerr/commit/c88fcb2e2d1c4b84527844a80680c15337626e72))
- **ui:** rename global group class to form-group ([8056187](https://github.com/sct/overseerr/commit/8056187c3c0ea464a8f751aa6347ea1d35c01aac))
- **ui:** Size cards appropriately based on base font size ([#871](https://github.com/sct/overseerr/issues/871)) ([282f28f](https://github.com/sct/overseerr/commit/282f28f2b9d0cc8c9105d01b43d4e1f730320b8b))
- **ui/notif:** Custom application title in password-related emails and UI messages ([#979](https://github.com/sct/overseerr/issues/979)) ([4e2706b](https://github.com/sct/overseerr/commit/4e2706b4211b06f364910c327d84c2ceb45b2fe3))

### Features

- **lang:** translated using Weblate (French) ([#1007](https://github.com/sct/overseerr/issues/1007)) ([970da66](https://github.com/sct/overseerr/commit/970da664b2700b8cd9ad8dce0cbca1d37820eceb))
- **lang:** translations update from Weblate ([#853](https://github.com/sct/overseerr/issues/853)) ([e156acc](https://github.com/sct/overseerr/commit/e156acc1ae2fa86b4441faacc0b58e1e993e0edc))
- **lang:** translations update from Weblate ([#986](https://github.com/sct/overseerr/issues/986)) ([4296765](https://github.com/sct/overseerr/commit/4296765ad61bac09c2317b71b763366d328733e4))
- **notif:** Add Pushbullet notification agent ([#950](https://github.com/sct/overseerr/issues/950)) ([29b97ef](https://github.com/sct/overseerr/commit/29b97ef6d85bbea31dd59b7ad857b0d8ab30bff0))
- **notif:** Notification improvements ([#914](https://github.com/sct/overseerr/issues/914)) ([2768155](https://github.com/sct/overseerr/commit/2768155bbabe121a4c51fc1472461cd5114c4300))
- **regions:** add region/original language setting for filtering Discover ([#732](https://github.com/sct/overseerr/issues/732)) ([#942](https://github.com/sct/overseerr/issues/942)) ([b557c06](https://github.com/sct/overseerr/commit/b557c06b0a78f5df5f64a05dc1e4511dae72df4f))
- **requests:** add language profile support ([#860](https://github.com/sct/overseerr/issues/860)) ([53f6f59](https://github.com/sct/overseerr/commit/53f6f59798fa7e3f95959990a3df555db3c1c51e))
- **ui:** Add 'Available' filter to request list and remove unused MediaRequestStatus.AVAILABLE enum value ([#905](https://github.com/sct/overseerr/issues/905)) ([9757e3a](https://github.com/sct/overseerr/commit/9757e3ae0c572fb46177e25154b29e0ceced665f))
- **ui:** Add 'Page Size' setting for request/user list pages ([#957](https://github.com/sct/overseerr/issues/957)) ([621db89](https://github.com/sct/overseerr/commit/621db893281f0280fe773ac7dbdc44434895242c))
- **ui:** Add separate permissions for 4K auto approval ([#908](https://github.com/sct/overseerr/issues/908)) ([53b7425](https://github.com/sct/overseerr/commit/53b7425f6711e250935e7bb024c38ff6c62e07d9))
- **ui:** Add sort options to user list ([#913](https://github.com/sct/overseerr/issues/913)) ([ef5d019](https://github.com/sct/overseerr/commit/ef5d019c18d7f6cdbbb1e1b7f8ff7816ed9b117b))
- **ui:** Add support for requesting collections in 4K ([#968](https://github.com/sct/overseerr/issues/968)) ([139341b](https://github.com/sct/overseerr/commit/139341b0434b41e7c31af36baacd8d65566a6a0c))
- user profile/settings pages ([#958](https://github.com/sct/overseerr/issues/958)) ([bbb683e](https://github.com/sct/overseerr/commit/bbb683e637386ad8bbeb44dca97aac9cdaf11349))
- **ui:** added content ratings for tv shows and movie ratings ([#878](https://github.com/sct/overseerr/issues/878)) ([c8b2a57](https://github.com/sct/overseerr/commit/c8b2a57721a51adcc7f90ec1acb48b127991d467))
- **users:** add reset password flow ([#772](https://github.com/sct/overseerr/issues/772)) ([e5966bd](https://github.com/sct/overseerr/commit/e5966bd3fbfe172f264f4e986ad2aecf29ae1510))

## [1.19.1](https://github.com/sct/overseerr/compare/v1.19.0...v1.19.1) (2021-02-06)

### Bug Fixes

- **ui:** Fix webhook URL validation regex ([#864](https://github.com/sct/overseerr/issues/864)) ([726f62b](https://github.com/sct/overseerr/commit/726f62b9b69b5078e718f129e26abdf358f5cb06))

# [1.19.0](https://github.com/sct/overseerr/compare/v1.18.0...v1.19.0) (2021-02-05)

### Bug Fixes

- **api:** filter out adult content from combined credits ([3052f12](https://github.com/sct/overseerr/commit/3052f12c91b3ce86128324e3698fff61bbce3f2a))
- **cache:** use formatted numbers for displaying cache counts ([6c437c5](https://github.com/sct/overseerr/commit/6c437c515fc01b9fe4461968875e23542bae7542))
- **email:** make image a link to the action url in request template ([ee0a7bd](https://github.com/sct/overseerr/commit/ee0a7bd8c0b3a79c292b0abceb2f780f3889e49f)), closes [#834](https://github.com/sct/overseerr/issues/834)
- **frontend:** add github sponsor link to about page ([7c192d5](https://github.com/sct/overseerr/commit/7c192d54f422a5f2b55750535d2382e313f1d011))
- **frontend:** correctly show 4k download tracker activity ([a7314f8](https://github.com/sct/overseerr/commit/a7314f876ea528fdec0fb0a2adaa36a01afcdf38))
- **frontend:** fix possible division by zero in download status ([#839](https://github.com/sct/overseerr/issues/839)) ([c97c96a](https://github.com/sct/overseerr/commit/c97c96a30c50db7735f06c6d2d2f6193fb7da55e))
- **frontend:** match request button color on titlecards to other request buttons ([5b39911](https://github.com/sct/overseerr/commit/5b39911e024513fab7a62948e653cee08fd166c7))
- **frontend:** set 4k status on RequestItem when request is for 4k ([a3b00c3](https://github.com/sct/overseerr/commit/a3b00c3458b868506d4158fb24f0369fa5daefc5))
- **frontend:** use consistent spinner style on TitleCard/Plex Presets ([cf7ebc4](https://github.com/sct/overseerr/commit/cf7ebc488db33725444c428b4244d780ab9d123b))
- **html:** th elements should be nested under tr, not directly under thead ([#801](https://github.com/sct/overseerr/issues/801)) ([6e9ac27](https://github.com/sct/overseerr/commit/6e9ac275e19d56de8c7a366db970c7321f26fc8a))
- **lang:** Add missing source strings & remove local user sign-in setting tip ([#828](https://github.com/sct/overseerr/issues/828)) ([c0769d4](https://github.com/sct/overseerr/commit/c0769d4f8f2bad88e4638d8c3cbcc0414b3ef6fb))
- **lang:** Edit English language strings ([#820](https://github.com/sct/overseerr/issues/820)) ([f54df21](https://github.com/sct/overseerr/commit/f54df214af86d90ea8d7cfcd4e39022215c3568c))
- **lang:** translate language names & change zh-Hant language code to zh-TW ([#793](https://github.com/sct/overseerr/issues/793)) ([3c5ae36](https://github.com/sct/overseerr/commit/3c5ae360fd179d794a78cc918fe97a09216ca6b2))
- **notif/ui:** Use custom application title in notifications & sign-in page ([#849](https://github.com/sct/overseerr/issues/849)) ([38c76b5](https://github.com/sct/overseerr/commit/38c76b55e0039c489cb6a4a0a298aa6385406db4))
- **radarr:** correctly set requested status after sending to radarr (with auto approve) ([ec44841](https://github.com/sct/overseerr/commit/ec448413569ddc2f24bb856d29084169979f9f05))
- **sonarr-sync:** sonarr sync will no longer set shows with no episodes to partially available ([d20bd53](https://github.com/sct/overseerr/commit/d20bd530edaadc5887b0361358da80153e36505c)), closes [#796](https://github.com/sct/overseerr/issues/796)
- **ui:** Add additional URL & email input validation ([#843](https://github.com/sct/overseerr/issues/843)) ([3f9bfeb](https://github.com/sct/overseerr/commit/3f9bfeb01a67b2b587c7548b02ee826722e65c0f))
- **ui:** Don't display empty dropdown when no trailer available ([#804](https://github.com/sct/overseerr/issues/804)) ([95c2a21](https://github.com/sct/overseerr/commit/95c2a2169799d96413b47ab24506b330435643eb))
- **ui:** dont show bulk edit options on user list if there is only one user ([b658ddf](https://github.com/sct/overseerr/commit/b658ddf5cf61b2bb9b93cb1a4ca716cd75e18bb4))
- **ui:** Dynamically generate path to config in warning message ([#851](https://github.com/sct/overseerr/issues/851)) ([b531a64](https://github.com/sct/overseerr/commit/b531a642f601f4ef9bf39c2f5915402157e55372))
- **ui:** fix tables extending outside viewport in mobile formats ([e270999](https://github.com/sct/overseerr/commit/e270999745f97c2860f6a5b84e897dc6da8d6001))
- **ui:** Hide 'Mark 4k as Available' button if 4k not enabled ([#833](https://github.com/sct/overseerr/issues/833)) ([e4a50c3](https://github.com/sct/overseerr/commit/e4a50c33f105b440243885d72a9e96595a525447))
- **ui:** Limit max width of forms & lists ([#845](https://github.com/sct/overseerr/issues/845)) ([b9d14a9](https://github.com/sct/overseerr/commit/b9d14a9fd0f3c94d8267755147a87fe3b77fa2c3))
- **ui:** prevent names from getting squished in AdvancedRequester user selector ([06e9411](https://github.com/sct/overseerr/commit/06e941171a1d019fbb178624167c026f6df5271c))
- **ui:** remove yup validation from display name on user edit page ([63d7e2b](https://github.com/sct/overseerr/commit/63d7e2b39858fcb1cc0819a680eebccded7f4451))
- **ui:** Restore original port input size ([#814](https://github.com/sct/overseerr/issues/814)) ([1ccafc0](https://github.com/sct/overseerr/commit/1ccafc0ebd368d798f9571b83910336efa317e37))
- **ui:** show request as option even if there are no radarr/sonarr servers ([b116281](https://github.com/sct/overseerr/commit/b116281196c264b4ec35b07f1b4ffa717e50ade5))
- **ui:** uniform-size checkboxes, vertically-aligned form labels, and fixes for other UI imperfections/inconsistencies ([#737](https://github.com/sct/overseerr/issues/737)) ([e34fbf7](https://github.com/sct/overseerr/commit/e34fbf72fda34d69b9f25563fa81f88b3c20912a))
- **ui:** Use minimum char validation message ([#850](https://github.com/sct/overseerr/issues/850)) ([7456bea](https://github.com/sct/overseerr/commit/7456bea2ae600a28cb933278ffb310b63a474d6a))
- **ui:** validate application url and service external urls ([026795d](https://github.com/sct/overseerr/commit/026795d4c940cb4797d3e68089456a4c3defbb21))
- **ui:** when PersonCard has no profilePath, correctly position name/role content ([3ffd5ab](https://github.com/sct/overseerr/commit/3ffd5ab0ee8ffa63199d1428e37206f9b59fb7a5))

### Features

- **cache:** add cache table and flush cache option to settings ([996bd9f](https://github.com/sct/overseerr/commit/996bd9f14ed0f56767892c169b071be4f0f628d0))
- **cache:** external API cache ([#786](https://github.com/sct/overseerr/issues/786)) ([20289b5](https://github.com/sct/overseerr/commit/20289b5960a93545cdff9331a1a7b613f382e702))
- **docker:** Check for /app/config volume mount during setup ([#826](https://github.com/sct/overseerr/issues/826)) ([1e5f88f](https://github.com/sct/overseerr/commit/1e5f88f462b0c69db5f6ab8e0249a5905bc6952a))
- **frontend:** add TheTVDB external link ([#800](https://github.com/sct/overseerr/issues/800)) ([72cffd7](https://github.com/sct/overseerr/commit/72cffd74a75984ba98c456c0ec006ec378a8dcec))
- **lang:** add support for Hungarian language ([cfacb15](https://github.com/sct/overseerr/commit/cfacb151b52d08e19d2fcd603fb4bbcd78707cdf))
- **lang:** translations update from Weblate ([#791](https://github.com/sct/overseerr/issues/791)) ([42295e0](https://github.com/sct/overseerr/commit/42295e076a7579b226d57407a20cb0ba044e9ec1))
- **lang:** translations update from Weblate ([#819](https://github.com/sct/overseerr/issues/819)) ([9e5e4c2](https://github.com/sct/overseerr/commit/9e5e4c22f5b25df96f47875d599ed8685791382a))
- **lang:** translations update from Weblate ([#841](https://github.com/sct/overseerr/issues/841)) ([e4f9b8a](https://github.com/sct/overseerr/commit/e4f9b8a9848f3af00e86fc7108c823ed0584609f))
- **lang:** translations update from Weblate ([#852](https://github.com/sct/overseerr/issues/852)) ([c5be00e](https://github.com/sct/overseerr/commit/c5be00eebfd2b0e65295edbe282cbba22fffa660))
- **ui:** Add local login setting ([#817](https://github.com/sct/overseerr/issues/817)) ([9d0d5b8](https://github.com/sct/overseerr/commit/9d0d5b86aae025e4647bb664c6412d42192e2fe7))
- **ui:** added next airing date to TV Shows ([#842](https://github.com/sct/overseerr/issues/842)) ([4eae02a](https://github.com/sct/overseerr/commit/4eae02a7e14e377fd69ddd4a43774cb7e3d1855b))
- new permission to allow users to see other users requests ([033ba9d](https://github.com/sct/overseerr/commit/033ba9d41bddf6dc1c4512d8404f747e57923bca)), closes [#840](https://github.com/sct/overseerr/issues/840)
- request as another user ([59150f9](https://github.com/sct/overseerr/commit/59150f955f7003672ef19eb9d37156e93b79c97d))
- **tv:** show cast for the entire show instead of only the last season ([#778](https://github.com/sct/overseerr/issues/778)) ([b239598](https://github.com/sct/overseerr/commit/b239598e64d33b78dc5d7972878840149aff360a)), closes [#775](https://github.com/sct/overseerr/issues/775)
- **ui:** Add custom title functionality ([#825](https://github.com/sct/overseerr/issues/825)) ([35c6bfc](https://github.com/sct/overseerr/commit/35c6bfc0216bf879353b3ee546b439a06c8e6121))

# [1.18.0](https://github.com/sct/overseerr/compare/v1.17.2...v1.18.0) (2021-01-30)

### Bug Fixes

- **api:** prevent duplicate movie requests ([421f4c1](https://github.com/sct/overseerr/commit/421f4c17f0f206bbe7bfcbf2819014b8c7f55b6a)), closes [#705](https://github.com/sct/overseerr/issues/705)
- **build:** fix sqlite3 build error ([#691](https://github.com/sct/overseerr/issues/691)) ([3a1f6d5](https://github.com/sct/overseerr/commit/3a1f6d5706c8fc100e88425f3d89a26a0325af79))
- **frontend:** add poster not found image to request card and request list item ([ae9a1b3](https://github.com/sct/overseerr/commit/ae9a1b3e940ac2abf6e842d91f458daab3dd0f0d))
- **frontend:** add poster not found image to tv details page ([0b05545](https://github.com/sct/overseerr/commit/0b055458d0ddbfd4c87ebf9b0562f161fa3445a3))
- **frontend:** dont show external links unless slug is set ([946bd2d](https://github.com/sct/overseerr/commit/946bd2db5ecde0748b2e9bc5edfe7ca6000ec3d5))
- **frontend:** fix server name position on plex settings page ([86efcd8](https://github.com/sct/overseerr/commit/86efcd82c34ad6490f2899ebf6f84cdd1bffc498))
- **frontend:** fixed mismatched rounded sizing on new login ([5e352c2](https://github.com/sct/overseerr/commit/5e352c201fc2f731ca5f713ecb6901527ef354da)), closes [#721](https://github.com/sct/overseerr/issues/721)
- **ip logging:** add env var for proxy to fix ip logging on failed logins ([#756](https://github.com/sct/overseerr/issues/756)) ([9342a40](https://github.com/sct/overseerr/commit/9342a40bbc03f7fdda23e3876b3a4a81ea8532c0))
- **lang:** add missing i18n strings for notification settings ([2f75c4c](https://github.com/sct/overseerr/commit/2f75c4c6aed42a15bb47d3652272de8f852ec79f))
- **notifications:** only send a single notification when standard media becomes available ([b5fd1d5](https://github.com/sct/overseerr/commit/b5fd1d520cd2a7be6e6356a25129e93af1caf542)), closes [#770](https://github.com/sct/overseerr/issues/770)
- **permissions:** use default user permissions when creating a local user ([#713](https://github.com/sct/overseerr/issues/713)) ([660ada0](https://github.com/sct/overseerr/commit/660ada0b2025eb2c06d9054fd0a7b5a632af6af2))
- **radarr:** fix request bug which made it unable to be added to radarr ([#760](https://github.com/sct/overseerr/issues/760)) ([45a2779](https://github.com/sct/overseerr/commit/45a277964b0c39346d7216873812e0ebe505cb79))
- **radarr:** return the updated data when updating radarr request ([#765](https://github.com/sct/overseerr/issues/765)) ([0c6d478](https://github.com/sct/overseerr/commit/0c6d4780c355ffe1a951268fb6949491d435bbf1))
- **requests:** handle when tvdbid is null ([#657](https://github.com/sct/overseerr/issues/657)) ([2da0da8](https://github.com/sct/overseerr/commit/2da0da826ae1d73467bc8a671fda7cc5ca1f14c9))
- **sonarr-sync:** correctly set series with no seasons to requested status ([3812989](https://github.com/sct/overseerr/commit/3812989a1ce1e07d4af09149008043a6e2e94060)), closes [#762](https://github.com/sct/overseerr/issues/762)
- **sync:** do not update series status if already available and no new seasons ([136d874](https://github.com/sct/overseerr/commit/136d874cba37babf9c0670844b002871710e6d99)), closes [#777](https://github.com/sct/overseerr/issues/777)
- **ui:** Capitalization, punctuation, and grammar inconsistences & errors ([#731](https://github.com/sct/overseerr/issues/731)) ([f05d4a0](https://github.com/sct/overseerr/commit/f05d4a0d0b42905fcaee49b2471bb1f4ee77fffe))
- lookup movie by imdbid if tmdbid does not exits for plex movie agent ([#711](https://github.com/sct/overseerr/issues/711)) ([e972288](https://github.com/sct/overseerr/commit/e97228899a5936b2525c8060abfa14b5ce31658d))
- show recently added series even if they are not complete ([d0c830e](https://github.com/sct/overseerr/commit/d0c830e80d389f9e0f48a9b83659331f54630d03))

### Features

- **lang:** translated using Weblate (Dutch) ([059995e](https://github.com/sct/overseerr/commit/059995e0ef3370a3192bd386fa6875ca0f58690a))
- **lang:** translated using Weblate (French) ([4789583](https://github.com/sct/overseerr/commit/4789583d66305ac7b3d393659b2f3604c0acc576))
- **lang:** translations update from Weblate ([#727](https://github.com/sct/overseerr/issues/727)) ([71875ef](https://github.com/sct/overseerr/commit/71875efb48246dbb0139ad15a4261a5661fcfe17))
- **lang:** update languages and fix merge conflict ([083a74a](https://github.com/sct/overseerr/commit/083a74a686d202cce5775bf9752caaa9a626cf45))
- **ui:** Move PROXY setting to UI ([#782](https://github.com/sct/overseerr/issues/782)) ([f1dd5e7](https://github.com/sct/overseerr/commit/f1dd5e7e12c1f602449c4769173dbce71e3569d0))
- add manual availability buttons to manage slideover ([67f8aef](https://github.com/sct/overseerr/commit/67f8aef00d98c834b60cb6152ccd5cb7b5709d12)), closes [#672](https://github.com/sct/overseerr/issues/672)
- **media:** add link to the item on plex ([#735](https://github.com/sct/overseerr/issues/735)) ([1d7150c](https://github.com/sct/overseerr/commit/1d7150c24ec5ad347093889bfceab61b664900d5))
- Radarr & Sonarr Sync ([#734](https://github.com/sct/overseerr/issues/734)) ([ec5fb83](https://github.com/sct/overseerr/commit/ec5fb836785855eb4846fd33b49faeb94c40506a))
- **frontend:** add option to hide all available items from discovery ([#699](https://github.com/sct/overseerr/issues/699)) ([6c1742e](https://github.com/sct/overseerr/commit/6c1742e94ccfc6c13cf1d25fd9e893ee1f431aae))
- **lang:** add support for Portuguese (Portugal) language ([e044146](https://github.com/sct/overseerr/commit/e044146aa55109a1eccfde9650b26beb0d5ec9a6))
- **lang:** translated using Weblate (Dutch) ([6d0f7d4](https://github.com/sct/overseerr/commit/6d0f7d4b50370c420c1017f32d48313074543743))
- **lang:** translated using Weblate (Italian) ([9aa5c12](https://github.com/sct/overseerr/commit/9aa5c121644518c1fbb308a487c26d8998bb5a36))
- **lang:** translated using Weblate (Portuguese (Portugal)) ([f001fb3](https://github.com/sct/overseerr/commit/f001fb3b33d4fb749acb70c45b8a55a5bbef570c))
- **lang:** translated using Weblate (Spanish) ([4f94d22](https://github.com/sct/overseerr/commit/4f94d227fc3096bcb8a1e5cf12fe9222d6c6b711))
- **login:** add request ip to the failed request log ([#714](https://github.com/sct/overseerr/issues/714)) ([2d31ea9](https://github.com/sct/overseerr/commit/2d31ea940ac0a1a84d2150743798b41ff6490317))
- **users:** add editable usernames ([#715](https://github.com/sct/overseerr/issues/715)) ([20ca3f2](https://github.com/sct/overseerr/commit/20ca3f2f5fcf4a9eb0d6a8be671bb4fb1f5e6178))
- pre-populate server info from plex.tv API ([#563](https://github.com/sct/overseerr/issues/563)) ([82ac76b](https://github.com/sct/overseerr/commit/82ac76b0540ba1133cb5384744d2499c2488a4e8))
- **auth:** Add optional CSRF protection ([#697](https://github.com/sct/overseerr/issues/697)) ([6e25891](https://github.com/sct/overseerr/commit/6e2589178b99f8f32f0ded9a7cfd9921c33e9b60))
- ability to edit user settings in bulk ([#597](https://github.com/sct/overseerr/issues/597)) ([4b0241c](https://github.com/sct/overseerr/commit/4b0241c3b34d4229f928c21defb10a1c051264d1))
- **lang:** translated using Weblate (English) ([9bb11af](https://github.com/sct/overseerr/commit/9bb11afc6b4a109ae1e14d41c9fe2b71f19c470a))
- **lang:** translated using Weblate (German) ([c2a3e8e](https://github.com/sct/overseerr/commit/c2a3e8ed5243925dce991ec7995ae831702dbc7b))
- **lang:** translated using Weblate (Portuguese (Brazil)) ([32f4916](https://github.com/sct/overseerr/commit/32f4916c4a926097f31ed472aee031536b847bb7))
- **lang:** translated using Weblate (Portuguese (Brazil)) ([98570c9](https://github.com/sct/overseerr/commit/98570c920e4904a594bb7464161b985094958f84))
- **notifications:** add option to send notifications for auto-approved requests ([21db367](https://github.com/sct/overseerr/commit/21db3676d1464b63384b04c0c2926cb2a6252e9b)), closes [#267](https://github.com/sct/overseerr/issues/267)

## [1.17.2](https://github.com/sct/overseerr/compare/v1.17.1...v1.17.2) (2021-01-20)

### Bug Fixes

- **requests:** allow declined season requests to be re-requested ([e1032ff](https://github.com/sct/overseerr/commit/e1032ff5dfac4a8c9d4da9cf2788c19822343ad9)), closes [#690](https://github.com/sct/overseerr/issues/690)
- **requests:** update requests to approved when parent media is set as available ([78444a9](https://github.com/sct/overseerr/commit/78444a9e643829823162389dee60cca70da56bff)), closes [#688](https://github.com/sct/overseerr/issues/688)

## [1.17.1](https://github.com/sct/overseerr/compare/v1.17.0...v1.17.1) (2021-01-19)

### Bug Fixes

- **frontend:** show auto approval on series request modal only with correct permissions ([8927c6d](https://github.com/sct/overseerr/commit/8927c6d2e39dbda2b1121095a7273f5cab1c9b74)), closes [#687](https://github.com/sct/overseerr/issues/687)

# [1.17.0](https://github.com/sct/overseerr/compare/v1.16.0...v1.17.0) (2021-01-19)

### Bug Fixes

- **api:** improve rottentomatoes rating matching for movies ([7db62ab](https://github.com/sct/overseerr/commit/7db62ab824eefc42e6db16e42d52f4266b136f82)), closes [#494](https://github.com/sct/overseerr/issues/494)
- **build:** remove cross import from client to server for UserType ([23624bd](https://github.com/sct/overseerr/commit/23624bd144af5df4c31995b68ce48105b95b20f6))
- **frontend:** clarify which fields are required in radarr/sonarr modals ([860d71e](https://github.com/sct/overseerr/commit/860d71ed69a69a1a3f74b79290ef471e04f57a6b)), closes [#575](https://github.com/sct/overseerr/issues/575)
- **frontend:** do not show failed media status on request list for declined requests ([00944b1](https://github.com/sct/overseerr/commit/00944b1ec2db8ddc5742448f6448f7364c473a98)), closes [#664](https://github.com/sct/overseerr/issues/664)
- **frontend:** fix button styling on details page on small screen sizes ([d9e0c90](https://github.com/sct/overseerr/commit/d9e0c90e76d80aef0c67318e00e997804805f46e))
- **frontend:** fix request button height ([a262727](https://github.com/sct/overseerr/commit/a2627270784bdef8644875fa5c5a7349a0b7fd81))
- **frontend:** request dropdown menu now properly shows up over collection button ([b491be1](https://github.com/sct/overseerr/commit/b491be1b1e7f6aa588274230e695e4c5302b961e))
- **frontend:** show correct request status on request cards for 4k requests ([1aa0005](https://github.com/sct/overseerr/commit/1aa0005b4298fc1af9c1d0bf1f357738c0fa2673))
- **lang:** add missing see more i18n string for SeeMoreCard ([d9919ab](https://github.com/sct/overseerr/commit/d9919abb8998d28558ddec35b8e60ab2af75d5b7))
- **lang:** change email auth user/pass strings to SMTP Username/Password ([a77a2aa](https://github.com/sct/overseerr/commit/a77a2aa3ebb1be353d534db5b07647ac26c60e15))
- **notifications:** correctly compare seasons before sending series notifications ([f17fa2a](https://github.com/sct/overseerr/commit/f17fa2a2db8144bac89936f588627e8dd37bf54a))
- **notifications:** only send one available notification for standard media ([fc6f7cc](https://github.com/sct/overseerr/commit/fc6f7ccea586165a30022b6d5554911c66ece6df))
- **notifications:** send media declined email ([eb6fc8a](https://github.com/sct/overseerr/commit/eb6fc8a19099469794d471db0b48a258c2866633)), closes [#679](https://github.com/sct/overseerr/issues/679)
- **plex-sync:** improve plex sync error handling. add session id to fix stuck runs ([a740b07](https://github.com/sct/overseerr/commit/a740b07f06f892b72a651b928af28ce71cb495ee))
- **plex-sync:** store plex added date and sort recently added by it ([d688a96](https://github.com/sct/overseerr/commit/d688a967596afcba9799b8133089bebb5add27cf))
- **requests:** select the correct radarr/sonarr server when sending request to service ([e0d9f89](https://github.com/sct/overseerr/commit/e0d9f891e797c3839f976b75a871903b6f2e55f1))
- **server:** support absolute paths for CONFIG_DIRECTORY ([51d8fba](https://github.com/sct/overseerr/commit/51d8fba9162b9e148a35ced69e7e035438c8b0f1))
- **user edit:** fix user edit not being able to be saved ([#651](https://github.com/sct/overseerr/issues/651)) ([b04d00e](https://github.com/sct/overseerr/commit/b04d00ef509d6f13c1f9677b3f318331782c0086))

### Features

- **api:** /request/count endpoint ([#682](https://github.com/sct/overseerr/issues/682)) ([192cfd8](https://github.com/sct/overseerr/commit/192cfd8a8ea9ab942d5bb265d42050917a2f5a04))
- **frontend:** add see more card to media sliders ([587e8db](https://github.com/sct/overseerr/commit/587e8db15e9c19b4c58406e3e4215d8bf87d8762))
- **frontend:** add template variable help button to custom webhook settings page ([29c5bc4](https://github.com/sct/overseerr/commit/29c5bc40975e7ab0a2e08bb77294f164f0c60769))
- **lang:** add support for Chinese (Traditional) language ([686c4f7](https://github.com/sct/overseerr/commit/686c4f71bf930625af082ac5e14dc5f79f5c42eb))
- **lang:** Translations update from Weblate ([#604](https://github.com/sct/overseerr/issues/604)) ([801e765](https://github.com/sct/overseerr/commit/801e76524d6ea0887249f1630402e9c3a3430b44))
- **login:** add local users functionality ([#591](https://github.com/sct/overseerr/issues/591)) ([492e19d](https://github.com/sct/overseerr/commit/492e19df4014e67dc6a2de5903a33c25e13fcf45))
- **notifications:** add notification for declined requests ([2f97f61](https://github.com/sct/overseerr/commit/2f97f61a6e8846975774aa16950a39ada2b1a016)), closes [#663](https://github.com/sct/overseerr/issues/663)
- **notifications:** Webhook Notifications ([#632](https://github.com/sct/overseerr/issues/632)) ([a7cc7c5](https://github.com/sct/overseerr/commit/a7cc7c59753dd9649b2ec37eb9d46fe4fa8e1e1c))
- **requests:** Request Overrides & Request Editing ([#653](https://github.com/sct/overseerr/issues/653)) ([bdb3372](https://github.com/sct/overseerr/commit/bdb33722e6df09dd6d8caa36b104b61c6b8dc00d))
- **server:** add CONFIG_DIRECTORY env var to control config directory location ([fa8f112](https://github.com/sct/overseerr/commit/fa8f112c31ccb5ee6244f776bc97e76d81958539))
- 4K Requests ([#559](https://github.com/sct/overseerr/issues/559)) ([6b2df24](https://github.com/sct/overseerr/commit/6b2df24a2e8f96dd2277a814d7e02015d1f80cdc))
- map AniDB IDs from Hama agent to tvdb/tmdb/imdb IDs ([#538](https://github.com/sct/overseerr/issues/538)) ([0600ac7](https://github.com/sct/overseerr/commit/0600ac7c3a1bc0cdd906634d5f77ea3e99b10e94)), closes [#453](https://github.com/sct/overseerr/issues/453)

### Reverts

- **deps:** revert back to next@10.0.3 until sharp optional dependency bug is fixed ([7962964](https://github.com/sct/overseerr/commit/79629645aacc1a042919834da79bff0c1f69c9d6))

# [1.16.0](https://github.com/sct/overseerr/compare/v1.15.0...v1.16.0) (2021-01-07)

### Bug Fixes

- **frontend:** adjust titlecard badge styling ([effc809](https://github.com/sct/overseerr/commit/effc80977a4ed732092254248f82363e52233171))
- **frontend:** apply same titlecard hover effect to personcard ([67f2b57](https://github.com/sct/overseerr/commit/67f2b57f00216ded3b34965629d6fdd2f16bc25f))
- **frontend:** only animate titlecard when showDetail is true ([0ab4c3c](https://github.com/sct/overseerr/commit/0ab4c3c36fe2c1ded142b6931111516f7f990a41))
- **frontend:** use hardware acceleration for titlecard scale ([88810bf](https://github.com/sct/overseerr/commit/88810bf0a4ef74299f6541b60fa91cea3610f99c))
- **plex-sync:** do not run plex sync if no admin exists ([493d82b](https://github.com/sct/overseerr/commit/493d82b6b066d77609cf66e005fd1f1472b8e011))

### Features

- **lang:** translations update from Weblate ([#495](https://github.com/sct/overseerr/issues/495)) ([b04eda6](https://github.com/sct/overseerr/commit/b04eda6c8a3bfcaa2a14b8a29612fdf690c9fba0))
- **lang:** Translations update from Weblate ([#580](https://github.com/sct/overseerr/issues/580)) ([2bfe0f2](https://github.com/sct/overseerr/commit/2bfe0f2bf66956763ab26d5c54f26e6c456f59f7))
- **notifications:** add pushover integration ([#574](https://github.com/sct/overseerr/issues/574)) ([ee5d018](https://github.com/sct/overseerr/commit/ee5d0181fc9a673b27aefd1d09b0a78c3d2e4f55))

# [1.15.0](https://github.com/sct/overseerr/compare/v1.14.1...v1.15.0) (2021-01-04)

### Bug Fixes

- **api:** return 202 when same seasons are requested again ([5c84702](https://github.com/sct/overseerr/commit/5c847026aad79fcac4d020786ded9f867696c226))
- **build:** fixes build to include commit tag for app build step ([289864a](https://github.com/sct/overseerr/commit/289864af1a995ce04834bf8a220cc238e1954d19))
- **docs:** fix typo in build instructions ([#503](https://github.com/sct/overseerr/issues/503)) ([2b27a71](https://github.com/sct/overseerr/commit/2b27a715b07c27200ba1e5e9623629a34389276d))
- **frontend:** add i18n for request text on titlecard ([a524b9c](https://github.com/sct/overseerr/commit/a524b9c4c8968f6823d33eb270dc26069fe4a725))
- **frontend:** add localized strings for status checker ([2dcda39](https://github.com/sct/overseerr/commit/2dcda39d40d820419e098bd6f1101eb820e5b42d))
- **frontend:** center text in movie auto-approve modal on small screens ([#510](https://github.com/sct/overseerr/issues/510)) ([1438b08](https://github.com/sct/overseerr/commit/1438b08cf0b358d79c6688c64be99f1718ec2d23)), closes [#507](https://github.com/sct/overseerr/issues/507)
- **frontend:** change titlecard to only have a request button ([b5a3a7a](https://github.com/sct/overseerr/commit/b5a3a7a89fcaf86dd794dc419711677b53646577))
- **frontend:** combine duplicate credits on a persons detail page ([d188f6f](https://github.com/sct/overseerr/commit/d188f6ffadff1564c47d5f33138e35498bed29fd)), closes [#504](https://github.com/sct/overseerr/issues/504)
- **frontend:** disable pointer-events on titlecard badges ([ce06879](https://github.com/sct/overseerr/commit/ce0687922a94588b3492e8ddf2e84f54dd1a0d4e))
- **frontend:** fix count of requests in request list ([f124d73](https://github.com/sct/overseerr/commit/f124d732a2911abdccb5abc11471efe61cc20f7a))
- **frontend:** fix sliders overflowing on firefox ([67ac9e0](https://github.com/sct/overseerr/commit/67ac9e075f0ca1cfe7e4766d9168815d7ab600fa)), closes [#566](https://github.com/sct/overseerr/issues/566)
- **frontend:** full season request modal fits on a smaller mobile UI ([#535](https://github.com/sct/overseerr/issues/535)) ([12db7a0](https://github.com/sct/overseerr/commit/12db7a065ad566b47d46de4b949343290894f153))
- **frontend:** handle currentLibrary possibly being null on first manual sync ([93b57a7](https://github.com/sct/overseerr/commit/93b57a76f10a823615ca11ff59f523b67aa30fad))
- **frontend:** increase titlecard status badge size on larger screens ([ba106c4](https://github.com/sct/overseerr/commit/ba106c447d76db2f9ac70a60c5b38cc60ab554fe))
- **frontend:** search clear button now correctly triggers routing ([343f466](https://github.com/sct/overseerr/commit/343f466788abc308b91a414ef61bba816ac8875c))
- **frontend:** set locale cookie expiration to be much longer ([fae4818](https://github.com/sct/overseerr/commit/fae481895736eab81d52eb93788beb00669fb355))
- **frontend:** show movie/series badges always ([8cbf39a](https://github.com/sct/overseerr/commit/8cbf39a9d12eaee7720fa4721c350c1ef9dee856))
- **frontend:** update login/setup images ([058fb65](https://github.com/sct/overseerr/commit/058fb65495baa08a0bd4c9e0aef320c6fc7d017b))
- **holiday:** remove special holiday slider ([8c09033](https://github.com/sct/overseerr/commit/8c0903393cf2cb2a929ba70a8ab6ddcc4cba0574))
- correctly deal with tmdb id duplicates between movies/series ([721ed9a](https://github.com/sct/overseerr/commit/721ed9a93087a57ae749388bddcacf26022e3df6)), closes [#526](https://github.com/sct/overseerr/issues/526)
- use new commit tag file for app version as well ([d00e470](https://github.com/sct/overseerr/commit/d00e470b55327489b49d770144b7cfdb24045be6))

### Features

- **email:** add sendername to email notification ([#506](https://github.com/sct/overseerr/issues/506)) ([0185bb1](https://github.com/sct/overseerr/commit/0185bb1a7084c1faeb61fb1c63e34e26732711c8))
- **frontend:** add clear-field-icon to search field ([#498](https://github.com/sct/overseerr/issues/498)) ([7434a26](https://github.com/sct/overseerr/commit/7434a26f76b5e9f74918f3e1a34443d20ecfcbe4))
- **frontend:** add documentation link to about page ([c034496](https://github.com/sct/overseerr/commit/c034496f557a031aed35cd28dc7221d8cdf36643))
- **frontend:** add telegram integration ([#491](https://github.com/sct/overseerr/issues/491)) ([c8d4d67](https://github.com/sct/overseerr/commit/c8d4d674f412082ad9e9da09abd79660365cf728))
- **frontend:** filter/sorting for request list ([5add44c](https://github.com/sct/overseerr/commit/5add44cfb0379aa6fed7c3b867230292feacc684)), closes [#431](https://github.com/sct/overseerr/issues/431)
- **notifications:** control notifcation types per agent ([8af6a1f](https://github.com/sct/overseerr/commit/8af6a1f566769c583af7dd9e18d162717835b7cc)), closes [#513](https://github.com/sct/overseerr/issues/513)
- status checker to prompt users to reload their frontend when app version changes ([75a4264](https://github.com/sct/overseerr/commit/75a426437a4182e21da13684066966dd5bf8fc5e))

## [1.14.1](https://github.com/sct/overseerr/compare/v1.14.0...v1.14.1) (2021-01-02)

### Bug Fixes

- **holiday:** remove special holiday slider ([22f2037](https://github.com/sct/overseerr/commit/22f2037ea6c5a0ba2ffa4d69f2b7cf42bdcf8575))

# [1.14.0](https://github.com/sct/overseerr/compare/v1.13.0...v1.14.0) (2020-12-25)

### Bug Fixes

- **frontend:** add margin to ButtonWithDropdown component on movie/tv details page ([06fc98b](https://github.com/sct/overseerr/commit/06fc98b6b958221fa180f57f702c348f15b31f1c))
- **frontend:** correctly position title card hover section ([#486](https://github.com/sct/overseerr/issues/486)) ([4b7af86](https://github.com/sct/overseerr/commit/4b7af86111a0300e1a137f23fa4ad1639fa55feb))
- **frontend:** fix missing styles for alert component ([de3d288](https://github.com/sct/overseerr/commit/de3d288949b60d3a3af889d69a62bea2bc799ed7))
- **frontend:** fix mobile dropdown in notifications settings ([6353cda](https://github.com/sct/overseerr/commit/6353cda5825f442dd539886c7b9ba437edf27ac4))
- **frontend:** fix scaling titlecard content position ([bd94740](https://github.com/sct/overseerr/commit/bd947409e6e8ff313011b77adc76ccd5f9112c78))
- **frontend:** improve flex header on movie/tv details page ([d7b1c28](https://github.com/sct/overseerr/commit/d7b1c2840690c144ebf29a360defcbd6fdb21354))
- **frontend:** invalid dom-nesting title card fix ([#482](https://github.com/sct/overseerr/issues/482)) ([f2ebba7](https://github.com/sct/overseerr/commit/f2ebba7b1df775d33d2af6abc3ee2c9de5f2e57a)), closes [#476](https://github.com/sct/overseerr/issues/476)
- **frontend:** remove vote permission for now ([5d06a34](https://github.com/sct/overseerr/commit/5d06a347311bd10c05d8f58068ca7104e265dcca))
- **frontend:** sort person detail credits by tmdb votes ([17518db](https://github.com/sct/overseerr/commit/17518dbe7f545100770a892d03d1f8508adc3650))
- **frontend:** status badge Unavailable renamed to Requested ([ed94a0f](https://github.com/sct/overseerr/commit/ed94a0f335c59de526dd812aea7616313fe002fd)), closes [#374](https://github.com/sct/overseerr/issues/374)
- **frontend:** update titlecard status badge to new requested colors ([8f292d5](https://github.com/sct/overseerr/commit/8f292d538b937ea133175089979ef02599f6fef4))
- **logs:** rotate logs on a daily basis instead of incrementing log filename ([395cbb2](https://github.com/sct/overseerr/commit/395cbb2be6c62f1d7573593e49a93615eaf22853))
- improve apple-touch-icon and android app icons ([329a814](https://github.com/sct/overseerr/commit/329a814a8fb791122266c0b04b05848c71d68ba1))

### Features

- **lang:** translations update from Weblate ([#479](https://github.com/sct/overseerr/issues/479)) ([c8c74b0](https://github.com/sct/overseerr/commit/c8c74b0ae54fcc524aa8b2edf5a5c5e5db6c1638))
- **notifications:** add slack notification agent ([1163e81](https://github.com/sct/overseerr/commit/1163e81adc7da1e8334155ebee5b4672a22143db)), closes [#365](https://github.com/sct/overseerr/issues/365)
- add collections ([#484](https://github.com/sct/overseerr/issues/484)) ([a333a09](https://github.com/sct/overseerr/commit/a333a095820ce3f10857026ba4770a2fffeed7cb)), closes [#418](https://github.com/sct/overseerr/issues/418)
- add separate auto approve permissions for Movies/Series ([4809257](https://github.com/sct/overseerr/commit/480925781691de456abc427fbbba161be11a3a8a)), closes [#268](https://github.com/sct/overseerr/issues/268)
- simple failed request handling ([#474](https://github.com/sct/overseerr/issues/474)) ([02969d5](https://github.com/sct/overseerr/commit/02969d5426245062a2f53475d83c4a8639632c9d))
- YouTube Movie/TV Trailers ([#454](https://github.com/sct/overseerr/issues/454)) ([e88dc83](https://github.com/sct/overseerr/commit/e88dc83aeba0475e3ad421d5ab130cea4fc9a806))

# [1.13.0](https://github.com/sct/overseerr/compare/v1.12.1...v1.13.0) (2020-12-23)

### Bug Fixes

- **api:** correctly return firstAirDate for series in search endpoints ([32b4c99](https://github.com/sct/overseerr/commit/32b4c99950659d9e1da2ffa93c22383c54d0d904)), closes [#462](https://github.com/sct/overseerr/issues/462)
- **email:** correctly log errors when emails fail to send ([0980fa5](https://github.com/sct/overseerr/commit/0980fa54f9fc3bdfae6c57fa5a20ce3b2a88a677))
- **frontend:** added new Radarr v3 logo ([#471](https://github.com/sct/overseerr/issues/471)) ([3bbc716](https://github.com/sct/overseerr/commit/3bbc716434dc04bfe6b55de9898eb2c0ecb03baa))
- **frontend:** approve and decline button (in manage panel) will now fit on mobile ([#441](https://github.com/sct/overseerr/issues/441)) ([66ef72d](https://github.com/sct/overseerr/commit/66ef72dd42912d83ea8f86aabb75fbee547f8de9))
- **frontend:** filter out undefined backdrop paths for person details page ([2e0e4d5](https://github.com/sct/overseerr/commit/2e0e4d5129ed4912415f61eb8d1da41e88ddcaff))
- **frontend:** show backdrops instead of posters for new person detail design ([9f5f920](https://github.com/sct/overseerr/commit/9f5f920c23007363aa7f53ebef0b61236d4f53ea))
- clarify full sync runs every 24 hours ([0c8a180](https://github.com/sct/overseerr/commit/0c8a180189b2610bab2fa977d458743d8a60343e))
- **plex-sync:** match correct tmdb format for movies ([4205e32](https://github.com/sct/overseerr/commit/4205e32ae71bc18c07209f1c82e6af1cb5f01335))

### Features

- **email:** option to allow self signed certificates ([6898357](https://github.com/sct/overseerr/commit/6898357b13a6aa53a55709ea95819c2b3df6784c))
- **frontend:** adjust person details design and add improved truncate ([1fb7ea7](https://github.com/sct/overseerr/commit/1fb7ea72589d2908ae80a2a688881d4eb3c050e5))
- **frontend:** first air date added to TV details page ([#470](https://github.com/sct/overseerr/issues/470)) ([a7db01f](https://github.com/sct/overseerr/commit/a7db01fba483ca633a6eb9d39eb085ab9939d4d2))
- **lang:** translations update from Weblate ([#410](https://github.com/sct/overseerr/issues/410)) ([941fe19](https://github.com/sct/overseerr/commit/941fe1990454439cf05b48ef92bd3493432f8ed8))
- **logs:** rotate log files if they reach 20MB in size ([22002ab](https://github.com/sct/overseerr/commit/22002ab4c76aace2bb202ac58da605b7a6f75d6d)), closes [#438](https://github.com/sct/overseerr/issues/438)
- **notifications:** include direct links to media in notifications ([659fa50](https://github.com/sct/overseerr/commit/659fa505f0db32262ad0041cddb4daea893e6d65)), closes [#437](https://github.com/sct/overseerr/issues/437)
- **plex-sync:** add support for hama guid's ([ffe9e19](https://github.com/sct/overseerr/commit/ffe9e19c3b99de6af1185900e292da641ff44320)), closes [#453](https://github.com/sct/overseerr/issues/453)

## [1.12.1](https://github.com/sct/overseerr/compare/v1.12.0...v1.12.1) (2020-12-22)

### Bug Fixes

- **migration:** fixes issue migrating away from the unique imdbId constraint ([69fd7a5](https://github.com/sct/overseerr/commit/69fd7a5511215674a5c22ba48627f221da900229))

# [1.12.0](https://github.com/sct/overseerr/compare/v1.11.0...v1.12.0) (2020-12-22)

### Bug Fixes

- **api:** fix cross-imported type crashing build ([f35dae5](https://github.com/sct/overseerr/commit/f35dae56a583a5545375318fa5be994ae1f2557f))
- **api:** prevent checking first admin account for plex server access ([22006e9](https://github.com/sct/overseerr/commit/22006e9dbde82609440f89bde9a40887b4742682))
- **frontend:** add name, short_name and start_url to manifest ([#424](https://github.com/sct/overseerr/issues/424)) ([c6836e0](https://github.com/sct/overseerr/commit/c6836e02c810e8adb12c3a4b110f9604cf5b7b81))
- **frontend:** adjust person card layout to deal with overflowing content ([4891298](https://github.com/sct/overseerr/commit/48912988915ae40606a900a6f1dd23fc25ed567f)), closes [#416](https://github.com/sct/overseerr/issues/416)
- **frontend:** allow more special characters in search input ([5deb64a](https://github.com/sct/overseerr/commit/5deb64a87fd70e97da27a025ad11fb8ace0e0b57)), closes [#430](https://github.com/sct/overseerr/issues/430)
- **logs:** improve logging when adding to sonarr/radarr ([4b50522](https://github.com/sct/overseerr/commit/4b505223b881a750007e3fbc7d4bcb9677d4d412))
- only run migrations in production ([ab9cef3](https://github.com/sct/overseerr/commit/ab9cef3624b5db1ec03507553a69d33b87857e29))
- **notifications:** always update the media table when seasons become available ([0916b58](https://github.com/sct/overseerr/commit/0916b58594a00db98c6701fdcaee4f3c3e08904e))
- **plex-sync:** fixes processing movies using TMDB agent ([764db94](https://github.com/sct/overseerr/commit/764db94f1bd7866309684d5bd56033b21cbc2e0c)), closes [#363](https://github.com/sct/overseerr/issues/363)

### Features

- **frontend:** add crew related movies/shows to person details page ([12127a7](https://github.com/sct/overseerr/commit/12127a77633f0e92ae88cbafd49581296f559c33))
- **frontend:** add full crew page for movies/shows ([604ba2a](https://github.com/sct/overseerr/commit/604ba2a92f1d59489e7fc6dfc011347f8595c123))
- default user permissions added to settings ([e7ee85c](https://github.com/sct/overseerr/commit/e7ee85c29b5d25c6bff58717eae5e62de4dcef0c)), closes [#388](https://github.com/sct/overseerr/issues/388)
- import users from plex ([#428](https://github.com/sct/overseerr/issues/428)) ([7e8f361](https://github.com/sct/overseerr/commit/7e8f361af711001cfc4dcc06a384b76f9846f90f)), closes [#281](https://github.com/sct/overseerr/issues/281)
- **frontend:** add prioritized crew under overview ([6753d9d](https://github.com/sct/overseerr/commit/6753d9daaafb18672f14fd86f2c1675dcec39b13)), closes [#406](https://github.com/sct/overseerr/issues/406)
- **notifications:** added ability to send test notifications ([44a3054](https://github.com/sct/overseerr/commit/44a305426f3e9829c167a4a73095d0d248641f47)), closes [#309](https://github.com/sct/overseerr/issues/309)

### Reverts

- **deps:** revert react-use-clipboard to 1.0.2 ([7083ddf](https://github.com/sct/overseerr/commit/7083ddf18121716e3442acab3506c395fdc351ac))

# [1.11.0](https://github.com/sct/overseerr/compare/v1.10.0...v1.11.0) (2020-12-20)

### Features

- **frontend:** add language picker to setup/login ([ff2ab29](https://github.com/sct/overseerr/commit/ff2ab29491a80c421525b9a394d6fbbf54914dc2))
- **frontend:** add support overseerr block to about page ([c128898](https://github.com/sct/overseerr/commit/c128898206d6cbb482de4d8dca53f70b87e4911a))
- **frontend:** releases added to about page ([b7f5739](https://github.com/sct/overseerr/commit/b7f573903500cc8a62e39afd787bc1da8c09d88b)), closes [#303](https://github.com/sct/overseerr/issues/303)
- **lang:** add support for Italian, Portuguese (Brazil) and Serbian ([108dfc4](https://github.com/sct/overseerr/commit/108dfc4afd31388cb6c9e07deccd168ade8b1574))
- **lang:** add support for swedish language ([c9fe6cb](https://github.com/sct/overseerr/commit/c9fe6cb0b7ea984d8e4e1cb3f284935c9da7cc2b))
- **lang:** translations update from Weblate ([#400](https://github.com/sct/overseerr/issues/400)) ([1bd0e64](https://github.com/sct/overseerr/commit/1bd0e646e313ddf77ef331e818e03401fbf64a72))
- **lang:** translations update from Weblate ([#403](https://github.com/sct/overseerr/issues/403)) ([3778ad8](https://github.com/sct/overseerr/commit/3778ad829c0897de178212b3bde4c0d3b5089161))

# [1.10.0](https://github.com/sct/overseerr/compare/v1.9.1...v1.10.0) (2020-12-19)

### Bug Fixes

- **email:** fix link to Overseerr in email templates ([816fec1](https://github.com/sct/overseerr/commit/816fec1a83a53edb3b65c3e5e7d0e6e1bd49726d)), closes [#392](https://github.com/sct/overseerr/issues/392)
- **frontend:** adjust padding of search box so placeholder text fits on mobile ([3601d44](https://github.com/sct/overseerr/commit/3601d442db32d3f98f7b050365c11ea8ef9bc4ae)), closes [#393](https://github.com/sct/overseerr/issues/393)
- **frontend:** changed request block for slideover on mobile UI ([#387](https://github.com/sct/overseerr/issues/387)) ([549567a](https://github.com/sct/overseerr/commit/549567a7e9db01933546d9970fc06f17218dfab1))
- **frontend:** hide Request More button if all current seasons are available ([2a4dd52](https://github.com/sct/overseerr/commit/2a4dd52275007e48f946c3b9e29f1d78da57bdaa)), closes [#343](https://github.com/sct/overseerr/issues/343)
- **frontend:** try not to render broken rottentomatoes data ([a0c5608](https://github.com/sct/overseerr/commit/a0c5608aa0b6c7a4294300589efa9a662163ce48))

### Features

- **lang:** translations update from Weblate ([#391](https://github.com/sct/overseerr/issues/391)) ([5f71fb7](https://github.com/sct/overseerr/commit/5f71fb7ee280714275d2ac045c472fcdddd5a2ea))
- add missing tzdata package to image ([53bede6](https://github.com/sct/overseerr/commit/53bede692d4f0e940dededa63015fe1908129914)), closes [#394](https://github.com/sct/overseerr/issues/394)
- **frontend:** add external links to movie and tv detail pages ([a0024a0](https://github.com/sct/overseerr/commit/a0024a0cbe717d78f53413bb78644c829f143c4d))
- **lang:** translations update from Weblate ([#380](https://github.com/sct/overseerr/issues/380)) ([8408e19](https://github.com/sct/overseerr/commit/8408e19568b2f239c57e11e2946c75f193d1c22e))

## [1.9.1](https://github.com/sct/overseerr/compare/v1.9.0...v1.9.1) (2020-12-18)

### Bug Fixes

- change default internal port to 5055 ([#389](https://github.com/sct/overseerr/issues/389)) ([5e5ba40](https://github.com/sct/overseerr/commit/5e5ba4050563f07bff367d2fb31ed7e7fca4291e))

# [1.9.0](https://github.com/sct/overseerr/compare/v1.8.0...v1.9.0) (2020-12-18)

### Features

- api key regeneration ([6beac73](https://github.com/sct/overseerr/commit/6beac736efcf7b9102e02e43b75d91a9a158cd22))
- **api:** add movie keyword search ([f88c4a6](https://github.com/sct/overseerr/commit/f88c4a6d4a49f8f3451ba6c85153677f33b7f5f6))
- **frontend:** add studio/networks to movie/tv details ([4b6ad8a](https://github.com/sct/overseerr/commit/4b6ad8a3871957db4192b603abf38404250cea5d)), closes [#370](https://github.com/sct/overseerr/issues/370)
- **frontend:** added user deletion to the user list ([727fa06](https://github.com/sct/overseerr/commit/727fa06c18febb2a97ca219cc6bf0277ff462acd)), closes [#348](https://github.com/sct/overseerr/issues/348)
- **holiday:** special seasonal slider added to discover :) ([908f635](https://github.com/sct/overseerr/commit/908f63557ca03a1da8b16809ffa2c3acd782d94e))
- allow to listen server on specific host interface ([#381](https://github.com/sct/overseerr/issues/381)) ([086183b](https://github.com/sct/overseerr/commit/086183b5636aa8d075d01fe59492c3eab0d1345b)), closes [#273](https://github.com/sct/overseerr/issues/273)
- anime profile support ([#384](https://github.com/sct/overseerr/issues/384)) ([0972f40](https://github.com/sct/overseerr/commit/0972f40a4e1fb3b5f02b07ae46b997d71aab9bfb)), closes [#266](https://github.com/sct/overseerr/issues/266)

# [1.8.0](https://github.com/sct/overseerr/compare/v1.7.0...v1.8.0) (2020-12-17)

### Features

- **lang:** translations update from Weblate ([#336](https://github.com/sct/overseerr/issues/336)) ([ee84f74](https://github.com/sct/overseerr/commit/ee84f74f8a3558875b41daa539f42d00b949898a))

# [1.7.0](https://github.com/sct/overseerr/compare/v1.6.0...v1.7.0) (2020-12-17)

### Bug Fixes

- **email:** do not pass auth object to transport if no auth data present ([d5eb4d8](https://github.com/sct/overseerr/commit/d5eb4d8d438a159266b2de66b6bcdd9440a0c8ef)), closes [#312](https://github.com/sct/overseerr/issues/312)
- **frontend:** add http/https prefix to hostname fields for plex/radarr/sonarr ([ce0266f](https://github.com/sct/overseerr/commit/ce0266f74ea3979b291ff962271a928682892788)), closes [#357](https://github.com/sct/overseerr/issues/357)
- **frontend:** clarify that radarr/sonnarr servers must be tested before profiles/folders appear ([fc12ab8](https://github.com/sct/overseerr/commit/fc12ab84d9482eb3a11f117f8cab6fd48a9401cd)), closes [#326](https://github.com/sct/overseerr/issues/326) [#328](https://github.com/sct/overseerr/issues/328)
- **frontend:** correctly show an unauthorized error when a user fails to login ([18925de](https://github.com/sct/overseerr/commit/18925decafdac518f52a354c594cc378d2529022)), closes [#322](https://github.com/sct/overseerr/issues/322)
- **frontend:** fix tv shows failing to open when firstAirDate is undefined ([c21fa5b](https://github.com/sct/overseerr/commit/c21fa5b5350abdd8e03c077fde7246fa398e176e)), closes [#347](https://github.com/sct/overseerr/issues/347)
- **frontend:** make minimum availability required for Radarr servers ([2fe53ec](https://github.com/sct/overseerr/commit/2fe53ec5a8534e75c7d0cef31a8b46065111e0a7)), closes [#345](https://github.com/sct/overseerr/issues/345)
- **plex-sync:** bundle duplicate ratingKeys to speed up recently added sync ([67146c3](https://github.com/sct/overseerr/commit/67146c33ef7f28d520ba2c50b32673d43f4525c8)), closes [#360](https://github.com/sct/overseerr/issues/360)
- **sonarr.ts, mediarequest.ts:** add missing seasonFolder option ([#358](https://github.com/sct/overseerr/issues/358)) ([e9c899c](https://github.com/sct/overseerr/commit/e9c899ce419d149dde2ad9a0f7d5a2f2545b3ebf))

### Features

- **frontend:** show alert when there are no default radarr/sonarr servers ([0d088e0](https://github.com/sct/overseerr/commit/0d088e085e68d39455fda21d1fd08ebcaef2c06b)), closes [#344](https://github.com/sct/overseerr/issues/344)

# [1.6.0](https://github.com/sct/overseerr/compare/v1.5.0...v1.6.0) (2020-12-16)

### Bug Fixes

- **api:** accept the api key to perform actions on the api with X-API-Key header ([33f8831](https://github.com/sct/overseerr/commit/33f8831e880dc7fd3f69d951246cada5c6c0ffe7))
- **api:** filter out libraries that do not have any metadata agent or are not movie/show ([01c179f](https://github.com/sct/overseerr/commit/01c179f762e686a1e5a3d4dab3a5bea53425b575))
- **api:** only run recently added sync on enabled libraries ([e08fa35](https://github.com/sct/overseerr/commit/e08fa35548bb8644afa8df3124e6f9cc3a2c8f4a)), closes [#259](https://github.com/sct/overseerr/issues/259)
- **api:** set plex libraries to disabled if the name changes ([675060b](https://github.com/sct/overseerr/commit/675060bcdf23acbfd4de2900a65f95e74f4966a5)), closes [#324](https://github.com/sct/overseerr/issues/324)
- **frontend:** adds a tip to plex setup to clarify that syncing runs in the background ([df4ac83](https://github.com/sct/overseerr/commit/df4ac8361f82971ee845f3be217408a9123a0bf3)), closes [#325](https://github.com/sct/overseerr/issues/325)
- **frontend:** aligned movie and tv details ([#331](https://github.com/sct/overseerr/issues/331)) ([db0a5c4](https://github.com/sct/overseerr/commit/db0a5c44f678e76eee7f5582381016306d1f46a2))
- **frontend:** close sidebar when clicking outside ([#333](https://github.com/sct/overseerr/issues/333)) ([6d7907e](https://github.com/sct/overseerr/commit/6d7907e844a909993d185759d660632f55aeaa35))
- spelling mistake on the word 'requested' fixed ([#319](https://github.com/sct/overseerr/issues/319)) ([961d110](https://github.com/sct/overseerr/commit/961d1107208069a6fc820a1ba97ffda7336677cb))

### Features

- add version to startup logs ([2948f93](https://github.com/sct/overseerr/commit/2948f9360eb484d1d6c0740a840135ca97e7240a))
- **frontend:** temporary logs page to clear up confusion about it 404ing ([d9788c4](https://github.com/sct/overseerr/commit/d9788c4aa9f87e2eda3f7e3f1adc985f16039552)), closes [#272](https://github.com/sct/overseerr/issues/272)
- **lang:** add support for Spanish language ([6cd2049](https://github.com/sct/overseerr/commit/6cd20491d2a0ceb995c4744eeb92a6e2f57a4893))
- **lang:** Translations update from Weblate ([#291](https://github.com/sct/overseerr/issues/291)) ([fddbb3c](https://github.com/sct/overseerr/commit/fddbb3cdfe3d50b2835c248556139c769dc2b805))

# [1.5.0](https://github.com/sct/overseerr/compare/v1.4.0...v1.5.0) (2020-12-15)

### Bug Fixes

- **api:** require package.json directly so typescript doesnt compile it into dist folder ([b9faa64](https://github.com/sct/overseerr/commit/b9faa6486b35aa865019aa8af9d307531054bc1d))
- **frontend:** add validation for Radarr/Sonarr server name ([b5988f9](https://github.com/sct/overseerr/commit/b5988f9a5ff274e97f208c2726abe76c22c858ee))
- **frontend:** only show alpha notice to admins ([ff61895](https://github.com/sct/overseerr/commit/ff618956b5d9cf933d867ea979b612c3d8a6f30b))
- add support for ssl when connecting to plex ([3ba09d0](https://github.com/sct/overseerr/commit/3ba09d07eb0367c41603cd55e7ff41c66fb641c4)), closes [#275](https://github.com/sct/overseerr/issues/275)
- **services:** improve logging for when Radarr movie already exists ([#285](https://github.com/sct/overseerr/issues/285)) ([f998873](https://github.com/sct/overseerr/commit/f998873fc5669a547901f2733c9c785d744d27ca)), closes [#260](https://github.com/sct/overseerr/issues/260)

### Features

- **lang:** add i18n strings for new about page ([900827b](https://github.com/sct/overseerr/commit/900827be97845688e4bea72a8c5d9611a3e9d069))
- about page initial version ([3f2a04c](https://github.com/sct/overseerr/commit/3f2a04c881bf06b73a952181fa463af84454b0dd))

# [1.4.0](https://github.com/sct/overseerr/compare/v1.3.2...v1.4.0) (2020-12-15)

### Bug Fixes

- changing parameter name to use correct 'port' [#276](https://github.com/sct/overseerr/issues/276) ([#277](https://github.com/sct/overseerr/issues/277)) ([6d08b10](https://github.com/sct/overseerr/commit/6d08b108200177ca3068c852e60a0df75ce2232a))
- **services:** include radarr/sonarr baseUrl when adding media ([78af1a3](https://github.com/sct/overseerr/commit/78af1a3e6d00a5645a05e7bf3cf56a59439b6cc9))

### Features

- **lang:** Translations update from Weblate ([#240](https://github.com/sct/overseerr/issues/240)) ([e17c637](https://github.com/sct/overseerr/commit/e17c63748362b6a480693e003ef5eec614dcec43))

## [1.3.2](https://github.com/sct/overseerr/compare/v1.3.1...v1.3.2) (2020-12-14)

### Bug Fixes

- **frontend:** convert plex port to a number before posting to the api ([8cb05c4](https://github.com/sct/overseerr/commit/8cb05c413a15a4b74e37ece5e24367d115995b32))
- **frontend:** converts email smtp port to a number before posting to the api ([2098a2d](https://github.com/sct/overseerr/commit/2098a2d3d2981fd2ae54392aec3ef81327f2858e)), closes [#251](https://github.com/sct/overseerr/issues/251)
- **frontend:** encode special characters in search input to prevent crashing router ([15013d6](https://github.com/sct/overseerr/commit/15013d6c5dbff15704c7c30d261d68a265e7f2d7)), closes [#252](https://github.com/sct/overseerr/issues/252)
- **plex sync:** catch errors that occur during processMovie ([edbbccf](https://github.com/sct/overseerr/commit/edbbccf3ae623430294f1a5c3fd2728dbd42e555)), closes [#244](https://github.com/sct/overseerr/issues/244) [#246](https://github.com/sct/overseerr/issues/246) [#250](https://github.com/sct/overseerr/issues/250)
- **services:** improve logging for adding movies to Radarr ([6c1ee83](https://github.com/sct/overseerr/commit/6c1ee830a183f89bb1fe96a181a7d61684e23b22))
- **services:** radarr/sonarr will use the correct default server ([0658b79](https://github.com/sct/overseerr/commit/0658b7943e1ab25816db9da34d4c9ea808d9203d))

## [1.3.1](https://github.com/sct/overseerr/compare/v1.3.0...v1.3.1) (2020-12-14)

### Bug Fixes

- **frontend:** also convert activeProfileId to a number for radarr/sonarr submissions ([7bf924f](https://github.com/sct/overseerr/commit/7bf924f7e94a0e0834f41b4ec067ed277c652766))
- **frontend:** also convert ports to numbers when saving radarr/sonarr servers ([c53dc3b](https://github.com/sct/overseerr/commit/c53dc3b15da522c6e6ab76bbc9d15008a8a9fb9d))
- **frontend:** new radarr/sonarr ports will be converted to a number before posting ([92c9001](https://github.com/sct/overseerr/commit/92c9001c9d1f2cbd272a5897ea1157d2cadbce2d))

# [1.3.0](https://github.com/sct/overseerr/compare/v1.2.0...v1.3.0) (2020-12-14)

### Bug Fixes

- **api:** correctly generate clientId on first startup ([5f09e83](https://github.com/sct/overseerr/commit/5f09e83ed870336638d3e9d94fcf55ead928e737))

### Features

- **frontend:** add full cast page for movies and series ([051f1b3](https://github.com/sct/overseerr/commit/051f1b3e899bf749e632743e5c8d45a02b621998))
- **lang:** translated using Weblate (Dutch) ([1ab3a4b](https://github.com/sct/overseerr/commit/1ab3a4b80a081d7e4a201f1290cd270ed5b38ac7))
- **lang:** translated using Weblate (English) ([0949c9b](https://github.com/sct/overseerr/commit/0949c9b334b3a4b6c342517a157a9e2b7596f2f0))
- **lang:** translated using Weblate (French) ([f943701](https://github.com/sct/overseerr/commit/f943701e13c7f0de5a711302597858cc898b16e2))
- **lang:** translated using Weblate (French) ([30d04ce](https://github.com/sct/overseerr/commit/30d04ce35adc21070cce37ab10384154afda191b))
- **lang:** translated using Weblate (German) ([7bf9add](https://github.com/sct/overseerr/commit/7bf9addd13a707aac23b64ef3f1733e491d40a4e))
- **lang:** translated using Weblate (German) ([b6e60a4](https://github.com/sct/overseerr/commit/b6e60a412b30907aea751a4cf1ce0cc8230f9814))
- **lang:** translated using Weblate (Japanese) ([08e968f](https://github.com/sct/overseerr/commit/08e968fd0097ec7b2a65de064ed5b07e7c49ef39))
- **lang:** translated using Weblate (Norwegian Bokmål) ([83efb0e](https://github.com/sct/overseerr/commit/83efb0e3d4d96b6a2d2ebdd85d36c9d78c1717b2))
- **lang:** translated using Weblate (Russian) ([0d8e0d0](https://github.com/sct/overseerr/commit/0d8e0d0352f72fdb65ee8f054371eae08c39fe33))

# [1.2.0](https://github.com/sct/overseerr/compare/v1.1.0...v1.2.0) (2020-12-11)

### Bug Fixes

- **frontend:** person cards now show correctly in ListView's ([ccb9855](https://github.com/sct/overseerr/commit/ccb98553f104c1aebd33796b7090cc9bbe964bd7))
- **frontend:** properly remove site overlay when closing modals ([3fa7ff9](https://github.com/sct/overseerr/commit/3fa7ff9858d14d132151f3329164d55d74638f53))
- **frontend:** switch to using Transition component for modals ([b16fbaf](https://github.com/sct/overseerr/commit/b16fbafa1f3d5e105c0a4ba6f1d66aa064019636)), closes [#220](https://github.com/sct/overseerr/issues/220)
- fix missing personid in Discover ([d8060af](https://github.com/sct/overseerr/commit/d8060afe02574337f51b88cab0a0f824976ac721))
- missing personId in ListView component ([6502feb](https://github.com/sct/overseerr/commit/6502feb1a5be3c6daab33230814fe74632c87f7e))
- **frontend:** update overflow issues with seasons + email ([#217](https://github.com/sct/overseerr/issues/217)) ([2d0afb2](https://github.com/sct/overseerr/commit/2d0afb29d37798a626e3f182571ccce43d80063c)), closes [#216](https://github.com/sct/overseerr/issues/216)
- **lang:** fix missing i18n string for agent enabled in email notification page ([42788ad](https://github.com/sct/overseerr/commit/42788adb75f7d23e68327688b1c542dd047e9609))

### Features

- **lang:** update language files ([8cd067b](https://github.com/sct/overseerr/commit/8cd067b6e9df1a3c8f4056789436a31177703986))
- person details page ([d6eb3ae](https://github.com/sct/overseerr/commit/d6eb3ae64ef46bd62145010d3029e272676487c3))
- **lang:** add nb-NO and de language support to app ([d38b28d](https://github.com/sct/overseerr/commit/d38b28d2061b38366989ff412957a5dee5766c6f))
- **lang:** add support for dutch language ([df94db0](https://github.com/sct/overseerr/commit/df94db050bf68a925118e0ce865d27178b702f9e))
- **lang:** add support for russian languge ([8d8e750](https://github.com/sct/overseerr/commit/8d8e7509826514eebc859374d2e1ab212cc442d1))
- **lang:** added translation using Weblate (Russian) ([887f5dd](https://github.com/sct/overseerr/commit/887f5dd487b61676029652d99cbc5b40213aa22e))
- **lang:** translated using Weblate (French) ([30a8934](https://github.com/sct/overseerr/commit/30a8934626fa2d47e95b5925d7e4227a0d0aa728))
- **lang:** translated using Weblate (German) ([44dbb74](https://github.com/sct/overseerr/commit/44dbb745b6216ce19fab4740520785c6414cf367))
- **lang:** translated using Weblate (Japanese) ([a494507](https://github.com/sct/overseerr/commit/a494507dfeafb0cfd2bd66fb01138522e0e80737))
- **lang:** translated using Weblate (Russian) ([86cadb8](https://github.com/sct/overseerr/commit/86cadb8283fcab8745b4c09f8429fd9e46708813))
- **lang:** translations update from Weblate ([#201](https://github.com/sct/overseerr/issues/201)) ([b0c663b](https://github.com/sct/overseerr/commit/b0c663baccd994e234b4d41d86486c3af4906344))

# [1.1.0](https://github.com/sct/overseerr/compare/v1.0.0...v1.1.0) (2020-12-08)

### Bug Fixes

- fix a few misc unused imports and useless assignments/conditionals ([8e6daf7](https://github.com/sct/overseerr/commit/8e6daf7bd271ce5bebf4a00f5bb1144bd6b60aa5))
- **frontend:** dont show delete button in request list for users without correct permission ([83fde46](https://github.com/sct/overseerr/commit/83fde46a59c6f1910806a6106b5526b8adbc386c))
- **frontend:** push updated i18n locale files ([b4002d7](https://github.com/sct/overseerr/commit/b4002d71323a04e7991198cedc263660e872df8d))

### Features

- generate real api key ([a839370](https://github.com/sct/overseerr/commit/a8393707fec85a9262af5ba8c03d205190b2235b))
- **frontend:** add i18n strings for request list and request item ([6c4022f](https://github.com/sct/overseerr/commit/6c4022fb236583ad20d4c4c6693c1339e165b4af))
- **frontend:** initial version of the requests page (no filtering/sorting) ([1ba027b](https://github.com/sct/overseerr/commit/1ba027b4357e078c3f177d9d07208049f0c1ce65))
- **frontend:** only load request/tmdb cards when in the browser view ([2d51efd](https://github.com/sct/overseerr/commit/2d51efd71612ec969b83c62d6aa0dac6df9391a3))

# 1.0.0 (2020-12-06)

### Bug Fixes

- **api:** fix scheduling for plex full sync (maybe) ([7287a6a](https://github.com/sct/overseerr/commit/7287a6a95703b23acc0c4f6eb3beb9ec2295e33f))
- **frontend:** always show request modal option for tv ([2b46268](https://github.com/sct/overseerr/commit/2b462688243531b4be620a942f59defd4e0534d0))
- **frontend:** canceled movie request should set parent movie status back to unknown ([#198](https://github.com/sct/overseerr/issues/198)) ([139871f](https://github.com/sct/overseerr/commit/139871f218812a15f742aa66408db12704e0b9b5))
- **frontend:** close request modals when complete ([85ae499](https://github.com/sct/overseerr/commit/85ae4998f0ba8d4869b9b244f2c440b9df1310d2))
- **frontend:** dont show runtime if there is no runtime data ([e0c39ae](https://github.com/sct/overseerr/commit/e0c39aeca119b822f2a54ff05a97f91780ddd052))
- **frontend:** fix missing data for request modal title i18n ([a56fd16](https://github.com/sct/overseerr/commit/a56fd16ab6638d4649fe9f8b9d75e7cae7742f73))
- **frontend:** fix missing import for ReactNode type in Slider ([b26a234](https://github.com/sct/overseerr/commit/b26a2347e7b0f7ff8720a204d9faefd501ba886c))
- **frontend:** fix modal design and rename some text for adding servers ([46d99b0](https://github.com/sct/overseerr/commit/46d99b02b1c992c7b8dde2150217ed9ce326b7a5))
- **frontend:** fix opening popups on safari ([364d9d1](https://github.com/sct/overseerr/commit/364d9d105ca3690fcd5f635485d7c025353bb9f1))
- **frontend:** fix request card placeholder sizes for mobile ([ef62c67](https://github.com/sct/overseerr/commit/ef62c67480ed52d753ea6db8205f035b2e9da272))
- **frontend:** show a badge on requestcard for partially available status ([59056c4](https://github.com/sct/overseerr/commit/59056c44f942a37df536ff947b5faccc27f32246))
- dont cross import SyncStatus type ([e032e38](https://github.com/sct/overseerr/commit/e032e385a5253d215490255c676f42ee48f39428))
- fix type import from server side crashing build process ([89be56d](https://github.com/sct/overseerr/commit/89be56d8403ebc60c411e7cb357593edd9c79bb2))
- **frontend:** fix title detail background image to be centered ([b92f64f](https://github.com/sct/overseerr/commit/b92f64fa6e167bc89168d8f5c0f2eb12efa0b6f0))
- **frontend:** fixed similar/recommendations showing when empty ([#180](https://github.com/sct/overseerr/issues/180)) ([a3ca9b4](https://github.com/sct/overseerr/commit/a3ca9b40c552e6cc5effc2f57f7562ff6f723e42))
- **frontend:** have tvDetail use the new RequestModal ([6aca826](https://github.com/sct/overseerr/commit/6aca82607b97d4a4ad74e2ea843d52fba4689e6a))
- **frontend:** reinitalize plex form after data loads ([97e3036](https://github.com/sct/overseerr/commit/97e30367fb5d2d27efc42c1d76b0d051b6f1da76))
- **frontend:** remove requestId from tilecard request modal component ([61b6152](https://github.com/sct/overseerr/commit/61b6152e8915c99585b944756a61d33b8c8a0307))
- **frontend:** run initial props for children components after getting the user ([fdf9f38](https://github.com/sct/overseerr/commit/fdf9f38776b6d4c08b3505c03b354639cebb011f))
- **frontend:** when there were no results in the list view, it would call fetch more infinitely ([c0ce87b](https://github.com/sct/overseerr/commit/c0ce87b6f65bf0ab1301c7ca61090d779709529f))
- fixed an issue with eslint-prettier on windows ([#32](https://github.com/sct/overseerr/issues/32)) ([b673ea1](https://github.com/sct/overseerr/commit/b673ea1b18ca0f432996bb9e4e5d148af0247170))
- fixes next.js build to not include server files ([de8ee9b](https://github.com/sct/overseerr/commit/de8ee9ba85e0160b0b472cab44f92c01796efec8))

### Features

- add migration for delete cascades on season requests/seasons ([c688cf6](https://github.com/sct/overseerr/commit/c688cf60c710f0cf0b2da5ba6b0c18a2d137e7f9))
- **api:** email notification agent ([0962392](https://github.com/sct/overseerr/commit/0962392e3930c7fdcb3164b9143cc8faca38bdfa))
- **frontend:** add french language file ([cd6d8a8](https://github.com/sct/overseerr/commit/cd6d8a8216e7ae183b046d26cd22f3c1dc1d2b35))
- **frontend:** add translatable strings for request card ([0d2f360](https://github.com/sct/overseerr/commit/0d2f360c22cd9bb50ae04f00a25e5fcc6c21bcdd))
- **frontend:** added more localized strings ([659a601](https://github.com/sct/overseerr/commit/659a6018777718f7a90141307678d8dadcfd77f8))
- actually include email templates in built server files ([a28a8b3](https://github.com/sct/overseerr/commit/a28a8b37b0afc79583e4a7191a91f73ff6d3adad))
- add application url config to main settings ui ([a359672](https://github.com/sct/overseerr/commit/a359672ebafffef742858814f0faa918e0341aa3))
- add filtering for requests api ([cb9ae25](https://github.com/sct/overseerr/commit/cb9ae25d94f21e97113dfea3ca45c7002089e344))
- add trending to discover page ([ff8b9d8](https://github.com/sct/overseerr/commit/ff8b9d8e7ed228a153c2da4d237f7a4f99a79321))
- force setup if app is not initialized ([a99705f](https://github.com/sct/overseerr/commit/a99705f6a5674b436ae28cbc558f4ee6e99ac910))
- initial user list (no edit/delete yet) and job schedules ([24a0423](https://github.com/sct/overseerr/commit/24a0423f3b14303cfb0e83aef6e9e3bb273c5ba9))
- manage series slideover added (and approve/decline/delete hooked up) ([236c4e5](https://github.com/sct/overseerr/commit/236c4e5e6126d2424a4badc08b7f7e6d1d70f401))
- media delete option in manage media slideover ([250f484](https://github.com/sct/overseerr/commit/250f48492c95d74e40d95d3f026d2952157bc6e1))
- other email notifications for approved/available ([0d73d88](https://github.com/sct/overseerr/commit/0d73d88f35b03e993f305873dc72672003c7d9e5))
- radarr edit/create modal/backend functionality ([c4ac357](https://github.com/sct/overseerr/commit/c4ac357ef4cdd7a2c610260db46a4f0c325cd785))
- season creation migration ([978f92a](https://github.com/sct/overseerr/commit/978f92a1c589ac404a3cb1103a68a8a5ffb0dd7d))
- sonarr edit/delete modal ([3204326](https://github.com/sct/overseerr/commit/320432657e6ccf4d255238098e03590f28267bdb))
- throw 404 when movie/tv show doesnt exist ([0601b44](https://github.com/sct/overseerr/commit/0601b446873e2eaf042044dd6a995b713586b0cc))
- **api:** sonarr api wrapper / send to sonarr ([9385592](https://github.com/sct/overseerr/commit/9385592362eeba1dba05c5aa8fc7a2de1d054d74))
- **frontend:** add header styling to movie/tv recommendation and similar list views ([f5f2545](https://github.com/sct/overseerr/commit/f5f2545520a43daa23e1276d24ff60d794ebbc6e))
- **frontend:** add links to detail pages from new request card ([6ad3384](https://github.com/sct/overseerr/commit/6ad3384a78f7bcb03f409cce8b35cc61d634d6b2))
- **frontend:** new design for request card ([93738e1](https://github.com/sct/overseerr/commit/93738e154c41fd11d5c6cf3d35573daf54ead471))
- **frontend:** update favicon ([886389a](https://github.com/sct/overseerr/commit/886389a361da54c616da3bdfeee9a85e9d12bcf3))
- notification framework ([d8e542e](https://github.com/sct/overseerr/commit/d8e542e5fe2ed76dcb20fb6dfc5f59430cd4245d))
- notifications for media_available and media_approved ([a6c5e65](https://github.com/sct/overseerr/commit/a6c5e65bbfc196545471e99fe2e5b7194f9dd387))
- rotten tomatoes scores on movie/tv details pages ([1694f60](https://github.com/sct/overseerr/commit/1694f60e8aa475ceeb7f170a783ec0ba70bd4bce))
- upcoming movies on discover ([67290dd](https://github.com/sct/overseerr/commit/67290dd502571a22dcf8559ac07f42e855275bd0))
- upcoming/trending list views and larger title cards ([94eaaf9](https://github.com/sct/overseerr/commit/94eaaf96b4302a832c52ccb72009b3593452c779))
- upgrade tailwindcss to 2.0.1 ([fb5c791](https://github.com/sct/overseerr/commit/fb5c791b0b6b7593a472bf01713999a001f92dc7))
- user edit functionality (managing permissions) ([185ac26](https://github.com/sct/overseerr/commit/185ac2648fd21c4bf9692ac5ac055e9c740065ca))
- **api:** plex tv sync and recently added sync ([1390cc1](https://github.com/sct/overseerr/commit/1390cc1f130bb3975996e84b12ac833f55f2f753))
- **frontend:** allow permission check for showing nav items ([0b239f0](https://github.com/sct/overseerr/commit/0b239f0bdfb1394897bce5c50b0d112abfbb4ad7))
- **frontend:** alpha notice ([33da7e9](https://github.com/sct/overseerr/commit/33da7e9df3a2546b0f208bd3b1d1f268e343cead))
- **frontend:** buttonWithDropdown component added (no hookups yet) ([4975841](https://github.com/sct/overseerr/commit/4975841b5d4ba4ed1ba8cacaa5a063eeb3b8c311))
- **frontend:** cancel movie request modal ([1f9cbbf](https://github.com/sct/overseerr/commit/1f9cbbfdf1ac98e54de5b8777c52c7bfc69c7e20))
- **frontend:** improved settings menu design for mobile ([16221a4](https://github.com/sct/overseerr/commit/16221a46a7d57c77f53aa0186263aa27267d9863))
- **frontend:** initial Settings design ([8742da0](https://github.com/sct/overseerr/commit/8742da0ebb92d2f78309a998de0f67e788e14376))
- **frontend:** plex library scan ([1bc3f7b](https://github.com/sct/overseerr/commit/1bc3f7be4b07211563a1e254c28ce51e1bc337a2))
- **frontend:** plex settings page ([47714b6](https://github.com/sct/overseerr/commit/47714b698cf4351c1ee38bdf0b672d9f0baed03a))
- **frontend:** radarr delete modal ([877a518](https://github.com/sct/overseerr/commit/877a5184158fb4aa371fa2ea2107032543c9aa37))
- **frontend:** recently added on discover ([06dc606](https://github.com/sct/overseerr/commit/06dc606bcfeb50b7be1c35ac180c10738bade458))
- **frontend:** slideover initial work ([14b9cb6](https://github.com/sct/overseerr/commit/14b9cb610c0dcfef939ebec328f371e1cdfb689d))
- tv request modal status hookup ([5f8114f](https://github.com/sct/overseerr/commit/5f8114f730b067eb710704952824057e7b5b8fbf))
- **.editorconfig:** add .editorconfig ([b982066](https://github.com/sct/overseerr/commit/b982066327525156f8dd0d32818d3fe7cb28f9c8))
- **api:** add external ids to movie/tv response ([4aa7431](https://github.com/sct/overseerr/commit/4aa74319e0adcc19041239e57a00bc40fb127826))
- **api:** add movie details endpoint ([b176148](https://github.com/sct/overseerr/commit/b1761484cb2861329763d51a868f37dd3098760d))
- **api:** add tmdb discover api wrapper ([#67](https://github.com/sct/overseerr/issues/67)) ([839448f](https://github.com/sct/overseerr/commit/839448fcc8cc14ea83092af82e2ba3d0d92c9b73))
- **api:** allow plex logins from users who have access to the server ([5147140](https://github.com/sct/overseerr/commit/514714071dfe4be04e607fe6412f5b3f0ef74dd4))
- **api:** decouple media requests from media info ([8577db1](https://github.com/sct/overseerr/commit/8577db1be16f099d92c6649bbfb15f15e09a2f73))
- **api:** discover endpoint for movie/tv ([#73](https://github.com/sct/overseerr/issues/73)) ([258bb93](https://github.com/sct/overseerr/commit/258bb93be2acc2ca32eaaefb617a5c326c5943ba))
- **api:** initial implementation of the auth system ([#30](https://github.com/sct/overseerr/issues/30)) ([5343f35](https://github.com/sct/overseerr/commit/5343f35e5b572fe366a8712b24bd735de30e6170))
- **api:** plex Sync (Movies) ([1be8b18](https://github.com/sct/overseerr/commit/1be8b183617c3a44ab8d4454a64b43dfe1d877fe))
- **api:** public settings route ([#57](https://github.com/sct/overseerr/issues/57)) ([c0166e7](https://github.com/sct/overseerr/commit/c0166e7ecb5df110a4167f33338ed6406bf47f41))
- **api:** radarr api wrapper / send to radarr when requests approved ([#93](https://github.com/sct/overseerr/issues/93)) ([48d62c3](https://github.com/sct/overseerr/commit/48d62c3178488d0d51831155ddd35cc31867db2b))
- **api:** request api ([#80](https://github.com/sct/overseerr/issues/80)) ([f4c2c47](https://github.com/sct/overseerr/commit/f4c2c47e569e7faea7f99664966cb98b321ce952))
- **api:** tmdb api wrapper / multi search route ([#62](https://github.com/sct/overseerr/issues/62)) ([c702c17](https://github.com/sct/overseerr/commit/c702c17cee00a52b23f685206e2d5d0c2eddf5a2))
- **api:** tmdb trending api wrapper ([#68](https://github.com/sct/overseerr/issues/68)) ([ba34e54](https://github.com/sct/overseerr/commit/ba34e54d77d142d211df58d6ce9f53b6e673e004))
- **api:** tv details endpoint ([a3beeed](https://github.com/sct/overseerr/commit/a3beeede7e72e99c7595673a27e38611ca4bb0cd))
- **api:** validate plex when settings are saved ([8f6247d](https://github.com/sct/overseerr/commit/8f6247d82160704a3cfb76262696957b27641e87))
- **api-user:** add basic User Entity and basic routing to fetch all users ([d902ef7](https://github.com/sct/overseerr/commit/d902ef72770712f2f71f33c09bca9ba99a30fc64))
- **components/plexloginbutton:** added PlexLoginButton ([0abf743](https://github.com/sct/overseerr/commit/0abf743b17c664b58da18bdbf176f4a55ddc4179))
- **extensions.json:** added recommended extensions for VSCode ([5dc9b51](https://github.com/sct/overseerr/commit/5dc9b510b8049516ad889c9d76a2f84daa0d2718))
- **frontend:** add cancel request modal for titlecards ([f22f8c5](https://github.com/sct/overseerr/commit/f22f8c5d734be5cc0b1dcca869458a7321cd43a2))
- **frontend:** approve/decline request well added to movie detail ([8f21358](https://github.com/sct/overseerr/commit/8f21358f797ed55923d90ba43acf1126856e9dfd))
- **frontend:** basic discover page (only movies) ([#74](https://github.com/sct/overseerr/issues/74)) ([bbfe349](https://github.com/sct/overseerr/commit/bbfe349b52d308620796b37aaf986a0ed1ff0006))
- **frontend:** design updates for responsive titlecards ([31809d9](https://github.com/sct/overseerr/commit/31809d952c8bafde3f63e2c1d952cc013149940e))
- **frontend:** discover tv/movies full page ([be0003a](https://github.com/sct/overseerr/commit/be0003a85dc4e91799e85019aeb1110bd524a026))
- **frontend:** initial search functionality ([#78](https://github.com/sct/overseerr/issues/78)) ([342d1a3](https://github.com/sct/overseerr/commit/342d1a3c75b32b172a51ca7d82fdfde8510abedf))
- **frontend:** loading spinner ([de84658](https://github.com/sct/overseerr/commit/de84658b48985e24b0f92a1690387f6d59d0bc16))
- **frontend:** logo updates ([5a43ec5](https://github.com/sct/overseerr/commit/5a43ec5405855deb244e8085484a9d2b743caba6))
- **frontend:** modal component and basic request hookup ([#91](https://github.com/sct/overseerr/issues/91)) ([626099a](https://github.com/sct/overseerr/commit/626099a2c98fb30d0cb53d8ccf79a6bf75a00059))
- **frontend:** new dashboard concept ([#82](https://github.com/sct/overseerr/issues/82)) ([eae38bb](https://github.com/sct/overseerr/commit/eae38bb9ec8588856f319387d2f262d7ee3f7e9c))
- **frontend:** refresh indicator for titlecards / toasts ([4638fae](https://github.com/sct/overseerr/commit/4638fae336edc62a539796b3f55277a238683603))
- **frontend:** request card / recent requests ([371e433](https://github.com/sct/overseerr/commit/371e43356d2c057e52368c32ffe2af1744311d91))
- **frontend:** title detail (movie) initial version ([73ce24a](https://github.com/sct/overseerr/commit/73ce24a37bda3713e8cedc44e1ed065bdbc4ee4f))
- **frontend/api:** beginning of new request modal ([2bf7e10](https://github.com/sct/overseerr/commit/2bf7e10e32718b36799be2feb0a7f9ff54d85744))
- **frontend/api:** cast included with movie request and cast list on detail page ([04252f8](https://github.com/sct/overseerr/commit/04252f88bbdf51949923586feda582f86ac668ce))
- **frontend/api:** i18n support ([9131254](https://github.com/sct/overseerr/commit/9131254f3371f12a17de44b6fa8f9bfb0e5c002e))
- **frontend/api:** movie recommendations/similar request and frontend detail page update ([6398e36](https://github.com/sct/overseerr/commit/6398e3645a1e4ddbb9de9f4fda0a0659b4cac4d0))
- **frontend/api:** tv details page ([02cbb5b](https://github.com/sct/overseerr/commit/02cbb5b030a3af5d62ab6c4cafdd4d800b4f61f4))
- **frontend/api:** tv request modal (no status. only request) ([608b966](https://github.com/sct/overseerr/commit/608b96600a926adf16331b36e77789afa5d67069))
- logout route/sign out button ([#54](https://github.com/sct/overseerr/issues/54)) ([cb9098f](https://github.com/sct/overseerr/commit/cb9098f457f79b71734959fd924b6c72ca77d61d))
- user avatars from plex ([#53](https://github.com/sct/overseerr/issues/53)) ([e6349c1](https://github.com/sct/overseerr/commit/e6349c13a0eb0489289aa7663fcc64fa7d2906e6))
- **layout:** created Layout component ([1f497e8](https://github.com/sct/overseerr/commit/1f497e8913146ceb9748d667e638141b2ca4612a))
- **login component/route:** add: Login Component and Route ([6e47be2](https://github.com/sct/overseerr/commit/6e47be2fa865bcd51582ce30ebee6fd820c5f9dd))
- **login route conditional:** on login route, do not display layout ([7d179ae](https://github.com/sct/overseerr/commit/7d179ae3b42d8ffae5e1b6e266038793260f1bbe))
- **pass pageprops to loginpage:** pass page props to loginPage ([1597188](https://github.com/sct/overseerr/commit/159718891fb363001c650ac8b7e1446a1520ce4a))
- **plex/utils:** added Plex OAuth class ([72f9624](https://github.com/sct/overseerr/commit/72f9624f1db721fe0324b7be9f0f811d2ae02389))
- bootstrap the basic app structure ([89a6017](https://github.com/sct/overseerr/commit/89a6017c7f6f7637fe249ac0d667a652f44e02bb))
