# Validation: Workspace Redesign (AP-038)

**Date**: 2026-10-04 · **Version**: 19.20.0

## Automated

| Check | Result |
|---|---|
| `npm test` (workspace) | 312 files passed, 3 skipped; 2,470 tests passed, 10 skipped (opt-in suites) |
| `npm test -w frontend` | 78 files, 500 tests passed (includes the new `EntryChooser`, `CommandPalette`, `HelpDialog`, `paletteCommands`, `workflowCatalog` tests and the extended `App`, `AppHeader`, `Dialog`, `Tabs` tests) |
| `npm run lint` | clean |
| `npm run build` | exit 0, no warnings |

Intentional test change (SC-006): `UserScriptPage.test.tsx` "is offered on the start screen" now
queries `{ name: "Run k6 Script" }` exactly (plan.md). `AppHeader.test.tsx` passes the new props;
its four original assertions are unchanged.

## Scripted browser walkthrough

These checks ran with Playwright 1.63 (Chromium) against the Vite dev server and the backend in
`AI_PROVIDER_MODE=mock`. Screenshots were reviewed by eye.

| Scenario | Check | Result |
|---|---|---|
| 2 (SC-001, amended) | First pass: lowest card bottom 644 px of 657, but the user found the page crammed. Design A spacing restored: section heading top at 606 px of 657, cards start at 658 px | **pass** (amended criterion) |
| 6 (FR-001) | Computed headline font | `"IBM Plex Sans", …` in both themes: **pass** |
| 6 (FR-003) | Body background | `rgb(246, 248, 251)` light, `rgb(7, 13, 26)` dark: **pass** |
| 6 (SC-004) | Start screen and the five views in dark theme | navy surfaces throughout. The four start heroes' decorative glow was retinted from teal to the blue token during this check: **pass** |
| 1, 3 | Artifact choices, cards, tab colour markers | as specified: **pass** |
| 4 | Ctrl+K on a workflow view, type "gui", Enter | opens Guided Workflow through its tab (tab menu shown, so FR-019's tab path): **pass** |
| 4 (FR-018) | Ctrl+K inside the collection Name field | palette does not open: **pass** |
| 5 | Help dialog, then Escape | closes, focus back on the help button: **pass** |
| 7 (FR-012) | 390 px width | no horizontal overflow, one column, illustration hidden. The header hides the version badge below `sm` and the name truncates; the controls stay reachable: **pass** |
| 7 (FR-024) | Reduced motion | card `transition-duration` 1e-05s: **pass** |

## Outstanding

The user's own walkthrough of quickstart scenarios 1 to 7 in a real browser (constitution XXXI),
including scenario 4 step 8 with an in-progress guided run and scenario 4 step 9 with the network
panel open. Automated tests cover both (`App.test.tsx`), but neither has been observed by hand.
