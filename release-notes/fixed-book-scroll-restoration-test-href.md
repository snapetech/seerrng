---
category: fixed
audience: operators
area: testing
action: none
breaking: false
---
The book-discovery scroll-restoration E2E test now matches the book detail link's real href (which carries a `?format=` query parameter to preserve the discovery tab's format context, added alongside the Audiobooks discovery page) instead of a bare path, fixing a false failure introduced when that link shape changed.
