---
category: fixed
audience: users
area: requests
action: none
breaking: false
---
A book request for both ebook and audiobook formats now correctly shows as "Incomplete" once both services have been dispatched but the library hasn't finished processing them — previously it could report "Searching" even though both downloads were already underway, because the status check only compared which formats were linked and skipped the same in-progress check used for every other request type.
