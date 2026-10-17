# Contract: Shell structure, accessibility and test contracts

Implements FR-001 to FR-005, FR-011, FR-015, FR-022 to FR-024, SC-007 to SC-009.

## Landmarks and order

1. A skip link ("Skip to main content") first in the tab order, visible on focus.
2. `<nav aria-label="Primary">` inside the `<aside data-testid="sidebar">`: the sidebar. Brand, logo and version at its top; then Home, Guided Workflow (with a disclosure for its eleven stages), Import & Run Collection, Performance, Run k6 Script, Coverage. Nothing else (FR-002).
3. `<header>`: breadcrumb and `<h1>` for the screen; the command-palette button, connection status, theme control and help control.
4. `<main id="main">`: the notice live region (`role="status"`), then the page.

## Names and states

| Element | Contract |
|---|---|
| Destination | A link (`<a href="#/...">`) named by the workflow title from `workflowCatalog` ("Import & Run Collection" in full), or "Home" / "Coverage". The current one has `aria-current="page"`. |
| Home launch tile | A button whose whole accessible name is the workflow title; artifact controls keep "{title}, for {artifact phrase}". Roles differ from the sidebar links, so by-role queries stay unique. |
| Guided Workflow entry | A link to `#/guided` like the other destinations, with a separate disclosure button beside it (`aria-label` "Show/Hide Guided Workflow stages", `aria-expanded`, `aria-controls` the stage list). The Home tile keeps the button role, and the sidebar keeps the link role, so by-role queries stay unique. The list opens by itself while the Guided Workflow is the current page. |
| Stage item | Done: a link, with an icon labelled "Done" (a stale stage is a link marked "Redo"). Current: `aria-current="step"`. Locked: a button (not a link) with `aria-disabled="true"`, an icon labelled "Locked" and its reason in `aria-describedby` text ("Complete X first", or "Upload a specification first" with no workflow), shown as a tooltip on hover and focus. State is text or an icon with an accessible name, never colour alone. |
| Menu button (narrow) | `aria-label="Open navigation"`, `aria-expanded`, `aria-controls` the sidebar. |
| Drawer | Opens over a dimming layer; focus moves inside and is trapped; Escape, a destination choice or the dimming layer closes it and focus returns to the menu button. Uses the shared `useFocusTrap` also used by `Dialog`. |
| Connection status | Keeps `data-testid="connection-status"`, the three states Connecting, Connected, Disconnected as words, and `role="alert"` for Disconnected. |
| Palette and help | Keep `data-testid="command-palette"` / `help-dialog`, the dialog names "Command palette" and "Keyboard shortcuts and workflows", and the shortcut Ctrl+K / ⌘ K. "Back to start" becomes "Go to Home". |

## Preserved test identifiers

`connection-status`, `command-palette`, `help-dialog`, `workflow-stage-tracker`, `workflow-position`, `phase-tile-*`, `stage-status-*`, `stat-tile`, `coverage-page`, `performance-path`, `performance-step-*`, `external-collection-upload` and every `data-testid` inside the in-scope pages. Retired: `entry-chooser`. New: `app-shell`, `sidebar`, `sidebar-destination-{id}`, `sidebar-stage-{stageId}`, `route-notice`, `home-page`, `home-recent-runs`, `menu-button`.

## Behaviour that must not change

Pages stay mounted once reached and are hidden, not unmounted, when another destination is shown. The guided page's resume guard (the `lastHandoffKey` ref in `TestGenerationWorkflowPage`) and its one-time execution hand-off still fire at most once per mounted instance. Unsaved-changes questions appear where they do today (script editor view switch, exit with edits). Ctrl+K is ignored in text fields and over another dialog, as now.

## Responsive contract

Below `lg` (1024 px): the sidebar is a drawer, grids collapse to one or two columns, wide tables and code blocks scroll inside their card. At 320, 390, 768, 1280 and 1920 px no in-scope screen scrolls the page sideways. No script reads `matchMedia`; the switch is CSS only (jsdom has no `matchMedia`).

## Motion

The drawer's slide and any transition sit behind `motion-safe:`; with reduced motion the drawer appears without animation and nothing depends on it (FR-011).

## Tests

Shell render and landmark order; destination states and `aria-current`; locked stage not navigable with its reason; drawer open, Escape, scrim click, trap and focus return; skip link; connection status states; palette and help focus return (re-homed from `AppHeader.test.tsx`); stay-mounted check (no second `/api/external-collections` fetch when returning to Import & Run).
