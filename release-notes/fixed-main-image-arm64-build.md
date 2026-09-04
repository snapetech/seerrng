---
category: fixed
audience: users, operators
area: release-pipeline
action: none
breaking: false
---
The `:main` container image on GHCR is now published as a real multi-arch (amd64 + arm64) manifest, fixing "exec format error" crashes on arm64 hosts.
