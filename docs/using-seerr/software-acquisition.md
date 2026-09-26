---
title: Software requests
description: Browse and request emulation games and PC games, then download verified files from Request Status.
---

# Software requests

SeerrNG can use ROMarrNG to acquire emulation game files and QuestarrNG to
provide the IGDB catalog and acquire PC games. Users browse and request titles
in SeerrNG; providers run the acquisition jobs. General desktop applications
are not part of this feature.

## Configure providers

An administrator opens **Settings > Services > Software Acquisition** and
configures the provider address, port, optional base path, transport security,
and API key. Use the NG provider's server-side integration API key. SeerrNG
keeps credentials on the server, masks saved keys in settings responses, and
tests each provider's integration contract before reporting a successful
connection.

QuestarrNG supplies the catalog for PC games and emulation titles. ROMarrNG is
also required for emulation requests; its supported systems appear in the
settings panel after the connection succeeds.

### Group emulation systems

Assign every supported ROMarrNG system to **Retro** or **Modern**. Unassigned
systems stay out of the user catalog. The ROMarrNG platform list is the source
of supported systems; SeerrNG stores each assignment by the system's stable
slug so changing a display name does not lose the selection.

### Choose PC targets

When requesting a PC game, users select both an operating system and an
architecture before submitting the request. SeerrNG stores and sends these
values to QuestarrNG: Windows, Linux, or macOS, and x64, ARM64, x86, or
universal. Provider compatibility defaults do not replace the user's explicit
selection.

## Browse and request

Users open **Software** to browse popular titles or search the catalog, then
choose a supported emulation system or PC target. Existing request permissions
and approval settings determine whether a request is approved automatically or
waits for an administrator.

## Follow progress and download

Open **Requests > Request Status** to see software requests alongside media
requests. Their status advances through approval, searching, downloading,
import verification, and availability. SeerrNG checks active provider jobs in
the background every minute and while the status page is open.

After SeerrNG confirms that the provider has imported at least one deliverable
file, the request shows **Download copy**. Requests with multiple files show
**Download copies** and let the user choose a file. Download links return
through SeerrNG, which rechecks access and availability and does not expose
provider credentials or internal file paths.

Users can enable **Software Request Available** in their notification
preferences for configured notification providers. The message links to the
matching software request in Request Status, where the download action appears.

If a request fails, its requester can retry while they still have request
permission, and administrators with request-management permission can retry any
request. When ROMarrNG cannot tell whether a previous handoff reached the
download client, SeerrNG asks the user to check that client's queue and history
before confirming a retry.
