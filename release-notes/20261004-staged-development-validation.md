---
category: changed
audience: operators
area: development-validation
action: none
breaking: false
---

Development validation now stages repository checks, security scans, production builds, and browser tests in one engine. It selects worker limits from available CPUs and execution context, preserves native GitHub jobs, never reuses test results, and limits reuse to a successful same-run build consumed by its dependent browser stage.
