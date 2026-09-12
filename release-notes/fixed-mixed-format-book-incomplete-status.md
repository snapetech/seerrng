---
category: fixed
audience: users
area: requests
action: none
breaking: false
---
A book request for both ebook and audiobook formats now correctly shows as "Incomplete" once both services are dispatched but not yet processed — previously it could report "Searching" while both downloads were already underway, because the check stopped once both formats were linked instead of also checking progress.
