---
title: TV Episode Queue
description: Opt in to a small buffer of upcoming TV episodes requested in Sonarr as you watch in Plex, Jellyfin, or Emby.
---

# TV Episode Queue

The Episode Queue lets a TV request owner ask SeerrNG to keep up to five
upcoming episodes requested in Sonarr as they watch the series in Plex,
Jellyfin, or Emby. It is optional and **Off by default for every request**.
Choosing a buffer applies only to that request.

When you enable Episode Queue on a **new** TV request, the episode list changes
to a single starting episode. SeerrNG requests that episode first, then asks
Sonarr to keep the selected number of upcoming episodes requested as playback
progresses. Only one starting episode is selected, so this avoids requesting a
whole season in advance. Choose **Off** to return to the normal season or
episode selection and restore the selection you had before enabling the queue.
The queue does not guarantee a download will finish before you reach the next
episode; Sonarr controls searching and download timing.

Enabling Episode Queue on an **existing** request changes future queueing only.
It keeps the request's existing season and episode selections, and it does not
delete episodes already in Sonarr or the media library. To stop future additions
and remove an episode from Sonarr, turn the queue off first, then manage that
episode in Sonarr.

## Requirements

- SeerrNG is configured to use Plex, Jellyfin, or Emby as its media server.
- Your SeerrNG account is linked to the matching account or user on that
  media server.
- You have permission to request the TV quality selected for the request.
- The series has a TVDB identity so playback can be matched to the request.
- A matching Sonarr destination is configured for the request's standard or 4K
  quality.

## Turn it on or off

When creating or editing your own TV request, choose a buffer under **Episode
Queue**. The initial setting is **Off**. You can change it later from that
request's card in **Requests** or **Request Status**. Only the request owner can
change the setting; administrators cannot enable it for someone else.

Choose **Off** to stop future watch-ahead requests. Episodes already created
remain in Sonarr and in SeerrNG's request history. While the queue remains on,
SeerrNG may add a missing episode again if it is needed to maintain the selected
buffer. Episode Queue never deletes downloaded episodes or files.

## What SeerrNG does

While at least one request has a buffer enabled, the worker checks active
playback every 30 seconds. A matching episode must reach at least 90% of its
runtime before the queue advances. SeerrNG matches the playing series and
linked account to the TV request owner; another user's playback does not
advance your request. New episodes are reconciled at most once every 15
minutes.

While the TV request is pending approval, SeerrNG remembers your watched
progress but waits to add episodes. Once the request is approved, SeerrNG checks
the selected Sonarr library and requests enough upcoming, missing episodes to
maintain the buffer. Episodes already in the library, monitored by Sonarr, or
covered by another active request count toward that buffer. Specials follow
the administrator's **Enable Special Episodes** setting.

Generated episode requests inherit the approved parent request and do not use
additional request quota. They appear in Requests with a **Requested ahead of
playback** label and do not create a separate approval notification for every
episode. Sonarr remains responsible for searching, downloading, importing, and
tracking the files.

## API

The request owner can update a request through
`PUT /api/v1/request/{requestId}/watch-ahead` with a JSON body such as:

```json
{ "episodeCount": 3 }
```

Use `episodeCount: 0` to disable future additions. Values from 0 through 5 are
accepted. Enabling the queue requires a linked account for the configured
Plex, Jellyfin, or Emby server and a matching Sonarr destination.
