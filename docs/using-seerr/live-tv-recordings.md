---
title: Live TV and recordings
description: See when movies and series air on Live TV through IPTV Tunerr and request recordings.
sidebar_position: 8
---

# Live TV and recordings

When [IPTV Tunerr](https://github.com/snapetech/iptvtunerr) is connected,
movie and series pages show an **On Live TV** button whenever the title is in
the Tunerr guide. It lists upcoming airings with their channel and time, and
lets people request a recording of one airing or, for series, every airing.

Recording requests follow the same approval rules as other requests:

- People with **Manage Requests** or **Auto-Approve** have recordings scheduled
  immediately.
- Other requests wait in **Recordings** until a manager approves or declines
  them.
- Each person can have up to 25 active recordings.

Open **Recordings** (`/recordings`, also linked from the On Live TV dialog) to
follow requests, cancel them, and, for managers, approve or decline them.

## Requirements

- IPTV Tunerr with recording-rule support. SeerrNG checks that Tunerr reports
  the `title_equals`, `start_window`, and `rules_only_recorder` recording
  features and refuses to schedule recordings against older versions, because
  their recorder does not follow recording rules.
- The Tunerr **deck** (web UI) must accept connections from SeerrNG. Set
  `IPTV_TUNERR_WEBUI_ALLOW_LAN=1` on Tunerr and use the deck username and
  password in SeerrNG. The deck still requires that sign-in for every request.
- The Tunerr recorder (`catchup-daemon`) must run with recording rules enabled
  so that it records only what rules request. See the Tunerr documentation.

## Set up

1. Open **Settings → Services** and find **Live TV (IPTV Tunerr)**.
2. Enter Tunerr's hostname, deck port (default `48879`), tuner port (default
   `5004`), and the deck username and password.
3. Select **Test Connection**. SeerrNG reads the recording rules through the
   deck and opens the guide. It reports any recording features this Tunerr
   version is missing.
4. Turn on **Enable Live TV** and select **Save Changes**.

SeerrNG reads the guide from `http://<tuner>/guide.xml` unless you set a
**Guide URL**, and indexes the next 72 hours by default (**Guide Window**).
The **Live TV Sync** job refreshes the guide every 30 minutes and checks
recording progress every minute.

## How recordings are tracked

Approving a request creates a Tunerr recording rule named `SeerrNG #<id>`:

- **One airing**: the exact guide title on that channel, starting within two
  minutes of the listed time. SeerrNG removes the rule once Tunerr reports the
  recording finished, or 30 minutes after the airing ends if nothing was
  recorded, and marks the request **Failed** with the reason.
- **Every airing**: the exact guide title on any channel (or one channel, when
  requested through the API). The rule stays until the request is cancelled;
  Recordings shows how many airings have been recorded.

If someone deletes a SeerrNG rule in Tunerr while the request is still active,
the next sync re-creates it. Cancelling the request in SeerrNG removes it.

Recorded files are published by Tunerr into your media server's catch-up
libraries according to Tunerr's own publish settings.
