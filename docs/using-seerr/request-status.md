---
title: Request Status
description: Follow request progress, view status history, and find incomplete requests.
---

# Request Status

Open **Requests** from the account menu to see request progress. Each card
shows the current state and, when available, the request lifecycle from
approval and searching through downloading, importing, and library
availability. Expand **History** on a card to review its recorded status
changes.

## Find a request

Use the summary filters to view all requests, completed requests, active work,
requests needing attention, or incomplete requests. **Incomplete** helps find
requests where only part of the requested media or book formats have been
fulfilled.

The other filters can narrow the list by media type, keyword, and time period.
The time period options include the last 7, 14, or 30 days, the last 6 months,
and all time. If the page indicates older requests are outside the selected
period, choose **View All History** to include them. Users with permission to
view other users' requests can also filter by requester.

## Resolve requests that need attention

When a request has a **Retry** action, use it to restart the request from the
approval stage. Pending requests may also show management actions such as
approve, decline, or edit, depending on your permissions. Actions for deleting
status entries or removing available media are permission-controlled and
include a confirmation step.

For books, the Books and Audiobooks filters keep ebook and audiobook requests
separate. A combined request can therefore be incomplete while one format is
available and the other is still requested or missing. See
[Books, Authors, and Series](./books-and-series.md) for book discovery and
series requests.

## Download an available copy

When an imported file is available to SeerrNG, its request card shows a
**Download copy** action. If the request has several files, open **Download
copies** and choose the episode, book format, comic issue, or magazine issue to
save. The browser handles transfer progress after the download starts; SeerrNG
keeps the request's availability and history on this page.

ROM and PC game requests also appear in Request Status with their provider
confirmed lifecycle states and download actions. See
[Software requests](./software-acquisition.md) for provider setup, emulation
system groups, and PC target selection.

Available notifications link directly to the matching request in Request
Status. Software requests are reconciled in the background, so completion can
be detected when the page is closed. SeerrNG checks request access and current
availability again before each download. It
does not expose provider credentials or server paths, and it only lists files
that the configured backend reports as imported and SeerrNG can access.

### Administrator setup

In **Settings > Main > Download Copies**, add a path mapping for file-based
backends. The backend's `remoteRoot` is the library root it reports; `localRoot`
is the corresponding absolute path mounted read-only inside SeerrNG. Use an
instance-specific `serviceId` when more than one backend of that type uses
different paths. For example:

```json
[
  {
    "serviceType": "radarr",
    "serviceId": 1,
    "remoteRoot": "/movies",
    "localRoot": "/mnt/media/movies"
  }
]
```

Mappings are supported for Radarr, Sonarr, Readarr-compatible ebook and
audiobook services, LazyLibrarian magazines, and Kapowarr comics. Mylar3 comic
issues are streamed through its authenticated API and do not need a path
mapping. Keep the mounted library read-only and map the narrowest practical
folder. If the backend does not report an imported file, the path is not
mounted, or a mapping cannot be resolved safely, the download action stays
hidden.
