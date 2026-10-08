# Bookshelf Format Availability Integration

## Candidate identity

- Repository: `snapetech/seerrng`
- Worktree: `/home/keith/Documents/code/seerrng-bookshelf-format-stats`
- Branch: `codex/bookshelf-format-statistics`
- Base: `origin/main` at `a96fafa07c77a2d6d95badeb9f60c32a6b4a47c9`
- Publication was pending in this historical entry. The project owner's
  October 7, 2026 direction removes separate human acceptance as a merge or
  release gate. Keep the pull request description accurate and disclose AI use.

## Integration contract

BookshelfNG release `main-v0.4.21.62` publishes ebook and audiobook file counts
separately while preserving Readarr's aggregate count. The SeerrNG Readarr
scanner selects the count matching the configured service type. An explicit
zero is authoritative; older servers that omit the format-specific count use
the aggregate field. Availability and processing status use the same selected
count. Existing SeerrNG request and availability views consume those statuses;
this change adds no new UI control.

## Source changes

- `server/api/servarr/readarr.ts`: type the optional ebook and audiobook file
  count fields.
- `server/lib/scanners/readarr/index.ts`: select the configured format's count
  for `hasFile` and `processing`, with legacy aggregate fallback.
- `server/lib/scanners/readarr/readarr.test.ts`: cover audiobook zero despite an
  existing ebook and ebook availability when the aggregate count is zero.
- `docs/using-seerr/bookshelf-backend.md` and
  `release-notes/2026-10-04-bookshelf-format-availability.md`: document the
  contract and operator-visible effect.
- `src/styles/watchlistPreview.test.mjs`: replace the superseded source check
  with behavior coverage for the current permission plus saved-preference
  conditions. The test now evaluates all eight Discover gate combinations and
  all four ListView permission/preference combinations. Production blocklist
  behavior is unchanged by this test repair.

## Verification record

- On the untouched base, the required native JavaScript lane failed because the
  test expected the retired `hideBlocklisted && !canManageBlocklist` condition;
  the hook already included the saved `hideBlocklisted` setting. The ListView
  test fixture also lacked the `currentSettings` object read by its existing
  filter. Both mismatches were confirmed against the base source.
- Focused `src/styles/watchlistPreview.test.mjs`: 4 passed, 0 failed after the
  assertion and fixture update.
- `pnpm validate:development --plan`: passed; 92 Vitest files, 372 Node
  TypeScript files, 56 Node JavaScript files, and 32 tooling files selected,
  with no platform exclusions.
- `pnpm validate:development`: passed. Vitest: 426 passed; native TypeScript:
  2,835 passed and 4 PostgreSQL migration tests skipped; native JavaScript:
  484 passed; tooling: 238 passed. No lane failed. The four native TypeScript
  skips were the PostgreSQL screen-media, screen-blocklist, canonical-book-ID,
  and music-media migration tests.
- `pnpm build`: passed, including server TypeScript compilation and Next.js
  production build; 112 pages generated.
- `pnpm release-notes:preview --base HEAD --head <temporary candidate tree>`:
  passed and emitted the new Bookshelf format-availability note. The preview used
  a temporary commit object with no branch or tag ref.
- `git diff --check`: passed. Runtime: Node.js v24.15.0, pnpm 10.24.0;
  `pnpm-lock.yaml` SHA-256: `95ac464cf2675ebc64680309ead0f5c7c0b39e6cc2490695f423b9312cf0f489`.
- The full validation and build ran with the feature, scanner tests, operator
  documentation, and release note in place. Only this journal's final receipt
  text was added afterward; that documentation-only update was checked with
  Prettier and `git diff --check`.
- Visual inspection and live BookshelfNG round-trip evidence were pending in
  this historical entry. Visual acceptance is not a publication gate; record
  the live integration status separately from static checks and mocked tests.

## Recovery

The candidate can be rebuilt from the base commit above and the uncommitted
branch changes. The original `/home/keith/Documents/code/seerrng` checkout
contains unrelated dirty work and must remain untouched. Do not cherry-pick or
overwrite that checkout. Publish only when the maintainer authorizes it and the
applicable automated and functional checks pass; separate human review is not
required.
