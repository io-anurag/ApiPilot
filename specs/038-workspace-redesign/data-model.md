# Data Model: Workspace Redesign

This feature adds no persisted, transmitted or shared-domain data (FR-025). The structures below
are frontend presentation metadata. They are fixed in source or derived on each render, and never
stored. The only stored value the feature touches is the existing theme choice
(`localStorage["apipilot-theme"]`), written exactly as today.

## WorkflowEntry (fixed, `workflowCatalog.ts`)

| Field | Type | Rule |
|---|---|---|
| `id` | `EntryChoice` (`"guided-workflow" \| "import-collection" \| "quick-performance" \| "performance-plans" \| "user-script"`) | One per top-level view. Order = today's tab order. |
| `title` | string | Start-screen and palette title, verbatim from today's entry chooser ("Guided Workflow", "Import & Run Collection", "Quick performance test", "Performance plans", "Run k6 Script"). |
| `tabLabel` | string | Verbatim from today's `TABS` ("Quick Performance Test" keeps its capitals) (FR-013). |
| `description` | string | Verbatim from today's entry chooser. Used by the card, the help dialog and the card's accessible description. |
| `icon` | `WorkflowIconName` | One of five icons (research D11). |
| `recommended` | boolean | True only for Guided Workflow (FR-011). |
| `tone` | object of literal class strings | `marker` (small square), `text`, `solid` (arrow button), `tint` (icon tile, card border). Every value derives from the workflow's `--color-wf-*` token (FR-002). |

**Invariants**:
- There are exactly five entries, and their ids equal the `EntryChoice` union. A test checks the
  catalog against the union.
- Every colour is shown next to its title (FR-005).

## ArtifactChoice (fixed, `workflowCatalog.ts`)

| Field | Type | Rule |
|---|---|---|
| `id` | `"openapi" \| "postman" \| "k6"` | |
| `label` | string | "OpenAPI specification", "Postman collection", "k6 script". |
| `phrase` | string | "an OpenAPI specification", "a Postman collection", "a k6 script". |
| `workflows` | readonly `EntryChoice[]` | `openapi` → `guided-workflow`, `quick-performance`; `postman` → `import-collection`; `k6` → `user-script` (FR-009). |
| `icon` | `ArtifactIconName` | |

Each listed workflow renders as a control named "`{title}`, for `{phrase}`", where `phrase` is the
artifact with its article, e.g. "Guided Workflow, for an OpenAPI specification" (research D9). Activating it calls the same `onSelect(id)` as the card.

## Command (derived, `paletteCommands.ts`)

```text
Command =
  | { kind: "workflow"; id: EntryChoice; label: string /* catalog title */ }
  | { kind: "back-to-start"; label: "Back to start" }
  | { kind: "theme"; target: "light" | "dark"; label: "Switch to light theme" | "Switch to dark theme" }
```

`buildCommands({ workflowShown, theme })` returns, in order:
1. the five workflow commands, in catalog order;
2. `back-to-start`, only when `workflowShown` is true;
3. the `theme` command whose `target` is the opposite of `theme`.

`filterCommands(commands, query)`:
- returns the commands whose `label` contains `query.trim()`, ignoring case;
- returns every command for an empty query;
- keeps the input order.

## Palette UI state (component-local, never stored)

| State | Rule |
|---|---|
| `open` | Owned by `App`. Set by the shortcut (subject to FR-018) or the header button; cleared on run, Escape or backdrop click. |
| `query` | Reset to `""` on every opening. |
| `activeIndex` | Starts at `0` and resets to `0` whenever the filtered list changes. Down/Up move it modulo the list length. It is meaningless (no active option) when the list is empty. |

## State transitions (App navigation, unchanged handlers)

| Palette action | Condition | Handler called | Same as |
|---|---|---|---|
| workflow `id` | `started && tabsVisible` | `handleTabChange(id)` | Clicking its tab |
| workflow `id` | otherwise | `handleSelect(id)` | Clicking its start-screen card |
| back-to-start | `started` | `handleExitToStart()` | The existing "Back to start" control |
| theme `target` | always | `setTheme(target)` | The header theme control |
