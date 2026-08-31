---
category: security
audience: users, operators
area: security
action: Serve browser traffic through HTTPS before upgrading.
breaking: true
---
Browser sessions now require HTTPS, and vulnerable runtime and documentation-build dependencies have been updated or patched. Direct HTTP deployments must move behind TLS to keep browser sign-in working.
