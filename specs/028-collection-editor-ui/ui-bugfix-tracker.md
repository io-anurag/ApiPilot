# Collection Editor UI — Bug Fix Tracker (2026-09-22)

Personal tracker for a batch of usability issues reported against the collection/variable editor
and run panel introduced by AP-028 (`specs/028-collection-editor-ui`), reachable from the
"Import & Run Collection" tab (`frontend/src/pages/ExternalCollectionsPage.tsx`). Each item below
was reported with a screenshot; root cause and the applied fix are recorded so this doesn't need
re-diagnosing later.

| # | Issue | Status |
|---|-------|--------|
| 1 | Collection tree/editor pane has no close button | Resolved |
| 2 | Tree pane grows unbounded with many requests | Resolved |
| 3 | "Reset" link gives no feedback when clicked | Resolved |
| 4 | "Add request"/rename use native `window.prompt`/`window.confirm` | Resolved |
| 5 | Unverified-content warning re-shown on every run, not just the first | Resolved (see also #14) |
| 6 | Run summary hard to read; unlabeled statuses; unclear "Uploaded" meaning | Partially resolved |
| 7 | Per-request result detail shows everything at once, not tabbed | Resolved |
| 8 | Opening a row's "⋮" actions menu makes an unwanted scrollbar appear on the tree | Resolved |
| 9 | Save and Close buttons don't look like a matched pair | Resolved |
| 10 | Tree pane not the same height as the request/variable panel next to it | Resolved |
| 11 | No way to add a folder (only requests) | Resolved |
| 12 | Resolved-preview section not tabbed like the edit section above it | Resolved |
| 13 | A thin, arrow-only vertical scrollbar appears on tab bars (app-level and result-detail) | Resolved |
| 14 | #5's fix had a remaining gap: still re-warned when the first run also needed the risk-tier gate | Resolved |

---

## 1. No close button for the tree/editor pane

**Root cause**: `ExternalCollectionsPage.tsx` only ever hid the tree+editor `<section>` by
deselecting the collection entirely (`selectedId = undefined`), which also tore down the run
panel's request checklist. There was no lighter-weight way to just collapse the browsing/editing
view.

**First pass (superseded)**: added a page-level `editorOpen` toggle that collapsed the *entire*
tree+editor grid — still closed more than intended, since closing the currently-open request also
hid the tree a user would need to pick a different one from.

**Final fix**: removed that page-level toggle entirely. The tree (`CollectionTreeView`) is now
always visible whenever a collection is selected — it's the navigation, not something that should
ever need "closing". `RequestEditorPanel` and `VariablePanel` — "the modal that opens" on the right
when a request or Variables is selected — each got their own `onClose` prop and a "✕ Close" button
in their own top row. Clicking it only deselects (`selectedRequestId = undefined`, `mainView` reset
to `"request"`), returning the right-hand pane to its empty-selection placeholder while the tree
stays put, so a user can immediately pick something else instead of having to reopen a
collapsed section first.

**Follow-up (same session)**: the Save button (`RequestEditorPanel`'s existing top-row Save, and
`VariablePanel`'s previously bottom-of-panel "Save variables") was also moved up into that same top
row, inline with the new Close button — both panels now present Save and Close together at the
top, consistent with each other.

**Files**: `frontend/src/pages/ExternalCollectionsPage.tsx`,
`frontend/src/components/RequestEditorPanel.tsx`, `frontend/src/components/VariablePanel.tsx`.
**Tests**: `frontend/tests/unit/ExternalCollectionsPage.test.tsx` — "closes the request editor
panel (deselecting the request) without hiding the tree", "closes the variable panel (returning to
the empty-selection placeholder) via its own close button".

---

## 2. Tree pane grows infinitely with many requests

**Root cause**: `CollectionTreeView.tsx`'s root `<ul>` had no height cap, so a collection with a
large number of requests pushed the whole page to an unusable height (the run-order checklist
already had a `max-h-56 overflow-y-auto` cap; the tree never got the equivalent treatment).

**Fix**: Capped the tree at `max-h-[65vh] overflow-y-auto` so it scrolls internally instead of
growing the page.

**Files**: `frontend/src/components/CollectionTreeView.tsx`.

---

## 3. "Reset" gives no feedback

**Root cause**: `RunOrderChecklist`'s "Reset" button re-selected every request unconditionally.
When everything was already selected (the common case, e.g. right after loading a collection),
clicking it produced no visible state change at all — no error, no confirmation, nothing.

**Fix**: Disabled the button once every request is already selected, with a `title` tooltip
("Every request is already selected" / "Select every request") so the disabled state itself
communicates why nothing happens.

**Files**: `frontend/src/components/ExternalCollectionRunPanel.tsx` (`RunOrderChecklist`).

---

## 4. Native `window.prompt`/`window.confirm` for add/rename/delete

**Root cause**: `ExternalCollectionsPage.tsx`'s tree actions called `window.prompt(...)` (add
request, rename) and `window.confirm(...)` (delete) directly — unstyled native browser dialogs
that ignore the app's dark mode, focus management, and visual language entirely.

**Fix**: Added a new reusable `PromptDialog` component (single-field input, built on the existing
`Dialog` shell for focus trap/Escape/backdrop) and wired the delete confirmation through the
existing `ConfirmDialog` component instead. `onAddRequest`/`onRenameItem`/`onDeleteItem` now open
state-driven dialogs instead of calling `window.*` directly.

**Files**: `frontend/src/components/PromptDialog.tsx` (new),
`frontend/src/pages/ExternalCollectionsPage.tsx`.
**Tests**: `frontend/tests/unit/ExternalCollectionsPage.test.tsx` — "adds a new request through an
in-app dialog...", "renames an item through an in-app dialog...", "deletes an item through an
in-app confirmation dialog..." (each also asserts the corresponding `window.prompt`/
`window.confirm` spy was never called).

---

## 5. Unverified-content warning re-shown on every run

**Root cause**: This was a genuine bug, not a spec violation — the backend correctly persists
`confirmedAt` permanently on the first confirmed run (specs/026 FR-007) and never re-asks. But
`ExternalCollectionRunPanel`'s `handleRunClick` reads `confirmedAt` off the `uploadedCollection`
prop passed down from `ExternalCollectionsPage`'s own `uploadedCollections` array — and that array
was only ever populated once, on initial page load, and never updated after a successful confirm.
So for the rest of that browser session, the page's cached copy of the collection kept
`confirmedAt` unset, and every subsequent "Start run" click re-triggered the dialog client-side,
even though the backend never asked again.

**Fix**: Added an `onConfirmed` callback prop to `ExternalCollectionRunPanel`, invoked exactly
when a `performStart(true, /* confirmingUnverifiedContent */ true)` call succeeds (i.e. the
unverified-content dialog's own "Confirm and run", not the separate risk-tier gate). The page
wires this to update its own `uploadedCollections` state in place, setting `confirmedAt`, so the
next "Start run" click reads a truthy value and skips the dialog.

**Files**: `frontend/src/components/ExternalCollectionRunPanel.tsx`,
`frontend/src/pages/ExternalCollectionsPage.tsx`.
**Test**: `frontend/tests/unit/ExternalCollectionsPage.test.tsx` — "does not re-show the
unverified-content dialog on a second run after the first is confirmed" (asserts the dialog is
gone and that the second click's `/execution/start` call actually fires, proving `performStart`
ran directly instead of re-showing the dialog).

---

## 6. Run summary hard to read; unclear "Uploaded" label — partially resolved

**Root cause (label casing)**: `ExternalCollectionRunPanel.tsx` rendered several `StatusBadge`
labels straight from their raw kebab-case domain enum values (`run.status` → "completed"/
"in-progress"/"cancelled"; `failureCategory` → "assertion-failed"/"connectivity-failure"/
"timeout"; `notAttemptedReason` → "cancelled"/"dependency-not-met"/"run-ended-before-reached";
`test.outcome` → "passed"/"failed"). The sibling guided-workflow panel
(`ExecutionResultsPanel.tsx`) already solved exactly this with explicit sentence-case label maps
(`FAILURE_CATEGORY_LABEL`, `NOT_ATTEMPTED_LABEL`, `runStatusLabel`) — this panel, added later by
AP-028, never got the same treatment.

**Root cause ("Uploaded" unclear)**: The badge's plain text label has no explanation of what
distinguishes an "Uploaded" run from any other, and `StatusBadge` had no way to carry a tooltip.

**Fix applied**: Ported the same sentence-case label-map convention from `ExecutionResultsPanel`
into `ExternalCollectionRunPanel` (`RUN_STATUS_LABEL`, `FAILURE_CATEGORY_LABEL`,
`NOT_ATTEMPTED_LABEL`, and the test-outcome badge), applied everywhere a raw enum value was
previously rendered (run summary, run history, per-request result rows, per-test rows). Added an
optional `title` prop to `StatusBadge` and used it on every "Uploaded" badge to explain, on hover,
that it distinguishes this run from a guided-workflow-generated one.

**Not done**: a broader visual redesign of the summary block itself (e.g. adopting the segmented
`SummaryBreakdown` bar+legend component already used elsewhere in the app for a more scannable
passed/failed/not-attempted visualization) was not attempted — the fix here targets the two
concretely named complaints (unlabeled/inconsistent casing, unclear "Uploaded" meaning), not a
full visual overhaul of the stat row's layout. Flagged as a follow-up if a further redesign pass
is wanted.

**Files**: `frontend/src/components/ExternalCollectionRunPanel.tsx`,
`frontend/src/components/StatusBadge.tsx`.
**Test**: `frontend/tests/unit/ExternalCollectionRunPanel.test.tsx` — updated to assert the
sentence-case labels ("Assertion failed", "Cancelled") instead of the old raw enum text.

---

## 7. Per-request result detail not tabbed

**Root cause**: `ResultDetail` (the expanded row under each result in the run panel) rendered
duration/status, test outcomes, and the full raw request/response capture all at once in one long
block — unlike `RequestEditorPanel`'s own Headers/Body/Tests tabs used one screen away in the same
page.

**Fix**: Rebuilt `ResultDetail` around the shared `Tabs` component with three tabs — **Request**,
**Response**, **Tests** — showing the raw request URL/headers/body, the response headers/body, and
the named test outcomes respectively. When no raw capture exists (non-`local` tier), the Request
and Response tabs show an explanatory note instead of silently rendering nothing, matching the
equivalent guided-workflow panel's own messaging.

**Files**: `frontend/src/components/ExternalCollectionRunPanel.tsx`.
**Test**: `frontend/tests/unit/ExternalCollectionRunPanel.test.tsx` — updated to click into the
"Tests" tab before asserting a test's failure detail is visible (previously visible unconditionally
on row expansion).

---

## 8. Opening a row's "⋮" actions menu shows an unwanted scrollbar

Found by the user while reviewing the fix for #2 (a screenshot of the tree with the "auth" folder's
actions menu open, and a visible vertical scrollbar track next to it, on a tree far too short to
need one).

**Root cause**: fixing #2 gave `CollectionTreeView`'s root `<ul>` `max-h-[65vh] overflow-y-auto`.
`RowActionsMenu`'s dropdown, though, was `position: absolute` *inside* that same `<ul>` (a normal
in-flow-adjacent descendant, not portalled out). Per the CSS overflow model, an absolutely
positioned descendant that extends past its scroll container's content box is still counted toward
that container's *scrollable overflow region* — so opening the menu made the `<ul>` believe its
content was now taller than `max-h-[65vh]`, and `overflow-y-auto` responded by drawing a scrollbar,
even though none of the visible rows needed one.

**Fix**: rendered the dropdown through a `react-dom` portal into `document.body` instead, positioned
with `position: fixed` computed from the trigger button's `getBoundingClientRect()` at open time —
this removes it from the tree's DOM subtree entirely, so it can never contribute to the tree's own
scrollable overflow calculation again. Outside-click detection was extended to also treat a click
inside the portalled menu (tagged `data-testid="row-actions-menu-portal"`) as "inside", since it's
no longer a DOM descendant of the button's own wrapper `containerRef` used for that check. A
capturing `scroll`/`resize` listener on `window` closes the menu rather than trying to keep a
`position: fixed` menu pinned to a button that may have scrolled out from under it — simpler and
avoids a flicker of stale position.

**Files**: `frontend/src/components/CollectionTreeView.tsx`.
**Test**: none added — this is a layout/rendering-model bug (Testing Library's jsdom environment
doesn't lay out real scrollbars or compute real `getBoundingClientRect()` values), verified by
`npx tsc`/`npm run lint`/full test suite staying green plus manual reasoning about the CSS overflow
model; a real visual regression test would need a browser-based tool not available in this session.

---

## 9. Save and Close buttons don't look like a matched pair

**Root cause**: In both `RequestEditorPanel` and `VariablePanel`, Save used `BUTTON_STYLES.primary`
(a solid filled button) while Close used `BUTTON_STYLES.ghost` (a bare text link) — very different
visual weight for two buttons meant to be read as one pair of actions.

**Fix**: Switched Close from `ghost` to `secondary` (a bordered box button) in both components, so
Save (filled) and Close (bordered) now present as a consistent, matched button pair.

**Files**: `frontend/src/components/RequestEditorPanel.tsx`, `frontend/src/components/VariablePanel.tsx`.

---

## 10. Tree pane not the same height as the panel next to it

**Root cause**: The tree's height was capped independently (`max-h-[65vh]`, from fixing #2) with no
relationship to the request editor/variable panel column beside it, so the tree could end up
noticeably shorter or taller than its neighbor depending on that neighbor's own content.

**Fix**: The grid wrapping both columns now uses `items-stretch` (CSS Grid's own default, made
explicit) so both columns always match the row's height — whichever column has more natural content
sets that height, and the other stretches to it. The page's left-column wrapper is `flex h-full
flex-col`; `CollectionTreeView`'s own root changed from `h-full` to `flex-1 min-h-0`, so it fills
whatever height that stretched wrapper ends up with (accounting for the `viewError` banner also
sharing that column), and its internal `<ul>` keeps its own `flex-1 min-h-0 overflow-y-auto` to
scroll within that space rather than growing past it. This is the standard nested-flex-in-grid
pattern for "match a sidebar's height to taller content next to it, with internal scrolling" — CSS
Grid's auto-track-sizing treats percentage/`flex-1` heights as ignorable for the *sizing* pass (so
the tree doesn't itself inflate the row), then the *stretch* pass gives it that computed height for
real once the row size is settled.

**Files**: `frontend/src/pages/ExternalCollectionsPage.tsx`, `frontend/src/components/CollectionTreeView.tsx`.

---

## 11. No way to add a folder (only requests)

**Root cause**: The tree's "+ Add request" and each folder's "Add request here" were the only
structural-add actions anywhere in the UI. There was no backend capability to create a folder at
all — `POST .../items` only ever built a Postman `Item` (a request), never an `ItemGroup` (a
folder).

**Fix**: Added `addFolder()` to `collectionStructure.ts`, using the same `PropertyList.add()`
mechanism as `addRequest()` — the `postman-collection` SDK's own `_createNewGroupedItem` picks
`ItemGroup` over `Item` for a plain object based solely on whether it has a truthy `item` property,
so `{ name, item: [] }` is sufficient. `POST .../items` gained an additive `kind: "folder" |
"request"` field (default `"request"`, preserving the existing contract exactly for every existing
caller) that only requires `name` — no method/URL — when `kind: "folder"`. The frontend gained
`addUploadedCollectionFolder()`, a "+ Add folder" button in the tree's header row (next to "+ Add
request"), and an "Add folder here" entry in every folder's own actions menu, so folders nest to
any depth exactly like requests already did.

**Files**: `backend/src/externalCollections/collectionStructure.ts`, `backend/src/api/externalCollections.ts`,
`frontend/src/services/externalCollectionsClient.ts`, `frontend/src/components/CollectionTreeView.tsx`,
`frontend/src/pages/ExternalCollectionsPage.tsx`.
**Tests**: `backend/tests/unit/externalCollections/collectionStructure.test.ts` (`addFolder` at root,
nested, and unknown-parent error), `backend/tests/integration/externalCollections/collectionStructure.test.ts`
(`POST .../items` with `kind: "folder"`, and its name-only requirement), `frontend/tests/unit/CollectionTreeView.test.tsx`
("+ Add folder" header button, and a folder's own "Add folder here" menu item).

---

## 12. Resolved-preview section not tabbed like the edit section above it

**Root cause**: `RequestEditorPanel`'s "Resolved preview" block showed method/URL, every resolved
header, and the resolved body all stacked in one continuous block below the edit tabs, rather than
mirroring that same tabbed structure.

**Fix**: Added a second, independent tab bar (**Request**, **Body**, **Tests**) to the resolved
preview, with its own `previewTab` state separate from the edit tabs above it. "Request" shows the
resolved method/URL/headers; "Body" shows the resolved body (or "No body."); "Tests" shows the
current test script content (or "No test script."), read-only, so it's visible without switching
the *edit* tabs up top. The unresolved-variables warning stays outside the tabs, always visible,
since it's a cross-cutting concern rather than specific to one section.

**Files**: `frontend/src/components/RequestEditorPanel.tsx`.
**Test**: `frontend/tests/unit/RequestEditorPanel.test.tsx` — "tabs the resolved preview into
Request/Body/Tests sections"; existing tests updated to scope their `getByRole("tab", ...)` queries
to the correct `tablist` now that two tab bars both have same-named tabs ("Headers"/"Body"/"Tests"
edit tabs vs. "Request"/"Body"/"Tests" preview tabs).

---

## 13. Arrow-only vertical scrollbar on tab bars

Reported as two screenshots that looked unrelated (the app-level "Guided Workflow / Import & Run
Collection" tabs, and the new "Request/Response/Tests" tabs from #7) — both turned out to be the
same shared component.

**Root cause**: `Tabs.tsx` (used by both the app-level tab switcher and, since #7, `ResultDetail`)
sets `overflow-x-auto` but never touches `overflow-y`. Per the CSS overflow spec, a non-`visible`
`overflow-x` with an unset `overflow-y` computes `overflow-y` to `auto` too — the two axes can't mix
`visible` with a non-`visible` value. So the browser also treats this one-row tab bar as vertically
scrollable, and a single pixel of vertical overflow (from a focus ring, or the active tab's
`-mb-px`/border-bottom overlap trick) was enough to draw a real vertical scrollbar whose thumb
nearly fills its own tiny track — rendering as what looks like two touching up/down arrows with no
visible groove, at whatever vertical position that particular tab bar happens to sit on the page
(explaining why the two screenshots looked unrelated: they're the same bug on two different tab
bars, not the page's own scrollbar).

**Fix**: Added `overflow-y-hidden` alongside the existing `overflow-x-auto`, so only horizontal
overflow is ever considered — the intended behavior for a row of tabs in the first place.

**Files**: `frontend/src/components/Tabs.tsx`.
**Test**: none added — this is a real-browser layout/rendering-model bug (jsdom, used by this
project's component tests, doesn't compute real overflow/scrollbar geometry), verified instead by
reasoning about the CSS overflow spec's `visible`-mixing rule plus `npx tsc`/`npm run
lint`/full test suite staying green.

---

## 14. #5's fix had a remaining gap: risk-tier gate interaction

Found because the user reported the #5 symptom recurring even after confirming — re-diagnosis found
a real gap in that same fix, not a fresh unrelated bug.

**Root cause**: The backend's `POST .../execution/start` records `confirmedAt` (gate 1, FR-007) the
instant a `confirmed: true` request reaches it — *unconditionally, before it even evaluates gate 2*
(risk tier / destructive request, FR-013). So a collection whose very first run also happens to need
gate 2 — any collection containing a destructive `POST`/`PUT`/`PATCH`/`DELETE` request, which is
common — gets `confirmedAt` set server-side on that very call, even though the same call is then
*blocked* with gate 2's own separate confirmation requirement. #5's fix only called the
`onConfirmed` sync on the eventual *successful* run start, which this scenario never reaches on its
first round-trip (`performStart(true, true)` returns early into `setPendingRiskTierConfirmation`
instead), and the second round-trip (confirming gate 2) calls `performStart(true)` *without* the
`confirmingUnverifiedContent` flag — so `onConfirmed` never fires in either call, and the page's
cached `confirmedAt` stays stale exactly as it did before #5 was fixed. A second, related bug this
surfaced: `showUnverifiedDialog` was also never cleared on the gate-2-blocked response, so the
unverified-content dialog stayed open, stacked underneath the newly-shown risk-tier banner.

**Fix**: Introduced a single `gate1Satisfied` check — true for every response except a network
failure or the unverified-content error itself (the only two cases where gate 1 genuinely wasn't
satisfied). Both the `onConfirmed` sync and clearing `showUnverifiedDialog` now key off
`gate1Satisfied` rather than off the whole call's eventual success, so both fire correctly the
moment gate 1 is satisfied regardless of what gate 2 does next.

**Files**: `frontend/src/components/ExternalCollectionRunPanel.tsx`.
**Test**: `frontend/tests/unit/ExternalCollectionsPage.test.tsx` — "still syncs the confirmation
when the first run also needs the separate risk-tier gate" (reproduces the exact two-gate sequence
and asserts a third run click skips the unverified-content dialog, and that the dialog and banner
are never both shown at once).

---

## Validation performed

- `npx tsc --noEmit -p frontend/tsconfig.json` and `-p backend/tsconfig.json` — clean.
- `npx eslint` on every touched file, and `npm run lint` (repo-wide) — clean.
- `npm test` (repo-wide) — 1363/1365 passing (2 pre-existing, unrelated skips).
- `npm run build` (repo-wide) — succeeds across all workspaces.
- Not done: a live browser walkthrough (no browser-automation tool available in this session) —
  verification here is TypeScript + ESLint + Vitest/React Testing Library/Supertest only, consistent
  with how this limitation is already recorded elsewhere in this feature's own `tasks.md` (T050) and
  in `specs/ROADMAP.md`'s prior AP-017/AP-026 entries. Item #13 in particular (a real-browser
  scrollbar rendering bug) could not be directly observed or regression-tested here — the fix is
  reasoned from the CSS overflow specification, not confirmed visually.
