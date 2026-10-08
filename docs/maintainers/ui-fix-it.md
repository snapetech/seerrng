# UI Fix-It

Use [UI Style Standard](ui-style-standard.md) as the target contract. This file is the generic audit and repair workflow: it detects asset-role drift, corrects established rules, and raises unapproved choices. Do not copy the full standard here, merge the two documents, or turn this file into a list of exact labels and examples.

## 1. Establish authority and scope

1. Follow the project's startup, repository, development and release policies. Identify the source actually serving the approved target. Read back that authoritative source before editing; a nearby checkout or old staging snapshot is not authority.
2. Confirm the requested page/assets and whether the request authorizes diagnosis, implementation, publication, provider mutations or only a visual prototype. Persistence does not broaden authority. Preserve dirty work and coordinate shared-file ownership.
3. Read the current standard and task-specific records. Distinguish latest accepted decisions from superseded trials and upstream rules. If they conflict, gather the relevant source and acceptance evidence and ask; do not silently choose a new standard.
4. Keep a bounded audit manifest: entry component, rendered dependencies, active normal/conditional branches, shared owners, deferred roles and validation needed. Expand only when a rendered dependency or ownership relationship requires it.
5. Separate source cleanup from design changes. An established missing owner can be repaired automatically; a new size, palette, position, behavior or asset family needs discussion. Report uncertainty as a numbered issue with the role, evidence, effect and proposed options.
6. Keep review-batch scope separate from preservation scope. A Series-first audit must still retain previously accepted Request-page and shared heading/status/button/poster changes. Inventory those owners and their existing checks rather than rerunning an unrelated whole-app or backend investigation.

## 2. Inventory by asset role

1. Classify page identity, heading containers, aggregate status, main/inset/compact cards, copy, tables, posters, actions, filters/selects, dropdowns, messages, overlays, selection/tree, ratings, and native saved/reorder interactions.
2. Inspect imports and rendered shared components, not only the page's literal `className`. Include aliases, template strings, conditional branches, helper-produced classes, component class props, transition props, inline styles, CSS modules, CSS-in-JS and responsive states.
   Classify actual rendered variants before repairing an imported dependency. A hidden shared summary or another media type's branch is not an active consumer. Track those separately rather than widening the batch or declaring the complete shared component migrated.
3. Trace headings and titles through their typography roles and active translations/generated helpers. Detect Title Case and punctuation drift by role. Do not create checks keyed to exact example titles, badges, message strings or media names.
4. Search Tailwind use in JSX and styles, including `@apply`, utility aliases, generated `--tw-*` machinery and nested state/media rules. A zero literal-utility count in one component is not a completed dependency audit or native-CSS conversion.
5. Map each observed presentation property to its existing shared owner. Include typography, dimensions, padding/gap/margins, alignment, ratio/crop, border/surface, icon geometry, state effects, transitions, scrollbars and breakpoints.
6. Distinguish external/native classes and meaningful data geometry from presentation utilities. Country flags, provider branding, portrait/mosaic arrangements, runtime pointer bounds and native identifiers are not automatically removable because their names look unfamiliar.
7. Follow source/generated reference relationships and active palette/mode variants. Preserve opt-in reference pages; do not audit a generated preview as if it were the only source or silently adopt its experimental style.
8. Include loading placeholders in the asset inventory. Trace both whole-section loading and per-item lazy/partial metadata branches to the card family they replace. Compare them with established loaded examples at the family's breakpoints; do not assume a shared placeholder component selects the correct variant in every caller.

## 3. Find ownership and layout regressions

1. Inspect the complete cascade: root variables, variants, grouped selectors, specificity, inheritance, pseudo-states, responsive rules and compiled output. Identify missing role attachment before deleting a local override.
   Verify that every custom property consumed by a migrated owner has an authored definition or documented runtime source. Framework palette names are not automatically CSS variables; undefined references can silently erase borders and surfaces while source class checks pass.
2. Check that controls have both appearance and a size owner. Raw `app-button` is insufficient. Reuse standard action/filter/poster/form roles; do not restore a local icon rule or create a class per button. Check action-state branches for an explicit appropriate palette and an icon that describes the offered action, not the opposite state. Use general color variants rather than borrowing an unrelated provider class. Trace single-option and multi-option branches separately; deleting a local SVG utility is unsafe until the actual branch consumes the shared size owner. Add negative coverage for missing ownership and competing local dimensions.
3. Detect duplicated CSS and Tailwind property ownership. If the correct shared class already supplies a property, remove the competing declaration; do not copy it into another owner. Trace shorthand/longhand and inherited variables before deciding it is redundant.
   A semantic shell does not prove its children or state variants are migrated. Inspect value/option descendants and CSS-generated utilities as well as the root. Move truncation and selection emphasis into the existing family and consume semantic state; preserve portal positioning, disabled behavior and keyboard focus. When retiring generated state variables, trace every theme/variant consumer and reconnect it to the authored state owner instead of dropping its palette feedback.
   Distinguish framed and standalone consumers of a shared surface. An established frame owns border and corner geometry; retain standalone legacy geometry through a low-specificity fallback that excludes framed consumers, rather than duplicating frame properties in the surface role. Compare effective rendered properties before and after migration; generated zero-shadow layers and unused border-color serialization are not visible geometry changes. Verify focused child controls and their parent state together, including higher-specificity palette variants.
   For action menus, trace the shared opaque surface, clipping ancestors and complete stacking-context chain, including decorative pseudo-element frames. Verify a menu crossing the card edge, not only its own background or z-index; preserve ordinary closed-card clipping. Report an unapproved viewport preset instead of inventing one.
4. Check page spacing as a boundary: search/header padding and offset, page margins, title/heading container padding, line height, card spacing and the next content edge. Reject compensating spacer nodes and offsets. Separate card-to-card or card-internal gaps from heading-to-content boundaries before replacing a grouped gap rule; those roles can consume different established owners. Remove superseded padding at every responsive breakpoint once the shared surface supplies it, without changing unrelated typography or poster geometry.
5. Check typography together with its layout owner. Table headings/values must share the table family while independent table-layout variables prevent changes to one table type from breaking another. Compact cards remain fixed-size, not item-dependent.
6. Check shelf headings and actions are actual shared-row children with baseline alignment. Check global poster dimensions/ratio and semantic region placement in all in-scope media renderers; distinguish compact credit/detail posters before migrating.
7. Check fixed headers/frames against rows-only scrolling, shared tracks, gutters and dividers. Check selection glyph visible diameter, not just equal SVG boxes. Preserve separate availability, watched and selected semantics. When reusing a selector for another action, retain its existing submission, quota and destination rules; verify action-specific eligibility independently of library availability, exact payload identity, clear/all/disclosure behavior and metadata failure/retry without losing selections. When replacing non-native controls with native buttons, reset browser defaults through the existing CSS owner and check focus, geometry and one activation per click/key.
8. Check overlays and dropdowns for duplicate surfaces, backdrop/animation owners, clipping and reduced-motion behavior. A transition migration must preserve interaction, not merely remove utility tokens.
9. Check each message's actual source and meaning, content-fit geometry, severity, title/body ownership, real recovery callback and cached-content behavior. Exercise long feedback in content-sized flex/grid regions: it must wrap below its control without determining sidebar width, crushing adjacent content or creating duplicate gap/margin ownership. A blank successful list is not automatically an error.
10. Check one aggregate page status covers actual fetch/search/panel/mutation activity and clears idle/unmounted contributions. Do not add inner spinners or move searching back to the global search input.
11. Check decorative masked frames separately from body surfaces, mode-independent artwork readability and actual control geometry through focus/selection. Native-select operating-system limits must be reported rather than disguised as a verified CSS theme.
12. Compare loading and loaded geometry through their actual shared CSS owner, including computed width, baseline height, box sizing and responsive variables. Detect copied skeleton dimensions, missing variants and competing utility/inline sizing. Reuse the existing family layout and keep loading paint separate; preserve content-driven growth and error recovery. A matching screenshot at one breakpoint is not proof of shared ownership.

Compare reused cards in their original and new contexts at the user's actual
CSS viewport, including display scaling. Check both sides of layout breakpoints;
a larger review viewport does not prove the user's arrangement. Preserve
established proportional card sizing, allocate the remainder after the shared
gap to companion content, and consume standard padding rather than a fixed-width
sidebar or copied geometry. For aligned adjacent cards, stretch the companion
layout and let its card consume the remaining height after controls and shared
gaps; do not copy the primary card's height into another sizing owner. Preserve
natural wrapping for longer or translated copy rather than clipping it.

## 4. Apply established repairs

1. Prefer the smallest role attachment/removal that restores an approved owner. Reuse existing semantic variables and variants; preserve data, actions, permissions, links, click targets and component APIs.
2. Convert scoped utility-owned styling into authored native CSS at its semantic owner. Do not paste compiled Tailwind output, retain redundant `--tw-*` state, or rename individual utilities into semantic-looking aliases. Keep one state/transition owner and reconcile downstream focus palette consumers deliberately.
3. If the current shared owner is incomplete, propose a narrowly reusable extension. Explain which roles need it, the existing property owner and how duplication will be avoided. Stop before inventing a new design value or page-specific exception.
4. For an approved global migration, update all in-scope consumers, CSS variables/selectors, imports, tests and current guidance together. Remove a retired owner only after active consumers are gone. Do not rewrite historical journal entries.
5. Keep action arrangement layout-dependent. Preserve approved row/order choices while migrating appearance; do not impose a retired universal playback/ratings/quality layout rule.
6. Keep experimental design variants opt-in and clearly classified in records. Use the documented site standard unless the maintainer explicitly adopts a variant as part of the task. Review fixtures preserve the actual shared production components and interactions without live data writes.
7. Do not make undisclosed behavior changes as a styling repair. New filters, matching rules, permission changes, provider actions, saved memberships and source semantics require their own explicit authority and tests.

## 5. Verify interactions and truthfulness

1. Exercise role/state combinations with isolated fixtures or mocks: enabled, disabled, hover, active, focus, busy, empty, failed, cached refresh, partial data and relevant breakpoints. Verify user-facing controls are visually functional where the review asks for them.
   Use dedicated ordinary inspection tabs, leave the work owner's existing tabs untouched, and close temporary inspection tabs afterward. Verify preview origin/source and media-specific optional controls before diagnosing a screenshot or wrapped row.
2. Preserve accessibility: names, descriptive help, disabled-tooltip access, keyboard behavior, native semantics and reduced motion. Detect nested buttons, double selection, event propagation into posters and invisible-but-interactive panels.
   When consolidating segmented actions into a single screen-entry control,
   verify that the whole control opens the intended screen, permission/service
   eligibility is preserved, and navigation does not perform an approval or
   submission. Keep format choice inside the destination through its existing
   controls, and test unmodified consumers of the shared component separately.
3. Verify ratings retain persistent provider slots and exact unknown placeholders, valid zero and cached-known values; reject fabricated/out-of-range data and unsafe or media-incorrect links.
4. Native saved actions must prove own-user/token provenance, strict inputs, selected-quality trusted root, verified provider authority, sanitized errors and confirmed membership. Collections/Favorites/Watchlist are not interchangeable labels. No real provider/account mutation is allowed merely to verify a visual cleanup.
5. Client tests prove inactive prototypes mount no native hooks and busy/unavailable controls cannot mutate; authorized state reads may continue while a loading control is disabled. Cover identity/provider/title/quality cache separation, fresh preflight, double-click protection, stale-response rejection, failure reset, confirmed-only state and GET-only recovery. Check actual fetcher and middleware contracts rather than adding unsupported query parameters or assuming raw query types reach the route unchanged.
   Trace mutable membership through client request freshness, API cache policy and service-worker interception. Cover Add and Remove, confirmed readback and fresh already-completed actions; a cached no-op is not provider verification. Keep live authorization and live evidence distinct from mocked coverage.
6. Reorder tests cover quick-click versus one-second hold, cursor-following inert ghost, draft versus committed order, valid release, outside/Escape/blur/cancel/capture-loss rollback, stable panels, keyboard/reduced motion, save failure and identity changes. Mocked tests do not prove physical drag feel or touch support.
   Register new disclosure roles in the shared saved-order and scoped pin
   contracts, not only their visible controls. Verify default insertion preserves
   the relative order of older roles, explicit saved placement wins, each panel
   follows committed order, and hidden/embedded consumers remain valid. Moving
   content between disclosures must preserve its links, attribution and single
   ownership. Distributed rows use the existing layout owner with wrapping and
   standard minimum gaps; they must not change control geometry.
   For saved disclosure controls, test pin-to-expand and unpin-to-collapse separately from manual heading toggles. Capture previous/next state transitions before queueing React state updates; do not compare an advancing mutable ref inside a deferred updater. Cover delayed saved-state arrival, independent sections and optimistic rollback with isolated fixtures. Keep a staged rollout within the scope the maintainer authorized and complete its applicable automated checks; do not wait for separate human sign-off when the maintainer directs rollout.

## 6. Run the shared gate efficiently

Before the expensive cumulative run, establish a complete pinned repository tree
and the prerequisites required by its current test inventory. A runtime app
volume may omit workflow/release/dotfile fixtures even though the app runs.
Check the snapshot manifest against those inputs; do not reconstruct missing
files from a different release or guessed ancestry. Linux platform selection is
not proof that Bash/Git/Python, CLI tools or GNU filesystem options are installed.
Use a suitable disposable toolchain and record its versions. Plan discovery
does not certify these external prerequisites. Missing inputs block finalization,
not permission to skip suites, change CI or install tools into the live preview.

1. Read `tools/validation-engine/README.md` and follow the applicable mode exactly. Regenerate and review the selected source's test inventory, expected cases, ownership, dependency closure, source/dependency/runtime hashes and invocation packets. During repairs, run affected focused checks and label preview evidence as iterative. Run the engine on the exact final candidate and the integrated tree after conflicts. Keep mutable config/database fixtures in disposable scratch storage; preserve provider/network guards and global-state barriers. Queue failures for reviewed diagnosis and repair, then rerun failed checks and their affected dependency closure. A successful complete applicable engine mode owns every required stage and suite in that candidate's verified plan and live inventory; do not repeat unchanged stages. `--tests-only` is partial and cannot certify finalization. Retain discovery and executed results separately, including counts/skips/platform exclusions; Linux is required for full POSIX tooling parity.
2. Run focused source/AST checks, effective CSS checks and behavioral tests for changed owners and affected consumers. Reuse existing focused tests instead of building a second verifier architecture or performing an unrelated whole-site audit.
3. Assertions target roles, relationships and actual behavior. Parse CSS correctly across grouped/nested rules; do not use stale utility-name assertions, naive first-brace extraction, or exact text examples as proof of styling.
4. Run proportional lint/type and focused checks for changed source types/style owners during iteration. Use the complete applicable engine gate for finalization rather than adding a second compile or browser sequence. Check service health only after authorized publication. Compile/type/HTTP success does not establish visual inspection evidence or a successful provider round trip.
5. Diagnose a failing check. Repair actual behavior or update a genuinely superseded assertion with equivalent coverage and acceptance evidence. Never weaken or delete a live behavior check merely to obtain a passing count.
6. Avoid repeated full builds, rerunning unchanged suites, broad source copies and serial work that can safely be batched. Keep one authoritative readback, one owned edit batch, focused checks and a final cumulative verification. Communicate shared-file barriers and completion promptly.
7. If scope, safety, source identity or gate coverage is unresolved, fail closed: do not finalize or claim completion. Record unrelated baseline failures. If the user authorized broader remediation or completion of the required gate, repair failures that block that scope without asking again; otherwise keep unrelated backend repairs out of the change. Deferral never converts a failed required gate into a pass.

## 7. Record, report and evolve

1. Update the task's identified journal or evidence ledger, when one is routed, for every change in the same work unit. Record role/owner, exact files, old/new known values, authoritative source identity, publication target/archive, checks, remaining limitations and available visual evidence. A checkpoint or this file is not a substitute.
2. Retain rollback archives and ownership-uncertain assets. Do not infer old staging, idle previews or comparison sources are disposable. Keep credential-containing recovery material out of repository/document content.
3. Report outcomes in a numbered list: fixed established drift, verified scope, visual inspection evidence, unresolved choices, explicit deferrals and remaining checks. Say whether code is staged, published, functional or static; do not conflate these states.
4. Keep coverage honest. Count and list remaining active utilities/owners by role and branch, including dynamic/untraced cases. Never report the page or site Tailwind-free while deferred dependencies or active scoped `@apply` remain.
5. When a new rule is accepted, add the reusable subject/asset rule to the standard and detection/repair method here. Keep exact examples and chronology in the journal, not in normative matching logic.
   For every repair, consider whether it exposes a reusable detection or ownership gap. Improve the relevant method rather than adding a class/text-specific exception or copying an isolated example's values into a new rule. Existing accepted components illustrate the standard; their CSS owners and variables remain the contract, and tests should enforce relationships and behavior rather than example labels.
6. Before marking complete, verify the requested scope is implemented, source readback matches the authorized target, all required automated and functional gates passed, and records are current. Report any visual inspection or live provider evidence that remains unavailable; do not turn it into a human approval gate when the maintainer explicitly directs the work to proceed.
