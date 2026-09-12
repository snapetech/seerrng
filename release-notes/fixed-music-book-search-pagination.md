---
category: fixed
audience: users
area: search
action: none
breaking: false
---
Searching for music or audiobooks/books no longer gets stuck after the first ~20 results — pagination was being computed from this page's (capped) result count instead of the true number of matches reported by MusicBrainz and Open Library, so scrolling past the first page silently stopped fetching more.
