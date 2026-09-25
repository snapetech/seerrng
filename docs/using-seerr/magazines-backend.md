---
title: Magazines Backend
description: Configure LazyLibrarian for magazine discovery, requests, and issue status.
sidebar_position: 25
---

# Magazines Backend

SeerrNG handles magazine discovery, requests, permissions, quotas, and request
status. Configure [LazyLibrarian](https://lazylibrarian.gitlab.io/) in SeerrNG
to add requested titles and track downloaded issues.

## Configure LazyLibrarian

1. In LazyLibrarian, open **Config > Interface** and copy its API key. Use a
   write-enabled key; a read-only key cannot add magazines or start searches.
2. In SeerrNG, open **Settings > Services** and add a LazyLibrarian server.
3. Enter the LazyLibrarian host, port (usually `5299`), and API key, then test
   the connection.
4. If you configure multiple servers, mark one as the default. Requests use
   this instance unless an authorized requester selects another service.
5. Enable **Library Scan** to sync tracked magazines and issue availability
   into SeerrNG.

Set the magazine folder, download providers, and search behavior in
LazyLibrarian itself. The **Search automatically after approval** option in
SeerrNG starts a search for the requested title after an administrator approves
it (or immediately when the request is auto-approved).

## Discover and request titles

The Magazines page lists titles already tracked by configured LazyLibrarian
instances. Global Search also has a **Magazines** category that searches the
tracked title catalogs across configured instances. Enter a main search query
to find titles; the category can further narrow the displayed matches by title
or latest issue. To request a title that is not listed, choose **Request
Magazine** and enter its title. LazyLibrarian adds that title to its own
magazine list. Users with **Advanced Request** or **Manage Requests** can choose
which LazyLibrarian instance receives the request when multiple instances are
configured; other requesters use the default instance.

SeerrNG checks requests and availability by a normalized title, so requests
that differ only in case or repeated whitespace resolve to the same magazine.
The magazine details page shows issue dates and whether each issue has a file.
Magazine cards and details show the latest LazyLibrarian cover when one is
available.

Users can add magazines to a SeerrNG watchlist from magazine cards or details.
With **Auto-Request** and **Auto-Request Magazines** permission, enable
**Auto-Request Magazines** in your profile to submit a request when you add a
magazine to your watchlist. Users with **Manage Blocklist** can blocklist a
magazine from its card or details page, then find or remove it with the
**Magazines** filter on the Blocklist page.

Users with **Create Issues** can report a problem for an available tracked
magazine. Magazine reports use the **Other** category. Users with **View
Issues** or **Manage Issues** can see open reports on magazine details and use
the magazine filter on the **Issues** page.

## Manage tracked magazines

Users with **Manage Requests** permission can open **Manage Magazine** from a
tracked title's details page. The panel shows its SeerrNG status, requests, and
known issues. Administrators can open the title in LazyLibrarian, mark it
available in SeerrNG, clear its SeerrNG tracking data, or remove it from both
LazyLibrarian and SeerrNG. Clearing tracking data also clears the related
requests. Removing a title from LazyLibrarian removes its magazine and issue
records, but leaves files on disk untouched.

## Permissions and quotas

Administrators can grant **Request Magazine**, **Auto Approve Magazine**, and
**Auto-Request Magazines** in user permissions. A global magazine request
limit can be set in **Settings > Users**. Administrators can override that
limit for an individual account in the user's **General** profile settings.
Users see their current usage in the request form and profile.

## Troubleshooting

Magazine discovery is empty:

- Confirm that at least one LazyLibrarian server is configured in **Settings >
  Services**.
- Enable **Library Scan** and add or import magazine titles in LazyLibrarian.
- For a title not already tracked, enter its name with **Request Magazine**.

Connection tests fail:

- Confirm the host, port, API key, SSL setting, and URL base match
  LazyLibrarian's configuration.
- Make sure SeerrNG can reach LazyLibrarian over the configured network.
