# Fastest-Source Routing: Design (Phase 5)

Status: **proposal, awaiting maintainer approval.** No code exists for this
phase. It builds on Phases 1–3 of
[ng-ecosystem-integration-plan.md](./ng-ecosystem-integration-plan.md).

## Problem

An approved request goes to exactly one acquisition path today: the *arr
service chosen by the request's media type and override rules. Several faster
paths now exist but are separate actions the user must find:

- A movie or series airing on Live TV within hours (Tunerr recording).
- A single track Lidarr cannot request (slskdN wishlist).
- An ebook available from ChaptarrNG's direct download source.

Goal: when a request is approved, SeerrNG offers or uses the fastest source
that can satisfy it, without acquiring the same item twice.

## Scope

In scope for a first version:

1. **Movies and series → Live TV.** If the guide has an airing of the
   requested title within the configured window (default 12 hours) and Tunerr
   recording is set up, SeerrNG offers to record it in addition to the normal
   *arr request.
2. **Music tracks → slskdN.** Already explicit (Phase 3). Routing adds
   nothing until Lidarr track-level requests exist.

Out of scope: choosing between *arr services, Usenet versus torrent selection
(the *arr services already do this), and ebooks (ChaptarrNG's direct source is
already selected inside ChaptarrNG; SeerrNG only displays it).

## Recommendation: offer, then race — never cancel blindly

Confidence: moderate.

A recording and an *arr download produce different artefacts (a broadcast
capture with commercials versus a release file). They are not interchangeable,
so SeerrNG should not silently pick one:

1. On approval of a movie or TV request, if a matching airing exists within
   the window, the request still goes to the *arr service as today.
2. The requester sees a **Record the airing on {channel} at {time} too?**
   prompt on Request Status (and in the approval notification). Accepting
   creates a linked recording request (`RecordingRequest.mediaRequestId`).
3. Whichever finishes first marks the media request **Available (recording)**
   or **Available**. The other path continues unless the user cancels it,
   because the *arr download is usually the better copy.
4. An admin setting can make step 2 automatic per media type
   ("Always record airings within N hours"). Off by default.

Rejected alternative: cancel the *arr request when the recording completes.
This loses the higher-quality copy, and cancelling an *arr download
mid-transfer is a destructive action with its own failure modes.

## Data model changes

- `recording_request.mediaRequestId` (nullable integer, FK to `media_request`,
  `ON DELETE SET NULL`) to link a recording to the request that prompted it.
- `RecordingRequest.source = 'routing' | 'manual' | 'sports'` for reporting.
- New settings: `liveTvRouting: { enabled: boolean; windowHours: number;
  autoRecord: Record<'movie' | 'tv', boolean> }`.

## Flow

```
approve MediaRequest
  ├─ send to *arr (unchanged)
  └─ if liveTvRouting.enabled and Tunerr configured
       └─ guideIndex.findAirings(title, original title) within windowHours
            ├─ none → done
            └─ found → autoRecord[mediaType]
                  ├─ true  → createRecordingRequest(kind: airing, mediaRequestId)
                  └─ false → store an offer on the request; show the prompt
```

## Double-acquisition safety

- A linked recording never changes the *arr request.
- At most one routing recording per media request (unique index on
  `mediaRequestId` where `source = 'routing'`).
- Declining or cancelling the media request cancels a linked *pending*
  recording; a scheduled one is left for the user to cancel explicitly.

## Open questions

1. Should a completed recording mark the media item available in SeerrNG, or
   only appear under Recordings? (Availability today comes from the media
   server scan, which will pick up Tunerr's published catch-up library item
   under a different library.)
2. What window is useful: 12 hours, or "airs before the *arr service's typical
   time to download"?
3. Should the prompt appear for users who cannot request recordings?

## Verification plan

- Unit tests for the routing decision (window, settings, existing offers).
- Integration test with the fake Tunerr deck from `server/routes/liveTv.test.ts`
  plus a mocked Radarr: approval creates both, and the request reports the
  first completion.
- No live verification is possible without an IPTV subscription; record it as
  outstanding.
