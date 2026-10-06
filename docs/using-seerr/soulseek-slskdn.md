---
title: Soulseek through slskdN
description: Request single tracks, fix flagged albums, and identify songs with slskdN.
sidebar_position: 9
---

# Soulseek through slskdN

Lidarr can already use slskdN as a download client for albums. Connecting
[slskdN](https://github.com/snapetech/slskdn) to SeerrNG directly adds three
things Lidarr cannot do:

- **Single-track requests.** Playlist imports list tracks with no confident
  album match. When slskdN is connected, the bulk request dialog offers
  **Request … from Soulseek** for those tracks. Each becomes a slskdN wishlist
  entry that downloads the first good match.
- **Album fixes.** Managers see **Library Health** on music album pages. It
  lists issues slskdN's library-health scanner found for the album (suspected
  transcodes, missing tracks, corrupted files, and similar), and starts
  slskdN's remediation for issues it can fix automatically.
- **Song identification.** **Identify a Song** (`/identify`) sends a link or a
  description to slskdN SongID. Album matches link to their SeerrNG album page;
  track matches can be requested from Soulseek.

Track requests follow the usual approval rules: people with **Manage
Requests**, **Auto-Approve**, or **Auto-Approve Music** start searching
immediately, and other requests wait for approval on **Track Requests**
(`/track-requests`). Each person can have up to 50 active track requests. A
search that finds nothing for two weeks is marked failed and its wishlist entry
removed.

## Set up

1. In slskdN, create an API key with the **read-write** role. SongID needs the
   **administrator** role; without it, the other features still work.
2. Open **Settings → Services → Soulseek (slskdN)** in SeerrNG and enter the
   hostname, port (default `5030`), and API key.
3. Select **Test Connection**. SeerrNG shows the slskdN version and which of
   track requests, album fixes, and SongID this slskdN and key support. Plain
   slskd and slskr installs report the slskdN-only features as unavailable.
4. Optionally set a **Search Filter** (a slskdN wishlist filter) to apply to
   every track request.
5. Turn on **Enable Soulseek Requests** and select **Save Changes**.

The **Soulseek Sync** job checks active track requests every two minutes.
