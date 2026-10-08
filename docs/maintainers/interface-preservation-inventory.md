# Interface Preservation Inventory

Recovered from the development journal and original discussion on October 1–2, 2026. This complements the integration checkpoint. It records what to preserve,
not a claim that every feature passed final verification or human review.

## Evidence labels

- **Accepted** means an explicit recorded human decision for that named state.
- **Implemented** means the source/journal records implementation; it does not
  establish current full-suite, rendered, physical-interaction or provider success.
- **Pending** means evidence was not recorded as complete at that checkpoint.
  Pending human visual review is not a merge or release gate under the project
  owner's October 7, 2026 direction; required automated and functional checks
  still apply.
- **Retired** means superseded; do not restore it during a conflict.
- **Opt-in** means a retained experiment, not a global production decision.

October 1 journal entries establish sequence but lack exact clock times; do not
claim a precise noon cutoff. These are preservation families, not an exhaustive
file-level diff. Produce the actual three-way file inventory at integration.
Listed suites are existing coverage pointers, not fresh passing receipts.

## Preserve across the contribution

1. **Request Status and shared typography/layout.** Preserve the ordered pinnable
   task/media/filter/sort sections, shared filter and action geometry, Request
   modal spacing, semantic title/heading roles, card/table typography, boundaries
   and truthful error/empty/retry states. Preserve page-level aggregate activity,
   loading text and spinner; do not reintroduce nested activity owners.
   Checks: `buttonGeometry`, `requestLayout`, `catalogLists`,
   `catalogFilterOwners`, `filterMenuGeometry`, `discoverHeaderSpacing`,
   `cardSpacing` and the current-batch contract. Final current page/state
   references must be assembled; no blanket Request-page acceptance is inferred.

2. **Browsing posters and controls.** Preserve fixed poster width/ratio, regular
   title treatment, semantic media slots, heading/navigation alignment, hover
   and shared action padding. Detail/credit posters remain distinct roles.
   Preserve the development-only browsing Watchlist star/local toggle, accessible
   pressed state and isolation from production writes; it is not Plex Watchlist.
   Preserve watched/Associations/Blocklist placement, disabled help and permission-
   aware blocked visibility. Prototype appearance/local interaction was explicitly
   accepted October 1; later refinements retain pending visual review.
   Checks: `buttonGeometry`, `iconOnlyButtons`, `watchlistPreview` and relevant
   blocklist/list/hook tests. Do not restore the retired 24px zero-padding ghost-
   button assertion; the current contract uses shared padding and poster roles.

3. **Shared dropdowns, mosaics and compact selectors.** Preserve native authored
   semantic anchoring/split parts, one border overlap, role-owned menu surfaces,
   collection mosaic geometry, matching selection/availability glyphs and compact
   browse/provider/region/filter controls. Preserve native flags/logos and source
   behavior. Compiled Tailwind output with redundant `--tw-*` machinery was an
   unfinished trial, superseded by authored owners—not the target design.
   Checks: `seriesDetailsStyle`, `catalogFilterOwners`, `filterMenuGeometry`,
   `buttonGeometry`. Noncompact forms, confirmation/association dependencies and
   shell debt were not certified clean. Do not claim site-wide Tailwind removal.

4. **Final shared Series tree.** Preserve outline structure, separate disclosure
   and selection, one actual selection target, source-truth dates/watched state,
   eligibility-aware counts, shared glyph colors, independent card/table settings,
   parent-only spacing, stationary toolbar/header and rows-only scrolling.
   Preserve production/lab reuse and exact season/episode-to-provider mapping.
   Outline design was explicitly accepted October 2 at 02:49 MDT; integrated
   playback/manual review remained pending. Checks: `seasonEpisodeTree`,
   `seriesTreeData`, `seriesDetailsStyle` and provider mapping tests.

5. **Independent tables and Media Server workspace.** Preserve descriptive Series/
   Movie summary versus expanded table configuration, responsive fallback and
   card/table ownership separation. Keep one full disclosure workspace, mounted
   selection state but no hidden hit targets, provider-derived logos, per-user
   pin preferences and symmetric pin geometry. Preserve six persistent video
   rating slots, truthful unknown/zero/cached-known values and safe media-correct
   links; do not copy video semantics into other ratings. Checks:
   `seriesDetailsStyle`, `videoRatings`, `detailDisclosureMediaServer`,
   `detailDisclosurePinsMutation` and user settings tests.

6. **Accepted action row and summary spacing.** The fully justified Series
   Trailer/Associations/Report/ratings row was explicitly accepted at 03:32 MDT;
   the corrected title-to-table spacing consuming card spacing was explicitly
   accepted at 04:46. Preserve right-aligned content-sized native controls,
   remaining-width tree, calendar weekday semantics, stacked server/device
   playback and wrapping. Later width/date arrangements still need final renders.
   Checks: `seriesDetailsStyle`, `buttonGeometry`, `seriesTreeData`.

7. **Per-user disclosure reorder.** Preserve common control/panel order, one-second
   hold, actual inert cursor-follow ghost, draft sibling reflow, valid-release-only
   commit, quick-click and pin independence, rollback on cancellation/capture loss/
   blur/Escape, keyboard/reduced-motion access, identity-safe preferences and stable
   panels. Preserve nullable reversible SQLite/PostgreSQL migration compatibility;
   adapt to the newer target's migration ordering, never replace newer migrations.
   Final physical drag/touch acceptance remained pending at 04:54 MDT.
   Check: `disclosureOrder` and underlying settings/client interaction suites.

8. **Native actions and bounded recovery.** Preserve independent Plex Watchlist,
   Jellyfin/Emby Favorites and existing shared Collections, own-account authority,
   exact selected-quality roots, confirmed desired state and no implicit request/
   download/synchronization. Personal Lists and collection creation proposals were
   superseded by choose-existing Collections at 04:40 MDT. The October 2 recovery
   restored the emergency baseline and retained bounded Collection corrections,
   then Watchlist freshness and dropdown repairs. Live Plex proof is recorded in
   the checkpoint; Jellyfin/Emby remain mock-only. Broad successor backend/visual
   batches were rolled back; historical passing logs do not restore that code.

## Retired and experimental states

Retired tree trials include paired tables, rejected ledger/accordion/folder/tile
variants, Page 2, former trial heights, sticky/opaque header compensation, duplicate
child gap, card-title selection summary, two-second hold, highlight overhang and
tree-fill opt-in. The final compact tree uses the existing 186px frame, transparent
heading/rows, stationary header outside scrolling rows, border-only selection
feedback and table-role summary. Do not select an older value merely to satisfy
an old test. Replace superseded assertions with meaningful current checks and
negative fixtures; do not weaken behavior coverage.

Page 6 retro amber/monospace remains an **opt-in reference**. Future global theme
work is deferred; liking that experiment never approved site-wide application.

## Merge preparation agreement

The original discussion at approximately 05:03–05:30 MDT on October 2 requested
recoverable checkpoints, journal/tests/accepted references, the same checked-in
standards and checks for both AIs, separate Style Standard and Fix-It documents,
AGENTS routing, and a clear forward-merge procedure. Implementation was explicitly
authorized at 05:30. The approximate 04:58 history marker identifies the nearby
conversation, not the exact start of the merge discussion.

Review a page or two per batch, repair only established violations automatically,
and bring new design choices or unrelated backend failures to the maintainer.
Final cumulative checks and production compilation remain required automated
gates. Human visual acceptance is separate evidence and is not a publication
gate when the maintainer explicitly directs the work to proceed. This inventory
is not publication authority.
