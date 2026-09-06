---
category: changed
audience: operators
area: release-pipeline
action: none
breaking: false
---
Release publication now validates the real platform matrix, records build
provenance, and waits for enabled package channels to finish, so a green
release cannot hide a missing architecture or silently skipped package upload.
