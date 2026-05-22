---
title: Bookshelf Hardcover Migration
description: Migrate existing Readarr or softcover Bookshelf libraries to Hardcover-backed Bookshelf.
sidebar_position: 22
---

# Bookshelf Hardcover Migration

SeerrNG can migrate an existing Readarr-compatible ebook/audiobook library into
Bookshelf instances backed by Hardcover metadata. The migration is layered and
resumable: it keeps strict Hardcover matches, retries transient failures, uses a
softcover Bookshelf endpoint to recover metadata when Hardcover rejects a stale
ID, and can optionally create deterministic local Bookshelf rows for the few
books that Hardcover still cannot import.

The validated lab result imported `2115 / 2115` books with `0` failures. In that
run, most books imported through the normal Hardcover API path. The final `42`
records required the explicit `HARDCOVER_LOCAL_DB_IMPORT=true` fallback because
Hardcover metadata rejected every API-safe candidate.

## Record States

The migration reports separate the record state from the Bookshelf backend:

| State | Meaning | Typical source |
| --- | --- | --- |
| Native Hardcover | The target row uses Hardcover-provided book, author, and edition IDs. | Direct Hardcover lookup, softcover remap, or OpenLibrary remap. |
| Shadow local | The target row is shaped like a Hardcover-backed Bookshelf row, but uses stable `local:*` IDs. | `HARDCOVER_LOCAL_DB_IMPORT=true` after all native recovery paths fail. |
| Reconciled | A former shadow row was promoted in place to native Hardcover IDs. | `--reconcile-local` after Hardcover adds or fixes metadata. |

Shadow local rows are intentionally deterministic. The same source book gets the
same local foreign IDs on repeated runs, so reruns and later reconciliation can
target the existing row instead of creating another book.

## What "100%" Means

The migration can reach 100% of the source inventory in a Bookshelf Hardcover
target when the final local DB fallback is enabled.

That does not mean every source book has a native Hardcover ID. Records imported
by the local DB fallback use stable IDs like:

```text
local:ebook:1076
local:audiobook:4905
```

Those records are visible through the Bookshelf API and are included in
validation/cutover checks, but they are not Hardcover metadata records yet.
They are the deterministic last-resort layer for users who want their library
represented without requiring an LLM or manual data cleanup. Later, if Hardcover
adds an acceptable record, run local reconciliation to promote the shadow row to
the native Hardcover IDs in place.

## Compatibility Layers

The migration keeps earlier recovery layers. It does not replace them.

1. Source inventory is exported from Readarr/Bookshelf SQLite.
2. Existing Hardcover matches are reused when strict enough.
3. ISBN/ASIN/title/author lookup variants are tried against Hardcover.
4. Apply resumes from `applied-books.json` and skips already imported records.
5. Target cache duplicate rows are de-duplicated when they cause API errors.
6. Missing target authors are pre-created when Hardcover can resolve them.
7. Alternate Hardcover candidates are tried when the first target ID is bad.
8. Optional softcover fallback recovers title/author/edition metadata from a
   softcover Bookshelf endpoint, then remaps back through Hardcover.
9. OpenLibrary recovery finds alternate title/author/ISBN profiles, then remaps
   those profiles back through Hardcover for a native target record.
10. Optional local DB fallback inserts deterministic local records for anything
   still rejected by the target API.

The local DB fallback is opt-in. Leave it off when you only want current native
Hardcover metadata. Enable it when complete library representation matters more
than waiting for Hardcover to fill every metadata gap.

## Required Inputs

You need one source config directory for ebooks and, if used, one for
audiobooks:

```text
BOOKSHELF_EBOOKS_CONFIG_DIR=/path/to/readarr-or-bookshelf-ebook-config
BOOKSHELF_AUDIOBOOKS_CONFIG_DIR=/path/to/readarr-or-bookshelf-audiobook-config
```

You also need running Hardcover target Bookshelf instances and their API keys:

```text
HARDCOVER_EBOOK_BASE_URL=http://127.0.0.1:8787
HARDCOVER_AUDIOBOOK_BASE_URL=http://127.0.0.1:8788
HARDCOVER_EBOOK_API_KEY=...
HARDCOVER_AUDIOBOOK_API_KEY=...
```

If you want the softcover recovery layer, run or keep a softcover Bookshelf pair
available and provide:

```text
HARDCOVER_SOFTCOVER_EBOOK_BASE_URL=http://127.0.0.1:18887
HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL=http://127.0.0.1:18888
HARDCOVER_SOFTCOVER_EBOOK_API_KEY=...
HARDCOVER_SOFTCOVER_AUDIOBOOK_API_KEY=...
```

## Report-Only Run

Generate inventory, match reports, and rebuild payloads without importing:

```bash
deploy/install-bookshelf-backend.sh --migrate-to-hardcover
```

Review these files in the generated `hardcover-migration` directory:

```text
ebook-inventory.json
audiobook-inventory.json
matched-books.json
unmatched-books.json
ambiguous-books.json
rebuild-payload.json
rebuild-blocked.json
migration-report.json
```

## Apply Run

Apply matched/recovered books to prepared Hardcover targets:

```bash
APPLY_HARDCOVER_REBUILD=true \
HARDCOVER_EBOOK_API_KEY=... \
HARDCOVER_AUDIOBOOK_API_KEY=... \
deploy/install-bookshelf-backend.sh --migrate-to-hardcover
```

The apply phase writes:

```text
applied-books.json
apply-failures.json
apply-failure-summary.json
validation-report.json
cutover-decision.json
lookup-cache.json
ebook-match-checkpoint.json
audiobook-match-checkpoint.json
```

If the process stops, rerun the same command. Previously applied source records
are skipped.

## 100% Fallback Run

Enable the final fallback only after reviewing failures and deciding that local
shadow records are acceptable for non-Hardcover metadata gaps:

```bash
APPLY_HARDCOVER_REBUILD=true \
HARDCOVER_LOCAL_DB_IMPORT=true \
HARDCOVER_EBOOK_CONFIG_DIR=/path/to/hardcover-ebook-config \
HARDCOVER_AUDIOBOOK_CONFIG_DIR=/path/to/hardcover-audiobook-config \
HARDCOVER_EBOOK_API_KEY=... \
HARDCOVER_AUDIOBOOK_API_KEY=... \
deploy/install-bookshelf-backend.sh --migrate-to-hardcover
```

The installer also accepts an explicit flag:

```bash
APPLY_HARDCOVER_REBUILD=true \
HARDCOVER_EBOOK_CONFIG_DIR=/path/to/hardcover-ebook-config \
HARDCOVER_AUDIOBOOK_CONFIG_DIR=/path/to/hardcover-audiobook-config \
HARDCOVER_EBOOK_API_KEY=... \
HARDCOVER_AUDIOBOOK_API_KEY=... \
deploy/install-bookshelf-backend.sh --migrate-to-hardcover --allow-local-db-import
```

`HARDCOVER_LOCAL_DB_IMPORT=true` requires `sqlite3` and direct access to the
target `readarr.db` files. It inserts only after the API path, softcover
recovery path, and OpenLibrary recovery path fail.

To apply the final fallback directly to an existing migration directory:

```bash
node deploy/bookshelf-hardcover-migration.mjs --apply --local-db-import \
  /opt/bookshelf-backend/backups/20260520-082024/hardcover-migration
```

## Local Reconciliation

If local shadow records were imported, periodically try to promote them to
native Hardcover IDs:

```bash
HARDCOVER_EBOOK_CONFIG_DIR=/path/to/hardcover-ebook-config \
HARDCOVER_AUDIOBOOK_CONFIG_DIR=/path/to/hardcover-audiobook-config \
node deploy/bookshelf-hardcover-migration.mjs --reconcile-local \
  /opt/bookshelf-backend/backups/20260520-082024/hardcover-migration
```

The reconciliation command looks up each `localDbImport` record through
Hardcover, softcover recovery, and OpenLibrary recovery. When it finds a strict
native match, it updates the existing local book, author metadata, and edition
foreign IDs in place. If a native duplicate already exists, it skips the record
and reports `native_duplicate_book_exists` instead of creating another book.
Results are written to `local-reconciliation-report.json`.

Reconciliation mutates only rows that were previously recorded in
`applied-books.json` with `localDbImport: true`. Successful rows are marked as:

```json
{
  "localDbImport": false,
  "reconciledFromLocal": true
}
```

The report uses these common statuses:

| Status | Meaning |
| --- | --- |
| `ok: true` | The shadow row was promoted to native Hardcover IDs. |
| `native_match_not_found` | Hardcover still does not have a strict usable candidate. |
| `native_duplicate_book_exists` | A native row already exists; no duplicate was created. |
| `target_config_dir_not_provided` | Set `HARDCOVER_EBOOK_CONFIG_DIR` or `HARDCOVER_AUDIOBOOK_CONFIG_DIR`. |
| `local_shadow_book_not_found` | The migration record exists but the matching `local:*` row is not in the target DB. |
| `db_reconcile_failed` | SQLite rejected the in-place update; inspect the error in the report. |

Run validation again after reconciliation:

```bash
node deploy/bookshelf-hardcover-migration.mjs --validate \
  /opt/bookshelf-backend/backups/20260520-082024/hardcover-migration
```

## Output Files

| File | Written by | Purpose |
| --- | --- | --- |
| `matched-books.json` | Report run | Strict native matches and native recovery matches ready for rebuild. |
| `unmatched-books.json` | Report run | Source books still lacking a native candidate. |
| `ambiguous-books.json` | Report run | Books with multiple plausible candidates that require inspection. |
| `rebuild-payload.json` | Report run | Books that can be applied to the Hardcover target through the API. |
| `rebuild-blocked.json` | Report run | Matches missing required fields such as root folder or profile IDs. |
| `applied-books.json` | Apply/reconcile | Applied source records, target IDs, local shadow flags, and reconciliation flags. |
| `apply-failures.json` | Apply run | Records that failed API import and, if enabled, direct DB fallback. |
| `apply-failure-summary.json` | Apply run | Grouped failure categories and recommended next action. |
| `validation-report.json` | Validate run | Per-target provider, lookup, and applied-record checks. |
| `cutover-decision.json` | Validate/cutover check | Boolean cutover gate plus blocking reasons. |
| `lookup-cache.json` | Report/apply/reconcile | Cached Hardcover lookup responses for resumability and rate-limit control. |
| `local-reconciliation-report.json` | Reconcile run | Promotion results for shadow local records. |

## Command Reference

```bash
# Generate inventory and reports without importing.
deploy/install-bookshelf-backend.sh --migrate-to-hardcover

# Apply native API-safe records.
APPLY_HARDCOVER_REBUILD=true \
deploy/install-bookshelf-backend.sh --migrate-to-hardcover

# Apply native records and shadow local rows for remaining gaps.
APPLY_HARDCOVER_REBUILD=true \
HARDCOVER_LOCAL_DB_IMPORT=true \
deploy/install-bookshelf-backend.sh --migrate-to-hardcover

# Promote shadow rows later when native Hardcover entries exist.
node deploy/bookshelf-hardcover-migration.mjs --reconcile-local \
  /path/to/hardcover-migration

# Validate and gate cutover.
node deploy/bookshelf-hardcover-migration.mjs --validate /path/to/hardcover-migration
node deploy/bookshelf-hardcover-migration.mjs --cutover-check /path/to/hardcover-migration
```

## Useful Tuning

```env
HARDCOVER_API_TIMEOUT_MS=30000
HARDCOVER_RATE_LIMIT_BATCH_SIZE=20
HARDCOVER_RATE_LIMIT_DELAY_MS=3000
HARDCOVER_RATE_LIMIT_MAX_RETRIES=1
HARDCOVER_RATE_LIMIT_BACKOFF_BASE_MS=5000
HARDCOVER_RECOVERY_LOOKUP_LIMIT=4
HARDCOVER_MATCH_CONCURRENCY=6
HARDCOVER_CHECKPOINT_INTERVAL=1
HARDCOVER_DEDUPE_TARGET_CACHE=true
HARDCOVER_IDENTIFIER_FALLBACK=false
HARDCOVER_VALIDATION_LOOKUP_RETRIES=3
HARDCOVER_VALIDATION_LOOKUP_RETRY_DELAY_MS=10000
HARDCOVER_OPENLIBRARY_RECOVERY=true
```

## Validation and Cutover

Validate an already-applied migration:

```bash
node deploy/bookshelf-hardcover-migration.mjs --validate \
  /opt/bookshelf-backend/backups/20260520-082024/hardcover-migration
```

Check cutover readiness:

```bash
node deploy/bookshelf-hardcover-migration.mjs --cutover-check \
  /opt/bookshelf-backend/backups/20260520-082024/hardcover-migration
```

A successful cutover decision looks like:

```json
{
  "ok": true,
  "reasons": [],
  "status": "validation_complete",
  "applyCounts": {
    "applied": 2115,
    "failed": 0
  }
}
```

## Lab Rehearsal

Use the lab script for a disposable trial:

```bash
SOURCE_EBOOK_CONFIG_DIR=/path/to/source/ebook \
SOURCE_AUDIOBOOK_CONFIG_DIR=/path/to/source/audiobook \
deploy/bookshelf-migration-lab.sh apply
```

To rehearse the 100% final fallback:

```bash
HARDCOVER_LOCAL_DB_IMPORT=true \
SOURCE_EBOOK_CONFIG_DIR=/path/to/source/ebook \
SOURCE_AUDIOBOOK_CONFIG_DIR=/path/to/source/audiobook \
deploy/bookshelf-migration-lab.sh apply
```

The lab uses ports `18787` and `18788` for the target Hardcover instances.

## Rollback

The installer writes timestamped backups before mutation. If validation fails,
restore from `BACKUP_DIR`:

```bash
BACKUP_DIR=/opt/bookshelf-backend/backups/20260520-082024 \
deploy/install-bookshelf-backend.sh --restore-backup
```

Keep the old Readarr/softcover data until ebook, audiobook, and both-format
requests have been tested through SeerrNG.
