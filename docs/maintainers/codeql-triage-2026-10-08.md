# CodeQL triage — October 8, 2026

This records the 26 open CodeQL alerts fetched from `main` at
`fe1ef9790369c4694cb6b7de4444e6c9330dcfc1` before the all-branches integration.
The alert IDs let the GitHub dispositions be checked against the reviewed
source.

## Dependabot Next.js alerts

Dependabot alerts **#309–#314** identify Next.js versions below `16.3.8` in
`pnpm-lock.yaml`. PR #172 changed the root `package.json` version but left the
workspace override at `16.3.6`, so the lockfile continued resolving the
vulnerable version. The override and lockfile now both resolve to `16.3.8`.
`pnpm install --lockfile-only --frozen-lockfile --offline` passes. GitHub's
default-branch alerts remain open until this lockfile repair reaches `main` and
Dependabot refreshes its dependency graph.

## Fixed in source

- **#481 — `js/missing-rate-limiting`** at
  `server/routes/gameLibrary.test.ts:51`. The alert surfaced at the test app's
  mount of the production router. The Game Library router now limits every
  authenticated user's requests to 120 per minute; the existing Steam sync
  limit remains 4 per minute. Test and E2E environments skip these limits. The
  next CodeQL analysis should close this alert as fixed.

## Dismissed as false positives

The `js/file-access-to-http` alerts are **#480, #482–#484, #503–#514, #517,
#521–#522, #526, #528–#529, and #535**. CodeQL traces values loaded from
SeerrNG's local settings and metadata into outbound calls. Review of each sink
found that the data is intentionally sent to its selected integration: the
download clients, Audiobookshelf, Jellystat, slskdN, Apprise, and the configured
Swipe model use an administrator-configured service URL with the existing safe
URL, origin, DNS, and redirect controls; Steam uses its fixed official API
endpoint. These calls send the integration credentials or request metadata the
service expects. They do not upload arbitrary local file contents or accept an
untrusted destination from the request being handled.

## Dismissed as protocol-required

- **#499 and #501 — `js/insufficient-password-hash` and
  `js/weak-cryptographic-algorithm`** at `server/api/navidrome/index.ts:49`.
  Navidrome's Subsonic API requires `token = md5(password + salt)` for token
  authentication. SeerrNG generates a fresh random salt for each request and
  sends the token rather than the password. Replacing MD5 here would break the
  protocol; the [Subsonic API authentication specification](https://www.subsonic.org/pages/api.jsp)
  defines this calculation.

## October 8 follow-up scan and corrections

A later scan of the default branch at `42397ee61d496337134106ef341a7d8b45ff412b`
reported 12 open alerts: **#538–#546, #548, #481, and #485**. The changes below
are on the integration candidate and remain open in GitHub until the candidate
reaches `main` and CodeQL refreshes its analysis.

- **#548 — `CVE-2026-94483`**. The workspace override had kept resolving Next.js
  to vulnerable `16.3.6` after the package manifest was changed. Both the
  override and lockfile now resolve to `16.3.8`, the fixed version. The existing
  `2026-10-08-security-hardening.md` fragment records the update.
- **#541–#545 and #538–#540 — `js/file-system-race`**. Several Mode 3 paths
  checked file metadata and later reopened the path to read evidence, profiles,
  or configuration. A replacement between those operations could redirect the
  read. Evidence reads now pin an ordinary file descriptor, verify that the
  path still names that object, read only the opened file within its recorded
  size, and compare descriptor metadata before and after. Configuration,
  active-marker, and runner-attestation readers likewise open first and then
  validate the opened object and current path before consuming it. Regression
  coverage swaps in a symlink between the old check and read: the old pattern
  returns the symlink target while preserving the original path identity; the
  descriptor reader detects the swap and rejects it.
- **#546 — `js/trivial-conditional`**. Local volume options were validated for
  type inside a boolean `&&` whose object result was always truthy. Validation
  now produces an explicit options value before checking for an empty object.
- **#485 — `js/unneeded-defensive-code`**. The duplicate-plan guard ran after a
  parser branch that always exits at the first level plan, so the guard could
  never fire. It was removed; a second plan is still rejected as unexpected
  trailing TAP structure, now covered by a regression test.
- **#481 — `js/missing-rate-limiting`**. The alert points to the Game Library
  test app mount. Production already applies a per-user 120-request/minute
  router limit and preserves a 4-request/minute Steam sync limit. Keep this
  alert open until the default-branch reanalysis confirms the route is covered.

Focused verification on the candidate passed 157 tests across evidence
reconciliation, Node attestation, native TAP accounting, config management,
public lifecycle, production runner, and host containment; one platform-specific
case was skipped. The dedicated race reproduction passed. The first hosted
build also exposed a duplicate `datCatalog` declaration introduced while
reconciling the software-provider contract; that duplicate has been removed.
The new hosted run must verify the corrected build and re-evaluate CodeQL.
