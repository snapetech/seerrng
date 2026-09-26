---
title: Services
description: Configure your default services.
sidebar_position: 4
---

# Services

:::info
**If you keep separate copies of non-4K and 4K content in your media libraries, you will need to set up multiple Radarr/Sonarr instances and link each of them to Seerr.**

Seerr checks these linked servers to determine whether or not media has already been requested or is available, so two servers of each type are required _if you keep separate non-4K and 4K copies of media._

**If you only maintain one copy of media, you can instead simply set up one server and set the "Quality Profile" setting on a per-request basis.**
:::

### Radarr/Sonarr Settings

:::warning
**Only v3 & V4 Radarr/Sonarr servers are supported!** If your Radarr/Sonarr server is still running v2, you will need to upgrade in order to add it to Seerr.
::::

#### Default Server

At least one server needs to be marked as "Default" in order for requests to be sent successfully to Radarr/Sonarr.

If you have separate 4K Radarr/Sonarr servers, you need to designate default 4K servers _in addition to_ default non-4K servers.

#### 4K Server

Only select this option if you have separate non-4K and 4K servers. If you only have a single Radarr/Sonarr server, do _not_ check this box!

#### Server Name

Enter a friendly name for the Radarr/Sonarr server.

#### Hostname or IP Address

If you have Seerr installed on the same network as Radarr/Sonarr, you can set this to the local IP address of your Radarr/Sonarr server. Otherwise, this should be set to a valid hostname (e.g., `radarr.myawesomeserver.com`).

#### Port

This value should be set to the port that your Radarr/Sonarr server listens on. By default, Radarr uses port `7878` and Sonarr uses port `8989`, but you may need to set this to `443` or some other value if your Radarr/Sonarr server is hosted on a VPS or cloud provider.

#### Use SSL

Enable this setting to connect to Radarr/Sonarr via HTTPS rather than HTTP. Self-signed certificates are not trusted by default, but you can configure Seerr to accept them. See [Self-Signed Certificates](/using-seerr/advanced/self-signed-certificates) for details.

#### API Key

Enter your Radarr/Sonarr API key here. Do _not_ share these key publicly, as they can be used to gain administrator access to your Radarr/Sonarr servers!

You can locate the required API keys in Radarr/Sonarr in **Settings &rarr; General &rarr; Security**.

#### URL Base

If you have configured a URL base for your Radarr/Sonarr server, you _must_ enter it here in order for Jellyeerr to connect to those services!

You can verify whether or not you have a URL base configured in your Radarr/Sonarr server at **Settings &rarr; General &rarr; Host**. (Note that a restart of your Radarr/Sonarr server is required if you modify this setting!)

#### Profiles, Root Folder, Minimum Availability

Select the default settings you would like to use for all new requests. Note that all of these options are required, and that requests will fail if any of these are not configured!

#### External URL (optional)

If the hostname or IP address you configured above is not accessible outside your network, you can set a different URL here. This "external" URL is used to add clickable links to your Radarr/Sonarr servers on media detail pages.

#### Enable Scan (optional)

Enable this setting if you would like to scan your Radarr/Sonarr server for existing media/request status. It is recommended that you enable this setting, so that users cannot submit requests for media which has already been requested or is already available.

#### Enable Automatic Search (optional)

Enable this setting to have Radarr/Sonarr to automatically search for media upon approval of a request.

### Bookshelf Settings

SeerrNG uses Bookshelf for book requests through the Readarr-compatible API.
One BookshelfNG instance can manage ebooks and audiobooks in the same library.
SeerrNG keeps ebook and audiobook routing separate, so add a service entry for
each format you enable and mark one as the default for that format. Both
entries can use the same BookshelfNG URL and API key; this does not require two
BookshelfNG instances.

Each BookshelfNG author can optionally set separate ebook and audiobook
folders for future imports, upgrades, and renames. Existing files are not moved
when an override changes. Quality and metadata profiles remain shared. Use separate
BookshelfNG instances only when you need isolated databases or different
settings for the same author.

Use the [Bookshelf Backend](/using-seerr/bookshelf-backend) guide for the
recommended Docker Compose deployment. Hardcover is the default for new
deployments, while existing Goodreads/softcover and other compatible metadata
sources remain supported. Migration is optional.

If you choose to switch providers, use the
[Bookshelf Hardcover Migration](/using-seerr/bookshelf-hardcover-migration)
runbook. Provider IDs are not portable; the runbook rebuilds records and can
preserve strict matches, recover metadata, and create local records for books
the target provider cannot import.

## Override Rules

Override rules can assign a root folder, quality profile, or tags when a movie
or series request matches selected requester and media conditions. Matching
rules are also applied in **Advanced Options** for movie and series requests,
where you can review the resulting values before submission. See the
[Override Rules guide](/using-seerr/override-rules) for setup and matching
behavior.
