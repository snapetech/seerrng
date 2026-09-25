# Software acquisition plan: ROMs and games

**Status:** Implementation in progress

**Researched:** 2026-09-25

**Confidence:** High that ROMarr and Questarr are actively developed as of this date. Moderate that the current ROMarr API meets the full request lifecycle without compatibility work. High that Questarr needs an extension for durable external request/job status. Gamarr remains a conditional fallback pending a defined platform gap.

## Scope

Plan request-driven catalog and acquisition for:

- Retro emulation titles and ROMs.
- Modern emulation systems and their game files.
- Windows, Linux, and macOS games.

The scope includes catalog discovery, request approval, acquisition dispatch, download progress, import or file organization, and availability in a library. Playback, launching, emulator setup, and runtime or compatibility-layer configuration are out of scope.

General desktop applications for Windows, Linux, and macOS are deferred to a future wishlist item. They are not part of this plan.

## Recommendation

Do not build a new general-purpose game downloader. Use ROMarr as the initial backend for supported ROM systems; it is actively maintained and its current API covers the main request-to-import path. Maintain [QuestarrNG](https://github.com/snapetech/QuestarrNG) as the separate Games acquisition service and add the request/job contract SeerrNG needs. The upstream API does not expose durable external request identity or request-specific job status. Keep Gamarr as a forkable fallback for a demonstrated platform gap; its source is active and MIT-licensed, but its request API is not a dependable external contract as-is.

Treat Retro, Modern Emulation, and Games as SeerrNG catalog/request experiences that route to providers by the selected platform and acquisition capabilities. They do not need a different backend just because they have different labels in the UI.

## Candidate health and integration readiness

This assessment uses release and commit information available on 2026-09-25. Stars and forks are weak adoption signals; tagged releases, documented APIs, persistent job state, and integration tests matter more.

| Backend | Maintenance and maturity evidence | Integration assessment |
| --- | --- | --- |
| [ROMarr](https://github.com/BlizzHacker/romarr) | MIT. v0.9.0 was released 2026-09-19, with 79 commits since v0.8.0; the latest commit was on the release date. The v0.9.0 notes describe a persisted queue, failed-download recovery, and a state-file security fix. The repository has an OpenAPI description and tests for the served API. It is still pre-1.0 and had a small public contributor base at review time. | **Integrate as-is for the first ROM pilot, pinned to v0.9.0.** It is active and has the API and queue behavior needed to prove the flow. Keep the SeerrNG adapter separate so a breaking upstream change cannot take down request tracking. Recheck its release health before implementation. [v0.9.0 notes](https://github.com/BlizzHacker/romarr/releases/tag/v0.9.0) · [activity](https://github.com/BlizzHacker/romarr/commits/main) · [API](https://github.com/BlizzHacker/romarr#api) |
| [Questarr](https://github.com/Doezer/Questarr) / [QuestarrNG](https://github.com/snapetech/QuestarrNG) | GPL-3.0-only. Latest tagged release v1.4.2 was published 2026-08-11. Upstream main was pushed 2026-09-24 and contains package version 1.5.0; QuestarrNG currently tracks upstream main commit `6f31f2999d6b6e029eca557551039526f89615d0`. The project has a versioned integration API, API documentation, and integration tests. | **Maintain QuestarrNG as a separate service and extend the integration API before using it for SeerrNG requests.** Existing v1 accepts title-only requests and does not persist caller request IDs or return request-specific acquisition status/job IDs. The selected platform/OS/architecture must also be recorded and applied before SeerrNG can claim a variant-specific acquisition. The fork remains separate under GPL-3.0-only. [v1.4.2 notes](https://github.com/Doezer/Questarr/releases/tag/v1.4.2) · [recent upstream activity](https://github.com/Doezer/Questarr/commits/main) · [API docs](https://github.com/Doezer/Questarr/blob/main/docs/API.md) · [integration routes](https://github.com/Doezer/Questarr/blob/main/server/routes/integration.ts) · [fork](https://github.com/snapetech/QuestarrNG) |
| [Gamarr](https://github.com/JeremiahM37/gamarr) | MIT. Latest release v1.3.0 was published 2026-08-05; commits continued through 2026-09-25. The project documents an OpenAPI 3.1 API and reports 43 automated end-to-end tests. | **Do not use its request workflow as-is for production. Keep it as the MIT-licensed fork fallback.** The code has request create/list/search/download routes, but those routes are absent from the published OpenAPI document. A request row does not persist the download job ID, and request completion is watched by an in-process goroutine. A fork would need a versioned external contract, idempotency, persisted request-to-job correlation, restart recovery, and dependable status/import reconciliation. [v1.3.0 notes](https://github.com/JeremiahM37/gamarr/releases/tag/v1.3.0) · [recent activity](https://github.com/JeremiahM37/gamarr/commits/main) · [request handlers](https://github.com/JeremiahM37/gamarr/blob/main/internal/api/requests.go) · [OpenAPI document](https://github.com/JeremiahM37/gamarr/blob/main/internal/api/openapi.json) · [request model](https://github.com/JeremiahM37/gamarr/blob/main/internal/models/request.go) |

### What each backend would handle

| SeerrNG area | Preferred route | Fallback and boundary |
| --- | --- | --- |
| Retro Emulation | ROMarr for platforms it supports. It can search through Prowlarr/indexers, dispatch to download clients, validate imports, and target RomM, Gaseous, Retrom, Gameyfin, or a platform-organized folder. | Keep library services as destinations, not acquisition managers. |
| Modern Emulation | ROMarr wherever the exact system and file format are supported. Its documented matrix spans 58 systems, including newer consoles; validate the exact matrix at implementation time. | Use Gamarr only for a demonstrated coverage gap, and then only through the planned fork/adaptation work. Do not route based on an undefined “modern” label. |
| Native PC games | QuestarrNG, after its versioned integration API carries SeerrNG request identity and the target variant and exposes durable job state. It retains Questarr's discovery, Prowlarr/Torznab and Newznab, downloader, and post-processing support. | Gamarr is a fallback if QuestarrNG cannot cover a required platform or source and a GamarrNG fork passes the recovery and API gates. |
| Store-account games | Store-specific connector only when that store is explicitly included in the product matrix. itch.io's butlerd is an official, documented per-store JSON-RPC service with queued tasks, progress, and cancellation. | This does not provide a general game-store API. Steam catalog IDs do not grant download entitlement; Valve's Steamworks API requires a running Steam client and a license for the app. Treat store download as a separate, account-authorized provider. [butlerd](https://itch.io/docs/butler/launcher-integration.html) · [Steamworks API overview](https://partner.steamgames.com/doc/sdk/api) |

## Required provider adaptation

### ROMarr: integrate through a pinned adapter

ROMarr documents request submission, release search, queue, history, health, and webhook endpoints. Its v0.9.0 queue is persisted across restarts, addressing an earlier loss of request-to-download association. The first integration should call the supported API and normalize its queue/history into SeerrNG's local job record.

The spike must confirm duplicate submission handling, stable correlation from SeerrNG request to ROMarr request and download, authentication, cancellation, failed-download retry, import results, and state recovery after both systems restart. Do not use its `latest` container tag as a production pin. [ROMarr API and v0.9.0 release](https://github.com/BlizzHacker/romarr/releases/tag/v0.9.0)

### QuestarrNG: add a durable, versioned machine contract

Questarr's API v1 integration endpoints are deliberately limited to ping, library read/sync, and `POST /api/integration/games/request`. The request is title-based and hands off to Questarr's own auto-search pipeline. Its API key is intended for machine integrations, and the API version is explicitly tracked.

For SeerrNG's full request experience, extend that contract with:

- A caller-supplied SeerrNG request ID and deduplication on repeat dispatch.
- Stable catalog identifiers and the selected platform/OS/architecture variant.
- A returned backend request ID and acquisition job ID.
- A read endpoint or callback with searching, downloading, importing, failed, cancelled, and available states plus progress where supported.
- Cancel/retry operations tied to the same request.
- A clear signal that import/library registration is complete, rather than only that a request was accepted.

The fork was created from active upstream main at `6f31f2999d6b6e029eca557551039526f89615d0` (package version 1.5.0; latest tagged release v1.4.2). Keep the QuestarrNG application separate from SeerrNG and comply with its GPL-3.0-only terms. Do not copy its code into SeerrNG. The fork README and API docs must identify the upstream, explain the SeerrNG request/job contract, and link to the main SeerrNG repository. [Questarr integration API](https://github.com/Doezer/Questarr/blob/main/docs/API.md#integration-api-external-clients) · [upstream release history](https://github.com/Doezer/Questarr/releases) · [QuestarrNG](https://github.com/snapetech/QuestarrNG)

### Gamarr: fork only if it fills a proven platform gap

Gamarr has useful PC and console coverage and existing request, search, download, retry, and library code. Before using it as a SeerrNG provider, a fork must:

1. Add request endpoints and schemas to its OpenAPI document, with a versioned external API contract.
2. Persist an external request ID and the associated download job ID; make enqueue idempotent.
3. Reconcile active requests and download jobs after restart instead of relying on the original in-process watcher.
4. Expose status/progress and cancel/retry operations to external callers.
5. Distinguish download completion from successful import/library availability.
6. Keep API authentication enabled and cover the external contract with integration tests.

Its MIT license makes a separate fork technically straightforward, but ongoing fork maintenance remains an operational cost. Prefer Questarr unless Gamarr is needed for a specific platform or capability Questarr cannot supply.

## Fork naming and documentation policy

If an upstream project will not accept a required change and SeerrNG decides to maintain a fork, use the upstream application name with `NG` appended (for example, `QuestarrNG`, `GamarrNG`, or `ROMarrNG`). Keep the fork as a separate project and preserve the upstream license and attribution requirements.

The fork's README and user/developer documentation must identify the upstream project, state the specific SeerrNG capability the fork exists to provide, describe the maintained changes, and link both to the upstream project and to the main [SeerrNG repository](https://github.com/snapetech/seerrng). Keep those documents current with the fork's behavior and release changes. Apply this naming and documentation rule to every fork created for this plan; do not fork or rename a backend merely as a precaution.

## SeerrNG architecture

Keep SeerrNG as the only user-facing catalog, request, and approval flow. Users should not need to submit the same request to ROMarr, Questarr, or Gamarr.

Add a separate software request domain rather than extending media entities. The current media model requires TMDb identity and carries media-specific fields such as seasons, 4K, and book format. Reuse the existing request policies and reliability patterns: approval and quota checks, the durable `RequestDispatchOutbox`, request history, and lifecycle presentation. Relevant code includes `server/entity/Media.ts`, `server/entity/MediaRequest.ts`, `server/lib/requestStatus.ts`, `server/entity/RequestDispatchOutbox.ts`, and `server/lib/MediaRequestSubscriber.ts`.

Separate these responsibilities:

1. **Catalog provider** — discovers title metadata and preserves provider IDs without making one catalog's identifier mandatory.
2. **Variant resolver** — captures exact platform/system, OS, architecture, version/build, edition, region/language, and file/package format as applicable. The approved variant must not change if catalog metadata later changes.
3. **Acquisition provider** — offers configuration health, idempotent enqueue, job readback, cancellation/retry when supported, and a webhook or polling contract.
4. **Library adapter** — confirms import and availability in the selected folder/library destination.

Record external provider request/job IDs and source/verification metadata. Mark a SeerrNG request available only after the result is imported or registered. Keep external credentials and temporary download URLs on the server side. Route by the provider's declared platform and variant capabilities, not by the display category alone.

```mermaid
flowchart LR
    C[Catalog providers] --> S[SeerrNG catalog and variant]
    S --> R[Request and approval]
    R --> O[Durable dispatch outbox]
    O --> A[ROMarr or QuestarrNG, GamarrNG fallback]
    A --> D[Download job and files]
    D --> L[Import and verify]
    L --> I[Library adapter]
    I --> U[Available in SeerrNG]
```

## Phased plan

### 0. Lock the supported matrix

- Define which systems are Retro and which are Modern; use an explicit system list.
- Decide whether each system's scope includes game files only or also firmware, updates, and DLC.
- Specify whether game variants target Windows, Linux, macOS, console system, architecture, edition, and/or region.
- Decide whether store-account downloads are included initially or remain an optional later Games provider.
- Select the first shared library destination and define what confirms availability.

### 1. Integrate ROMarr as the first provider

Use pinned v0.9.0 for a disposable integration spike. Test one Retro system and one system from the agreed Modern matrix. Keep the SeerrNG request UI and approval policy authoritative.

**Exit gate:** repeated dispatch cannot create duplicate provider work; the local request remains correlated to its provider job across restarts; SeerrNG can show search/download/import outcomes; and “available” follows library confirmation.

### 2. Extend QuestarrNG for Games — in progress

QuestarrNG is created from actively maintained upstream main. Add an idempotent external request contract with durable correlation to Questarr's game and download records, selected target metadata, request status readback, and supported cancel/retry operations. Keep the fork's README and API documentation current with the NG branding and SeerrNG purpose.

**Exit gate:** SeerrNG can request a specific game variant, reconcile the provider job after restart, and report truthful progress and availability without adopting Questarr's UI or request database as SeerrNG's source of truth.

### 3. Evaluate Gamarr only for uncovered systems

Compare the supported console/platform matrix with ROMarr and QuestarrNG. If Gamarr uniquely covers a required system or source, create a time-boxed GamarrNG fork implementing the six API/recovery requirements above. If no external project can supply that category reliably, build only the missing acquisition worker/provider for that target.

**Exit gate:** adopt the fork only if it has a documented/versioned API, authenticated and idempotent requests, durable restart recovery, and successful import reconciliation.

### 4. Implement and expand the SeerrNG domain

After the first backend passes, implement one vertical slice using a dedicated software request/job model and the provider boundary above. Add further systems and providers through the same contract. Pin backend versions and schedule routine compatibility/security reviews; do not follow floating `latest` tags.

### Current implementation record

- Work is on the `feature/software-acquisition` branch, based on the current SeerrNG `origin/main`.
- The plan update has been carried onto that branch before implementation.
- `snapetech/QuestarrNG` has been created as a separate fork of `Doezer/Questarr` for durable SeerrNG request/job correlation and variant-aware acquisition metadata.
- ROMarr remains an upstream integration target; no ROMarr fork is planned unless a required capability cannot be adapted at the SeerrNG provider boundary.
- General desktop applications remain a future wishlist item.

## Acceptance criteria

- A request preserves its exact title and selected system/OS/architecture variant.
- Dispatch is idempotent, durable, and recoverable across SeerrNG and provider restarts.
- The user can distinguish searching, downloading, importing/verifying, available, failed, and cancelled.
- The SeerrNG request maps to a provider request/job and resulting library entry.
- Cancellation/retry reflects the actual provider capability.
- A request becomes available only after file import/library confirmation.
- Backend credentials and download URLs are not exposed to the browser.
- No UI or backend work launches or plays games or configures emulation/compatibility runtimes.

## Future wishlist: general applications

General-purpose app catalog and acquisition for Windows, Linux, and macOS remains deferred. Revisit platform package managers and store adapters only when that wishlist item is brought back into scope.

## Open decisions

1. What exact systems are included in Modern Emulation?
2. Are native games requested by title only, or must the requester choose OS and architecture before approval?
3. Is a Steam/itch.io account-backed acquisition provider required in the first Games release?
4. Should acquired files land in one shared library or a user-specific destination?

## Sources reviewed

- [ROMarr project](https://github.com/BlizzHacker/romarr), [v0.9.0 release](https://github.com/BlizzHacker/romarr/releases/tag/v0.9.0), [API description/tests](https://github.com/BlizzHacker/romarr/blob/main/romarr/openapi.py)
- [Questarr project](https://github.com/Doezer/Questarr), [v1.4.2 release](https://github.com/Doezer/Questarr/releases/tag/v1.4.2), [activity](https://github.com/Doezer/Questarr/commits/main), [API docs](https://github.com/Doezer/Questarr/blob/main/docs/API.md), [integration tests](https://github.com/Doezer/Questarr/blob/main/server/__tests__/integration_api.test.ts)
- [Gamarr project](https://github.com/JeremiahM37/gamarr), [v1.3.0 release](https://github.com/JeremiahM37/gamarr/releases/tag/v1.3.0), [activity](https://github.com/JeremiahM37/gamarr/commits/main), [request handlers](https://github.com/JeremiahM37/gamarr/blob/main/internal/api/requests.go), [OpenAPI document](https://github.com/JeremiahM37/gamarr/blob/main/internal/api/openapi.json), [request model](https://github.com/JeremiahM37/gamarr/blob/main/internal/models/request.go)
- [itch.io butlerd integration](https://itch.io/docs/butler/launcher-integration.html) and [Steamworks API overview](https://partner.steamgames.com/doc/sdk/api)
