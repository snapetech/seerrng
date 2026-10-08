---
title: Software requests
description: Configure ROMarrNG and QuestarrNG, browse ROMs and PC games, follow acquisition, and download verified files.
---

# Software requests

SeerrNG adds a request and catalog workflow for emulation games and PC games.
Users browse titles in SeerrNG, submit a request with its intended target, and
follow provider-confirmed acquisition in **Requests > Request Status**. The
connected providers perform the acquisition and expose imported files back to
SeerrNG for download.

SeerrNG's **Indexer Search** page can query Prowlarr's configured PC-game and
console categories for manual inspection by users with **Manage Requests**.
The page does not grab or track results. Approved requests still go through
QuestarrNG or ROMarrNG, which own acquisition and progress tracking. Those
providers may also use Prowlarr-synced or direct Torznab/Newznab indexers. IGDB
remains the catalog for game discovery, served by the selected catalog provider.
See [Indexer searches by media
category](./indexer-searches.md) for the full routing map.

This feature covers **Retro**, **Modern**, and **PC Games**. General desktop
applications are a future wishlist item. SeerrNG does not install, launch, or
play games and does not configure emulators, Proton, FEX, or other runtime
layers.

## Providers and responsibilities

| Provider | Used for | What SeerrNG reads or sends |
| --- | --- | --- |
| [QuestarrNG](https://github.com/snapetech/QuestarrNG) | Default IGDB catalog source and PC game acquisition | Searches and popular titles, IGDB platform details, stable request identity and selected PC target, request progress, and imported files |
| [ROMarrNG](https://github.com/snapetech/ROMarrNG) | Supported emulation systems and acquisition for ROM requests; optional IGDB or loaded DAT catalog source for emulation | Supported platform list and aliases, optional IGDB search and browse or DAT-backed browse, stable request identity and selected system, request progress, and imported files |

Both providers are separate **NG** forks maintained for SeerrNG integration.
Their project documentation identifies the upstream project, describes the
SeerrNG integration, and links back to the SeerrNG repository. Use the
provider's SeerrNG integration API key and contract. SeerrNG does not use a
provider's browser UI or expose its credentials to requesters.

Provider handshakes can report retry, cancel, asset, IGDB catalog, and DAT
catalog capabilities.
Request Status follows reported retry and cancel availability and shows the
provider's reason when an action is unavailable. Providers that do not report
these optional capabilities continue to use the existing v1 acquisition
contract. The emulation catalog source is QuestarrNG by default; SeerrNG only
saves a ROMarrNG catalog source when that provider advertises the matching
capability in its SeerrNG handshake.

## Configure the providers

An administrator opens **Settings > Services > Software Acquisition**. The
provider fields are the address as seen from the SeerrNG server or container,
port, optional base path, SSL setting, and API key.

1. Configure **QuestarrNG** for PC game requests and as the default IGDB catalog
   source.
2. Configure **ROMarrNG** if users should request emulation games. To use its
   IGDB catalog, configure an IGDB metadata provider in ROMarrNG first.
3. Select **Test connection** for each provider. ROMarrNG reports its
   supported-system count and which optional IGDB or DAT catalog capabilities
   are available. DAT readiness includes the number of systems with matched
   entries and any unmatched DAT header names for review.
4. Under **Emulation catalog source**, choose QuestarrNG, ROMarrNG's IGDB
   catalog, or **ROMarrNG · DAT**. The DAT option is available only when
   ROMarrNG advertises the capability and has loaded DAT entries. Save checks
   the selected capability again. PC game catalog and acquisition always use
   QuestarrNG, and ROM acquisition always uses ROMarrNG.
5. Select **Save settings**. SeerrNG reloads the ROMarrNG system list after the
   provider settings are saved.
6. Assign each supported ROMarrNG system to **Retro** or **Modern**, then save
   the settings again.

Saved API keys are masked. Leave the key field blank to keep the saved key, or
use **Remove saved API key** to clear it. Only administrators can read or
change provider settings. Configure credentials in SeerrNG; do not put them in
browser URLs or user-facing links.

The selected catalog provider must be configured for its categories to load.
QuestarrNG remains required for PC game requests, and ROMarrNG is required for
emulation systems and ROM acquisition. Existing ROMarrNG installations keep
using their documented v1 request and status routes. ROMarrNG v1 and v2
contract handshakes use the stable `/api/integration/seerrng/v1` routes; older
builds without a contract version continue using `/api/v1/integration`. The
ROMarrNG IGDB or DAT catalog is enabled only when the provider advertises its
matching capability.
These connections are independent of Radarr, Sonarr, Bookshelf, and the other
media automation services.

## Match IGDB platforms and assign emulation systems

ROMarrNG's supported platform list is the source of selectable emulation
systems. The administrator assigns each system to one of these groups:

- **Retro** — older console and handheld systems.
- **Modern** — newer platforms such as PS4, PS5, Vita, Xbox One, and Xbox
  Series.
- **Not available in requests** — the default for an unassigned system.

These labels organize emulation browsing and requests in SeerrNG. They do not
change ROMarrNG's platform setup or automatically classify systems; choose the
group for each platform that matches how you want users to browse it.

The assignment is saved by the system's stable slug, so a provider display-name
change does not discard it. For IGDB catalogs, SeerrNG matches catalog
platforms to a ROMarrNG system name, slug, or alias when the match is unique.
Open **Preview platform matches** to review automatic matches, unmatched
systems, and unused IGDB platforms. Choose a platform override when an
automatic match is missing or incorrect; choosing **Automatic match** removes
the saved override. A system without an IGDB match is hidden from IGDB-backed
emulation browsing until it is mapped. Review new systems after updating
ROMarrNG and save their group before users request them.

## Use ROMarrNG's DAT catalog

ROMarrNG can provide a second emulation catalog from its loaded DAT files. DAT
headers are matched against ROMarrNG's declared system names and aliases.
Unmatched or ambiguous headers stay out of browsing and appear in the
connection result so an administrator can identify DATs that need attention.
DAT browsing includes systems with matched entries; the system group still
controls whether each system appears under Retro or Modern.

DAT entries are grouped by title and system and use ROMarrNG's configured 1G1R
region preference. The catalog supports title search and alphabetical
browsing. DATs do not provide IGDB's artwork, popularity, genres, ratings, or
release dates, so SeerrNG does not show IGDB genre or release-year filters for
this source. Requests retain the stable DAT catalog key and selected system,
including through provider retry, so a changed title cannot silently inherit
the same request identity. Replacing a DAT version keeps an existing key when
the same system, DAT name, and title group remain present.

## Browse and submit requests

Users with the existing **Request** permission open **Software** in the
navigation. The page has three tabs:

- **Retro** and **Modern** show catalog titles that match systems assigned to
  the selected group.
- **PC Games** shows catalog titles with a Windows, Linux, or macOS platform.
- Search filters the current tab; popular titles appear when no search is
  submitted.

The main Search page also has a **Software** category. Its query searches these
same paged catalogs, and **All** search shows a small software preview when
matching titles are available. Opening a preview takes you to the title's
shareable detail view.

Within Retro or Modern, select a supported emulation system to show its games.
Updated ROMarrNG builds include PS4 (`ps4`), PS5 (`ps5`), PlayStation Vita
(`psvita`), Xbox One (`xboxone`), and Xbox Series X/S (`series-x-s`). Assign
these systems to Modern in administrator settings before browsing them. Their
catalogs use the same paged discovery, artwork cache, requests and status
tracking as other emulation systems.

Acquisition depends on releases provided by your configured indexers. PS4/PS5
accept console packages or complete folder dumps; Vita accepts VPK packages or
complete dumps; recent Xbox systems accept XVC console packages. A PC MSIXVC
package is not an Xbox console package. Recent-console releases must name the
target console explicitly so shared package formats do not select another
generation. This does not install emulators, decrypt packages, satisfy firmware
requirements, or establish that a particular game can run.

Folder dumps keep their complete directory tree. Request Status offers them as
one streamed TAR download, including games with more than 100 files. Individual
file downloads and generated TAR bundles support byte-range resume after an
interruption. ROMarrNG refuses to offer a truncated bundle when
a game exceeds its 10,000-file or directory traversal limits. Library
availability and downloadable-file availability remain separate in that case.

Within PC Games, select Windows, Linux, or macOS to narrow the catalog. The PC
platform choice is preselected when opening a request and can still be changed
before submission.
For IGDB catalogs, use **Genre** and **Release year** to narrow any software
category. These filters apply before pages are returned. DAT catalogs support
title and system filters only.

Software titles load as you scroll, with a **Load more titles** button available
when another page exists. SeerrNG filters by the selected PC or emulation
platform before showing each page. This requires the selected catalog provider
to support SeerrNG's paged catalog endpoints. Older provider builds continue
to show the first available catalog window until upgraded.

Catalog cards show **In library**, **Owned in QuestarrNG**, **Tracked**, or
**Downloading** when the acquisition service reports a title. **In library**
means QuestarrNG can deliver at least one registered file; **Owned in
QuestarrNG** means the linked account tracks the game but has no deliverable
file. PC game cards can also show **Steam library** when QuestarrNG verifies a
match in the public Steam library linked to its account. Steam ownership is a
separate signal: it does not imply that QuestarrNG has a local game file, and
private or unavailable Steam profiles do not produce an ownership badge. ROM
availability is shown for the exact
emulation system, including in the request target picker. If ROMarrNG is still
loading its library or only has a partial cache, an unmatched title shows
**Availability unknown** rather than being treated as absent. These indicators
require QuestarrNG's bounded IGDB library lookup and ROMarrNG's bounded
title-and-platform lookup; older builds leave availability unknown until
upgraded.

Open a title's cover or name to see its summary, genres, release date, and
supported request targets. PC game cards and details show IGDB's community
play-time estimates when available: quick completion, main story, and full
completion, in hours. These are community estimates, so some games have no
values. When IGDB supplies them, the detail view also shows a rating,
screenshots, developer names, and links to game videos. Screenshots load only
when the detail view opens. The title URL can be copied and reopened directly;
users without request permission can still inspect its details.

When requesting an emulation title, choose one of the supported systems shown
for that title. SeerrNG stores the chosen system with the request and sends it
to ROMarrNG. The request is not silently redirected to a different system.

When requesting a PC game, choose both an **operating system** (Windows, Linux,
or macOS) and **architecture** (x64, ARM64, x86, or Universal). Both choices are
required, are shown on the request later, and are sent to QuestarrNG as the
selected target. SeerrNG does not infer or change the target based on a
provider's compatibility default.

Requests use the same request permissions and approval policy as the rest of
SeerrNG. Depending on the user's permissions and administrator settings, a
request is either approved and sent to its provider or waits for an
administrator to approve or decline it. Repeating a request for the same
title and target is rejected instead of creating a duplicate SeerrNG request.

An administrator can set a global software request limit in **Settings >
Users** and per-user overrides from that user's **General** profile settings.
The quota counts each Retro, Modern, or PC game request as one item. Failed,
declined, and withdrawn requests do not count. Users can withdraw their own
request while it is pending approval. The requester can also cancel an active
request while they still have **Request** permission; administrators with
**Manage Requests** can cancel any active software request. Cancelled requests
are separate from requests withdrawn before approval.

## Follow progress

Open **Requests > Request Status** to see software requests beside media
requests. Each software card includes its title, category, selected emulation
system or PC target, current state, and request date. Open **Show status
history** on a card to review saved lifecycle events. The history is saved in
SeerrNG, so the status page can be reopened after a restart.

| Status | Meaning |
| --- | --- |
| Pending approval | An administrator's decision is needed before provider acquisition starts. |
| Approved | The request has been approved and handed to its provider. |
| Searching | The provider is looking for an acquisition source. |
| Downloading | The provider reports that a download is in progress. |
| Verifying import | The provider reports acquisition, but SeerrNG is still waiting for an imported file. |
| Available | The provider reports the requested game in its collection. A **Download copy** action appears only when SeerrNG can verify and stream a request-scoped local file. |
| Failed | The provider reports that acquisition failed. The requester or an authorized administrator may be able to retry. |
| Declined | An administrator declined the request. |
| Withdrawn | The requester withdrew the request before approval. |
| Cancelled | The provider confirmed that active work was cancelled. |

SeerrNG refreshes active provider requests in the background once per minute
and while Request Status is open. An available library item may not have a
download action when its files are remote or unavailable to SeerrNG. A
provider-reported completion alone never exposes a download action.

When a provider reports a real percentage, Request Status shows it with a
progress bar. ROMarrNG currently reports the acquisition stage without a
percentage because it cannot measure a reliable overall download percentage.
Failure codes identify the type of failure while the displayed explanation
stays readable. Provider status never exposes local filesystem paths.

### Cancel an active request

QuestarrNG can cancel only downloads that its database links to this SeerrNG
request. SeerrNG asks QuestarrNG to stop the tracked download while preserving
the downloaded files. If an active download cannot be tied safely to this
request, cancellation is refused; stop that download in QuestarrNG or its
download client first.

ROMarrNG can cancel while a request is still searching and has not handed a
release to a download client. After handoff, cancel the transfer in ROMarrNG
or the download client. Request Status explains this limit and hides the
unavailable cancellation action. The provider remains authoritative and may
refuse cancellation if its state changed while the page was open.

The same action is exposed to authorized clients as
`POST /api/v1/request/software/status/{id}/cancel`. The requester must retain
**Request** permission; an administrator needs **Manage Requests**. The route
returns `409` when the provider cannot safely cancel the current work.

Request Status is paginated, so older software requests remain available after
the first page.

### Retry a failed request

The requester can retry their own failed request while they still have
**Request** permission. An administrator with **Manage Requests** permission
can retry any failed software request.

ROMarrNG can report that it cannot confirm whether a previous handoff reached
the download client. In that case, SeerrNG pauses the retry and asks the user
to check the download client's queue and history. Confirm the retry only if no
matching download is already present. QuestarrNG retries use the same
request-scoped provider record.

## Download an available copy

When SeerrNG can verify an imported file, the software request shows **Download
copy**. If the provider reports several files, **Download copies** opens a
file list with **Download all files** as a compressed `.tar.gz` archive, plus
individual links so the user can choose the intended files. The browser downloads the
selected file through SeerrNG, which checks request access and current
availability again when the transfer starts.

SeerrNG serves the request-scoped asset through its own authenticated route.
The browser does not receive provider credentials, a private library path, or
a long-lived provider URL. If the provider has not listed an imported file,
the file is missing, or the provider cannot stream it, the download action is
not offered. The same Request Status download design is used for verified
movie, TV, book, comic, and magazine files; see [Request Status](./request-status.md)
for administrator path-mapping setup for file-based media backends.

### Availability notifications

Users can enable **Software Request Available** in their profile's notification
preferences for a configured notification provider. The notification points
to the matching software request in Request Status. The user can then download
the verified file from the request card. Notification delivery depends on the
user's notification preferences and the administrator's configured provider.

The separate **Software Request Updates** preference sends pending requests
to request managers and notifies requesters when software requests are
approved, declined, or fail. Enable both preferences if you also want a notice
when the verified download is ready.

### API access

The authenticated status endpoint supports `take` and `skip` pagination and
returns `pageInfo`. A requester with **Request** permission can withdraw their
own request with `POST /api/v1/request/software/status/{id}/withdraw` while its
state is `pending`. `GET /api/v1/user/{id}/quota` includes the `software` quota
alongside other media quotas.

## Troubleshooting

- **The Software page is unavailable:** Ask an administrator to connect
  QuestarrNG and test its connection.
- **No emulation systems appear:** Configure and test ROMarrNG, assign its
  systems to Retro or Modern, and save the settings.
- **A title does not appear for an emulation system:** Check that the system is
  assigned and that the selected catalog provider's platform name matches its
  ROMarrNG name, slug, or alias.
- **There is no Request button:** The signed-in user needs the existing
  **Request** permission.
- **The request is still waiting:** An administrator may need to approve it,
  or the acquisition provider may still be searching, downloading, or
  verifying its import.
- **The request is Available but has no download action:** Available means the
  provider has the title in its library. The download action additionally
  requires a local, request-scoped file that SeerrNG can read and stream. Check
  the provider's library mode, import state, and filesystem access.
- **Retry or cancellation asks for confirmation:** Check the download client's
  queue and history before confirming, to avoid leaving or starting a duplicate
  download. QuestarrNG
  also asks for this confirmation if it restarts during a download handoff and
  cannot find a request-linked download record.

For provider API and release details, use the [QuestarrNG
documentation](https://github.com/snapetech/QuestarrNG) and [ROMarrNG
documentation](https://github.com/snapetech/ROMarrNG). General desktop apps are
not part of the current software catalog.

## RomM library status

For ROM requests fulfilled by ROMarrNG, the request shows **In RomM Library**
once ROMarrNG has placed the finished file in a library folder that RomM reads.
This means the file is in place. RomM still has to scan its library before the
game appears there, so the badge does not confirm that RomM has indexed it.
