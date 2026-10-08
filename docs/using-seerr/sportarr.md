---
title: Sportarr
description: Connect Sportarr to browse, request, and track sports leagues.
---

# Sportarr

SeerrNG can browse Sportarr leagues, let users request a league, and show its
monitored events and downloaded files. Sportarr remains responsible for
choosing the teams and events it monitors, the root folder, and acquisition.

## Connect Sportarr

An administrator opens **Settings → Services → Sportarr** and adds a
connection:

1. Enter a connection name and the hostname, port, and optional URL base that
   the SeerrNG server can reach. Sportarr uses port `1867` by default. Enable
   HTTPS if Sportarr is served over TLS.
2. Enter the Sportarr API key. Find it in Sportarr under **Settings → General**.
3. Choose **Test connection**. SeerrNG checks the native Sportarr API and loads
   its quality profiles.
4. Choose the quality profile for new leagues and mark one Sportarr connection
   as the default destination.
5. Choose **Connect** or **Save**.

The API key is hidden after saving. Leave its field blank when editing to keep
the saved key. Configure the connection address as seen from SeerrNG; a
browser-accessible address alone does not mean the SeerrNG server can reach it.

SeerrNG uses Sportarr's native `/api` interface, which is the documented
integration API for new applications. Sportarr's Sonarr-compatible API remains
available for existing Sonarr clients. SeerrNG uses the native league identity
and reads the library back after adding a league so that request status reflects
what Sportarr actually accepted.

## Browse and request leagues

Users open **Discover → Sports** to search Sportarr's league catalog. Select a
league to see its details. Users with either the general **Request** permission
or the **Sports Requests** permission can request a league that is not already
in Sportarr. Requests follow the normal approval and auto-approval settings.
When multiple Sportarr services are configured, users with **Advanced Request**
or **Manage Requests** permission can choose a destination; SeerrNG checks that
service's library state before enabling the request.

When an approved request is sent, SeerrNG adds the league with the selected
quality profile. Sportarr applies its own root-folder and monitoring defaults.
If Sportarr already contains the league but does not monitor it, SeerrNG marks
that state and explains that an administrator must enable monitoring in
Sportarr. SeerrNG does not silently change an existing league's monitoring
choices.

Sports requests use the account's existing TV request quota. Administrators
can separately grant **Auto-approve Sports Requests** in user permissions.

## Follow events

League details show events Sportarr reports as monitored, with their broadcast
date and time when available, file availability, file count, and quality.
Events are paged as you load more. A league's event list appears after it has
been added to Sportarr and monitoring is enabled there.

An event marked **Available** has a file in Sportarr. **Not downloaded** means
Sportarr reports no file for that event; acquisition and download progress are
managed in Sportarr.

## Troubleshooting

- If connection testing fails, check the hostname, port, HTTPS option, URL
  base, API key, and network access from the SeerrNG server.
- If the connection works but requests fail, confirm a default Sportarr
  connection and quality profile are selected.
- If a league is already in Sportarr but cannot be requested, check whether it
  is unmonitored there. Enable it in Sportarr to make its events visible.
- If **Sports** does not appear in Discover, enable the Sports media category
  under **Settings → Media Categories**.

See the [Sportarr Integration API](https://wiki.sportarr.net/development/integration-api/)
and [Sportarr API reference](https://wiki.sportarr.net/api/) for the provider's
native API contract.
