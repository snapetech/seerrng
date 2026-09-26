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

This feature covers **Retro**, **Modern**, and **PC Games**. General desktop
applications are a future wishlist item. SeerrNG does not install, launch, or
play games and does not configure emulators, Proton, FEX, or other runtime
layers.

## Providers and responsibilities

| Provider | Used for | What SeerrNG reads or sends |
| --- | --- | --- |
| [QuestarrNG](https://github.com/snapetech/QuestarrNG) | IGDB catalog for all software categories and acquisition for PC games | Searches and popular titles, IGDB platform details, request identity and selected PC target, request progress, and imported files |
| [ROMarrNG](https://github.com/snapetech/ROMarrNG) | Supported emulation systems and acquisition for ROM requests | Supported platform list and aliases, request identity and selected system, request progress, and imported files |

Both providers are separate **NG** forks maintained for SeerrNG integration.
Their project documentation identifies the upstream project, describes the
SeerrNG integration, and links back to the SeerrNG repository. Use the
provider's SeerrNG integration API key and contract. SeerrNG does not use a
provider's browser UI or expose its credentials to requesters.

## Configure the providers

An administrator opens **Settings > Services > Software Acquisition**. The
provider fields are the address as seen from the SeerrNG server or container,
port, optional base path, SSL setting, and API key.

1. Configure **QuestarrNG**. It is required for the software catalog and PC
   game requests.
2. Configure **ROMarrNG** if users should request emulation games.
3. Select **Test connection** for each configured provider. SeerrNG checks the
   provider's SeerrNG integration contract; a successful ROMarrNG check also
   validates the service and its supported-system endpoint.
4. Select **Save settings**. SeerrNG reloads the ROMarrNG system list after the
   provider settings are saved.
5. Assign each supported ROMarrNG system to **Retro** or **Modern**, then save
   the settings again.

Saved API keys are masked. Leave the key field blank to keep the saved key, or
use **Remove saved API key** to clear it. Only administrators can read or
change provider settings. Configure credentials in SeerrNG; do not put them in
browser URLs or user-facing links.

QuestarrNG must be configured for **Software** to load. ROMarrNG must also be
configured for emulation systems to appear. These provider connections are
independent of Radarr, Sonarr, Bookshelf, and the other media automation
services.

## Assign emulation systems

ROMarrNG's supported platform list is the source of selectable emulation
systems. The administrator assigns each system to one of these groups:

- **Retro** — systems grouped as retro in the user catalog.
- **Modern** — systems grouped as modern in the user catalog.
- **Not available in requests** — the default for an unassigned system.

The assignment is saved by the system's stable slug, so a provider display-name
change does not discard it. SeerrNG matches IGDB catalog platforms to a
ROMarrNG system name, slug, or alias. If there is no match, the title is not
offered for that emulation system. Review new systems after updating ROMarrNG
and save their group before users request them.

## Browse and submit requests

Users with the existing **Request** permission open **Software** in the
navigation. The page has three tabs:

- **Retro** and **Modern** show catalog titles that match systems assigned to
  the selected group.
- **PC Games** shows catalog titles with a Windows, Linux, or macOS platform.
- Search filters the current tab; popular titles appear when no search is
  submitted.

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
request while it is pending approval; after approval, SeerrNG has no shared
cancel operation across both acquisition providers.

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
| Available | The provider reports the request as available and SeerrNG has verified at least one deliverable file. |
| Failed | The provider reports that acquisition failed. The requester or an authorized administrator may be able to retry. |
| Declined | An administrator declined the request. |
| Withdrawn | The requester withdrew the request before approval. |

SeerrNG refreshes active provider requests in the background once per minute
and while Request Status is open. A provider-reported completion alone does
not expose a download action: SeerrNG also needs a request-scoped imported file
from that provider.

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
file list so the user can choose the intended file. The browser downloads the
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
  assigned and that the QuestarrNG catalog platform name matches its ROMarrNG
  name, slug, or alias.
- **There is no Request button:** The signed-in user needs the existing
  **Request** permission.
- **The request is still waiting:** An administrator may need to approve it,
  or the acquisition provider may still be searching, downloading, or
  verifying its import.
- **The request is Available but has no download action:** The provider must
  list and stream an imported file associated with that request. Check the
  provider request and import state; an available title elsewhere in the
  provider library does not count as this request's deliverable.
- **The retry asks for confirmation:** Check the download client's queue and
  history before confirming, to avoid starting a duplicate download.

For provider API and release details, use the [QuestarrNG
documentation](https://github.com/snapetech/QuestarrNG) and [ROMarrNG
documentation](https://github.com/snapetech/ROMarrNG). General desktop apps are
not part of the current software catalog.
