---
title: Companion services and SeerrNG forks
description: Choose optional media automation services and the NG forks with SeerrNG-specific APIs.
sidebar_position: 6
---

# Companion services and SeerrNG forks

SeerrNG connects to separate media-server and acquisition services. They are
not bundled into the SeerrNG container, and most are optional: install a
provider only for the media categories you want to request.

## Choose providers by media type

| Media | Provider | What it does with SeerrNG |
| --- | --- | --- |
| Movies | [Radarr](https://github.com/Radarr/Radarr) | Searches, imports, and tracks movie requests. |
| TV | [Sonarr](https://github.com/Sonarr/Sonarr) | Searches, imports, and tracks series and episode requests. |
| Sports leagues | [Sportarr](https://github.com/Sportarr/Sportarr) | Searches sports leagues and requests them using the configured quality profile and library defaults. |
| Music | [Lidarr](https://github.com/Lidarr/Lidarr) | Searches, imports, and tracks artist and album requests. |
| Books and audiobooks | [BookshelfNG](https://github.com/snapetech/bookshelfng) or [ChaptarrNG](https://github.com/snapetech/chaptarrng) | Recommended SeerrNG-compatible book managers. Either can serve both formats from one instance; add one SeerrNG service entry for each format. Other Readarr-compatible services may work, but do not provide the NG-specific behavior listed below. |
| Comics | [BackIssue](https://backissue.app/), [Mylar3](https://github.com/mylar3/mylar3), or [Kapowarr](https://github.com/Casvt/Kapowarr) | Connect one or more supported comic services, then choose a default destination for requests. Mylar3, Kapowarr, and BackIssue use different search sources and download flows. |
| Magazines | [LazyLibrarian](https://github.com/llninja/LazyLibrarian) | Searches and tracks magazine requests. |
| PC games | [QuestarrNG](https://github.com/snapetech/QuestarrNG) | Provides the IGDB catalog and acquires PC game requests. |
| Emulation ROMs | [ROMarrNG](https://github.com/snapetech/ROMarrNG) | Provides supported systems and acquires ROM requests. Configure each available system as Retro or Modern in SeerrNG. |

Prowlarr is an optional indexer manager. It can provide configured indexers to
compatible acquisition apps and power SeerrNG's manual indexer search. A
download client such as qBittorrent is also optional; configure it inside each
provider that should use it. SeerrNG does not require every app in the table.
For each enabled request category, connect an acquisition service that
supports that category; the fork-specific catalog and request features below
require the corresponding NG fork.

## Why use the NG forks?

The Snapetech NG forks are standalone apps. They are not libraries that SeerrNG
loads, and they do not have to be installed when their media type is disabled.
They add or maintain APIs and behavior used by SeerrNG's extended workflows.
Use them when you want those SeerrNG-specific capabilities; they remain
independent applications and SeerrNG does not install them automatically.

Use these container images when adding the forks directly to Compose:

| Fork | SeerrNG-specific behavior | Container image | Container port |
| --- | --- | --- | --- |
| [BookshelfNG](https://github.com/snapetech/bookshelfng) | Readarr-compatible book manager with the Hardcover-backed image; one instance can serve ebooks and audiobooks through separate SeerrNG service entries. | `ghcr.io/snapetech/bookshelfng:hardcover` | `8787` |
| [ChaptarrNG](https://github.com/snapetech/chaptarrng) | Alternative book manager with format-aware requests, pending-import progress and safe cancellation, paged library scans, and an optional restricted SeerrNG key. | `ghcr.io/snapetech/chaptarrng:latest` | `8789` |
| [QuestarrNG](https://github.com/snapetech/QuestarrNG) | Provides PC game acquisition and SeerrNG's IGDB catalog integration. | `ghcr.io/snapetech/questarrng:latest` | `5000` |
| [ROMarrNG](https://github.com/snapetech/ROMarrNG) | Provides supported emulation systems and ROM acquisition; it can also provide the IGDB catalog when configured. Assign each system to Retro or Modern in SeerrNG. | `ghcr.io/snapetech/romarrng:latest` | `6868` |

The tags above follow the install commands in each fork's README. Check that
README for supported architectures, storage mounts, and upgrade guidance
before deploying; the container port is the port SeerrNG uses inside a shared
Compose network.

For book requests, BookshelfNG and ChaptarrNG are alternatives; BookshelfNG is
the recommended Hardcover-backed setup. PC game acquisition and its SeerrNG
catalog use QuestarrNG. ROM acquisition uses ROMarrNG; its optional IGDB
catalog does not replace QuestarrNG for PC game acquisition. Follow each fork's
SeerrNG setup instructions and use the linked NG image so its integration
contract is present. Radarr, Sonarr, Lidarr, LazyLibrarian, Mylar3, Kapowarr,
and BackIssue remain separate upstream or third-party integrations; they are
not Snapetech forks.

## Docker and Compose

Each companion app runs in its own container. In Compose, use the app's service
name and container port as the hostname and port in SeerrNG. Host-published
ports are for opening the app's web interface; they are not needed for
service-to-service traffic on the same Compose network. Enter API keys in the
SeerrNG server settings, not in links or generated Compose files.

For book services, see the [Bookshelf backend guide](/using-seerr/bookshelf-backend)
for the recommended image and metadata setup. For software services, see the
[software requests guide](/using-seerr/software-acquisition). The
[Unraid Compose guide](/getting-started/third-parties/unraid) documents its
optional profiles and appdata, media, and download mounts.
