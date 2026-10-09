# Sportarr–IPTV Tunerr Sports DVR Integration

## Objective

Let an administrator optionally connect IPTV Tunerr's generated sports
playlist and guide to Sportarr. Once Sportarr has those feeds, its existing
channel mapping, event monitoring, and DVR scheduling can use Tunerr's matched
live sports channels. SeerrNG continues to work with either service on its own.

This is a SeerrNG integration. It does not change Sportarr or Tunerr's runtime,
and it does not make either service a dependency of the other.

## Current capabilities and ownership

| Service | Owns | Existing SeerrNG path |
| --- | --- | --- |
| IPTV Tunerr | Provider lineup, XMLTV, sports schedules/matches, generated event M3U/XMLTV feeds, and its rule-based recorder | Live TV guide requests, recordings, and followed teams |
| Sportarr | Sports league monitoring, channel-to-league mapping, its DVR, download/search acquisition, and event files | League discovery/requests and monitored event/file status |
| SeerrNG | Optional connector configuration, request permissions/approval, and the setup/status UI | Discover → Sports and Settings → Services |

The providers do not share a stable event identifier. The integration must not
join Tunerr and Sportarr events by guessed IDs or title/time fuzzy matching.
Sportarr consumes Tunerr's event-specific M3U/XMLTV feed and resolves those
channels using its own channel and event contracts.

## Optionality matrix

| Configuration | User experience |
| --- | --- |
| Neither service | No integration panel or hard dependency; existing SeerrNG features remain available. |
| Tunerr only | SeerrNG Live TV requests and followed-team recordings continue to use Tunerr. |
| Sportarr only | Sports league search, requests, downloads, and event status continue to use Sportarr. |
| Both, not linked | Both existing paths work independently. An administrator sees the optional setup action. |
| Both, linked | Tunerr event feeds are available to Sportarr's channel mapper and DVR in addition to the independent SeerrNG request paths. |

## Admin flow

1. Configure and test Tunerr and Sportarr using their existing Settings →
   Services forms. A default Sportarr instance is required because that is the
   instance SeerrNG uses for sports discovery and requests.
2. Set **Tunerr URL reachable from Sportarr** when the hostname/port used by
   SeerrNG is not reachable from the Sportarr host/container. The blank value
   derives the tuner address from Tunerr's existing hostname, HTTPS, and tuner
   port settings.
3. Select **Connect sports feeds**. This is the only operation that writes to
   Sportarr; saving general Tunerr settings never changes Sportarr.
4. SeerrNG asks Sportarr to test the M3U URL before creating a source. It then
   creates or reuses a Tunerr M3U source, creates or reuses an XMLTV source
   linked to that M3U source, and runs the XMLTV sync. Exact URL matches make
   retries idempotent.
5. The status panel reports the imported channel/program counts and any
   partial setup. If the M3U source was added but XMLTV setup failed, the
   source is preserved and a retry reuses it. SeerrNG does not silently delete
   external Sportarr configuration.
6. The administrator reviews Tunerr channels in Sportarr, maps the applicable
   channels to leagues, and enables Sportarr's automatic DVR behavior for the
   leagues they want recorded. Monitoring/requesting a league remains the
   existing SeerrNG/Sportarr flow.

Feed URLs must be plain HTTP(S) addresses without embedded credentials, query
strings, or fragments. SeerrNG stores only the optional base URL, not Tunerr or
Sportarr API credentials in the generated feed URL. Sportarr and Tunerr must
be able to reach one another on the configured network.

## UI hierarchy and states

- Add an **Optional Sportarr DVR link** section within Settings → Services →
  Live TV (IPTV Tunerr). Explain the extra behavior in one sentence, show the
  derived URL, provide the network override, and place the explicit connect
  button next to the setup status.
- Keep setup instructions visible after linking: review channels, map them to
  leagues, and enable Sportarr automatic DVR. Do not imply that adding feeds
  automatically makes an unmapped channel recordable.
- Surface separate states for services not configured, Tunerr sports
  automation unavailable/disabled, feeds not linked, feeds linked and
  syncing, linked/ready, partial setup, and provider/API errors.
- Keep existing Tunerr recording controls and Sportarr discovery usable if the
  other service is absent or offline. A failed optional link must not turn
  either existing service into an error state.
- Update the Sports discovery description and operator/user documentation so
  people can distinguish SeerrNG's Tunerr recording requests from Sportarr's
  own DVR path.
- Use existing shared semantic styles and controls; no new visual style family.

## API and data design

- Add a server-side Sportarr adapter for the documented native endpoints:
  `GET/POST /api/iptv/sources`, `POST /api/iptv/sources/test`,
  `GET/POST /api/epg/sources`, and `POST /api/epg/sources/{id}/sync`.
- Use Tunerr's `/sports/live.m3u` and `/sports/guide.xml` endpoints. The
  operator-configurable base address is specifically the address as seen from
  Sportarr; it may differ from SeerrNG's deck URL or an externally served
  guide URL.
- Add an admin-only status endpoint that returns only connection state and
  bounded source/guide details. Never return API keys, passwords, or full feed
  URLs to the browser.
- Add an admin-only connect endpoint. Test the M3U from Sportarr before
  mutation; reuse exact existing feeds; never update, activate, or delete an
  unrelated existing Sportarr source. A conflicting existing guide is surfaced
  with a repair instruction instead of being rewritten.
- Guard writes with the existing Sportarr service-admission mechanism so the
  selected service's credentials/configuration cannot change mid-operation.
- No database schema change is needed. The Tunerr-to-Sportarr URL override is
  a non-secret optional settings value with a default for existing installs.
- Keep direct SeerrNG Live TV recording requests separate from Sportarr DVR
  recordings. This feature does not bypass SeerrNG's approval rules or create
  speculative cross-provider event associations.

## Failure behavior and recovery

- Missing Tunerr, Sportarr, or Tunerr sports automation leaves existing
  standalone features intact and displays the precise missing setup step.
- A Sportarr M3U test failure creates no source.
- If the M3U source succeeds but EPG creation or sync fails, report that the
  playlist source remains in Sportarr and allow a retry to continue from the
  existing URL match.
- If a matching XMLTV source is already attached to another source or is
  standalone, do not silently move it; give the administrator a direct repair
  instruction.
- If Sportarr is temporarily unavailable, status is retryable and no local
  source state is cached as truth.
- A successful feed import is not evidence that any channel has been mapped or
  that a real recording completed. Those remain visible in Sportarr.

## Validation and completion criteria

- Contract fixtures cover valid, malformed, oversized, and transport-error
  responses for the M3U/EPG source endpoints; verify API-key headers and exact
  request bodies.
- Route coverage checks admin-only status/setup actions and the
  neither-service-configured response. Integration-flow fixtures cover exact
  retry reuse, conflicting existing guides, failed M3U tests, and partial
  XMLTV recovery with a fake Sportarr API.
- Settings parser coverage checks safe HTTP(S) base URL handling and backward
  compatibility when older settings files omit the field.
- UI checks cover the optional/offline/partial/ready states, accessible status
  announcements, and permission-appropriate controls at desktop and narrow
  widths.
- Build and repository validation run on the exact pushed candidate. Do not
  claim a real Sportarr/Tunerr round-trip or recording unless performed against
  disposable live services.

The feature is complete when an administrator can explicitly connect the two
feeds, a retry does not create duplicates, Sportarr displays Tunerr's sports
channels and guide data, and the standalone SeerrNG Sportarr and Tunerr paths
still work independently.

## References

- [Tunerr Sports Automation guide](https://github.com/snapetech/iptvtunerr/blob/main/docs/how-to/sports-automation.md)
- [Sportarr IPTV DVR guide](https://wiki.sportarr.net/features/iptv-dvr/)
- [Sportarr native API](https://wiki.sportarr.net/api/)
