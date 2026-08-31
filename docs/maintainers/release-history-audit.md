# Release History Audit

The SeerrNG release history was audited against the repository's version tags
on 2026-08-31.

## Coverage

- `CHANGELOG.md` contains one section for each of the 65 `v3.*` tags, from
  `v3.0.0` through `v3.12.8`.
- The six imported upstream Seerr tags from `v3.0.0` through `v3.4.1` are
  represented with provenance entries; no separate SeerrNG notes were recorded
  for those tags.
- `v3.2.6` is not listed because no such tag exists.
- Releases that contain only release preparation or CI work are still listed,
  with that scope called out explicitly instead of inventing user-facing
  changes.
- The inherited Jellyseerr/Overseerr entries remain below the SeerrNG history
  under a separate heading.

## Audit method

For each tag, compare its commit range with the previous SeerrNG tag and
summarize changes that affect users, operators, security, integrations,
packaging, or upgrade safety. Release-preparation commits and duplicate draft
release records are not treated as additional software releases. The generated
git-cliff history remains available for commit-level traceability.

The coverage check is automated by
[`scripts/check-changelog-tags.mjs`](../../scripts/check-changelog-tags.mjs).
Pull-request CI and the tag-preparation workflow run it, so a future change
cannot silently remove a historical release section.

## Future releases

The tag workflow generates the new release section, assembles its curated
fragments, and prepends that section to the existing changelog. It does not
regenerate the entire file. This preserves the audited history while allowing
future agents to add normal `release-notes/*.md` fragments for each user-facing
change.
