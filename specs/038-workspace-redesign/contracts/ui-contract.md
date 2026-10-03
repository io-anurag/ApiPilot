# UI Contract: Workspace Redesign

This feature has no HTTP, API or shared-domain contract (FR-025). It defines the user-facing
interaction contract that tests and assistive technology rely on: the stable accessible roles,
names and test identifiers. Existing contracts kept unchanged are marked **(kept)**.

## Header (`AppHeader`)

| Element | Role / identifier | Accessible name | Notes |
|---|---|---|---|
| Product name | text | "ApiPilot" | **(kept)** |
| Subtitle | text, truncates | "API test engineering workspace" | **(kept)** keeps the `truncate` class (spec 027 FR-009) |
| Theme control | `group` | "Color theme" | **(kept)** two `button`s, "Light theme" and "Dark theme", with `aria-pressed` |
| Help button | `button` | "Keyboard shortcuts and help" | opens the help dialog |
| Palette button | `button` | "Open command palette" | visible hint "Ctrl K", or "⌘ K" on macOS; the hint hides below `sm` |
| Connection status | `data-testid="connection-status"` | text "Connecting…", "Connected" or "Disconnected" | **(kept)** `role="alert"` and `title` = error when disconnected; no chevron |

`AppHeader` props change from `{ health }` to
`{ health, theme, onThemeChange, onOpenCommandPalette }` (research D5).

## Start screen (`EntryChooser`)

| Element | Role / identifier | Accessible name |
|---|---|---|
| Container | `data-testid="entry-chooser"` | **(kept)** |
| Headline | `heading` level 2 | "Start with the artifact you have." |
| Artifact group | `group`, one per artifact | "OpenAPI specification", "Postman collection", "k6 script" |
| Artifact workflow control | `button` | "`{title}`, for an OpenAPI specification" / "…, for a Postman collection" / "…, for a k6 script" |
| Section heading | `heading` level 2, id `entry-paths-heading` | "Launch a test session" **(kept)** |
| Workflow card | `button`, one per workflow | exactly the workflow title, e.g. "Guided Workflow" **(kept)**; `aria-describedby` → its description **(kept)** |
| Illustration | `aria-hidden="true"` | none |

`onSelect(choice: EntryChoice)` stays the component's only output **(kept)**.

## Top tab menu (`Tabs`)

- **(kept)** a `navigation` named "Top-level views", one `button` per tab, `aria-current="page"`
  on the active tab, labels unchanged.
- **New**: optional `TabItem.markerClassName`. When present, an `aria-hidden` colour square
  renders before the label. It does not change the button's accessible name.

## Command palette (`CommandPalette`)

| Element | Role | Name / state |
|---|---|---|
| Panel | `dialog`, `aria-modal="true"`, `data-testid="command-palette"` | labelled by a visually hidden heading "Command palette" |
| Filter | `combobox` | "Filter commands"; `aria-expanded="true"`, `aria-controls` → listbox, `aria-activedescendant` → active option |
| List | `listbox` | "Commands" |
| Entry | `option` | its label; `aria-selected="true"` on the active option only |
| Empty message | `status` | "No matching commands" |

Keyboard:
- Down and Up arrows move the active option and wrap at either end.
- Enter runs the active option.
- Escape closes.
- Tab stays inside the dialog.
- Clicking the backdrop closes; clicking an option runs it.

Opening:
- Ctrl+K or Meta+K, never while the target is editable or an `aria-modal` element exists;
- or the header's palette button.

## Help dialog (`HelpDialog`)

| Element | Role | Name |
|---|---|---|
| Panel | `dialog`, `aria-modal="true"`, `data-testid="help-dialog"` | "Keyboard shortcuts and workflows" |
| Shortcuts | `table` | "Keyboard shortcuts". Rows: "Ctrl K / ⌘ K" → "Open the command palette"; "Esc" → "Close a dialog or the palette"; "↑ ↓ and Enter" → "Move and choose in the palette" |
| Workflows | list | the five titles, each with its catalog description |
| Close | `button` | "Close" |

## Shared `Dialog`

- **New (additive)**: optional `onBackdropClick?: () => void`, called only when the click target
  is the backdrop element itself.
- **(kept)** Every existing caller omits it and behaves as before.
