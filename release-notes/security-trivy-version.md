---
category: security
audience: operators
area: security
action: none
breaking: false
---
Release and main-image vulnerability scans now use an available, explicitly pinned Trivy release instead of a retired scanner version, so the security gates execute rather than failing during tool installation.
