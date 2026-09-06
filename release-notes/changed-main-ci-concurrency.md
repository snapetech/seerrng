---
category: changed
audience: operators
area: ci
action: none
breaking: false
---
Main validation runs can now proceed independently while image publication and live deployment remain serialized, and each scan and deployment uses the exact image digest produced by its own run.
