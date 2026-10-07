# PostgreSQL Startup Recovery — Issue #164

## Recovery identity

- Base: `a9dd1b5a64cd9ccabe59da198b0524a7886bb708` (`origin/main`).
- Issue fix commit: `0980bc5d1db052f566cd97b46b98a89149a34952`.
- Supporting packaging-fixture test commit: `e87fef1e4374eadf0b3e15667eb57f44ccc5a6ff`.
- Upstream issue: https://github.com/snapetech/seerrng/issues/164.
- Pre-audit recovery archive: `/tmp/seerrng-issue164-preaudit-20261006.tar`.

## Root cause and changes

Three `@UpdateDateColumn` decorators passed SQLite's `datetime` type directly
to TypeORM. PostgreSQL rejects that type while building entity metadata, before
startup reaches the migration runner. The affected columns are
`ReaderDeliveryGrouping.updatedAt`, `GameLibraryAccount.updatedAt`, and
`GameLibraryEntry.updatedAt`.

The fix resolves those types for the active database and adds a reversible
PostgreSQL migration to normalize nine private-library date columns, preserving
their wall-clock values under the session timezone. The issue commit includes a
metadata regression test, migration test, and release-note fragment.

## Verification

- Before rebasing, full Linux `pnpm test:ci`: 487 files passed, 1 skipped; 3,375 tests passed,
  4 skipped; 0 failures. The four skips were PostgreSQL-gated tests.
- Before rebasing, focused PostgreSQL 18 Node run: 5 passed, 0 failed, 0 skipped. This included
  all four database-gated migration tests and the issue migration query test.
- Focused Linux Vitest metadata regression: 1 passed.
- Disposable PostgreSQL 18 migration round-trip (before rebase, same issue
  commit contents): all nine columns converted up and down, preserving values
  under an `America/Edmonton` session timezone.
- Before rebasing, Linux `pnpm build`: passed. Translation extraction, 569-file current-batch
  contract, shared-style checks, 68 button/geometry tests, server compilation,
  Next.js compilation, and all 113 static pages completed.
- Release-note preview rendered the PostgreSQL startup fix note.
- Before rebasing, `pnpm validate:development` on Linux ARM64 passed formatting, lint, types,
  Vitest (100 files; 453 tests), native TypeScript (2,912 passed, 4 skipped),
  and native JavaScript (485 tests). It failed one tooling test because its
  archive fixture assumed x64. The corrected fixture now passes 7/7 locally;
  the full gate was not rerun after that test-only correction.
- A full `pnpm test:node` attempt was stopped after 9m15s while compiling an
  unrelated Jellyfin suite. No failure was reported; that full lane is not
  counted as passed. Focused relevant Node tests passed separately.
- The reviewed combined validation engine was not run. Historical
  `pnpm validate:development` attempts on the prior base had platform/tooling
  failures. The complete gate has not been rerun on the rebased candidate.
- Initial PR Cypress CI ran 43 specs (185 tests): 152 passed, 1 failed, and
  32 were pending. The failure was the Prowlarr settings heading being absent
  when the test queried it. The component renders after its settings response;
  the Cypress test now aliases and waits for that mocked request, then checks
  the section is visible before continuing its existing interaction checks.
  The updated Cypress test has not been rerun; the next push will trigger CI.
- No live database, account, or provider was used.

## Release

Before publication, the latest published tag was `v3.52.1`. The repository's
`Create tag` workflow determines the next version from unreleased conventional
commits on `main`.
