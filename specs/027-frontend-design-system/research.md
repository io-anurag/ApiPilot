# Phase 0 Research: Frontend Design System & Application Shell

## D1: What design-system infrastructure already exists?

**Decision**: Treat this feature as extending an existing, deliberately-built system, not
creating one from scratch.

**Rationale**: Direct inspection of `frontend/src` found:

- `frontend/src/index.css` already defines Tailwind v4 CSS-first design tokens (`@theme`) for
  brand/success/warning/danger/info colors, surface/background/muted/border, and font families —
  exactly the token layer CLAUDE.md §29 asks for. It has no dark-mode variants.
- `StatusBadge.tsx`, `HttpMethodBadge.tsx`, `ProvenanceBadge.tsx`, and `controlStyles.ts`
  (`BUTTON_STYLES`) are each explicitly documented in their own file header as the "single source
  of truth" for their concept, consolidating duplicated styling that a prior `/speckit-analyze`
  pass flagged (finding "U1", referenced in comments). They are actively imported by multiple
  consumers already (e.g. `HttpMethodBadge` by `OperationList`, `OperationDetail`,
  `TestScenarioReviewList`).
- `WorkflowStageTracker.tsx` already renders the full 10-stage workflow order with per-stage
  status (`not-yet-reached` / `active` / `complete` / `stale` / `skipped` / `partial`), already
  distinguishes revisitable vs. read-only vs. locked stages, and already satisfies "status is
  never color-only" (status is always rendered as a text label via `StatusBadge`).
- There is no router (`App.tsx` documents this as an intentional decision carried over from spec
  009: two top-level views toggle via local state, not routes) and no sidebar — the "shell" today
  is a single sticky header plus this stage tracker, rendered inside the active page.
- There is no existing `EmptyState`, `ErrorState`, `Skeleton`, `Card`, or generic `Dialog`
  component; `ConfirmDialog.tsx` hand-rolls its own modal/focus-trap markup rather than composing
  a shared primitive.
- No icon library, animation library, or component-library dependency exists; icons are
  hand-rolled inline SVGs (e.g. `WorkflowStageTracker`'s local `CheckIcon`).

**Implication for this plan**: the spec's requirements (FR-001–FR-015) are satisfied by (a)
filling the identified gaps — dark mode, empty/error/loading states, a generic dialog primitive
— and (b) making an implicit-but-already-correct behavior explicit (locked-stage reasoning),
rather than by replacing working, tested, intentionally-consolidated code. Re-implementing
`StatusBadge`/`HttpMethodBadge`/`ProvenanceBadge`/`BUTTON_STYLES`/`WorkflowStageTracker` from
scratch would violate CLAUDE.md §59 (search before creating) and §60 (avoid premature
abstraction / do not collapse intentional architecture) and would risk regressing the ~35
existing unit/accessibility tests that already assert on their current `data-testid`s and
rendered text.

**Alternatives considered**: A ground-up rewrite of the shared component set (as a generic
`components/ui/*` library) was considered, matching the scale of the original redesign brief.
Rejected for this phase — it would duplicate working, tested code, touch every consumer's
imports as an unrelated refactor (CLAUDE.md §58), and contradicts the "smallest coherent change"
principle (CLAUDE.md §7) for a spec explicitly scoped to closing gaps, not a rewrite.

## D2: How should dark mode be implemented?

**Decision**: Add dark-mode color tokens to the existing `@theme` block in `index.css` using
Tailwind v4's `dark:` variant driven by `prefers-color-scheme`, with no manual theme switcher in
this phase (per spec Assumptions — OS/browser preference is a reasonable default; a manual
switcher is a future enhancement, not required).

**Rationale**: Tailwind v4's CSS-first configuration lets dark values be declared alongside the
existing light tokens in the same file, preserving the "no `tailwind.config.js`" convention
(CLAUDE.md §27) and keeping every token in one place developers already know to look.

**Alternatives considered**: A JS-driven theme-context/provider with a persisted user
preference — rejected for this phase as unnecessary infrastructure (Constitution XXVII) until a
concrete requirement for a manual switcher exists; CSS media-query-driven dark mode is the
simplest mechanism that satisfies FR-008 today.

## D3: Should the flat `components/` directory be reorganized into `ui/`/`layout/`/etc.?

**Decision**: No — keep the existing flat `frontend/src/components/` layout; add new files at the
same level.

**Rationale**: The directory currently holds ~40 files with no subfolder precedent. Introducing a
`ui/`/`layout/` split now would rewrite import paths across most existing components and tests
for a purely organizational change unrelated to this spec's functional requirements — exactly
the "unrelated refactoring" CLAUDE.md §58 and §60 warn against. If a future phase's growth in
file count genuinely warrants it, that reorganization can be proposed on its own, reviewable
merits.

**Alternatives considered**: Adopting the `components/{ui,layout,workflow,ai}/` structure from
the original redesign brief verbatim — rejected for this phase for the reason above; the brief
itself says to adapt the structure to the repository rather than impose it blindly.

## D4: How is a "locked" stage's reason computed (FR-004)?

**Decision**: Compute it purely on the client from data already available — `WORKFLOW_STAGE_ORDER`
and `workflow.stages` — with no new backend field.

**Rationale**: `packages/shared-domain/src/testGenerationWorkflow.ts` defines a strictly ordered,
single-active-stage workflow (`WORKFLOW_STAGE_ORDER`, `activeStageId`, one `StageStatus` per
stage). A stage in `not-yet-reached` status is always locked for exactly one reason: the stage
immediately before it in `WORKFLOW_STAGE_ORDER` is not yet `complete`. That prior stage's label
(already defined in `WorkflowStageTracker`'s `STAGE_LABELS`) is sufficient to render "Complete
<prior stage> first" without any new API data, satisfying the spec's Assumption that this phase
requires no backend contract change.

**Alternatives considered**: Adding a `lockReason` field to the backend's workflow response —
rejected as unnecessary; the ordering already fully determines the reason, so adding a
server-computed duplicate of client-derivable information would be pure overhead.

## D5: Icon strategy for new components (EmptyState/ErrorState/Skeleton/Dialog)

**Decision**: Continue the existing hand-rolled inline-SVG convention (as `WorkflowStageTracker`
already does for its check icon); no icon library dependency is added.

**Rationale**: The number of net-new icons needed (e.g. an alert glyph for `ErrorState`, an
empty-tray glyph for `EmptyState`) is small enough that a dependency is not justified per
CLAUDE.md §5's dependency checklist and Constitution XXVII; matching the existing convention also
keeps visual weight/stroke style consistent without a design decision about which icon set to
adopt.

**Alternatives considered**: `lucide-react` or `@heroicons/react` — rejected as an unjustified
new dependency for a handful of icons the codebase already knows how to hand-roll consistently.

## D6: Does FR-006's "tabbed content panels" requirement need a new component?

**Decision**: Yes — add a small `Tabs.tsx` primitive and migrate `App.tsx`'s existing top-level
tab bar (the `TABS.map(...)` block choosing between "Guided Workflow" and "Import & Run
Collection") onto it.

**Rationale**: FR-006 explicitly lists tabbed content panels among the minimum shared components
this phase must provide. `App.tsx` already has exactly one tab pattern today; extracting it is a
small, low-risk change that closes the requirement rather than leaving it uncovered, and it gives
any future page that needs tabs (e.g. a later per-page redesign phase) a component to reuse
instead of re-hand-rolling the same `aria-current`/focus-ring markup again.

**Alternatives considered**: Leaving `App.tsx`'s tab bar inline and treating FR-006's tabs clause
as not-yet-applicable (since only one tab instance exists today) — rejected because it would
leave a spec requirement with literally zero implementation, discovered as a real gap during
`/speckit-analyze` (finding E1), rather than a documented, deliberate scope reduction.

## D7: Where is the line between a "loading condition" (FR-007) and a button's own busy state?

**Decision**: FR-007's shared `Skeleton` pattern covers content-panel loading (waiting for data
before anything meaningful can render — e.g. `AppHeader`'s "Connecting…" indicator). It does
**not** cover a button's own in-progress label/disabled state (e.g. `PostmanExportPanel`'s and
`PostmanGenerationStage`'s `status === "loading"` → "Exporting…"/"Generating…" text,
`TestGenerationWorkflowPage`'s and `ExternalCollectionUpload`'s "Uploading…" text).

**Rationale**: A busy button is already a single, consistent, deliberate convention across this
codebase (disabled state + `BUTTON_STYLES` + a label change) — it is not "ad hoc or absent"
(FR-007's actual concern), and replacing an inline button label with a full `Skeleton` panel
would be a worse UX for a sub-second action, not a consistency fix. This boundary was found to be
undocumented during `/speckit-analyze` (finding C1); recording it here gives task T057's
(formerly T054) final audit a documented line to check against instead of re-litigating the
question.

**Alternatives considered**: Migrating every `status === "loading"` button label onto `Skeleton`
— rejected as scope creep beyond what FR-007 is actually asking for, and a regression in that
specific interaction (a placeholder skeleton doesn't tell the user "your export is running" the
way a labeled disabled button does).
