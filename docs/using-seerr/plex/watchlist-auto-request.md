---
title: Watchlist Auto Request
description: Automatically request Plex and SeerrNG watchlist items
sidebar_position: 1
---

# Watchlist Auto Request

SeerrNG can automatically request movies and series from a user's Plex
Watchlist. Users can also keep local SeerrNG watchlists for music, books,
comics, and magazines, and opt in to automatic requests for those formats.

Both administrator permissions and the matching toggle in the user's profile
are required. Auto requests still follow request permissions, quotas,
availability, and blocklist state.

## Plex Watchlist: Movies and Series

This path is available to users who sign in through Plex and have access to the
Plex server configured in SeerrNG.

An administrator grants **Auto-Request** and the applicable **Auto-Request
Movies** and/or **Auto-Request Series** permission. In their profile under
**General**, the user enables the matching **Auto-Request Movies** or
**Auto-Request Series** toggle. SeerrNG periodically checks the Plex Watchlist
and submits requests for eligible items that are not already available.

## SeerrNG Watchlist: Music, Books, Comics, and Magazines

Local SeerrNG watchlists are available for music albums, books, comics, and
magazines. Add an item from its detail page or poster card. To submit a request
automatically, the user needs **Auto-Request** plus the permission for that
format, then enables its toggle in their profile under **General**:

- **Auto-Request Music**
- **Auto-Request Books**
- **Auto-Request Comics**
- **Auto-Request Magazines**

SeerrNG submits an eligible request when the item is added to the local
watchlist. For books, the request uses the default configured ebook destination
when available, then the audiobook destination, and otherwise follows the
standard book request default.

## For Administrators

Open **Users > [Select User] > Permissions** and grant **Auto-Request** and the
specific format permissions the user should have. The user's profile toggle is
still required. You can set defaults for new accounts under **Settings >
Users > Default Permissions**.

## Limits

- Automatic requests obey the user's request quota, required request
  permissions, existing availability, and blocklist entries.
- 4K movie and series requests are not created by the Plex Watchlist flow.
- Users can remove local music, book, comic, and magazine entries from their
  SeerrNG watchlist at any time.
