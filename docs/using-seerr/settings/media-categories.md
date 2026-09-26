---
title: Media categories
description: Choose which catalog and request categories SeerrNG makes available to users.
sidebar_position: 2
---

# Media categories

Administrators can control category availability in **Settings → Media
Categories**. Each switch applies to everyone who uses the SeerrNG instance.

The switches cover:

- Movies and Series
- Music
- Books and Audiobooks
- Comics and Magazines
- Emulation (Retro) and Emulation (Modern)
- PC Games

Turning a category off removes it from the navigation and its discovery or
search filters, hides matching discovery rows, redirects direct category pages
back to Discover, and blocks new requests through the API. Books and
audiobooks have separate switches, so either format can stay available on its
own. Retro, Modern, and PC Games can also be enabled independently.

The switches control availability; they do not configure acquisition services.
Connect and configure the required provider under **Settings → Services** as
well. A software category appears to users only when its category switch is on
and the required providers are connected. Emulation needs QuestarrNG for the
catalog and ROMarrNG for supported systems; PC Games need QuestarrNG.

Existing requests, status history, and available download copies remain in
**Requests → Request Status** after a category is turned off. Users can still
follow previously submitted work and download files that SeerrNG has already
verified. Turning the category back on restores its browse and request entry
points without deleting its saved request history.

All categories are enabled by default, including for existing installations.
General desktop applications are not included; they remain a future wishlist
item.
